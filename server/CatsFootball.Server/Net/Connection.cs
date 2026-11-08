using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.Json;
using CatsFootball.Server.Game;

namespace CatsFootball.Server.Net;

public sealed class Connection(WebSocket socket, ILogger<Connection> log)
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    private readonly Outbox _outbox = new();
    private int _closing;
    private int _code = 1000;
    private string _reason = "Closed";
    public bool Closing => Volatile.Read(ref _closing) != 0;
    public bool Joined { get; set; }
    public long BytesSent { get; private set; }
    public void Send(object value)
    {
        if (!Closing && !_outbox.Reliable(Protocol.Encode(value))) Close(4008, "Reliable queue full");
    }
    public void Snapshot(byte[] bytes) { if (!Closing) _outbox.Snapshot(bytes); }
    public void Fail(string code, string message)
    {
        log.LogInformation("Connection rejected: {Code}", code);
        Send(Protocol.Error(code, message)); Close(4000, code);
    }
    public void Close(int code = 1000, string reason = "Closed")
    {
        if (Interlocked.CompareExchange(ref _closing, 1, 0) != 0) return;
        _code = code; _reason = reason; _outbox.Wake();
    }

    public async Task RunAsync(GameHost host, CancellationToken requestCt)
    {
        using var life = CancellationTokenSource.CreateLinkedTokenSource(requestCt);
        var sender = SendLoop(life.Token);
        var receiver = ReceiveLoop(host, life.Token);
        await Task.WhenAny(sender, receiver);
        Close();
        // Only the sender performs close output. Receive can remain pending during the handshake.
        try { await sender.WaitAsync(TimeSpan.FromSeconds(3), requestCt); }
        catch (Exception e) when (e is OperationCanceledException or TimeoutException or WebSocketException) { }
        try { await receiver.WaitAsync(TimeSpan.FromSeconds(2), requestCt); }
        catch (Exception e) when (e is OperationCanceledException or TimeoutException or WebSocketException) { }
        life.Cancel();
        if (socket.State != WebSocketState.Closed) socket.Abort();
        try { await receiver; } catch (Exception e) when (e is OperationCanceledException or WebSocketException) { }
        _outbox.Dispose();
    }

    private async Task SendLoop(CancellationToken ct)
    {
        try
        {
            await _outbox.DrainAsync(async (bytes, binary, token) =>
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(2));
                await socket.SendAsync(bytes.AsMemory(), binary ? WebSocketMessageType.Binary : WebSocketMessageType.Text, true, timeout.Token);
                BytesSent += bytes.Length;
            }, () => Closing, ct);
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync((WebSocketCloseStatus)_code, _reason, timeout.Token);
            }
        }
        catch (Exception e) when (e is OperationCanceledException or WebSocketException) { Close(); }
    }

    private async Task ReceiveLoop(GameHost host, CancellationToken ct)
    {
        var buffer = new byte[Protocol.MaxMessageBytes + 1];
        var hello = false;
        var rate = new TokenBucket(GameHost.NowMs);
        try
        {
            while (!ct.IsCancellationRequested && !Closing)
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(hello ? TimeSpan.FromSeconds(15) : TimeSpan.FromSeconds(5));
                var length = 0;
                ValueWebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer.AsMemory(length), timeout.Token);
                    if (result.MessageType == WebSocketMessageType.Close) { Close(); return; }
                    length += result.Count;
                    if (length > Protocol.MaxMessageBytes) { Fail("messageTooLarge", "Сообщение больше 16 КиБ"); return; }
                    if (result.MessageType != WebSocketMessageType.Text) { Fail("invalidMessage", "Ожидается JSON"); return; }
                } while (!result.EndOfMessage);
                if (!rate.Take(GameHost.NowMs)) { Fail("rateLimit", "Слишком много сообщений"); return; }
                using var doc = JsonDocument.Parse(buffer.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 12 });
                var root = doc.RootElement;
                var type = root.GetProperty("type").GetString();
                if (type == "hello")
                {
                    if (hello) throw new InvalidDataException("Duplicate hello");
                    hello = true;
                }
                else if (!hello) throw new InvalidDataException("hello required");
                if (!host.Enqueue(this, root.Clone())) { Fail("commandQueueFull", "Очередь команд заполнена"); return; }
            }
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException or InvalidDataException or FormatException)
        { Fail("invalidMessage", "Неверный формат команды"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { Fail("timeout", "Истекло время ожидания"); }
        catch (WebSocketException) { Close(); }
    }
}
