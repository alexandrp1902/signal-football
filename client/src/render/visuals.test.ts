import {expect,it} from 'vitest';
import {projectPanel,rotate,soccerMesh} from './soccerMesh.ts';
import {followPlayer,worldToScreen,type Camera} from '../sim/coordinates.ts';

it('football panels share a closed spherical topology with curved visible seams',()=>{
  const panels=soccerMesh();expect(panels.filter(p=>p.black)).toHaveLength(12);expect(panels.filter(p=>!p.black)).toHaveLength(20);
  const points=panels.flatMap(p=>p.corners);expect(points).toHaveLength(180);
  for(const p of points)expect(Math.hypot(p.x,p.y,p.z)).toBeCloseTo(1,10);
  const unique=new Set(points.map(p=>[p.x,p.y,p.z].map(v=>v.toFixed(8)).join(',')));expect(unique.size).toBe(60);
  for(const panel of panels){const projected=projectPanel(panel.corners);expect(projected.every(Number.isFinite)).toBe(true);for(let i=0;i<projected.length;i+=2)expect(Math.hypot(projected[i],projected[i+1])).toBeLessThanOrEqual(1+1e-10);}
});
it('rolling displaces the front panel and reversing restores its orientation',()=>{
  const front={x:0,y:0,z:1},axis={x:0,y:1,z:0};const moved=rotate(front,axis,.5);
  expect(moved.x).toBeGreaterThan(.4);expect(moved.z).toBeLessThan(1);
  const restored=rotate(moved,axis,-.5);expect(restored.x).toBeCloseTo(0,10);expect(restored.z).toBeCloseTo(1,10);
});
it('player remains at the screen centre anywhere on the larger pitch, keeping the old zoom',()=>{
  for(const width of [320,390,600])for(const player of [{x:0,y:0},{x:23.58,y:39.58},{x:-23.58,y:-39.58}]){
    const camera:Camera={x:0,y:0,width:0,height:0,scale:0};followPlayer(camera,player,width,844);
    expect(camera.scale).toBe((width-32)/24);
    for(const team of ['blue','red'] as const)expect(worldToScreen(player,team,camera)).toEqual({x:width/2,y:422});
  }
});
