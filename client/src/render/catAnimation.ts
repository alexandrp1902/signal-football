import type {Vec} from '../sim/movement.ts';

export type CatView = 0 | 1 | 2 | 3; // Front, profile, rear three-quarter, rear.
export type CatFacing = {view: CatView; mirror: number};

export function catFacing(direction: Vec, previous: CatFacing = {view:0,mirror:1}): CatFacing {
  const speed=Math.hypot(direction.x,direction.y);
  if(speed<.001)return previous;
  const angle=Math.atan2(Math.abs(direction.x),direction.y),unit=Math.PI/8;
  const bounds=[[5*unit,Math.PI],[3*unit,5*unit],[unit,3*unit],[0,unit]][previous.view];
  // A small angular dead band keeps the view stable near direction boundaries.
  const view=angle>=bounds[0]-.1&&angle<=bounds[1]+.1?previous.view:angle<unit?3:angle<3*unit?2:angle<5*unit?1:0;
  const mirror=Math.abs(direction.x)>speed*.2?(direction.x<0?-1:1):previous.mirror;
  return {view,mirror};
}

export function gaitPose(phase: number, direction: Vec, strength = 1) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const dx = direction.x / length, dy = direction.y / length;
  const swing = Math.sin(phase), stride = -Math.cos(phase);
  const foot = (swing: number, stride: number) => {
    const lift = Math.max(0, swing);
    return {
      x: dx * stride * 5.5 * strength,
      y: (-lift * 7.5 - dy * stride * 3) * strength,
      angle: (-dx * stride * .38 + lift * .12) * strength,
      scaleY: 1 - (lift * .1 + dy * stride * .08) * strength,
    };
  };
  const bounce = 1 - Math.cos(phase * 2);
  return {
    left: foot(swing, stride), right: foot(-swing, -stride),
    bodyX: swing * .6 * strength, bodyY: -bounce * 1.7 * strength,
    bodyAngle: (.07 * dx + swing * .035) * strength,
    bodyScaleY: 1 - Math.cos(phase * 2) * .025 * strength,
    headY: bounce * .45 * strength, headAngle: (-.035 * dx - swing * .025) * strength,
    leftArmAngle: stride * .42 * strength, rightArmAngle: -stride * .42 * strength,
  };
}

type Pose = ReturnType<typeof gaitPose>;
const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
function mixPose(a:Pose,b:Pose,t:number):Pose {
  if(t<=0)return a;if(t>=1)return b;
  const pose={...a,left:{...a.left},right:{...a.right}};
  for(const side of ['left','right'] as const)for(const key of ['x','y','angle','scaleY'] as const)pose[side][key]+= (b[side][key]-a[side][key])*t;
  for(const key of ['bodyX','bodyY','bodyAngle','bodyScaleY','headY','headAngle','leftArmAngle','rightArmAngle'] as const)pose[key]+=(b[key]-a[key])*t;
  return pose;
}

export function windupPose(charge:number,direction:Vec):Pose {
  const pose=gaitPose(0,direction,0),length=Math.hypot(direction.x,direction.y)||1;
  const dx=direction.x/length,dy=direction.y/length,amount=.2+.8*smooth(charge);
  pose.right={x:-dx*10*amount,y:(dy*7-4+2*Math.abs(dy))*amount,angle:(dx*.45+.15)*amount,scaleY:1-.15*amount};
  pose.bodyX=-dx*.8*amount;pose.bodyY=amount;pose.bodyAngle=-dx*.075*amount;
  pose.bodyScaleY=1-.02*amount;pose.headAngle=dx*.04*amount;
  pose.leftArmAngle=-.25*amount;pose.rightArmAngle=.35*amount;
  return pose;
}

export function strikePose(progress:number,charge:number,direction:Vec):Pose {
  const neutral=gaitPose(0,direction,0),contact=gaitPose(0,direction,0);
  const length=Math.hypot(direction.x,direction.y)||1,dx=direction.x/length,dy=direction.y/length;
  contact.right={x:dx*11,y:-dy*8-3,angle:-dx*.35-.05,scaleY:.96};
  contact.bodyX=dx*.8;contact.bodyY=-.8;contact.bodyAngle=dx*.12;
  contact.headAngle=-dx*.06;contact.leftArmAngle=.35;contact.rightArmAngle=-.3;
  // Swing from the charged position into contact, then return the foot to the turf.
  return progress<.22?mixPose(windupPose(charge,direction),contact,smooth(progress/.22)):
    mixPose(contact,neutral,smooth((progress-.22)/.78));
}
