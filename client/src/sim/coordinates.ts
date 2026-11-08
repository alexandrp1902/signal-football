import type {Vec} from './movement.ts';
export type Team = 'blue' | 'red';
export type Camera = {x: number; y: number; scale: number; width: number; height: number};
// Preserve the original zoom even when the stadium grows. Both axes follow the player.
export function followPlayer(c: Camera, player: Vec, width: number, height: number): void {
  c.width=width;c.height=height;c.scale=(width-32)/24;c.x=player.x;c.y=player.y;
}
export const worldToTeam = (v: Vec, _team: Team): Vec => ({...v});
export const teamToWorld = worldToTeam;
export function worldToScreen(v: Vec, team: Team, c: Camera): Vec {
  const p = worldToTeam(v, team);
  return {x: c.width / 2 + (p.x - c.x) * c.scale, y: c.height / 2 - (p.y - c.y) * c.scale};
}
export function screenToWorld(v: Vec, team: Team, c: Camera): Vec {
  return teamToWorld({x: (v.x - c.width / 2) / c.scale + c.x, y: -(v.y - c.height / 2) / c.scale + c.y}, team);
}
