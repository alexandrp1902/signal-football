namespace CatsFootball.Sim;

public sealed record ActionTransition(string Kind, int ActionId, string? Mode = null, int PossessionVersion = 0, double? AimX = null, double? AimY = null);
public sealed record AppliedAction(ActionTransition Transition, Vec Aim);
public sealed record InputFrame(int InputSeq, int TargetTick, double MoveX, double MoveY,
    double AimX, double AimY, bool ActionHeld, ActionTransition[] Transitions)
{
    public void Validate()
    {
        if (InputSeq is < 1 or > 2_000_000_000 || TargetTick < 1 || Transitions is null || Transitions.Length > 4 ||
            !double.IsFinite(MoveX) || !double.IsFinite(MoveY) || !double.IsFinite(AimX) || !double.IsFinite(AimY) ||
            Math.Abs(MoveX) > 1 || Math.Abs(MoveY) > 1 || Math.Abs(AimX) > 1 || Math.Abs(AimY) > 1 ||
            new Vec(AimX, AimY).Length is > 0 and < 0.999999 || new Vec(AimX, AimY).Length > 1.000001)
            throw new InvalidDataException("Invalid input frame.");
        foreach (var t in Transitions) {
            if (t is null || t.ActionId is < 1 or > 2_000_000_000 || t.Kind is not ("begin" or "cancel" or "release"))
                throw new InvalidDataException("Invalid action transition.");
            if (t.AimX.HasValue != t.AimY.HasValue || (t.AimX is { } ax && t.AimY is { } ay &&
                (!double.IsFinite(ax) || !double.IsFinite(ay) || Math.Abs(new Vec(ax,ay).Length-1)>1e-6)))
                throw new InvalidDataException("Invalid release direction.");
        }
    }
}

/// <summary>One shared world step per tick, never one movement per packet.</summary>
public sealed class InputTimeline(double createdMs)
{
    public const int MovementCapacity = 6;
    public const int TransitionCapacity = 32;
    public const int FutureHorizon = 30;
    public const double TimeoutMs = 250;
    private sealed class Pending(InputFrame frame)
    {
        public InputFrame Frame { get; } = frame;
        public bool DropMovement { get; set; }
    }
    private readonly List<Pending> _pending = [];
    private readonly SortedSet<int> _finished = [];
    private int _lastSeq, _lastTarget, _highestAction;
    private int _cancelBarrier = -1, _suspendBarrier = -1;
    private double _lastValidMs = createdMs;
    private bool _needsResync;
    public int Ack { get; private set; }
    public int Barrier { get; private set; }
    public Vec Move { get; private set; }
    public Vec Aim { get; private set; }
    public bool Held { get; private set; }
    public bool Preparing { get; private set; }
    public int ActionId { get; private set; }
    public int ChargeStartTick { get; private set; }
    public int LastInputTick { get; private set; }
    public int QueueDepth => _pending.Count(p => !p.DropMovement);
    public int PendingTransitions => _pending.Sum(p => p.Frame.Transitions.Length);
    public bool NeedsResync => _needsResync;
    public List<AppliedAction> Actions { get; } = [];
    public void CancelPreparation() => Preparing = false;

    public void Enqueue(InputFrame[] frames, int tick, double nowMs, bool resync = false)
    {
        if (frames is null || frames.Length is < 1 or > 4) throw new InvalidDataException("Batch must have 1..4 frames.");
        foreach (var f in frames) { if (f is null) throw new InvalidDataException("Null frame."); f.Validate(); }
        if (resync)
        {
            if (frames.All(f => f.InputSeq <= _lastSeq)) return;
            if (!_needsResync) throw new InvalidDataException("Resync requires suspend.");
            // Transit delay may make an otherwise fresh resync late. The normal stale-tick
            // rules still discard its movement; closing the socket would prevent recovery.
            _lastTarget = 0;
            _needsResync = false;
        }
        if (_needsResync) return; // Old buffered traffic cannot revive timed-out input.
        foreach (var f in frames)
        {
            if (f.InputSeq <= _lastSeq || f.InputSeq <= Barrier) continue;
            if (f.InputSeq != _lastSeq + 1 || (_lastTarget != 0 && f.TargetTick != _lastTarget + 1) ||
                f.TargetTick > tick + FutureHorizon)
                throw new InvalidDataException($"Input seq/tick {f.InputSeq}/{f.TargetTick}; expected {_lastSeq + 1}/{_lastTarget + 1}; server {tick}, future limit {tick + FutureHorizon}.");
            _lastSeq = f.InputSeq;
            _lastTarget = f.TargetTick;
            // Very old pre-timeout frames do not extend the lease.
            if (f.TargetTick < tick - 15) { Finish(f.InputSeq); continue; }
            _lastValidMs = nowMs;
            _pending.Add(new Pending(f));
            if (PendingTransitions > TransitionCapacity) throw new InvalidDataException("Action queue full.");
            while (QueueDepth > MovementCapacity)
            {
                var oldest = _pending.First(p => !p.DropMovement);
                oldest.DropMovement = true;
                if (oldest.Frame.Transitions.Length == 0) { _pending.Remove(oldest); Finish(oldest.Frame.InputSeq); }
            }
        }
    }

    public bool Tick(int tick, double nowMs)
    {
        Actions.Clear();
        if (nowMs - _lastValidMs >= TimeoutMs)
        {
            Stop(_lastSeq, true);
            return true;
        }
        foreach (var p in _pending.Where(p => p.Frame.TargetTick <= tick).ToArray())
        {
            var f = p.Frame;
            foreach (var transition in f.Transitions) Apply(transition, tick, new(f.AimX, f.AimY));
            if (!p.DropMovement && f.TargetTick == tick)
            {
                Move = new Vec(f.MoveX, f.MoveY).Clamped;
                Aim = new Vec(f.AimX, f.AimY);
                Held = f.ActionHeld;
                LastInputTick = tick;
                if (!Held) Preparing = false;
            }
            _pending.Remove(p);
            Finish(f.InputSeq);
        }
        return false;
    }

    private void Apply(ActionTransition t, int tick, Vec aim)
    {
        if (t.Kind == "begin")
        {
            if (t.ActionId <= _highestAction) return;
            _highestAction = ActionId = t.ActionId;
            ChargeStartTick = tick;
            Preparing = true;
            Actions.Add(new(t, aim));
        }
        else if (t.ActionId == ActionId) { Preparing = false; Actions.Add(new(t, t.AimX is { } x && t.AimY is { } y ? new(x,y) : aim)); }
    }

    private void Finish(int seq)
    {
        _finished.Add(seq);
        while (_finished.Remove(Ack + 1)) Ack++;
    }

    public void Stop(int throughSeq, bool suspend)
    {
        if (throughSeq < 0 || throughSeq > _lastSeq + 240) throw new InvalidDataException("Invalid input barrier.");
        if (throughSeq <= (suspend ? _suspendBarrier : _cancelBarrier)) return;
        if (throughSeq < _lastSeq) {
            if (throughSeq <= Barrier) return;
            throw new InvalidDataException("Barrier must include all received input.");
        }
        if (suspend) _suspendBarrier = throughSeq; else _cancelBarrier = throughSeq;
        Barrier = Math.Max(Barrier, throughSeq);
        foreach (var p in _pending.Where(p => p.Frame.InputSeq <= Barrier).ToArray()) _pending.Remove(p);
        _finished.RemoveWhere(s => s <= Barrier);
        Ack = Math.Max(Ack, Barrier);
        while (_finished.Remove(Ack + 1)) Ack++;
        // A barrier may include a locally generated frame that had not yet been batched.
        // Its target tick still belongs to the old consecutive sequence.
        if (_lastTarget != 0) _lastTarget += Math.Max(0, Barrier - _lastSeq);
        _lastSeq = Math.Max(_lastSeq, Barrier);
        Preparing = Held = false;
        Actions.Clear();
        if (suspend) { Move = default; Aim = default; _needsResync = true; }
    }
}
