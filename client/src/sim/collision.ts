import type {Motion, Vec} from './movement.ts';
export function sweepCircle(position: Vec, delta: Vec, center: Vec, radius: number): number {
  const x = position.x - center.x, y = position.y - center.y, c = x*x + y*y - radius*radius;
  const approach = x*delta.x + y*delta.y;
  if (c <= 1e-8) return approach < -1e-9 ? 0 : Infinity;
  const a = delta.x*delta.x + delta.y*delta.y, d = approach*approach - a*c;
  if (a < 1e-16 || approach >= 0 || d < 0) return Infinity;
  const t = (-approach - Math.sqrt(d)) / a;
  return t >= -1e-9 && t <= 1+1e-9 ? Math.max(0, Math.min(1, t)) : Infinity;
}
export function collideMotion(from: Vec, next: Motion, bodies: Vec[], radius: number, stop = false): boolean {
  let current = {...from}, delta = {x: next.x-from.x, y: next.y-from.y}, touched = false;
  for (let pass=0; pass<4; pass++) {
    let time=Infinity, obstacle: Vec|null=null;
    for (const body of bodies) {const t=sweepCircle(current,delta,body,radius); if(t<time){time=t;obstacle=body;}}
    if(!obstacle){current.x+=delta.x;current.y+=delta.y;break;}
    touched=true;current.x+=delta.x*time;current.y+=delta.y*time;
    const n={x:current.x-obstacle.x,y:current.y-obstacle.y}, length=Math.hypot(n.x,n.y)||1;n.x/=length;n.y/=length;
    if(stop){next.vx=next.vy=0;break;}
    delta.x*=1-time;delta.y*=1-time;
    const inward=Math.min(0,delta.x*n.x+delta.y*n.y);delta.x-=inward*n.x;delta.y-=inward*n.y;
    const speed=Math.min(0,next.vx*n.x+next.vy*n.y);next.vx-=speed*n.x;next.vy-=speed*n.y;
    if(Math.hypot(delta.x,delta.y)<1e-8)break;
  }
  next.x=current.x;next.y=current.y;return touched;
}
