import {expect,it} from 'vitest';
import {collideMotion,sweepCircle} from './collision.ts';
it('continuous sweep catches fast crossing before its endpoint',()=>{
 expect(sweepCircle({x:-2,y:0},{x:4,y:0},{x:0,y:0},.84)).toBeCloseTo(.29,10);
 expect(sweepCircle({x:-.84,y:0},{x:-1,y:0},{x:0,y:0},.84)).toBe(Infinity);
});
it('prediction stops at another body and can slide along its tangent',()=>{
 const next={x:2,y:0,vx:24,vy:0,facingX:1,facingY:0};
 collideMotion({x:-2,y:0},next,[{x:0,y:0}],.84);expect(next.x).toBeCloseTo(-.84,8);expect(next.vx).toBe(0);
 const along={x:0,y:1,vx:4,vy:4,facingX:1,facingY:0};
 collideMotion({x:-.84,y:0},along,[{x:0,y:0}],.84);expect(along.x).toBeCloseTo(-.84,8);expect(along.y).toBeCloseTo(1,8);
});
it('a sliding prediction stops fully at the first body',()=>{
 const next={x:1,y:1,vx:13,vy:3,facingX:1,facingY:0};
 collideMotion({x:-1,y:0},next,[{x:0,y:0}],.84,true);expect(next.vx).toBe(0);expect(next.vy).toBe(0);
});
