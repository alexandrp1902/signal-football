namespace CatsFootball.Sim;

public sealed class DribbleState
{
    public Vec Direction { get; set; } = new(0, 1);
    public Vec Target { get; set; } = new(0, 1);
    public int TurnStartTick { get; set; }
    public int TurnEndTick { get; set; }
    public void Reset(Vec direction)
    {
        Direction = Target = direction.Unit;
        TurnStartTick = TurnEndTick = 0;
    }
}

/// <summary>Ball steering is independent of shot aim. A sharp turn plants the feet before transferring the ball.</summary>
public static class Dribbling
{
    private const double SharpTurnDot = .25;
    public static double Angle(Vec from, Vec to)
    {
        var cross = from.X * to.Y - from.Y * to.X;
        var dot = Math.Clamp(from.Dot(to), -1, 1);
        return Math.Abs(cross) < 1e-12 && dot < 0 ? Math.PI : Math.Atan2(cross, dot);
    }
    public static Vec RotateToward(Vec from, Vec to, double maxAngle)
    {
        var angle = Angle(from, to);
        if (Math.Abs(angle) <= maxAngle) return to;
        angle = Math.CopySign(maxAngle, angle);
        return new(from.X * Math.Cos(angle) - from.Y * Math.Sin(angle), from.X * Math.Sin(angle) + from.Y * Math.Cos(angle));
    }
    public static bool Step(DribbleState state, Vec movement, int tick, Balance balance)
    {
        if (movement.Length < 1e-6)
        {
            state.Reset(state.Direction);
            return false;
        }
        var desired = movement.Unit;
        var pauseTicks = (int)Math.Ceiling(balance.DribbleTurnPauseSeconds * 60);
        var transferTicks = (int)Math.Ceiling(balance.DribbleTurnSeconds * 60);
        void BeginTurn()
        {
            state.Target = desired;
            state.TurnStartTick = tick;
            state.TurnEndTick = tick + pauseTicks + transferTicks;
        }
        if (state.TurnEndTick > 0)
        {
            // Returning to the currently planted side aborts the requested turn, never flips the ball.
            if (state.Direction.Dot(desired) > .995) { state.Reset(state.Direction); return false; }
            if (state.Target.Dot(desired) < SharpTurnDot) BeginTurn();
            else state.Target = desired;
            if (tick < state.TurnStartTick + pauseTicks) return true;
            var remaining = Math.Abs(Angle(state.Direction, state.Target));
            var maxStep = Math.PI / balance.DribbleTurnSeconds / 60;
            state.Direction = RotateToward(state.Direction, state.Target, Math.Min(maxStep, remaining / Math.Max(1, state.TurnEndTick - tick)));
            if (tick >= state.TurnEndTick)
            {
                if (Math.Abs(Angle(state.Direction, state.Target)) < 1e-6) { state.Reset(state.Target); return false; }
                state.TurnEndTick = tick + 1;
            }
            return true;
        }
        if (state.Direction.Dot(desired) < SharpTurnDot) { BeginTurn(); return true; }
        state.Direction = RotateToward(state.Direction, desired, balance.DribbleSteeringRadiansPerSecond / 60);
        state.Target = desired;
        return false;
    }
}
