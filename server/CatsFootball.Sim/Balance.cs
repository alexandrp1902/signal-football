using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CatsFootball.Sim;

public sealed record Balance
{
    public required int SchemaVersion { get; init; }
    public required int TickRate { get; init; }
    public required int InputRate { get; init; }
    public required int SnapshotRate { get; init; }
    public required double FieldWidth { get; init; }
    public required double FieldHeight { get; init; }
    public required double GoalWidth { get; init; }
    public required double GoalDepth { get; init; }
    public required double PlayerRadius { get; init; }
    public required double RunSpeed { get; init; }
    public required double Acceleration { get; init; }
    public required double Braking { get; init; }
    public required int TeamSize { get; init; }
    public required double MatchSeconds { get; init; }
    public required double BallRadius { get; init; }
    public double BallVisualRadius { get; init; } = .72;
    public double PostRadius { get; init; } = .12;
    public required double DribbleSpeedMultiplier { get; init; }
    public required double DribbleTurnPauseSeconds { get; init; }
    public required double DribbleTurnSeconds { get; init; }
    public required double DribbleSteeringRadiansPerSecond { get; init; }
    public required double ShotMoveMultiplier { get; init; }
    public required double ShotChargeSeconds { get; init; }
    public required double ShotMinSpeed { get; init; }
    public required double ShotMaxSpeed { get; init; }
    public required double CaptureMaxSpeed { get; init; }
    public required double ShotRecaptureSeconds { get; init; }
    public required double DribbleDistance { get; init; }
    public required double TackleChargeSeconds { get; init; }
    public required double TackleMinDistance { get; init; }
    public required double TackleMaxDistance { get; init; }
    public required double TackleSpeed { get; init; }
    public required double TackleReach { get; init; }
    public required double TackleBallSpeed { get; init; }
    public required double RecoverySeconds { get; init; }
    public required double CooldownSeconds { get; init; }
    public required double TackleRecaptureSeconds { get; init; }
    public required double WallRestitution { get; init; }
    public required double BodyRestitution { get; init; }
    public required double BallDrag { get; init; }
    public required double ReconnectSeconds { get; init; }

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    public static (Balance Value, string Hash) Load(string path)
    {
        var bytes = File.ReadAllBytes(path);
        var value = JsonSerializer.Deserialize<Balance>(bytes, JsonOptions)
            ?? throw new InvalidDataException("Balance must be an object.");
        value.Validate();
        return (value, Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }

    public void Validate()
    {
        foreach (var p in GetType().GetProperties())
        {
            var value = Convert.ToDouble(p.GetValue(this));
            if (!double.IsFinite(value) || value <= 0 || value > 10000)
                throw new InvalidDataException($"Invalid balance field: {p.Name}");
        }
        if (SchemaVersion != 1 || TickRate != 60 || InputRate != 30 || SnapshotRate != 20)
            throw new InvalidDataException("Unsupported balance schema or fixed rates.");
        if (TeamSize is < 1 or > 3 || FieldWidth <= PlayerRadius * 2 || FieldHeight <= PlayerRadius * 2 ||
            FieldWidth >= FieldHeight || GoalWidth >= FieldWidth || GoalDepth >= FieldHeight / 2 ||
            ShotMinSpeed > ShotMaxSpeed || TackleMinDistance > TackleMaxDistance ||
            ShotMoveMultiplier > 1 || WallRestitution > 1 || BodyRestitution > 1 ||
            DribbleSpeedMultiplier > 1 || DribbleTurnPauseSeconds > 2 || DribbleTurnSeconds > 2 || CooldownSeconds < RecoverySeconds)
            throw new InvalidDataException("Inconsistent balance dimensions or ranges.");
    }
}
