import type defaults from '../../../shared/football.json';
export type Balance = typeof defaults;
export type Vec = {x: number; y: number};
export type Motion = {x: number; y: number; vx: number; vy: number; facingX: number; facingY: number};
export const DT = 1 / 60;
export const ZERO: Vec = {x: 0, y: 0};
export function clampVector(v: Vec): Vec {
  const n = Math.hypot(v.x, v.y);
  return n > 1 ? {x: v.x / n, y: v.y / n} : {...v};
}
export function step(s: Motion, input: Vec, aim: Vec, b: Balance): void {
  const move = clampVector(input);
  const dx = move.x * b.runSpeed - s.vx, dy = move.y * b.runSpeed - s.vy;
  const distance = Math.hypot(dx, dy);
  const max = (move.x === 0 && move.y === 0 ? b.braking : b.acceleration) * DT;
  const k = distance > max ? max / distance : 1;
  s.vx += dx * k; s.vy += dy * k;
  s.x += s.vx * DT; s.y += s.vy * DT;
  constrain(s, b);
  const facing = Math.hypot(aim.x, aim.y) > 0 ? aim : move;
  const n = Math.hypot(facing.x, facing.y);
  if (n > 0) { s.facingX = facing.x / n; s.facingY = facing.y / n; }
}
export function constrain(s: Motion, b: Balance): void {
  const bx = b.fieldWidth / 2 - b.playerRadius, by = b.fieldHeight / 2 - b.playerRadius;
  if (Math.abs(s.x) > bx) {s.x = Math.max(-bx, Math.min(bx, s.x)); s.vx = 0;}
  if (Math.abs(s.y) > by) {s.y = Math.max(-by, Math.min(by, s.y)); s.vy = 0;}
}
