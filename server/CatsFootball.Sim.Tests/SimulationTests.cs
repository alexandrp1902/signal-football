using System.Text.Json;
using CatsFootball.Sim;

namespace CatsFootball.Sim.Tests;

public sealed class SimulationTests
{
    private static readonly string Shared = Path.Combine(AppContext.BaseDirectory, "shared");
    private static Balance Config => Balance.Load(Path.Combine(Shared, "football.json")).Value;
    private static JsonElement Vectors(string name) => JsonDocument.Parse(File.ReadAllText(Path.Combine(Shared, "test-vectors", name))).RootElement;
    private static InputFrame Frame(int seq, int tick, double x = 1, bool held = false, ActionTransition[]? transitions = null) => new(seq, tick, x, 0, 0, 1, held, transitions ?? []);

    [Fact]
    public void SharedMovementFixtures()
    {
        foreach (var v in Vectors("movement.json").EnumerateArray())
        {
            var state = v.GetProperty("initial").Deserialize<Motion>(Balance.JsonOptions)!;
            var move = v.GetProperty("move").Deserialize<Vec>(Balance.JsonOptions);
            var aim = v.GetProperty("aim").Deserialize<Vec>(Balance.JsonOptions);
            for (var i = 0; i < v.GetProperty("steps").GetInt32(); i++) Movement.Step(state, move, aim, Config);
            var expected = v.GetProperty("expected").Deserialize<Motion>(Balance.JsonOptions)!;
            Assert.True(Math.Abs(state.X - expected.X) < 1e-5, $"{v.GetProperty("name")}: X {state.X} != {expected.X}");
            Assert.InRange(Math.Abs(state.Y - expected.Y), 0, 1e-5);
            Assert.InRange(Math.Abs(state.Vx - expected.Vx), 0, 1e-5);
            Assert.InRange(Math.Abs(state.Vy - expected.Vy), 0, 1e-5);
        }
    }

    [Fact]
    public void DiagonalDoesNotIncreaseSpeedOrPath()
    {
        var a = new Motion(); var b = new Motion();
        for (var i = 0; i < 60; i++) {Movement.Step(a, new(1, 0), default, Config); Movement.Step(b, new(1, 1), default, Config);}
        Assert.Equal(a.X, Math.Sqrt(b.X * b.X + b.Y * b.Y), 10);
        Assert.Equal(Config.RunSpeed, Math.Sqrt(b.Vx * b.Vx + b.Vy * b.Vy), 10);
    }

    [Fact]
    public void SharedCoordinateFixtures()
    {
        foreach (var v in Vectors("coordinates.json").EnumerateArray())
        {
            var world = v.GetProperty("world").Deserialize<Vec>(Balance.JsonOptions);
            var expected = v.GetProperty("teamPoint").Deserialize<Vec>(Balance.JsonOptions);
            var transformed = Vec.ToTeam(world, v.GetProperty("team").GetString()!);
            Assert.Equal(expected, transformed);
            Assert.Equal(world, Vec.ToTeam(transformed, v.GetProperty("team").GetString()!));
        }
    }

    [Fact]
    public void SharedStarvationAndSuspendFixture()
    {
        var timeline = new InputTimeline(0); var motion = new Motion {Vx = 5.6};
        foreach (var row in Vectors("input-timeline.json").EnumerateArray())
        {
            var tick = row.GetProperty("tick").GetInt32();
            if (row.TryGetProperty("suspend", out var barrier)) {timeline.Stop(barrier.GetInt32(), true); motion.Vx = motion.Vy = 0;}
            var frames = row.GetProperty("frames").Deserialize<InputFrame[]>(Balance.JsonOptions)!;
            if (frames.Length > 0) timeline.Enqueue(frames, tick, (tick - 100) * 1000.0 / 60);
            if (timeline.Tick(tick, (tick - 100) * 1000.0 / 60)) motion.Vx = motion.Vy = 0;
            Movement.Step(motion, timeline.Move, timeline.Aim, Config);
            Assert.Equal(row.GetProperty("ack").GetInt32(), timeline.Ack);
            Assert.Equal(row.GetProperty("x").GetDouble(), motion.X, 10);
        }
    }

    [Fact]
    public void QueueOverflowPreservesTransitionsAndAcknowledgesOnlyFinishedFrames()
    {
        var t = new InputTimeline(0);
        for (var i = 1; i <= 8; i++) t.Enqueue([Frame(i, 100 + i, held: true, transitions: i == 1 ? [new("begin", 1)] : [])], 100, 0);
        Assert.Equal(6, t.QueueDepth); Assert.Equal(0, t.Ack); Assert.False(t.Preparing);
        t.Tick(101, 1);
        Assert.True(t.Preparing); Assert.Equal(101, t.ChargeStartTick); Assert.Equal(2, t.Ack);
        t.Tick(102, 2); Assert.Equal(2, t.Ack);
        t.Tick(103, 3); Assert.Equal(3, t.Ack);
    }

    [Fact]
    public void SuspendBarrierPreventsDelayedBeginAndAllowsFreshResync()
    {
        var t = new InputTimeline(0);
        t.Enqueue([Frame(1, 102, held: true, transitions: [new("begin", 1)])], 100, 0);
        t.Stop(1, true); t.Tick(102, 20);
        Assert.False(t.Preparing); Assert.Equal(default, t.Move); Assert.Equal(1, t.Ack);
        t.Enqueue([Frame(1, 102, held: true, transitions: [new("begin", 1)])], 102, 30);
        Assert.False(t.Preparing);
        t.Enqueue([Frame(2, 105, held: true, transitions: [new("begin", 2)])], 104, 60, true);
        t.Tick(105, 80); Assert.True(t.Preparing); Assert.Equal(2, t.ActionId);
        t.Stop(1, true); Assert.True(t.Preparing); // A delayed duplicate cannot suspend the new gesture.
    }

    [Fact]
    public void LateResyncDiscardsMovementButDoesNotCloseOrReplayIt()
    {
        var t = new InputTimeline(0);
        t.Enqueue([Frame(1, 100)], 100, 0); t.Tick(100, 0); t.Stop(1, true);
        t.Enqueue([Frame(2, 105)], 106, 100, true); t.Tick(106, 100);
        Assert.Equal(default, t.Move); Assert.Equal(2, t.Ack); Assert.False(t.NeedsResync);
        t.Enqueue([Frame(2, 105)], 107, 110, true); // Duplicate resync remains idempotent.
        Assert.Equal(2, t.Ack);
    }

    [Fact]
    public void CancelBarrierIncludesUnsentLocalFrameWithoutBreakingTargetSequence()
    {
        var t = new InputTimeline(0);
        t.Enqueue([Frame(1, 101), Frame(2, 102)], 100, 0);
        t.Stop(3, false);
        t.Enqueue([Frame(4, 104)], 103, 30);
        t.Tick(104, 50);
        Assert.Equal(4, t.Ack); Assert.Equal(1, t.Move.X);
    }

    [Fact]
    public void DuplicatesDoNotRefreshTimeoutOrReplayAction()
    {
        var t = new InputTimeline(0); var f = Frame(1, 1, held: true, transitions: [new("begin", 1)]);
        t.Enqueue([f], 1, 0); t.Tick(1, 0);
        t.Enqueue([f], 2, 249); t.Tick(2, 249); Assert.True(t.Preparing);
        Assert.True(t.Tick(3, 250)); Assert.False(t.Preparing); Assert.Equal(default, t.Move);
        t.Enqueue([Frame(2, 4, held: true, transitions: [new("begin", 1)])], 3, 251);
        t.Tick(4, 260); Assert.False(t.Preparing);
    }

    [Fact]
    public void HigherPacketRateCannotGiveExtraStepsOrCharge()
    {
        var slow = new InputTimeline(0); var flood = new InputTimeline(0);
        var a = new Motion(); var b = new Motion();
        for (var tick = 1; tick <= 120; tick++)
        {
            var f = Frame(tick, tick, held: true, transitions: tick == 1 ? [new("begin", 1)] : []);
            // 30 batches/sec, two frames/batch versus 120 messages/sec (one new frame and a duplicate).
            if (tick % 2 == 1) slow.Enqueue([f, Frame(tick + 1, tick + 1, held: true)], tick, tick * 1000.0 / 60);
            for (var packet = 0; packet < 2; packet++) flood.Enqueue([f], tick, tick * 1000.0 / 60);
            slow.Tick(tick, tick * 1000.0 / 60); flood.Tick(tick, tick * 1000.0 / 60);
            Movement.Step(a, slow.Move, slow.Aim, Config); Movement.Step(b, flood.Move, flood.Aim, Config);
        }
        Assert.Equal(a.X, b.X); Assert.Equal(slow.ChargeStartTick, flood.ChargeStartTick); Assert.Equal(120, flood.Ack);
    }

    [Fact]
    public void LimitsRejectNonfiniteFramesAndUnboundedFutureOrActionQueue()
    {
        Assert.Throws<InvalidDataException>(() => (Frame(1, 1) with {MoveX = double.NaN}).Validate());
        var t = new InputTimeline(0);
        Assert.Throws<InvalidDataException>(() => t.Enqueue([Frame(1, 132)], 100, 0));
        Assert.Throws<InvalidDataException>(() => t.Enqueue(Enumerable.Range(1, 5).Select(i => Frame(i, i)).ToArray(), 0, 0));
        Assert.Throws<InvalidDataException>(() => t.Stop(1000, true));
        var actions = new InputTimeline(0);
        Assert.Throws<InvalidDataException>(() => {
            for (var i = 1; i <= 17; i++) actions.Enqueue([Frame(i, 100 + i, transitions: [new("begin", i), new("release", i)])], 100, 0);
        });
    }

    [Fact]
    public void BalanceIsValidatedAndHashesOriginalBytes()
    {
        var (b, hash) = Balance.Load(Path.Combine(Shared, "football.json")); Assert.Equal(64, hash.Length);
        Assert.Throws<InvalidDataException>(() => (b with {RunSpeed = double.NaN}).Validate());
        Assert.Throws<InvalidDataException>(() => (b with {FieldWidth = .2}).Validate());
        Assert.Throws<InvalidDataException>(() => (b with {TickRate = 20}).Validate());
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Balance>("{\"schemaVersion\":1}", Balance.JsonOptions));
    }

    [Fact] public void ReleaseUsesLatchedArrowInsteadOfTheLaterFrameAim()
    {
        var t=new InputTimeline(0);t.Enqueue([Frame(1,1,held:true,transitions:[new("begin",1)])],1,0);t.Tick(1,0);
        t.Enqueue([Frame(2,2,transitions:[new("release",1,AimX:-1,AimY:0)])],2,10);t.Tick(2,10);
        Assert.Equal(new Vec(-1,0),Assert.Single(t.Actions).Aim);
        Assert.Throws<InvalidDataException>(()=>(Frame(3,3,transitions:[new("release",1,AimX:double.NaN,AimY:0)])).Validate());
        Assert.Throws<InvalidDataException>(()=>(Frame(3,3,transitions:[new("release",1,AimX:1)])).Validate());
    }
}
