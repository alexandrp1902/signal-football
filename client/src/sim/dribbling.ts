import type {Balance, Vec} from './movement.ts';
export type DribbleState = {x: number; y: number; targetX: number; targetY: number; turnStartTick: number; turnEndTick: number};
export const createDribble = (): DribbleState => ({x: 0, y: 1, targetX: 0, targetY: 1, turnStartTick: 0, turnEndTick: 0});
export function resetDribble(state: DribbleState): void {
  state.targetX = state.x; state.targetY = state.y; state.turnStartTick = state.turnEndTick = 0;
}
export function dribbleAngle(from: Vec, to: Vec): number {
  const cross = from.x * to.y - from.y * to.x, dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y));
  return Math.abs(cross) < 1e-12 && dot < 0 ? Math.PI : Math.atan2(cross, dot);
}
function rotateToward(state: DribbleState, to: Vec, maxAngle: number): void {
  let angle = dribbleAngle(state, to);
  if (Math.abs(angle) <= maxAngle) {state.x = to.x; state.y = to.y; return;}
  angle = Math.sign(angle) * maxAngle;
  const x = state.x;
  state.x = x * Math.cos(angle) - state.y * Math.sin(angle);
  state.y = x * Math.sin(angle) + state.y * Math.cos(angle);
}
/** Mirrors server Dribbling.Step. Returns true while the feet must stay planted. */
export function stepDribble(state: DribbleState, movement: Vec, tick: number, balance: Balance): boolean {
  const length = Math.hypot(movement.x, movement.y);
  if (length < 1e-6) {resetDribble(state); return false;}
  const desired = {x: movement.x / length, y: movement.y / length};
  const pauseTicks = Math.ceil(balance.dribbleTurnPauseSeconds * 60), transferTicks = Math.ceil(balance.dribbleTurnSeconds * 60);
  const begin = () => {state.targetX = desired.x; state.targetY = desired.y; state.turnStartTick = tick; state.turnEndTick = tick + pauseTicks + transferTicks;};
  if (state.turnEndTick > 0) {
    if (state.x * desired.x + state.y * desired.y > .995) {resetDribble(state); return false;}
    if (state.targetX * desired.x + state.targetY * desired.y < .25) begin();
    else {state.targetX = desired.x; state.targetY = desired.y;}
    if (tick < state.turnStartTick + pauseTicks) return true;
    const target = {x: state.targetX, y: state.targetY}, remaining = Math.abs(dribbleAngle(state, target));
    rotateToward(state, target, Math.min(Math.PI / balance.dribbleTurnSeconds / 60, remaining / Math.max(1, state.turnEndTick - tick)));
    if (tick >= state.turnEndTick) {
      if (Math.abs(dribbleAngle(state, target)) < 1e-6) {state.x = target.x; state.y = target.y; resetDribble(state); return false;}
      state.turnEndTick = tick + 1;
    }
    return true;
  }
  if (state.x * desired.x + state.y * desired.y < .25) {begin(); return true;}
  rotateToward(state, desired, balance.dribbleSteeringRadiansPerSecond / 60);
  state.targetX = desired.x; state.targetY = desired.y;
  return false;
}
