namespace CatsFootball.Sim;

public class SoccerPlayer(string id, string team, double now)
{
    public string Id { get; } = id;
    public string Team { get; set; } = team;
    public Motion Motion { get; } = new() { Y = team == "blue" ? -2.5 : 2.5, FacingY = team == "blue" ? 1 : -1 };
    public InputTimeline Input { get; private set; } = new(now);
    public string PreparingMode { get; set; } = "";
    public int PrepareVersion { get; set; }
    public int ChargeStartTick { get; set; }
    public int PreparedActionId { get; set; }
    public int LastActionId { get; set; }
    public Vec SlideDirection { get; set; }
    public double SlideRemaining { get; set; }
    public bool Sliding { get; set; }
    public int RecoverEndTick { get; set; }
    public int CooldownEndTick { get; set; }
    public int AnimationEndTick { get; set; }
    public bool HitBall { get; set; }
    public DribbleState Dribble { get; } = new();
    public Vec Position { get => new(Motion.X, Motion.Y); set { Motion.X = value.X; Motion.Y = value.Y; } }
    public Vec Velocity { get => new(Motion.Vx, Motion.Vy); set { Motion.Vx = value.X; Motion.Vy = value.Y; } }
    public void ResetInput(double now) {Input = new(now);PreparedActionId=LastActionId=ChargeStartTick=PrepareVersion=0;PreparingMode="";}
}

public sealed class FootballBall
{
    public Vec Position { get; set; }
    public Vec Velocity { get; set; }
    public string State { get; set; } = "free";
    public string? OwnerId { get; set; }
    public int PossessionVersion { get; set; }
    public int CaptureBlockedUntilTick { get; set; }
    public string? OwnerBlockedId { get; set; }
    public int OwnerBlockedUntilTick { get; set; }
    public int ImpulseSeq { get; set; }
}

/// <summary>Continuous circle sweep in seconds. Touching circles collide only when approaching.</summary>
public static class Geometry
{
    public static double Sweep(Vec relativePosition, Vec relativeVelocity, double radius, double maxTime)
    {
        var c = relativePosition.Dot(relativePosition) - radius * radius;
        var approach = relativePosition.Dot(relativeVelocity);
        if (c <= 1e-8) return approach < -1e-9 ? 0 : double.PositiveInfinity;
        var a = relativeVelocity.Dot(relativeVelocity);
        var d = approach * approach - a * c;
        if (a < 1e-16 || approach >= 0 || d < 0) return double.PositiveInfinity;
        var t = (-approach - Math.Sqrt(d)) / a;
        return t >= -1e-9 && t <= maxTime + 1e-9 ? Math.Clamp(t, 0, maxTime) : double.PositiveInfinity;
    }
    public static bool SegmentBlocked(Vec from, Vec to, Vec center, double radius)
    {
        var delta = to - from;
        if (delta.Length < 1e-10) return (from - center).Length < radius - 1e-6;
        var t = Math.Clamp((center - from).Dot(delta) / delta.Dot(delta), 0, 1);
        return (from + delta * t - center).Length < radius - 1e-6;
    }
}

public sealed class FootballWorld(Balance balance)
{
    private const double Eps = 1e-8;
    public Balance Balance { get; } = balance;
    public List<SoccerPlayer> Players { get; } = [];
    public FootballBall Ball { get; } = new();
    public string Phase { get; private set; } = "training";
    public int Tick { get; private set; }
    public int BlueScore { get; private set; }
    public int RedScore { get; private set; }
    public double RemainingSeconds { get; private set; } = balance.MatchSeconds;
    public int PhaseEndTick { get; private set; }
    public string KickoffTeam { get; private set; } = "blue";
    private string _resumePhase = "training";
    public bool Active => Phase is "training" or "playing";
    public SoccerPlayer? Owner => Players.Find(p => p.Id == Ball.OwnerId);
    private int Ticks(double seconds) => (int)Math.Ceiling(seconds * 60);
    public void PlaceSafely(SoccerPlayer player)
    {
        var desired=player.Position;
        for(var ring=0;ring<20;ring++)for(var dx=-ring;dx<=ring;dx++)for(var dy=-ring;dy<=ring;dy++){
            var point=desired+new Vec(dx,dy)*(Balance.PlayerRadius*2+.2);
            if(Math.Abs(point.X)>Balance.FieldWidth/2-Balance.PlayerRadius||Math.Abs(point.Y)>Balance.FieldHeight/2-Balance.PlayerRadius)continue;
            if(Players.All(other=>other.Id==player.Id||(point-other.Position).Length>=Balance.PlayerRadius*2+.01)){player.Position=point;return;}
        }
        throw new InvalidOperationException("No free player spawn");
    }
    private void RepairOverlaps()
    {
        var players=Players.OrderBy(p=>p.Id).ToArray();
        for(var pass=0;pass<12;pass++)for(var i=0;i<players.Length;i++)for(var j=i+1;j<players.Length;j++){
            var a=players[i];var b=players[j];var delta=a.Position-b.Position;var distance=delta.Length;
            if(distance>=Balance.PlayerRadius*2-1e-7)continue;
            var n=distance>1e-9?delta*(1/distance):new Vec(-1,0);var correction=Balance.PlayerRadius*2-distance+1e-7;
            var am=a.Input.Move.Length>0||a.Sliding;var bm=b.Input.Move.Length>0||b.Sliding;
            if(am&&!bm)a.Position+=n*correction;else if(bm&&!am)b.Position-=n*correction;else{a.Position+=n*(correction/2);b.Position-=n*(correction/2);}
        }
    }

    public void BeginMatch(int tick, string firstTeam = "blue")
    {
        Tick = tick; BlueScore = RedScore = 0; RemainingSeconds = Balance.MatchSeconds;
        KickoffTeam = firstTeam; _resumePhase = "playing";
        ResetPositions(); Phase = "countdown"; PhaseEndTick = tick + 180;
    }
    public void Practice(int tick)
    {
        Tick = tick; Phase = "training"; _resumePhase = "training";
        BlueScore = RedScore = 0; RemainingSeconds = Balance.MatchSeconds; ResetPositions();
    }
    public void Remove(SoccerPlayer p)
    {
        if (Ball.OwnerId == p.Id) SetOwner(null);
        Players.Remove(p);
    }
    public void Suspend(SoccerPlayer p)
    {
        Cancel(p); p.Velocity = default;
        if (p.Sliding) EndSlide(p);
        if (Ball.OwnerId == p.Id) SetOwner(null);
    }
    public void Cancel(SoccerPlayer p) { p.PreparingMode = ""; p.Input.CancelPreparation(); }
    public string State(SoccerPlayer p) => Phase == "goalPause" || Phase == "finished" ? "celebrating" :
        p.Sliding ? "sliding" : Tick < p.RecoverEndTick ? "recovering" :
        p.PreparingMode != "" ? "preparing" : Tick < p.AnimationEndTick ? "kicking" : p.Velocity.Length > .1 ? "running" : "idle";

    private void SetOwner(SoccerPlayer? player)
    {
        if (Ball.OwnerId == player?.Id) return;
        Owner?.Dribble.Reset(Owner.Dribble.Direction);
        Ball.OwnerId = player?.Id; Ball.PossessionVersion++;
        Ball.State = player is null ? "free" : "controlled";
        if (player is not null)
        {
            var offset = Ball.Position - player.Position;
            var direction = offset.Length > 1e-6 ? offset.Unit : player.Input.Move.Length > 1e-6 ? player.Input.Move.Unit : new Vec(player.Motion.FacingX, player.Motion.FacingY).Unit;
            player.Dribble.Reset(direction);
            var speed = Balance.RunSpeed * Balance.DribbleSpeedMultiplier;
            if (player.Velocity.Length > speed) player.Velocity = player.Velocity.Unit * speed;
        }
        foreach (var p in Players) Cancel(p);
    }
    private void ResetPositions()
    {
        foreach (var (p, index) in Players.OrderBy(p => p.Id).Select((p, i) => (p, i)))
        {
            p.Position = new((index / 2) * 1.5, p.Team == "blue" ? -2.5 : 2.5);
            p.Velocity = default; p.Motion.FacingX = 0; p.Motion.FacingY = p.Team == "blue" ? 1 : -1;
            p.Dribble.Reset(new(p.Motion.FacingX, p.Motion.FacingY));
            p.SlideRemaining = 0; p.Sliding = false; p.CooldownEndTick = p.RecoverEndTick = p.AnimationEndTick = 0;
            Cancel(p);
        }
        SetOwner(null); Ball.Position = Ball.Velocity = default; Ball.State = "free";
        Ball.CaptureBlockedUntilTick = 0; Ball.OwnerBlockedId = null; Ball.PossessionVersion++;
    }
    private void StartKickoff()
    {
        ResetPositions();
        var p = Players.Find(p => p.Team == KickoffTeam) ?? Players.FirstOrDefault();
        if (p is not null)
        {
            p.Position = new(0, p.Team == "blue" ? -Balance.DribbleDistance : Balance.DribbleDistance);
            SetOwner(p);
        }
        Phase = "kickoff"; PhaseEndTick = Tick + 60;
    }
    private void Finish()
    {
        Phase = "finished"; RemainingSeconds = 0; Ball.Velocity = default;
        foreach (var p in Players) { Cancel(p); p.SlideRemaining = 0; p.Sliding = false; p.Velocity = default; }
    }
    private void Goal(int side)
    {
        if (side > 0) BlueScore++; else RedScore++;
        KickoffTeam = side > 0 ? "red" : "blue";
        SetOwner(null); Ball.Velocity = default;
        Phase = "goalPause"; PhaseEndTick = Tick + 120;
        foreach (var p in Players) { Cancel(p); p.SlideRemaining = 0; p.Sliding = false; p.Velocity = default; }
        if (_resumePhase == "playing" && RemainingSeconds <= Eps) Finish();
    }

    public void Step(int tick, double nowMs)
    {
        Tick = tick;
        RepairOverlaps();
        if (Phase is "countdown" or "goalPause" && tick >= PhaseEndTick) StartKickoff();
        else if (Phase == "kickoff" && tick >= PhaseEndTick) Phase = _resumePhase;
        foreach (var p in Players.OrderBy(p => p.Id))
        {
            var stopped = p.Input.Tick(tick, nowMs);
            if (stopped) Suspend(p);
            if (!Active) { Cancel(p); p.Velocity = default; continue; }
            foreach (var action in p.Input.Actions.ToArray()) ApplyAction(p, action);
            if (!p.Input.Preparing && p.PreparingMode != "") Cancel(p);
            if (p.Sliding) p.Velocity = p.SlideDirection * Balance.TackleSpeed;
            else if (tick < p.RecoverEndTick) p.Velocity = default;
            else
            {
                var ownsBall = Ball.OwnerId == p.Id;
                var planted = ownsBall && Dribbling.Step(p.Dribble, p.Input.Move, tick, Balance);
                var speed = Balance.RunSpeed * (ownsBall ? Balance.DribbleSpeedMultiplier : 1);
                if (p.PreparingMode == "kick") speed *= Balance.ShotMoveMultiplier;
                if (planted) p.Velocity = default;
                Movement.Velocity(p.Motion, planted ? default : p.Input.Move, p.Input.Aim, Balance with { RunSpeed = speed });
            }
        }
        if (!Active) return;
        if (Ball.OwnerId is null) Ball.Velocity *= Math.Exp(-Balance.BallDrag * Movement.Dt);
        Solve();
    }

    private void ApplyAction(SoccerPlayer p, AppliedAction action)
    {
        var a = action.Transition;
        if (a.Kind == "cancel") { if (p.PreparedActionId == a.ActionId) Cancel(p); return; }
        if (a.Kind == "begin")
        {
            if (p.Sliding || Tick < p.RecoverEndTick) return;
            var mode = Ball.OwnerId == p.Id ? "kick" : "tackle";
            if ((a.Mode is not null && a.Mode != mode) || (a.Mode is not null && a.PossessionVersion != Ball.PossessionVersion) ||
                (mode == "tackle" && Tick < p.CooldownEndTick)) { Cancel(p); return; }
            p.PreparingMode = mode; p.PrepareVersion = Ball.PossessionVersion;
            p.PreparedActionId = a.ActionId; p.ChargeStartTick = Tick;
            return;
        }
        if (a.Kind != "release" || p.PreparedActionId != a.ActionId || p.PreparingMode == "" || p.LastActionId == a.ActionId) return;
        var kind = p.PreparingMode;
        var charge = Math.Clamp((Tick - p.ChargeStartTick) / 60.0 / (kind == "kick" ? Balance.ShotChargeSeconds : Balance.TackleChargeSeconds), 0, 1);
        var direction = action.Aim.Length > Eps ? action.Aim.Unit : new Vec(p.Motion.FacingX, p.Motion.FacingY).Unit;
        var valid = p.PrepareVersion == Ball.PossessionVersion;
        Cancel(p);
        if (!valid) return;
        if (kind == "kick" && Ball.OwnerId == p.Id)
        {
            // Bring the controlled ball to the striking foot before launching toward the arrow.
            // Never transfer it through another player, post or board.
            var launch=p.Position+direction*Balance.DribbleDistance;
            if(!PathBlocked(Ball.Position,launch,p.Id))Ball.Position=launch;
            SetOwner(null); Ball.Velocity = direction * (Balance.ShotMinSpeed + (Balance.ShotMaxSpeed - Balance.ShotMinSpeed) * charge);
            Ball.State = "kicked"; Ball.OwnerBlockedId = p.Id; Ball.OwnerBlockedUntilTick = Tick + Ticks(Balance.ShotRecaptureSeconds);
            Ball.ImpulseSeq++; p.AnimationEndTick = Tick + 15; p.LastActionId = a.ActionId;
        }
        else if (kind == "tackle" && Ball.OwnerId != p.Id && Tick >= p.CooldownEndTick)
        {
            p.SlideDirection = direction; p.SlideRemaining = Balance.TackleMinDistance + (Balance.TackleMaxDistance - Balance.TackleMinDistance) * charge;
            p.Sliding = true;
            p.HitBall = false; p.CooldownEndTick = Tick + Ticks(Balance.CooldownSeconds); p.LastActionId = a.ActionId;
            p.Motion.FacingX = direction.X; p.Motion.FacingY = direction.Y;
        }
    }

    private void EndSlide(SoccerPlayer p)
    {
        p.SlideRemaining = 0; p.Sliding = false; p.RecoverEndTick = Tick + Ticks(Balance.RecoverySeconds); p.Velocity = default;
    }
    private bool CaptureAllowed(SoccerPlayer p) => Tick >= Ball.CaptureBlockedUntilTick && !p.Sliding && Tick >= p.RecoverEndTick &&
        (Ball.OwnerBlockedId != p.Id || Tick >= Ball.OwnerBlockedUntilTick);
    private bool PathBlocked(Vec from, Vec to, string exclude, double ahead = 0)
    {
        var b = Balance;
        if (Math.Abs(to.X) > b.FieldWidth / 2 - b.BallRadius || Math.Abs(to.Y) > b.FieldHeight / 2 + b.GoalDepth - b.BallRadius) return true;
        foreach (var p in Players)
            if (p.Id != exclude && Geometry.SegmentBlocked(from, to, p.Position + p.Velocity * ahead, b.PlayerRadius + b.BallRadius)) return true;
        foreach (var x in new[] {-b.GoalWidth / 2, b.GoalWidth / 2}) foreach (var y in new[] {-b.FieldHeight / 2, b.FieldHeight / 2})
            if (Geometry.SegmentBlocked(from, to, new(x, y), b.PostRadius + b.BallRadius)) return true;
        if (Math.Abs(to.Y) > b.FieldHeight / 2 - b.BallRadius && Math.Abs(to.X) > b.GoalWidth / 2 - b.BallRadius) return true;
        foreach(var side in new[]{-1,1}){
            var line=side*(b.FieldHeight/2-b.BallRadius);
            if((from.Y-line)*(to.Y-line)<=0&&Math.Abs(to.Y-from.Y)>Eps){var t=(line-from.Y)/(to.Y-from.Y);if(t>=0&&t<=1&&Math.Abs(from.X+(to.X-from.X)*t)>b.GoalWidth/2-b.BallRadius)return true;}
        }
        return false;
    }
    private bool Capture(SoccerPlayer p)
    {
        var offset = Ball.Position - p.Position;
        var direction = offset.Length > Eps ? offset.Unit : p.Input.Move.Length > Eps ? p.Input.Move.Unit : new Vec(p.Motion.FacingX, p.Motion.FacingY).Unit;
        var target = p.Position + direction * Balance.DribbleDistance;
        if (PathBlocked(Ball.Position, target, p.Id)) return false;
        SetOwner(p); Ball.Position = target; Ball.Velocity = p.Velocity;
        return true;
    }
    private enum Kind { Paw, Post, BallBody, Capture, BallWall, Body, PlayerWall, SlideEnd, Goal, TimeEnd, None }
    private readonly record struct Contact(double Time, Kind Kind, SoccerPlayer? A = null, SoccerPlayer? B = null, Vec Normal = default, int Side = 0);

    private void Solve()
    {
        var b = Balance;
        var players = Players.OrderBy(p => p.Id).ToArray();
        var left = Movement.Dt;
        var noCapture = new HashSet<string>();
        for (var iteration = 0; iteration < 64 && left > Eps && Active; iteration++)
        {
            if (Owner is { } owner)
            {
                var target = owner.Position + owner.Velocity * left + owner.Dribble.Direction * b.DribbleDistance;
                Ball.Velocity = (target - Ball.Position) * (1 / left);
            }
            var hit = new Contact(left, Kind.None);
            void Offer(Contact c) {
                if (double.IsFinite(c.Time) && c.Time >= -Eps && (c.Time < hit.Time - Eps || (Math.Abs(c.Time - hit.Time) <= Eps && c.Kind < hit.Kind))) hit = c with { Time = Math.Clamp(c.Time, 0, left) };
            }
            void Wall(Vec pos, Vec velocity, double bx, double by, Kind kind, SoccerPlayer? p = null)
            {
                if (velocity.X > Eps) Offer(new((bx - pos.X) / velocity.X, kind, p, Normal: new(-1, 0)));
                if (velocity.X < -Eps) Offer(new((-bx - pos.X) / velocity.X, kind, p, Normal: new(1, 0)));
                if (velocity.Y > Eps) Offer(new((by - pos.Y) / velocity.Y, kind, p, Normal: new(0, -1)));
                if (velocity.Y < -Eps) Offer(new((-by - pos.Y) / velocity.Y, kind, p, Normal: new(0, 1)));
            }
            for (var i = 0; i < players.Length; i++)
            {
                var p = players[i];
                Wall(p.Position, p.Velocity, b.FieldWidth / 2 - b.PlayerRadius, b.FieldHeight / 2 - b.PlayerRadius, Kind.PlayerWall, p);
                if (p.Sliding) Offer(new(p.SlideRemaining / b.TackleSpeed, Kind.SlideEnd, p));
                for (var j = i + 1; j < players.Length; j++)
                    Offer(new(Geometry.Sweep(p.Position - players[j].Position, p.Velocity - players[j].Velocity, 2 * b.PlayerRadius, left), Kind.Body, p, players[j]));
                if (Ball.OwnerId == p.Id) continue;
                var relative = Ball.Position - p.Position;
                // A blocked foot transfer may leave the launch on the old side. The shooter
                // cannot reflect their own shot; keep excluding them until the ball clears.
                if(Ball.State=="kicked"&&Ball.OwnerBlockedId==p.Id&&
                    (Tick<Ball.OwnerBlockedUntilTick||relative.Length<b.PlayerRadius+b.BallRadius+Eps))continue;
                Offer(new(Geometry.Sweep(relative, Ball.Velocity - p.Velocity, b.PlayerRadius + b.BallRadius, left), Kind.BallBody, p));
                if (Ball.OwnerId is null && !noCapture.Contains(p.Id) && CaptureAllowed(p) && Ball.Velocity.Length <= b.CaptureMaxSpeed)
                {
                    var radius = b.PlayerRadius + b.BallRadius + .15;
                    var t = relative.Length <= radius ? 0 : Geometry.Sweep(relative, Ball.Velocity - p.Velocity, radius, left);
                    Offer(new(t, Kind.Capture, p));
                }
                if (p.Sliding && !p.HitBall)
                {
                    var paw = p.Position + p.SlideDirection * (b.TackleReach - b.BallRadius);
                    var t = (paw - Ball.Position).Length <= b.BallRadius ? 0 : Geometry.Sweep(paw - Ball.Position, p.Velocity - Ball.Velocity, b.BallRadius, left);
                    if (double.IsFinite(t))
                    {
                        var from = p.Position + p.Velocity * t;
                        var to = Ball.Position + Ball.Velocity * t;
                        var blocked = players.Any(other => other.Id != p.Id && Geometry.SegmentBlocked(from, to, other.Position + other.Velocity * t, b.PlayerRadius));
                        if (!blocked) Offer(new(t, Kind.Paw, p));
                    }
                }
            }
            var lineTime=Math.Abs(Ball.Velocity.Y)>Eps?(Math.Sign(Ball.Velocity.Y)*(b.FieldHeight/2-b.BallRadius)-Ball.Position.Y)/Ball.Velocity.Y:0;
            var crossingX=Ball.Position.X+Ball.Velocity.X*Math.Max(0,lineTime);
            var net = Math.Abs(crossingX) <= b.GoalWidth / 2 - b.BallRadius;
            Wall(Ball.Position, Ball.Velocity, b.FieldWidth / 2 - b.BallRadius,
                b.FieldHeight / 2 + (net ? b.GoalDepth : 0) - b.BallRadius, Kind.BallWall);
            if (Math.Abs(Ball.Position.Y) > b.FieldHeight / 2)
            {
                if (Ball.Velocity.X > Eps) Offer(new((b.GoalWidth / 2 - b.BallRadius - Ball.Position.X) / Ball.Velocity.X, Kind.BallWall, Normal: new(-1, 0)));
                if (Ball.Velocity.X < -Eps) Offer(new((-b.GoalWidth / 2 + b.BallRadius - Ball.Position.X) / Ball.Velocity.X, Kind.BallWall, Normal: new(1, 0)));
            }
            foreach (var x in new[] {-b.GoalWidth / 2, b.GoalWidth / 2}) foreach (var y in new[] {-b.FieldHeight / 2, b.FieldHeight / 2})
            {
                var post = new Vec(x, y);
                var time = Geometry.Sweep(Ball.Position - post, Ball.Velocity, b.BallRadius + b.PostRadius, left);
                Offer(new(time, Kind.Post, Normal: post));
            }
            if (Math.Abs(Ball.Position.X) <= b.GoalWidth / 2 - b.BallRadius && Math.Abs(Ball.Velocity.Y) > Eps)
            {
                var side = Math.Sign(Ball.Velocity.Y);
                var goalTime=(side*(b.FieldHeight/2+b.BallRadius)-Ball.Position.Y)/Ball.Velocity.Y;
                if(Math.Abs(Ball.Position.X+Ball.Velocity.X*goalTime)<=b.GoalWidth/2-b.BallRadius)Offer(new(goalTime,Kind.Goal,Side:side));
            }
            if (Phase == "playing") Offer(new(RemainingSeconds, Kind.TimeEnd));
            foreach (var p in players)
            {
                var distance = p.Velocity.Length * hit.Time;
                p.Position += p.Velocity * hit.Time;
                if (p.Sliding) p.SlideRemaining = Math.Max(0, p.SlideRemaining - distance);
            }
            Ball.Position += Ball.Velocity * hit.Time;
            if (Phase == "playing") RemainingSeconds = Math.Max(0, RemainingSeconds - hit.Time);
            left -= hit.Time;
            if (hit.Kind == Kind.None) return;
            switch (hit.Kind)
            {
                case Kind.Body:
                    var a = hit.A!; var other = hit.B!;
                    var normal = (a.Position - other.Position).Unit;
                    var av = a.Velocity.Dot(normal); var bv = other.Velocity.Dot(normal);
                    if (a.Sliding) EndSlide(a);
                    if (other.Sliding) EndSlide(other);
                    av = a.Velocity.Dot(normal); bv = other.Velocity.Dot(normal);
                    if (av < bv)
                    {
                        if (av < 0 && bv > 0) {a.Velocity -= normal * av; other.Velocity -= normal * bv;}
                        else if (av < 0) a.Velocity += normal * (bv - av);
                        else other.Velocity += normal * (av - bv);
                    }
                    break;
                case Kind.PlayerWall:
                    if (hit.A!.Sliding) EndSlide(hit.A);
                    else hit.A.Velocity -= hit.Normal * Math.Min(0, hit.A.Velocity.Dot(hit.Normal));
                    break;
                case Kind.SlideEnd: EndSlide(hit.A!); break;
                case Kind.Paw:
                    SetOwner(null); Ball.Velocity = hit.A!.SlideDirection * b.TackleBallSpeed;
                    Ball.CaptureBlockedUntilTick = Tick + Ticks(b.TackleRecaptureSeconds);
                    Ball.ImpulseSeq++; hit.A.HitBall = true;
                    break;
                case Kind.Capture:
                    if (!Capture(hit.A!)) noCapture.Add(hit.A!.Id);
                    break;
                case Kind.Post:
                case Kind.BallWall:
                case Kind.BallBody:
                    var n = hit.Kind == Kind.Post ? (Ball.Position - hit.Normal).Unit : hit.Kind == Kind.BallBody ? (Ball.Position - hit.A!.Position).Unit : hit.Normal;
                    if (Ball.OwnerId is not null) SetOwner(null);
                    var bodyVelocity = hit.Kind == Kind.BallBody ? hit.A!.Velocity : default;
                    var inward = (Ball.Velocity - bodyVelocity).Dot(n);
                    if (inward < 0) Ball.Velocity -= n * ((1 + (hit.Kind == Kind.BallBody ? b.BodyRestitution : b.WallRestitution)) * inward);
                    if (hit.Kind == Kind.BallBody) noCapture.Add(hit.A!.Id);
                    break;
                case Kind.Goal:
                    if (Math.Abs(Ball.Position.X) <= b.GoalWidth / 2 - b.BallRadius + Eps) Goal(hit.Side);
                    break;
                case Kind.TimeEnd: Finish(); break;
            }
        }
        // A pathological contact cluster is stopped safely instead of moving through bodies.
        if (left > Eps && Active) { foreach (var p in players) {if(p.Sliding)EndSlide(p);p.Velocity = default;} Ball.Velocity = default; }
    }
}
