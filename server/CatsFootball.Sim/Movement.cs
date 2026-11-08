namespace CatsFootball.Sim;

public readonly record struct Vec(double X, double Y)
{
    public double Length => Math.Sqrt(X * X + Y * Y);
    public Vec Clamped => Length > 1 ? new(X / Length, Y / Length) : this;
    public static Vec operator *(Vec v, double k) => new(v.X * k, v.Y * k);
    public static Vec operator +(Vec a, Vec b) => new(a.X + b.X, a.Y + b.Y);
    public static Vec operator -(Vec a, Vec b) => new(a.X - b.X, a.Y - b.Y);
    public double Dot(Vec b) => X * b.X + Y * b.Y;
    public Vec Unit => Length > 1e-10 ? this * (1 / Length) : new(0, 1);
    public static Vec ToTeam(Vec v, string team) => v;
}

public sealed class Motion
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Vx { get; set; }
    public double Vy { get; set; }
    public double FacingX { get; set; }
    public double FacingY { get; set; } = 1;
}

public static class Movement
{
    public const double Dt = 1.0 / 60;
    public static void Step(Motion s, Vec move, Vec aim, Balance b)
    {
        Velocity(s, move, aim, b);
        s.X += s.Vx * Dt;
        s.Y += s.Vy * Dt;
        var boundX = b.FieldWidth / 2 - b.PlayerRadius;
        var boundY = b.FieldHeight / 2 - b.PlayerRadius;
        if (s.X > boundX || s.X < -boundX) { s.X = Math.Clamp(s.X, -boundX, boundX); s.Vx = 0; }
        if (s.Y > boundY || s.Y < -boundY) { s.Y = Math.Clamp(s.Y, -boundY, boundY); s.Vy = 0; }
    }
    public static void Velocity(Motion s, Vec move, Vec aim, Balance b)
    {
        move = move.Clamped;
        var target = move * b.RunSpeed;
        var dx = target.X - s.Vx;
        var dy = target.Y - s.Vy;
        var distance = Math.Sqrt(dx * dx + dy * dy);
        var max = (move.Length == 0 ? b.Braking : b.Acceleration) * Dt;
        var k = distance > max ? max / distance : 1;
        s.Vx += dx * k;
        s.Vy += dy * k;
        var facing = aim.Length > 0 ? aim : move;
        if (facing.Length > 0) { s.FacingX = facing.X / facing.Length; s.FacingY = facing.Y / facing.Length; }
    }
}
