using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using CatsFootball.Server.Game;
using CatsFootball.Server.Net;
using MessagePack;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace CatsFootball.Server.Tests;

public sealed class NetworkTests
{
    [Fact]
    public void CSharpSnapshotMatchesCheckedInBinaryFixture()
    {
        var directory = Path.Combine(AppContext.BaseDirectory, "vectors");
        var snapshot = JsonSerializer.Deserialize<Snapshot>(File.ReadAllText(Path.Combine(directory, "snapshot.json")), Protocol.Json)!;
        var encoded = SnapshotCodec.Encode(snapshot);
        Assert.Equal(File.ReadAllBytes(Path.Combine(directory, "snapshot.msgpack")), encoded);
        Assert.Equal(101, MessagePackSerializer.Deserialize<Snapshot>(encoded).ServerTick);
    }

    [Fact]
    public void TokenBucketHasBoundedBurstAndRefills()
    {
        var bucket = new TokenBucket(0);
        for (var i = 0; i < 120; i++) Assert.True(bucket.Take(0));
        Assert.False(bucket.Take(0)); Assert.False(bucket.Take(5)); Assert.True(bucket.Take(10)); Assert.False(bucket.Take(10));
    }

    [Fact]
    public async Task OutboxSerializesWritesReplacesSnapshotsAndPreservesReliableMessages()
    {
        using var box = new Outbox();
        box.Reliable([1]); box.Snapshot([2]); box.Snapshot([3]); box.Reliable([4]);
        var active = 0; var maxActive = 0; var closing = false; var received = new List<(byte, bool)>();
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var task = box.DrainAsync(async (bytes, binary, ct) => {
            maxActive = Math.Max(maxActive, Interlocked.Increment(ref active));
            await Task.Delay(5, ct); received.Add((bytes[0], binary)); Interlocked.Decrement(ref active);
            if (received.Count == 3) {closing = true; box.Wake();}
        }, () => closing, cancel.Token);
        await task;
        Assert.Equal(1, maxActive); Assert.Equal(new[] {( (byte)1, false), ((byte)4, false), ((byte)3, true)}, received);
        using var full = new Outbox();
        for (var i = 0; i < Protocol.ReliableCapacity; i++) Assert.True(full.Reliable([1]));
        Assert.False(full.Reliable([1]));
    }

    [Fact]
    public void OriginPolicyChecksBrowserOriginAndAllowsExplicitNativeClients()
    {
        var request = new DefaultHttpContext().Request; request.Scheme = "http"; request.Host = new HostString("localhost", 5101);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["AllowedOrigins"] = "http://192.168.1.5:5174" }).Build();
        Assert.True(OriginPolicy.Allowed("http://localhost:5101", request, config));
        Assert.True(OriginPolicy.Allowed("http://192.168.1.5:5174", request, config));
        Assert.True(OriginPolicy.Allowed("", request, config));
        Assert.False(OriginPolicy.Allowed("https://evil.example", request, config));
    }

    [Fact]
    public void NamesAreTextSafeLimitedAndSupportGraphemes()
    {
        Assert.Equal("Игрок", GameHost.CleanName("\n\u0000"));
        Assert.Equal("Котик", GameHost.CleanName(" Ко\u0000тик\n"));
        Assert.Equal(new string('Я', 16), GameHost.CleanName(new string('Я', 20)));
        Assert.Equal("<b>Кот</b>", GameHost.CleanName("<b>Кот</b>")); // Client renders via textContent.
    }

    [Fact]
    public async Task RealWebSocketHandshakeCapacityEpochAndFragmentLimits()
    {
        await using var app = new WebApplicationFactory<Program>();
        using var http = app.CreateClient(); Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/health")).StatusCode);
        var client = app.Server.CreateWebSocketClient();
        using var a = await client.ConnectAsync(new Uri("ws://localhost/ws"), CancellationToken.None);
        using var b = await client.ConnectAsync(new Uri("ws://localhost/ws"), CancellationToken.None);
        await Send(a, new {type = "hello", protocolVersion = Protocol.Version, name = "Кот", create = true});
        var welcome = await ReceiveType(a, "welcome"); var roster = await ReceiveType(a, "roomState");
        Assert.Matches("^[0-9]{4}$",roster.GetProperty("code").GetString()!);
        await Send(b, new {type = "hello", protocolVersion = Protocol.Version, name = "Кот", create = false, code = roster.GetProperty("code").GetString()});
        var other = await ReceiveType(b, "welcome"); Assert.Equal("red", other.GetProperty("team").GetString());
        using var third = await client.ConnectAsync(new Uri("ws://localhost/ws"), CancellationToken.None);
        await Send(third, new {type = "hello", protocolVersion = Protocol.Version, name = "Third", create = false, code = roster.GetProperty("code").GetString()});
        Assert.Equal("roomFull", (await ReceiveType(third, "error")).GetProperty("code").GetString());
        await Send(b, new {type = "inputBatch", roomId = other.GetProperty("roomId").GetString(), matchId = other.GetProperty("matchId").GetString(), connectionEpoch = "wrong", frames = Array.Empty<object>()});
        Assert.Equal("invalidCommand", (await ReceiveType(b, "error")).GetProperty("code").GetString());
        var fragment = new byte[9000]; Array.Fill(fragment, (byte)' ');
        await a.SendAsync(fragment, WebSocketMessageType.Text, false, CancellationToken.None);
        await a.SendAsync(fragment, WebSocketMessageType.Text, true, CancellationToken.None);
        Assert.Equal("messageTooLarge", (await ReceiveType(a, "error")).GetProperty("code").GetString());
    }

    private static Task Send(WebSocket socket, object message) => socket.SendAsync(Protocol.Encode(message), WebSocketMessageType.Text, true, CancellationToken.None);
    private static async Task<JsonElement> ReceiveType(WebSocket socket, string type)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var buffer = new byte[65536];
        while (true)
        {
            var length = 0; WebSocketReceiveResult result;
            do {result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, length, buffer.Length - length), timeout.Token); length += result.Count;} while (!result.EndOfMessage);
            if (result.MessageType == WebSocketMessageType.Close) throw new Exception("Unexpected close");
            if (result.MessageType != WebSocketMessageType.Text) continue;
            var root = JsonDocument.Parse(buffer.AsMemory(0, length)).RootElement;
            if (root.GetProperty("type").GetString() == type) return root;
        }
    }
}
