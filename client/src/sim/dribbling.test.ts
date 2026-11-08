import {expect,it} from 'vitest';
import balance from '../../../shared/football.json';
import vectors from '../../../shared/test-vectors/dribbling.json';
import {createDribble,dribbleAngle,stepDribble} from './dribbling.ts';
import {RunningCat,gaitPose} from '../render/runningCat.ts';
import {Rectangle,Texture,TextureSource} from 'pixi.js';

for(const row of vectors)it(`shared carry reversal at tick ${row.steps}`,()=>{
  const state={...createDribble(),...row.direction,targetX:row.direction.x,targetY:row.direction.y};let planted=false;
  for(let tick=1;tick<=row.steps;tick++)planted=stepDribble(state,row.move,tick,balance);
  expect(planted).toBe(row.expected.planted);expect(state.x).toBeCloseTo(row.expected.x,9);expect(state.y).toBeCloseTo(row.expected.y,9);
});
it('late turn changes stay bounded and releasing movement preserves the ball side',()=>{
  const state={...createDribble(),x:1,y:0,targetX:1,targetY:0};
  for(let tick=1;tick<=50;tick++){
    const previous={...state};stepDribble(state,tick<20?{x:-1,y:0}:{x:0,y:-1},tick,balance);
    expect(Math.abs(dribbleAngle(previous,state))).toBeLessThanOrEqual(Math.PI/9+1e-8);
  }
  const before={x:state.x,y:state.y};stepDribble(state,{x:1,y:0},51,balance);stepDribble(state,{x:0,y:0},52,balance);
  expect({x:state.x,y:state.y}).toEqual(before);expect(state.turnEndTick).toBe(0);
});
it('actual paws alternate and gait depends on distance at any render frame rate',()=>{
  const pose=gaitPose(Math.PI/2,{x:1,y:0}),opposite=gaitPose(Math.PI*1.5,{x:1,y:0});
  expect(pose.left.y).toBeLessThan(pose.right.y);
  for(const key of ['x','y','angle','scaleY'] as const)expect(pose.left[key]).toBeCloseTo(opposite.right[key],10);
  const texture=new Texture({source:new TextureSource({width:314,height:314}),frame:new Rectangle(0,0,314,314)});
  const run=(frames:number)=>{const cat=new RunningCat(texture);for(let i=0;i<frames;i++)cat.advance(.525/frames,{x:0,y:1});return cat;};
  const a=run(30),b=run(120);
  for(const leg of ['leftLeg','rightLeg'] as const)for(let i=0;i<a[leg].vertices.length;i++)expect(a[leg].vertices[i]).toBeCloseTo(b[leg].vertices[i],6);
  expect(a.leftLeg.vertices.at(-1)!).toBeLessThan(a.rightLeg.vertices.at(-1)!);
  const vertices=[...a.leftLeg.vertices];a.advance(0,{x:0,y:1});expect([...a.leftLeg.vertices]).toEqual(vertices);
});
it('running bends the legs while their hips stay attached to the moving torso',()=>{
  const texture=new Texture({source:new TextureSource({width:314,height:314}),frame:new Rectangle(0,0,314,314)});
  const cat=new RunningCat(texture);
  const hips=[cat.leftLeg,cat.rightLeg].map(leg=>({x:leg.vertices[0],y:leg.vertices[1]-cat.body.y}));
  cat.advance(.35,{x:5.6,y:0});cat.body.updateLocalTransform();
  for(const [i,leg]of [cat.leftLeg,cat.rightLeg].entries()){
    const attached=cat.body.localTransform.apply(hips[i]);
    expect(leg.vertices[0]).toBeCloseTo(attached.x,5);expect(leg.vertices[1]).toBeCloseTo(attached.y,5);
    expect([...leg.vertices].every(Number.isFinite)).toBe(true);
  }
  expect(cat.leftArm.rotation).toBeCloseTo(-cat.rightArm.rotation,10);
  expect(cat.head.rotation*cat.body.rotation).toBeLessThan(0);
});
it('running turns toward movement and restarts gently after stopping',()=>{
  const texture=new Texture({source:new TextureSource({width:314,height:314}),frame:new Rectangle(0,0,314,314)});
  const cat=new RunningCat(texture),fresh=new RunningCat(texture);
  cat.advance(.3,{x:-5.6,y:0});expect(cat.scale.x).toBe(-1);
  cat.advance(.3,{x:5.6,y:0});expect(cat.scale.x).toBe(1);
  cat.reset();cat.advance(.1,{x:5.6,y:0});fresh.advance(.1,{x:5.6,y:0});
  expect([...cat.leftLeg.vertices]).toEqual([...fresh.leftLeg.vertices]);
  expect(cat.body.rotation).toBe(fresh.body.rotation);
  cat.destroy({children:true});expect(texture.destroyed).toBe(false);
});
