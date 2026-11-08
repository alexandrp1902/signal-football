import {expect,it} from 'vitest';
import {catFacing,gaitPose,strikePose,windupPose} from './catAnimation.ts';
import {RunningCat} from './runningCat.ts';
import {Rectangle,Texture,TextureSource} from 'pixi.js';

it('looks away when moving north and mirrors the side and diagonal views to the west',()=>{
  for(const [direction,view,mirror]of [
    [{x:0,y:1},3,1],[{x:1,y:1},2,1],[{x:1,y:0},1,1],[{x:1,y:-1},0,1],
    [{x:0,y:-1},0,1],[{x:-1,y:-1},0,-1],[{x:-1,y:0},1,-1],[{x:-1,y:1},2,-1],
  ] as const)expect(catFacing(direction)).toEqual({view,mirror});
});
it('holds the last view when stopping or hovering at a directional boundary',()=>{
  const north=catFacing({x:0,y:1});expect(catFacing({x:0,y:0},north)).toBe(north);
  const at=(angle:number)=>({x:Math.sin(angle),y:Math.cos(angle)});
  const boundary=Math.PI/8;
  expect(catFacing(at(boundary+.04),north).view).toBe(3);
  const diagonal=catFacing(at(boundary+.2),north);expect(diagonal.view).toBe(2);
  expect(catFacing(at(boundary-.04),diagonal).view).toBe(2);
});
it('plants the supporting foot while the kicking foot winds back, strikes and returns',()=>{
  const direction={x:1,y:0},neutral=gaitPose(0,direction,0),windup=windupPose(1,direction);
  expect(windup.right.x).toBeLessThan(windupPose(0,direction).right.x);
  expect(windup.left).toEqual(neutral.left);
  expect(strikePose(0,1,direction)).toEqual(windup);
  expect(strikePose(.22,1,direction).right.x).toBeGreaterThan(10);
  expect(strikePose(1,1,direction)).toEqual(neutral);
});
it('strikes along vertical aim and transfers the current stride between view rigs',()=>{
  expect(strikePose(.22,1,{x:0,y:1}).right.y).toBeLessThan(0);
  expect(strikePose(.22,1,{x:0,y:-1}).right.y).toBeGreaterThan(0);
  const texture=new Texture({source:new TextureSource({width:314,height:314}),frame:new Rectangle(0,0,314,314)});
  const before=new RunningCat(texture),after=new RunningCat(texture);
  before.advance(.3,{x:5.6,y:0});after.copyGait(before);
  before.advance(.1,{x:5.6,y:0});after.advance(.1,{x:5.6,y:0});
  expect([...after.leftLeg.vertices]).toEqual([...before.leftLeg.vertices]);
});
