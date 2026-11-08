import {clampVector, type Vec} from '../sim/movement.ts';
import type {Transition} from '../net/protocol.ts';
export function stickLayout(width: number): {diameter: number; knob: number} {
  const diameter = Math.max(112, Math.min(156, .34 * width));
  return {diameter, knob: diameter * .48};
}
export function stickVector(dx: number, dy: number, max: number): Vec {
  const raw = Math.hypot(dx, dy) / max;
  if (raw <= .12) return {x: 0, y: 0};
  const magnitude = (Math.min(1, raw) - .12) / .88;
  const n = Math.hypot(dx, dy);
  return {x: dx / n * magnitude, y: -dy / n * magnitude};
}
export class InputModel {
  readonly keys = new Set<string>();
  left: Vec = {x: 0, y: 0};
  aim: Vec = {x: 0, y: 1};
  touchMove = false;
  pressing = false;
  preparing = false;
  blocked = false;
  actionId = 0;
  canPrepare = true;
  startMs = 0;
  private transitions: Transition[] = [];
  get move(): Vec {
    if (this.touchMove) return this.left;
    return clampVector({x: +(this.keys.has('d') || this.keys.has('arrowright')) - +(this.keys.has('a') || this.keys.has('arrowleft')),
      y: +(this.keys.has('w') || this.keys.has('arrowup')) - +(this.keys.has('s') || this.keys.has('arrowdown'))});
  }
  beginGesture(): void {this.pressing = true; this.blocked = !this.canPrepare;}
  point(aim: Vec, now: number): boolean {
    const n = Math.hypot(aim.x, aim.y);
    if (n === 0) {if (this.preparing) {this.cancel(); return true;} return false;}
    this.aim = {x: aim.x / n, y: aim.y / n};
    if (this.pressing && !this.blocked && !this.preparing) {
      this.preparing = true; this.actionId++; this.startMs = now;
      this.transitions.push({kind: 'begin', actionId: this.actionId});
    }
    return false;
  }
  release(): void {
    if (this.preparing && !this.blocked) this.transitions.push({kind: 'release', actionId: this.actionId, aimX:this.aim.x, aimY:this.aim.y});
    this.preparing = this.pressing = this.blocked = false;
  }
  cancel(): void {
    if (this.preparing) this.transitions.push({kind: 'cancel', actionId: this.actionId});
    this.preparing = false; this.blocked = true;
  }
  clear(): void {
    this.cancel(); this.keys.clear(); this.left = {x: 0, y: 0}; this.touchMove = false;
    this.pressing = false;
  }
  takeTransitions(): Transition[] {const result = this.transitions; this.transitions = []; return result;}
}
