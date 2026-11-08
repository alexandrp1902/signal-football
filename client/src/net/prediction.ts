import {constrain, DT, step, type Balance, type Motion} from '../sim/movement.ts';
import type {InputFrame, Snapshot, Player} from './protocol.ts';
import {collideMotion} from '../sim/collision.ts';
import {createDribble, resetDribble, stepDribble} from '../sim/dribbling.ts';
export class Prediction {
  state: Motion = {x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1};
  history: InputFrame[] = [];
  correction = 0;
  private offset = {x: 0, y: 0};
  private synced = false;
  private horizon = 0;
  private balance: Balance;
  private snapshot: Snapshot | null = null;
  private own: Player | null = null;
  dribble = createDribble();
  constructor(balance: Balance) {this.balance = balance;}
  push(frame: InputFrame): boolean {
    if (this.history.length >= 240) return false;
    this.history.push(frame); this.horizon = frame.targetTick;
    this.simulate(this.state, frame);
    return true;
  }
  reconcile(snapshot: Snapshot, id: string, hard = false): void {
    const p = snapshot.players.find(p => p.playerId === id);
    if (!p) return;
    this.snapshot = snapshot; this.own = p;
    this.dribble = {x:p.dribbleX,y:p.dribbleY,targetX:p.dribbleTargetX,targetY:p.dribbleTargetY,turnStartTick:p.dribbleTurnStartTick,turnEndTick:p.dribbleTurnEndTick};
    this.history = this.history.filter(f => f.inputSeq > snapshot.recipient.ackInputSeq && f.targetTick > snapshot.serverTick);
    const next: Motion = {...p};
    let move = {x: snapshot.recipient.moveX, y: snapshot.recipient.moveY};
    let aim = {x: snapshot.recipient.aimX, y: snapshot.recipient.aimY};
    let lastTick = snapshot.recipient.lastInputTick;
    const byTick = new Map(this.history.map(f => [f.targetTick, f]));
    for (let tick = snapshot.serverTick + 1; tick <= Math.min(this.horizon, snapshot.serverTick + 240); tick++) {
      const f = byTick.get(tick);
      if (f) {move = {x: f.moveX, y: f.moveY}; aim = {x: f.aimX, y: f.aimY}; lastTick = tick;}
      if (snapshot.recipient.needsResync || tick - lastTick >= 15) {move = {x: 0, y: 0}; next.vx = next.vy = 0;}
      this.simulate(next, {inputSeq: f?.inputSeq ?? 0, targetTick: tick, moveX: move.x, moveY: move.y, aimX: aim.x, aimY: aim.y, actionHeld: f?.actionHeld ?? snapshot.recipient.held, transitions: []});
    }
    const dx = this.state.x - next.x, dy = this.state.y - next.y;
    this.correction = Math.hypot(dx, dy);
    if (!this.synced || hard || this.correction > 1) this.offset = {x: 0, y: 0};
    else {this.offset.x += dx; this.offset.y += dy;}
    this.state = next; this.synced = true;
  }
  render(seconds: number): Motion {
    const k = Math.exp(-seconds / .1);
    this.offset.x *= k; this.offset.y *= k;
    const s = {...this.state, x: this.state.x + this.offset.x, y: this.state.y + this.offset.y};
    constrain(s, this.balance);
    if (this.snapshot && this.own) collideMotion(this.state, s, this.snapshot.players.filter(p => p.playerId !== this.own!.playerId), this.balance.playerRadius * 2);
    return s;
  }
  private simulate(state: Motion, frame: InputFrame): void {
    const s=this.snapshot, own=this.own, before={x:state.x,y:state.y};
    if(s && (!['training','playing'].includes(s.phase) || (own && frame.targetTick<own.recoverEndTick))){state.vx=state.vy=0;return;}
    const sliding=own?.actionState==='sliding' && frame.targetTick<=own.slideEndTick;
    if(sliding){state.vx=own!.slideX*this.balance.tackleSpeed;state.vy=own!.slideY*this.balance.tackleSpeed;state.x+=state.vx*DT;state.y+=state.vy*DT;constrain(state,this.balance);}
    else{
      const ownsBall=!!own && s?.ball.ownerId===own.playerId;
      let speed=this.balance.runSpeed*(ownsBall?this.balance.dribbleSpeedMultiplier:1);if(ownsBall&&frame.actionHeld)speed*=this.balance.shotMoveMultiplier;
      const planted=ownsBall&&stepDribble(this.dribble,{x:frame.moveX,y:frame.moveY},frame.targetTick,this.balance);
      if(planted)state.vx=state.vy=0;
      step(state,planted?{x:0,y:0}:{x:frame.moveX,y:frame.moveY},{x:frame.aimX,y:frame.aimY},{...this.balance,runSpeed:speed});
    }
    if(s&&own){const dt=Math.max(0,Math.min(.1,(frame.targetTick-s.serverTick)/60));const bodies=s.players.filter(p=>p.playerId!==own.playerId).map(p=>({x:p.x+p.vx*dt,y:p.y+p.vy*dt}));collideMotion(before,state,bodies,this.balance.playerRadius*2,sliding);}
  }
  stop(): void {this.history = []; this.horizon = 0; this.state.vx = this.state.vy = 0; this.offset = {x: 0, y: 0};resetDribble(this.dribble);}
}
