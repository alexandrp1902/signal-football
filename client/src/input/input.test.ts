import {expect, it} from 'vitest';
import {InputModel, stickLayout, stickVector} from './model.ts';
it('stick CSS dimensions preserve safe layout at every specified width', () => {
  [320, 360, 390, 430, 480].forEach((width, i) => {
    const layout = stickLayout(width);
    expect(layout.diameter).toBeCloseTo([112, 122.4, 132.6, 146.2, 156][i], 6);
    expect(layout.knob).toBeCloseTo(.48 * layout.diameter, 6);
    expect(2 * layout.diameter + 48).toBeLessThanOrEqual(width);
  });
});
it('stick handles dead zone, analog remapping and captured finger outside base', () => {
  expect(stickVector(3, 0, 30)).toEqual({x: 0, y: 0});
  expect(stickVector(0, -100, 30)).toEqual({x: 0, y: 1});
  expect(Math.hypot(...Object.values(stickVector(100, 100, 30)))).toBeCloseTo(1);
  expect(stickVector(16.8, 0, 30).x).toBeCloseTo(.5);
});
it('gesture starts once outside dead zone and releases at most once', () => {
  const m = new InputModel(); m.beginGesture(); m.point({x: 0, y: 0}, 0); expect(m.preparing).toBe(false);
  m.point({x: 0, y: 1}, 100); m.point({x: 1, y: 0}, 200);
  expect(m.startMs).toBe(100); m.release(); m.release();
  expect(m.takeTransitions()).toEqual([{kind: 'begin', actionId: 1}, {kind: 'release', actionId: 1, aimX:1, aimY:0}]);
});
it('center cancellation latches until the next physical gesture', () => {
  const m = new InputModel(); m.beginGesture(); m.point({x: 1, y: 0}, 0);
  m.point({x: 0, y: 0}, 20); m.point({x: 1, y: 0}, 40); m.release();
  expect(m.takeTransitions()).toEqual([{kind: 'begin', actionId: 1}, {kind: 'cancel', actionId: 1}]);
  m.beginGesture(); m.point({x: 1, y: 0}, 50); expect(m.actionId).toBe(2);
});
it('release freezes the arrow direction before later mouse or movement updates',()=>{
  const m=new InputModel();m.keys.add('d');m.beginGesture();m.point({x:-1,y:0},0);m.release();
  m.point({x:0,y:1},1);const shot=m.takeTransitions().find(t=>t.kind==='release')!;
  expect(shot.aimX).toBe(-1);expect(shot.aimY).toBe(0);expect(m.aim).toEqual({x:0,y:1});expect(m.move).toEqual({x:1,y:0});
});
it('Escape/blur cancellation never releases an action and clears movement', () => {
  const m = new InputModel(); m.keys.add('w'); m.beginGesture(); m.point({x: 1, y: 0}, 0);
  m.clear(); m.release(); expect(m.move).toEqual({x: 0, y: 0});
  expect(m.takeTransitions().map(t => t.kind)).toEqual(['begin', 'cancel']);
});
it('opposite keys cancel, diagonals normalize and touch is independent of aiming', () => {
  const m = new InputModel(); m.keys.add('w'); m.keys.add('s'); expect(m.move.y).toBe(0);
  m.keys.delete('s'); m.keys.add('d'); expect(Math.hypot(m.move.x, m.move.y)).toBeCloseTo(1);
  m.touchMove = true; m.left = {x: .5, y: 0}; m.beginGesture(); m.point({x: 0, y: 1}, 1);
  expect(m.move).toEqual({x: .5, y: 0}); expect(m.preparing).toBe(true);
});
