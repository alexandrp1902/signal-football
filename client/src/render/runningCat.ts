import {Container, MeshSimple, Texture} from 'pixi.js';
import type {Vec} from '../sim/movement.ts';
import {gaitPose,windupPose,strikePose,type CatView} from './catAnimation.ts';
export {gaitPose} from './catAnimation.ts';

/** A small articulated rig cut from the existing mascot, sharing its atlas texture. */
export class RunningCat extends Container {
  readonly leftLeg: MeshSimple;
  readonly rightLeg: MeshSimple;
  readonly body = new Container();
  readonly head: MeshSimple;
  readonly leftArm: MeshSimple;
  readonly rightArm: MeshSimple;
  private phase = 0;
  private effort = 0;
  private legVertices: Float32Array[];
  private headBaseY: number;
  private meshes: MeshSimple[];

  constructor(idle: Texture,view:CatView=0) {
    super();
    const size = 68;
    const leg = (left: number, right: number, hipLeft: number, hipRight: number) => {
      const points = [hipLeft,.73,hipRight,.73, left,.82,right,.82, left,.90,right,.90, left,.975,right,.975];
      const vertices = points.map((v,i)=>(v-(i%2?.94:.5))*size);
      const indices: number[] = [];
      for(let row=0;row<3;row++){const i=row*2;indices.push(i,i+1,i+2,i+1,i+3,i+2);}
      const mesh = new MeshSimple({texture:idle,vertices:new Float32Array(vertices),uvs:new Float32Array(points),indices:new Uint32Array(indices)});
      mesh.autoUpdate = false;
      return mesh;
    };
    // Convex cutouts follow the shoulders; overlaps sit underneath the shirt/head.
    // Geometry clips the source artwork without masks, filters or new bitmap assets.
    const part = (points: number[], joint: Vec) => {
      const vertices = points.map((v, i) => (v - (i % 2 ? joint.y : joint.x)) * size);
      const indices: number[] = [];
      for (let i = 1; i < points.length / 2 - 1; i++) indices.push(0, i, i + 1);
      const mesh = new MeshSimple({texture: idle, vertices: new Float32Array(vertices), uvs: new Float32Array(points), indices: new Uint32Array(indices)});
      mesh.autoUpdate = false;
      mesh.position.set((joint.x - .5) * size, (joint.y - .79) * size);
      return mesh;
    };
    this.leftLeg = view===1?leg(.37,.62,.44,.55):leg(.30,.505,.37,.505);
    this.rightLeg = view===1?leg(.40,.68,.49,.62):leg(.505,.75,.52,.69);
    this.leftArm = part([.265,.78, .265,.69, .34,.59, .40,.565, .44,.63, .39,.78], {x:.38,y:.62});
    this.rightArm = part([.65,.585, .73,.61, .795,.70, .79,.78, .70,.78, .65,.68], {x:.70,y:.625});
    const shirt = part(view===1?[.30,.54,.8,.54,.8,.82,.30,.82]:[.40,.54, .65,.54, .71,.62, .72,.80, .33,.80, .35,.62], {x:.5,y:.79});
    // The profile's near arm overlaps the chest in the artwork; keep that silhouette intact.
    if(view===1)this.leftArm.visible=this.rightArm.visible=false;
    this.head = part([0,0, 1,0, 1,.58, 0,.58], {x:.54,y:.55});
    this.headBaseY = this.head.y;
    this.body.position.set(0, (.79 - .94) * size);
    this.body.addChild(this.leftArm, this.rightArm, shirt, this.head);
    this.meshes = [this.leftLeg, this.rightLeg, this.leftArm, this.rightArm, shirt, this.head];
    this.legVertices = [new Float32Array(this.leftLeg.vertices), new Float32Array(this.rightLeg.vertices)];
    this.addChild(this.leftLeg, this.rightLeg, this.body);
  }

  reset(): void {this.phase = this.effort = 0;}

  copyGait(other:RunningCat):void {this.phase=other.phase;this.effort=other.effort;}

  stand(direction:Vec):void {this.reset();this.applyPose(gaitPose(0,this.localDirection(direction),0));}
  windup(charge:number,direction:Vec):void {this.reset();this.applyPose(windupPose(charge,this.localDirection(direction)));}
  strike(progress:number,charge:number,direction:Vec):void {this.reset();this.applyPose(strikePose(progress,charge,this.localDirection(direction)));}

  private localDirection(direction:Vec):Vec {
    const speed=Math.hypot(direction.x,direction.y);
    if(Math.abs(direction.x)>speed*.2)this.scale.x=direction.x<0?-1:1;
    return {x:direction.x*this.scale.x,y:direction.y};
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if(this.destroyed)return;
    const geometry=this.meshes.map(mesh=>mesh.geometry);
    super.destroy(options);
    for(const part of geometry)part.destroy();
  }

  advance(distance: number, direction: Vec): void {
    const travelled = Math.min(.5, Math.max(0, distance));
    // One stride per 2.1 metres; corrections and turning in place do not add steps.
    this.phase = (this.phase + travelled / 2.1 * Math.PI * 2) % (Math.PI * 2);
    this.effort = Math.min(1, this.effort + travelled / .3);
    const speed = Math.hypot(direction.x, direction.y);
    const strength = this.effort * Math.min(1, .35 + speed / 5.6 * .65);
    this.applyPose(gaitPose(this.phase,this.localDirection(direction),strength));
  }

  private applyPose(pose:ReturnType<typeof gaitPose>):void {
    const bodyBase = (.79-.94)*68, bodyScaleX = 1+(1-pose.bodyScaleY)*.5;
    const bodyCos = Math.cos(pose.bodyAngle), bodySin = Math.sin(pose.bodyAngle);
    [pose.left, pose.right].forEach((p, index) => {
      const mesh = index === 0 ? this.leftLeg : this.rightLeg, base = this.legVertices[index];
      const vertices = mesh.vertices, hip = (.73-.94)*68, ankle = (.90-.94)*68;
      const centre = (base[base.length-4]+base[base.length-2])/2;
      // Keep the hip attached, bend through the knee and roll the shoe at the ankle.
      for(let i=0;i<base.length;i+=2){
        const x=base[i],y=base[i+1],weight=Math.min(1,Math.max(0,(y-hip)/(ankle-hip)));
        const bend=weight*weight*(3-2*weight),toe=Math.max(0,(y-ankle)/((.975-.90)*68));
        const angle=p.angle*toe,rx=x-centre,ry=y-ankle;
        const bodyX=x*bodyScaleX*bodyCos-(y-bodyBase)*pose.bodyScaleY*bodySin+pose.bodyX;
        const bodyY=x*bodyScaleX*bodySin+(y-bodyBase)*pose.bodyScaleY*bodyCos+bodyBase+pose.bodyY;
        vertices[i]=x+(bodyX-x)*(1-bend)+p.x*bend+(rx*Math.cos(angle)-ry*Math.sin(angle)-rx)*toe;
        vertices[i+1]=y+(bodyY-y)*(1-bend)+p.y*bend+(p.scaleY-1)*(y-hip)*bend+(rx*Math.sin(angle)+ry*Math.cos(angle)-ry)*toe;
      }
      mesh.geometry.getBuffer('aPosition').update();
    });
    this.setChildIndex(this.leftLeg, pose.left.y > pose.right.y ? 1 : 0);
    this.body.position.set(pose.bodyX, bodyBase + pose.bodyY);
    this.body.rotation = pose.bodyAngle;
    this.body.scale.set(bodyScaleX, pose.bodyScaleY);
    this.head.y = this.headBaseY + pose.headY; this.head.rotation = pose.headAngle;
    this.leftArm.rotation = pose.leftArmAngle; this.rightArm.rotation = pose.rightArmAngle;
  }
}
