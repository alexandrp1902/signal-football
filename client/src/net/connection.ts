import {decodeSnapshot} from './snapshot.ts';
import type {Identity, Roster, Snapshot, Welcome} from './protocol.ts';
import {resolveServerUrl} from './serverUrl.ts';
export type Callbacks = {welcome: (w: Welcome) => void; roster: (r: Roster) => void; snapshot: (s: Snapshot) => void;
  status: (status: string, disconnected: boolean) => void; sync: () => void};
export class Connection {
  welcome: Welcome | null = null;
  socket: WebSocket | null = null;
  rtt = 0;
  synced = false;
  private anchorTick = 0;
  private anchorTime = 0;
  private pingId = 0;
  private pingTimer = 0;
  private timer = 0;
  private errors = 0;
  private lastSnapshot = 0;
  private callbacks: Callbacks;
  private pendingPings = new Map<number, number>();
  private bootstrapRtts: number[] = [];
  constructor(callbacks: Callbacks) {this.callbacks = callbacks;}
  connect(name: string, code: string, create: boolean): void {
    this.close(); this.welcome = null; this.synced = false; this.errors = this.lastSnapshot = 0; this.bootstrapRtts = []; this.rtt = 0;
    const ws = new WebSocket(resolveServerUrl()); this.socket = ws; ws.binaryType = 'arraybuffer';
    this.callbacks.status('Подключение…', false);
    this.timer = window.setTimeout(() => {this.callbacks.status('Сервер не ответил вовремя. Попробуйте снова.', true); this.close();}, 7000);
    ws.onopen = () => {if (this.socket === ws) ws.send(JSON.stringify({type: 'hello', protocolVersion: 3, name, code, create}));};
    ws.onmessage = e => {
      if (this.socket !== ws) return;
      try {
        if (typeof e.data === 'string') {
          const m = JSON.parse(e.data);
          if (m.type === 'welcome') {
            if (m.protocolVersion !== 3 || m.balance?.tickRate !== 60 || m.balance?.schemaVersion !== 1) throw new Error('Обновите страницу: несовместимая версия игры');
            window.clearInterval(this.pingTimer); this.pendingPings.clear(); this.synced = false; this.bootstrapRtts = []; this.lastSnapshot = 0;
            this.welcome = m; window.clearTimeout(this.timer); this.callbacks.welcome(m);
            this.ping(); this.pingTimer = window.setInterval(() => this.ping(), 2000);
          } else if (m.type === 'roomState') this.callbacks.roster(m);
          else if (m.type === 'pong') {
            const sent = this.pendingPings.get(m.id); if (sent === undefined) return;
            this.pendingPings.delete(m.id);
            const now = performance.now(), sample = now - sent;
            if (!this.synced) {this.bootstrapRtts.push(sample); this.rtt = Math.min(...this.bootstrapRtts);}
            else this.rtt += (sample - this.rtt) * .2;
            this.anchorTick = m.serverTick + this.rtt * .03; this.anchorTime = now;
            // The first WebGL frame can delay JS for hundreds of ms. A single RTT would
            // schedule all inputs too far ahead and continuously overflow the six-frame queue.
            if (!this.synced && this.bootstrapRtts.length < 3) {this.ping(); return;}
            const first = !this.synced; this.synced = true;
            this.callbacks.status(this.rtt > 250 ? 'Связь с задержкой' : 'На поле', false);
            if (first) this.callbacks.sync();
          } else if (m.type === 'error') {this.callbacks.status(m.message || 'Ошибка сервера', !!m.fatal); if (m.fatal) this.close();}
        } else {
          const s = decodeSnapshot(new Uint8Array(e.data)); const w = this.welcome;
          if (!w || s.roomId !== w.roomId || s.matchId !== w.matchId || s.connectionEpoch !== w.connectionEpoch || s.snapshotSeq <= this.lastSnapshot) return;
          this.lastSnapshot = s.snapshotSeq; this.errors = 0;
          // Re-anchor to shared ticks as well as pongs: overload can discard wall-clock time.
          this.anchorTick = s.serverTick + this.rtt * .03; this.anchorTime = performance.now();
          this.callbacks.snapshot(s);
        }
      } catch (error) {
        if (++this.errors >= 3) {this.callbacks.status('Ошибка данных сервера. Подключитесь снова.', true); this.close();}
        console.warn('Protocol frame rejected', error);
      }
    };
    ws.onerror = () => {if (this.socket === ws) this.callbacks.status('Не удалось подключиться к серверу', true);};
    ws.onclose = () => {
      if (this.socket === ws) {window.clearTimeout(this.timer); window.clearInterval(this.pingTimer); this.socket = null;
        this.synced = false; this.callbacks.status('Связь потеряна. Войдите в комнату снова.', true);}
    };
  }
  get serverTick(): number {return this.anchorTick + (performance.now() - this.anchorTime) * .06;}
  get firstTarget(): number {return Math.floor(this.serverTick) + Math.ceil(this.rtt * .03) + 2;}
  ping(): void {
    const id = ++this.pingId, now = performance.now();
    if (this.pendingPings.size >= 4) {this.callbacks.status('Сервер перестал отвечать', true); this.close(); return;}
    this.pendingPings.set(id, now); this.send({type: 'ping', id, clientTime: now}, false);
  }
  send(message: Record<string, unknown>, identified = true): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 65536) {this.callbacks.status('Сеть перегружена. Подключитесь снова.', true); this.close(); return false;}
    const w = this.welcome;
    const identity: Identity | {} = identified && w ? {roomId: w.roomId, matchId: w.matchId, connectionEpoch: w.connectionEpoch} : {};
    this.socket.send(JSON.stringify({...message, ...identity})); return true;
  }
  close(): void {
    window.clearTimeout(this.timer); window.clearInterval(this.pingTimer); this.pendingPings.clear();
    const ws = this.socket; this.socket = null; this.synced = false;
    if (ws) {ws.onclose = null; ws.close();}
  }
}
