using CatsFootball.Server.Game;
using CatsFootball.Server.Net;
using Microsoft.Extensions.FileProviders;

if (args is ["--write-fixture", var fixtureDirectory])
{
    var fixture = System.Text.Json.JsonSerializer.Deserialize<Snapshot>(File.ReadAllText(Path.Combine(fixtureDirectory, "snapshot.json")), Protocol.Json)!;
    File.WriteAllBytes(Path.Combine(fixtureDirectory, "snapshot.msgpack"), SnapshotCodec.Encode(fixture));
    return;
}

var builder = WebApplication.CreateBuilder(args);
if (builder.Configuration["urls"] is null) builder.WebHost.UseUrls("http://0.0.0.0:5101");
builder.Services.AddSingleton<GameHost>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<GameHost>());
var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(10) });

// Resolve from the assembly location (including dotnet run from any working directory).
var dist = app.Configuration["ClientDist"] ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../client/dist"));
if (Directory.Exists(dist))
{
    var provider = new PhysicalFileProvider(dist);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = provider });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = provider });
}
else app.MapGet("/", () => Results.Text("Соберите клиент: npm --prefix client run build", statusCode: 503));
app.MapGet("/health", (GameHost host) => host.Ready ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
app.Map("/ws", async (HttpContext ctx, GameHost host, ILogger<Connection> log) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
    var origin = ctx.Request.Headers.Origin.ToString();
    if (!OriginPolicy.Allowed(origin, ctx.Request, app.Configuration)) { ctx.Response.StatusCode = 403; return; }
    using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
    await new Connection(socket, log).RunAsync(host, ctx.RequestAborted);
});
app.Run();

public partial class Program { }

public static class OriginPolicy
{
    public static bool Allowed(string origin, HttpRequest request, IConfiguration config)
    {
        if (origin == "") return true; // Native clients / CLI smoke; no browser credentials in this guest protocol.
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.UserInfo != "" || uri.AbsolutePath != "/" ||
            uri.Scheme is not ("http" or "https")) return false;
        if (string.Equals(origin.TrimEnd('/'), $"{request.Scheme}://{request.Host}", StringComparison.OrdinalIgnoreCase)) return true;
        var configured = (config["AllowedOrigins"] ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return configured.Contains(origin.TrimEnd('/'), StringComparer.OrdinalIgnoreCase);
    }
}
