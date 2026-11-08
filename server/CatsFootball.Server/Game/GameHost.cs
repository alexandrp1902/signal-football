using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using CatsFootball.Server.Net;
using CatsFootball.Sim;

namespace CatsFootball.Server.Game;

public sealed class Participant(Connection connection, string name, string team, double now) : SoccerPlayer(Guid.NewGuid().ToString("N"), team, now)
{
    public Connection Connection { get; } = connection;
    public string Epoch { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; } = name;
}

public sealed class Room(string code, Balance balance)
{
    public string Code { get; } = code;
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string MatchId { get; set; } = Guid.NewGuid().ToString("N");
    public string? PreviousMatchId { get; set; }
    public FootballWorld World { get; } = new(balance);
    public List<Participant> Players { get; } = [];
    public int SnapshotSeq { get; set; }
    public bool Dirty { get; set; } = true;
}

public sealed class GameHost : BackgroundService
{
    private readonly Channel<(Connection, JsonElement)> _commands = Channel.CreateBounded<(Connection, JsonElement)>(
        new BoundedChannelOptions(Protocol.CommandsCapacity) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private readonly Dictionary<string, Room> _rooms = [];
    private readonly Dictionary<string, (Room Room, Participant Player)> _players = [];
    private readonly ILogger<GameHost> _log;
    public Balance Balance { get; }
    public string BalanceHash { get; }
    public int Tick { get; private set; }
    public bool Ready { get; private set; }
    public static double NowMs => Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;

    public GameHost(IConfiguration config, ILogger<GameHost> log)
    {
        _log = log;
        (Balance, BalanceHash) = Balance.Load(config["BalancePath"] ?? Path.Combine(AppContext.BaseDirectory, "football.json"));
    }

    public bool Enqueue(Connection connection, JsonElement command) => _commands.Writer.TryWrite((connection, command));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Ready = true;
        var next = NowMs;
        var statsAt = next;
        var stepTimes = new List<double>();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var count = 0;
                while (NowMs >= next && count < 5)
                {
                    var start = NowMs;
                    Step(start);
                    stepTimes.Add(NowMs - start);
                    next += 1000.0 / 60;
                    count++;
                }
                if (NowMs >= next) { _log.LogWarning("Simulation overload; rescheduling without a large dt"); next = NowMs + 1000.0 / 60; }
                if (NowMs - statsAt > 10000)
                {
                    stepTimes.Sort();
                    if (stepTimes.Count > 0) _log.LogInformation("Tick {Tick}; rooms {Rooms}; step ms avg {Avg:F2}, p95 {P95:F2}, max {Max:F2}; sent bytes {Bytes}",
                        Tick, _rooms.Count, stepTimes.Average(), stepTimes[(int)((stepTimes.Count - 1) * .95)], stepTimes[^1],
                        _players.Values.Sum(p => p.Player.Connection.BytesSent));
                    stepTimes.Clear(); statsAt = NowMs;
                }
                await Task.Delay(TimeSpan.FromMilliseconds(Math.Clamp(next - NowMs, 1, 10)), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            Ready = false;
            foreach (var (_, p) in _players.Values) p.Connection.Close(1001, "Server stopping");
        }
    }

    private void Step(double now)
    {
        Tick++;
        foreach (var key in _players.Where(p => p.Value.Player.Connection.Closing).Select(p => p.Key).ToArray()) Remove(key);
        // Bounded work per global step; commands arriving while draining wait for the next step.
        for (var i = 0; i < Protocol.CommandsCapacity && _commands.Reader.TryRead(out var item); i++)
        {
            if (item.Item1.Closing) continue;
            try { Command(item.Item1, item.Item2, now); }
            catch (Exception e) when (e is JsonException or InvalidDataException or InvalidOperationException or KeyNotFoundException or FormatException or OverflowException)
            { _log.LogInformation("Rejected command: {Reason}", e.Message); item.Item1.Fail("invalidCommand", "Команда отклонена: неверные данные или порядок"); }
        }
        foreach (var r in _rooms.Values)
        {
            var phase = r.World.Phase;
            r.World.Step(Tick, now);
            if (phase != r.World.Phase) { r.Dirty = true; BroadcastRoster(r); _log.LogInformation("Room {Code} phase {Phase}", r.Code, r.World.Phase); }
            if (r.Dirty || Tick % 3 == 0)
            {
                r.SnapshotSeq++;
                foreach (var p in r.Players) p.Connection.Snapshot(SnapshotCodec.Encode(SnapshotFor(r, p)));
                r.Dirty = false;
            }
        }
    }

    private void Command(Connection c, JsonElement m, double now)
    {
        var type = m.GetProperty("type").GetString();
        if (type == "hello") { Join(c, m, now); return; }
        if (!_players.TryGetValue(c.Id, out var member)) throw new InvalidDataException("Not joined");
        var (r, p) = member;
        if (type == "ping")
        {
            var clientTime = m.GetProperty("clientTime").GetDouble();
            if (!double.IsFinite(clientTime)) throw new InvalidDataException("Invalid clock");
            c.Send(new { type = "pong", id = m.GetProperty("id").GetInt32(), clientTime, serverTick = Tick - 1, serverTime = now });
            return;
        }
        if (m.GetProperty("roomId").GetString() == r.Id && m.GetProperty("matchId").GetString() == r.PreviousMatchId) return;
        if (m.GetProperty("roomId").GetString() != r.Id || m.GetProperty("matchId").GetString() != r.MatchId ||
            m.GetProperty("connectionEpoch").GetString() != p.Epoch) throw new InvalidDataException("Stale identity");
        switch (type)
        {
            case "inputBatch":
                var array = m.GetProperty("frames");
                if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() is < 1 or > 4) throw new InvalidDataException("Batch too large");
                var frames = array.Deserialize<InputFrame[]>(Protocol.Json) ?? throw new InvalidDataException("Null batch");
                p.Input.Enqueue(frames, Tick, now, m.TryGetProperty("resync", out var resync) && resync.GetBoolean());
                break;
            case "cancelAction":
            case "suspend":
                p.Input.Stop(m.GetProperty("throughInputSeq").GetInt32(), type == "suspend");
                if (type == "suspend") r.World.Suspend(p); else r.World.Cancel(p);
                r.Dirty = true;
                break;
            case "leave": Remove(c.Id); c.Close(); break;
            case "startMatch":
            case "practice":
                if (r.Players[0] != p) { c.Send(Protocol.Error("notOrganizer", "Матч запускает создатель комнаты", false)); break; }
                if (type == "startMatch" && r.World.Phase is not ("training" or "finished")) break;
                r.PreviousMatchId = r.MatchId; r.MatchId = Guid.NewGuid().ToString("N");
                if (type == "startMatch") r.World.BeginMatch(Tick, p.Team); else r.World.Practice(Tick);
                foreach (var actor in r.Players) { actor.Epoch = Guid.NewGuid().ToString("N"); actor.ResetInput(now); Welcome(actor, r); }
                BroadcastRoster(r); r.Dirty = true;
                break;
            default: throw new InvalidDataException("Unsupported command");
        }
    }

    private void Join(Connection c, JsonElement m, double now)
    {
        if (c.Joined) throw new InvalidDataException("Duplicate hello");
        if (m.GetProperty("protocolVersion").GetInt32() != Protocol.Version) { c.Fail("protocolMismatch", "Обновите страницу: новая версия игры"); return; }
        var rawName = m.GetProperty("name").GetString() ?? "";
        if (rawName.Length > 256) throw new InvalidDataException("Name too long");
        Room? r;
        if (m.GetProperty("create").GetBoolean())
        {
            if (_rooms.Count >= 64) { c.Fail("serverFull", "Сервер занят"); return; }
            string code;
            do { code = RandomNumberGenerator.GetInt32(10000).ToString("D4", CultureInfo.InvariantCulture); } while (_rooms.ContainsKey(code));
            r = new Room(code, Balance); _rooms.Add(code, r);
            _log.LogInformation("Room {Code} created", code);
        }
        else
        {
            var code = m.GetProperty("code").GetString();
            if (code is null || code.Length != 4 || code.Any(ch => ch is < '0' or > '9') || !_rooms.TryGetValue(code, out r))
            { c.Fail("roomNotFound", "Комната не найдена"); return; }
        }
        if (r.Players.Count >= 2) { c.Fail("roomFull", "В комнате уже два участника"); return; }
        var name = CleanName(rawName);
        if (r.Players.Any(p => p.Name == name)) name = Truncate(name, 13) + " #2";
        var team = r.Players.Any(p => p.Team == "blue") ? "red" : "blue";
        var player = new Participant(c, name, team, now);
        r.Players.Add(player); r.World.Players.Add(player); r.World.PlaceSafely(player); _players[c.Id] = (r, player); c.Joined = true;
        Welcome(player, r);
        BroadcastRoster(r); r.Dirty = true;
    }

    private void Welcome(Participant player, Room r) => player.Connection.Send(new { type = "welcome", protocolVersion = Protocol.Version,
        roomId = r.Id, matchId = r.MatchId, playerId = player.Id, connectionEpoch = player.Epoch, team = player.Team,
        serverTick = Tick - 1, balance = Balance, balanceHash = BalanceHash,
        capabilities = new[] { "training", "movement", "contacts", "ball", "kick", "tackle", "match", "targetTick", "fullSnapshots" } });

    private void Remove(string id)
    {
        if (!_players.Remove(id, out var value)) return;
        var (r, p) = value;
        r.Players.Remove(p); r.World.Remove(p);
        if (r.Players.Count == 0) { _rooms.Remove(r.Code); _log.LogInformation("Room {Code} closed", r.Code); }
        else { BroadcastRoster(r); r.Dirty = true; }
    }

    private static void BroadcastRoster(Room r)
    {
        var state = new { type = "roomState", roomId = r.Id, matchId = r.MatchId, code = r.Code, phase = r.World.Phase, organizerId = r.Players[0].Id,
            players = r.Players.Select(p => new { playerId = p.Id, name = p.Name, team = p.Team }).ToArray() };
        foreach (var p in r.Players) p.Connection.Send(state);
    }

    public Snapshot SnapshotFor(Room r, Participant recipient) => new()
    {
        RoomId = r.Id, MatchId = r.MatchId, ConnectionEpoch = recipient.Epoch, SnapshotSeq = r.SnapshotSeq, ServerTick = Tick, Phase = r.World.Phase,
        Players = r.Players.Select(p => new PlayerSnapshot { PlayerId = p.Id, Team = p.Team,
            X = p.Motion.X, Y = p.Motion.Y, Vx = p.Motion.Vx, Vy = p.Motion.Vy, FacingX = p.Motion.FacingX, FacingY = p.Motion.FacingY,
            Preparing = p.PreparingMode != "", ActionId = p.PreparedActionId, ChargeStartTick = p.ChargeStartTick,
            ActionState = r.World.State(p), PreparationMode = p.PreparingMode, SlideX = p.SlideDirection.X, SlideY = p.SlideDirection.Y,
            SlideEndTick = p.SlideRemaining > 0 ? Tick + (int)Math.Ceiling(p.SlideRemaining / Balance.TackleSpeed * 60) : 0,
            RecoverEndTick = p.RecoverEndTick, CooldownEndTick = p.CooldownEndTick, LastActionId = p.LastActionId,
            PrepareVersion = p.PrepareVersion, AnimationEndTick = p.AnimationEndTick,
            DribbleX = p.Dribble.Direction.X, DribbleY = p.Dribble.Direction.Y, DribbleTargetX = p.Dribble.Target.X, DribbleTargetY = p.Dribble.Target.Y,
            DribbleTurnStartTick = p.Dribble.TurnStartTick, DribbleTurnEndTick = p.Dribble.TurnEndTick }).ToArray(),
        Recipient = new RecipientSnapshot { AckInputSeq = recipient.Input.Ack, MoveX = recipient.Input.Move.X, MoveY = recipient.Input.Move.Y,
            AimX = recipient.Input.Aim.X, AimY = recipient.Input.Aim.Y, Held = recipient.Input.Held,
            LastInputTick = recipient.Input.LastInputTick, Barrier = recipient.Input.Barrier, NeedsResync = recipient.Input.NeedsResync },
        Ball = new BallSnapshot { X = r.World.Ball.Position.X, Y = r.World.Ball.Position.Y, Vx = r.World.Ball.Velocity.X, Vy = r.World.Ball.Velocity.Y,
            State = r.World.Ball.State, OwnerId = r.World.Ball.OwnerId, PossessionVersion = r.World.Ball.PossessionVersion,
            CaptureBlockedUntilTick = r.World.Ball.CaptureBlockedUntilTick, OwnerBlockedId = r.World.Ball.OwnerBlockedId,
            OwnerBlockedUntilTick = r.World.Ball.OwnerBlockedUntilTick, ImpulseSeq = r.World.Ball.ImpulseSeq },
        Score = [r.World.BlueScore, r.World.RedScore], RemainingTime = r.World.Phase == "training" || r.World.Phase == "goalPause" && r.World.RemainingSeconds == Balance.MatchSeconds ? null : r.World.RemainingSeconds,
        PhaseEndTick = r.World.PhaseEndTick
    };

    public static string CleanName(string value)
    {
        var clean = new string(value.Where(ch => !char.IsControl(ch) && CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.Format).ToArray()).Trim();
        return clean.Length == 0 ? "Игрок" : Truncate(clean, 16);
    }
    private static string Truncate(string s, int length)
    {
        var elements = StringInfo.ParseCombiningCharacters(s);
        return elements.Length <= length ? s : s[..elements[length]];
    }
}
