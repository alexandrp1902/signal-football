import {describe, expect, it} from 'vitest';
import balance from '../../../shared/football.json';
import movements from '../../../shared/test-vectors/movement.json';
import coordinates from '../../../shared/test-vectors/coordinates.json';
import {step, type Motion} from './movement.ts';
import {worldToTeam, teamToWorld, worldToScreen, screenToWorld, type Team} from './coordinates.ts';
import {FixedClock} from './clock.ts';

describe('shared C#/TS vectors', () => {
  for (const vector of movements) it(vector.name, () => {
    const state = {...vector.initial};
    for (let i = 0; i < vector.steps; i++) step(state, vector.move, vector.aim, balance);
    for (const key of ['x', 'y', 'vx', 'vy'] as const) expect(state[key]).toBeCloseTo(vector.expected[key], 5);
  });
  for (const [index, v] of coordinates.entries()) it(`team transform ${index}`, () => {
    const transformed = worldToTeam(v.world, v.team as Team), restored = teamToWorld(v.teamPoint, v.team as Team);
    expect(transformed.x).toBeCloseTo(v.teamPoint.x, 10); expect(transformed.y).toBeCloseTo(v.teamPoint.y, 10);
    expect(restored.x).toBeCloseTo(v.world.x, 10); expect(restored.y).toBeCloseTo(v.world.y, 10);
  });
});
it('diagonal normalizes and analog input preserves magnitude', () => {
  const a: Motion = {x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1}, b = {...a};
  for (let i = 0; i < 60; i++) {step(a, {x: 1, y: 0}, {x: 0, y: 0}, balance); step(b, {x: 1, y: 1}, {x: 0, y: 0}, balance);}
  expect(Math.hypot(b.x, b.y)).toBeCloseTo(a.x, 10);
});
it('real fixed clock produces equal movement at 30, 60 and 120 render FPS', () => {
  const result = [30, 60, 120].map(fps => {
    const clock = new FixedClock(); let steps = 0;
    const state: Motion = {x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1};
    for (let i = 0; i < fps; i++) clock.advance(1 / fps, () => {steps++; step(state, {x: 1, y: 0}, {x: 0, y: 1}, balance);});
    expect(steps).toBe(60); return state;
  });
  expect(result[0]).toEqual(result[1]); expect(result[1]).toEqual(result[2]);
});
it('clock refuses to create background catch-up input', () => {
  const clock = new FixedClock(); let count = 0;
  expect(clock.advance(10, () => count++)).toBe(false); expect(count).toBe(0);
  clock.advance(1 / 60, () => count++); expect(count).toBe(1);
});
it('camera round trips and team input stays aligned for either side', () => {
  for (const team of ['blue', 'red'] as Team[]) for (const width of [320, 390, 1000]) {
    const c = {x: 0, y: -5, width, height: 800, scale: (width - 32) / 24};
    const world = {x: 4, y: -8}, screen = worldToScreen(world, team, c), result = screenToWorld(screen, team, c);
    expect(result.x).toBeCloseTo(world.x, 10); expect(result.y).toBeCloseTo(world.y, 10);
    const up = teamToWorld({x: 0, y: 1}, team);
    const ahead = worldToScreen({x: world.x + up.x, y: world.y + up.y}, team, c);
    expect(ahead.y).toBeLessThan(screen.y);
  }
});
