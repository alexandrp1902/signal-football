using System.Threading.Channels;

namespace CatsFootball.Server.Net;

/// <summary>One consumer. Reliable FIFO and one replaceable complete snapshot.</summary>
public sealed class Outbox : IDisposable
{
    private readonly Channel<byte[]> _reliable = Channel.CreateBounded<byte[]>(
        new BoundedChannelOptions(Protocol.ReliableCapacity) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private byte[]? _snapshot;
    private readonly SemaphoreSlim _signal = new(0, 1);
    public bool Reliable(byte[] bytes)
    {
        var accepted = _reliable.Writer.TryWrite(bytes);
        Wake();
        return accepted;
    }
    public void Snapshot(byte[] bytes) { Interlocked.Exchange(ref _snapshot, bytes); Wake(); }
    public void Wake() { try { _signal.Release(); } catch (SemaphoreFullException) { } }
    public async Task DrainAsync(Func<byte[], bool, CancellationToken, Task> send, Func<bool> closing, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _signal.WaitAsync(ct);
            while (_reliable.Reader.TryRead(out var message)) await send(message, false, ct);
            if (closing()) return;
            var snapshot = Interlocked.Exchange(ref _snapshot, null);
            if (snapshot is not null) await send(snapshot, true, ct);
        }
    }
    public void Dispose() => _signal.Dispose();
}
