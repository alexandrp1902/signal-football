import {Container,Graphics,Sprite,Texture} from 'pixi.js';
import type {Vec} from '../sim/movement.ts';
import {projectPanel,rotate,soccerMesh} from './soccerMesh.ts';

export class RollingBall extends Container {
  private panels=soccerMesh();
  private surface=new Graphics();
  private previous:Vec|null=null;
  private version=-1;
  constructor(){
    super();
    this.addChild(new Graphics().ellipse(0,.9,1.12,.27).fill({color:'#031920',alpha:.32}),this.surface);
    // Stationary light and soft rim shade; only the spherical panel layout rolls.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d')!,gradient=ctx.createRadialGradient(45,35,2,55,48,86);
    gradient.addColorStop(0,'#ffffff66');gradient.addColorStop(.38,'#ffffff05');gradient.addColorStop(.67,'#021c2e16');gradient.addColorStop(1,'#021421a8');
    ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(64,64,63,0,Math.PI*2);ctx.fill();
    const shade=new Sprite(Texture.from(canvas));shade.anchor.set(.5);shade.width=shade.height=2;
    this.addChild(shade,new Graphics().circle(0,0,1).stroke({width:.035,color:'#0a2736',alpha:.85}));
    this.panels=this.panels.map(p=>({...p,corners:p.corners.map(v=>rotate(v,{x:0,y:1,z:0},.32))}));
    this.paint();
  }
  update(position:Vec,radius:number,version:number):void{
    if(this.previous&&version===this.version){
      const dx=position.x-this.previous.x,dy=position.y-this.previous.y,d=Math.hypot(dx,dy);
      // Teleports and corrections must not produce a huge spin; regular motion is signed.
      if(d>1e-6&&d<3){const axis={x:dy/d,y:dx/d,z:0},angle=d/radius;
        for(const panel of this.panels)panel.corners=panel.corners.map(v=>rotate(v,axis,angle));this.paint();
      }
    }
    this.previous={...position};this.version=version;
  }
  private paint():void{
    const g=this.surface;g.clear().circle(0,0,1).fill('#f2f6f6');
    for(const panel of this.panels){
      const points=projectPanel(panel.corners);if(points.length<6)continue;
      g.poly(points).fill(panel.black?'#10232d':'#eef3f3').stroke({width:.013,color:'#647982',alpha:.7});
    }
  }
}
