import type {Ball, Player, Snapshot} from './protocol.ts';
export class Interpolation {
  frames: Snapshot[] = [];
  jitter = 0;
  delay = 75;
  private offset = NaN;
  private renderTick = NaN;
  private lastRender = 0;
  push(snapshot: Snapshot, now: number): void {
    const latest = this.frames.at(-1);
    if (latest && snapshot.snapshotSeq <= latest.snapshotSeq) return;
    const sample = now - snapshot.serverTick * 1000 / 60;
    if (!Number.isFinite(this.offset)) this.offset = sample;
    else {
      const deviation = Math.max(-100, Math.min(100, sample - this.offset));
      this.jitter += (Math.abs(deviation) - this.jitter) * .1;
      this.offset += deviation * .05;
    }
    this.delay = Math.max(75, Math.min(150, 50 + 3 * this.jitter));
    this.frames.push(snapshot); if (this.frames.length > 60) this.frames.shift();
  }
  ball(_now: number): Ball | null {
    if(!this.frames.length)return null;
    const tick=Number.isFinite(this.renderTick)?this.renderTick:this.frames.at(-1)!.serverTick;
    const before=this.frames.findLast(f=>f.serverTick<=tick)??this.frames[0],after=this.frames.find(f=>f.serverTick>=tick),ball={...before.ball};
    if(after&&after!==before&&after.ball.possessionVersion===ball.possessionVersion){const a=Math.max(0,Math.min(1,(tick-before.serverTick)/(after.serverTick-before.serverTick)));ball.x+=(after.ball.x-ball.x)*a;ball.y+=(after.ball.y-ball.y)*a;}
    else{const dt=Math.max(0,Math.min(.1,(tick-before.serverTick)/60));ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;}return ball;
  }
  sample(now: number): Player[] {
    if (!this.frames.length) return [];
    const target = (now - this.offset - this.delay) * 60 / 1000;
    if (!Number.isFinite(this.renderTick) || Math.abs(target - this.renderTick) > 60) this.renderTick = target;
    else this.renderTick += Math.max(0, now - this.lastRender) * .06 * Math.max(.9, Math.min(1.1, 1 + (target - this.renderTick) / 30));
    this.lastRender = now;
    const after = this.frames.find(s => s.serverTick >= this.renderTick);
    const before = this.frames.findLast(s => s.serverTick <= this.renderTick) ?? this.frames[0];
    if (!after || after === before) {
      const dt = Math.max(0, Math.min(.1, (this.renderTick - before.serverTick) / 60));
      return before.players.map(p => ({...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt}));
    }
    const alpha = Math.max(0, Math.min(1, (this.renderTick - before.serverTick) / (after.serverTick - before.serverTick)));
    return before.players.map(p => {
      const next = after.players.find(n => n.playerId === p.playerId) ?? p;
      return {...p, x: p.x + (next.x - p.x) * alpha, y: p.y + (next.y - p.y) * alpha};
    });
  }
}
