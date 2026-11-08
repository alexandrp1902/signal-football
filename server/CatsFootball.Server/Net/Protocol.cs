using System.Text.Json;
using CatsFootball.Sim;
using MessagePack;

namespace CatsFootball.Server.Net;

public static class Protocol
{
    public const int Version = 3;
    public const int MaxMessageBytes = 16 * 1024;
    public const int CommandsCapacity = 256;
    public const int ReliableCapacity = 64;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { RespectRequiredConstructorParameters = true };
    public static byte[] Encode(object value) => JsonSerializer.SerializeToUtf8Bytes(value, Json);
    public static object Error(string code, string message, bool fatal = true) => new { type = "error", code, message, fatal };
}

// Array keys are the wire contract; no reflection-based property-name serializer.
[MessagePackObject]
public sealed class PlayerSnapshot
{
    [Key(0)] public string PlayerId { get; set; } = "";
    [Key(1)] public string Team { get; set; } = "blue";
    [Key(2)] public double X { get; set; }
    [Key(3)] public double Y { get; set; }
    [Key(4)] public double Vx { get; set; }
    [Key(5)] public double Vy { get; set; }
    [Key(6)] public double FacingX { get; set; }
    [Key(7)] public double FacingY { get; set; }
    [Key(8)] public bool Preparing { get; set; }
    [Key(9)] public int ActionId { get; set; }
    [Key(10)] public int ChargeStartTick { get; set; }
    [Key(11)] public bool Active { get; set; } = true;
    [Key(12)] public string ActionState { get; set; } = "idle";
    [Key(13)] public string PreparationMode { get; set; } = "";
    [Key(14)] public double SlideX { get; set; }
    [Key(15)] public double SlideY { get; set; }
    [Key(16)] public int SlideEndTick { get; set; }
    [Key(17)] public int RecoverEndTick { get; set; }
    [Key(18)] public int CooldownEndTick { get; set; }
    [Key(19)] public int LastActionId { get; set; }
    [Key(20)] public int PrepareVersion { get; set; }
    [Key(21)] public int AnimationEndTick { get; set; }
    [Key(22)] public double DribbleX { get; set; }
    [Key(23)] public double DribbleY { get; set; } = 1;
    [Key(24)] public double DribbleTargetX { get; set; }
    [Key(25)] public double DribbleTargetY { get; set; } = 1;
    [Key(26)] public int DribbleTurnStartTick { get; set; }
    [Key(27)] public int DribbleTurnEndTick { get; set; }
}

[MessagePackObject]
public sealed class BallSnapshot
{
    [Key(0)] public double X { get; set; }
    [Key(1)] public double Y { get; set; }
    [Key(2)] public double Vx { get; set; }
    [Key(3)] public double Vy { get; set; }
    [Key(4)] public string State { get; set; } = "free";
    [Key(5)] public string? OwnerId { get; set; }
    [Key(6)] public int PossessionVersion { get; set; }
    [Key(7)] public int CaptureBlockedUntilTick { get; set; }
    [Key(8)] public string? OwnerBlockedId { get; set; }
    [Key(9)] public int OwnerBlockedUntilTick { get; set; }
    [Key(10)] public int ImpulseSeq { get; set; }
}

[MessagePackObject]
public sealed class RecipientSnapshot
{
    [Key(0)] public int AckInputSeq { get; set; }
    [Key(1)] public double MoveX { get; set; }
    [Key(2)] public double MoveY { get; set; }
    [Key(3)] public double AimX { get; set; }
    [Key(4)] public double AimY { get; set; }
    [Key(5)] public bool Held { get; set; }
    [Key(6)] public int LastInputTick { get; set; }
    [Key(7)] public int Barrier { get; set; }
    [Key(8)] public bool NeedsResync { get; set; }
}

[MessagePackObject]
public sealed class Snapshot
{
    [Key(0)] public int ProtocolVersion { get; set; } = Protocol.Version;
    [Key(1)] public string RoomId { get; set; } = "";
    [Key(2)] public string MatchId { get; set; } = "";
    [Key(3)] public string ConnectionEpoch { get; set; } = "";
    [Key(4)] public int SnapshotSeq { get; set; }
    [Key(5)] public int ServerTick { get; set; }
    [Key(6)] public string Phase { get; set; } = "training";
    [Key(7)] public PlayerSnapshot[] Players { get; set; } = [];
    [Key(8)] public RecipientSnapshot Recipient { get; set; } = new();
    [Key(9)] public BallSnapshot Ball { get; set; } = new();
    [Key(10)] public int[] Score { get; set; } = [0, 0];
    [Key(11)] public double? RemainingTime { get; set; }
    [Key(12)] public int PhaseEndTick { get; set; }
}

public static class SnapshotCodec
{
    public static byte[] Encode(Snapshot snapshot) => MessagePackSerializer.Serialize(snapshot);
}

public sealed class TokenBucket(double nowMs)
{
    private double _tokens = 120, _lastMs = nowMs;
    public bool Take(double ms)
    {
        _tokens = Math.Min(120, _tokens + Math.Max(0, ms - _lastMs) * .12);
        _lastMs = ms;
        if (_tokens < 1) return false;
        _tokens--;
        return true;
    }
}
