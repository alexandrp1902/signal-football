import {Application, Assets, Container, Graphics, Text, Sprite, Texture, Rectangle} from 'pixi.js';
import {followPlayer, screenToWorld, worldToScreen, type Camera, type Team} from '../sim/coordinates.ts';
import type {Balance, Motion, Vec} from '../sim/movement.ts';
import type {Ball, Player, Roster} from '../net/protocol.ts';
import {RunningCat} from './runningCat.ts';
import {RollingBall} from './rollingBall.ts';
type CatNode = {root: Container; label: Text; sprite: Sprite; runner: RunningCat; time: number; previous: Vec | null};
export class Scene {
  readonly app = new Application();
  camera: Camera = {x: 0, y: 0, width: 390, height: 800, scale: 15};
  private world = new Container();
  private entities = new Container();
  private aim = new Graphics();
  private ballNode!: RollingBall;
  private nodes = new Map<string, CatNode>();
  private textures: Texture[] = [];
  private host: HTMLElement;
  private team: Team = 'blue';
  private balance!: Balance;
  private ownId = '';
  private own: Motion = {x: 0, y: -2.5, vx: 0, vy: 0, facingX: 0, facingY: 1};
  private names = new Map<string, string>();
  constructor(host: HTMLElement) {this.host = host;}
  async init(): Promise<void> {
    await this.app.init({resizeTo: this.host, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true, antialias: true, background: '#143d38', preference: 'webgl'});
    this.host.append(this.app.canvas); this.entities.sortableChildren = true;
    this.app.stage.addChild(this.world, this.aim, this.entities);
    const atlas = await Assets.load<Texture>(new URL('art/football-cats-v1.png', document.baseURI).href);
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){
      const x=Math.floor(col*atlas.width/4),y=Math.floor(row*atlas.height/4);
      this.textures.push(new Texture({source:atlas.source,frame:new Rectangle(x,y,Math.floor((col+1)*atlas.width/4)-x,Math.floor((row+1)*atlas.height/4)-y)}));
    }
    this.ballNode=new RollingBall();this.entities.addChild(this.ballNode);
  }
  configure(balance: Balance, team: Team, id: string): void {
    this.balance=balance;this.team=team;this.ownId=id;this.camera.y=0;
    this.world.removeChildren().forEach(c=>c.destroy());
    for(const n of this.nodes.values())n.root.destroy({children:true});this.nodes.clear();
    const g=new Graphics(),b=balance,w=b.fieldWidth,h=b.fieldHeight;
    g.rect(-w/2-2,-h/2-3,w+4,h+6).fill('#102d2c');
    for(let i=0;i<10;i++)g.rect(-w/2,-h/2+i*h/10,w,h/10).fill(i%2?'#256451':'#286d58');
    g.rect(-w/2,-h/2,w,h).stroke({width:.1,color:'#aed5b6',alpha:.65});
    g.moveTo(-w/2,0).lineTo(w/2,0).stroke({width:.07,color:'#b3d6b7',alpha:.65});
    g.circle(0,0,6).stroke({width:.07,color:'#b3d6b7',alpha:.65});
    for(const side of [-1,1]){
      const y=side*h/2;
      g.rect(-11,side<0?y:y-12,22,12).stroke({width:.07,color:'#b3d6b7',alpha:.65});
      g.rect(-b.goalWidth/2,side<0?y-b.goalDepth:y,b.goalWidth,b.goalDepth).fill({color:'#9ac5b5',alpha:.15}).stroke({width:.13,color:side<0?'#0695d7':'#ff4758'});
      for(let j=1;j<10;j++){const x=-b.goalWidth/2+b.goalWidth*j/10;g.moveTo(x,y).lineTo(x,y+side*b.goalDepth).stroke({width:.025,color:'#d3e7dd',alpha:.3});}
      for(const x of [-b.goalWidth/2,b.goalWidth/2])g.circle(x,y,b.postRadius).fill('#e5f1ed');
    }
    this.world.addChild(g);
  }
  roster(roster:Roster):void{this.names=new Map(roster.players.map(p=>[p.playerId,p.name]));}
  aimAt(clientX:number,clientY:number):Vec{
    const r=this.host.getBoundingClientRect();
    const pos=screenToWorld({x:(clientX-r.left)*this.camera.width/r.width,y:(clientY-r.top)*this.camera.height/r.height},this.team,this.camera);
    return{x:pos.x-this.own.x,y:pos.y-this.own.y};
  }
  draw(players:Player[],own:Motion,aim:Vec,charge:number,seconds:number,ball:Ball|null,ownMode:string):void{
    if(!this.balance)return;this.own=own;
    const c=this.camera,b=this.balance;
    followPlayer(c,own,this.host.clientWidth,this.host.clientHeight);
    this.world.position.set(c.width/2-c.x*c.scale,c.height/2+c.y*c.scale);
    this.world.scale.set(c.scale,-c.scale); // Fixed north for both teams.
    const present=new Set(players.map(p=>p.playerId));
    for(const[id,node]of this.nodes)if(!present.has(id)){node.root.destroy({children:true});this.nodes.delete(id);}
    this.aim.clear();const labels:Vec[]=[];
    for(const player of players){
      let node=this.nodes.get(player.playerId);
      if(!node){
        const root=new Container(),color=player.team==='blue'?'#00b8ff':'#ff4758';
        root.addChild(new Graphics().ellipse(0,2,15,5).fill({color:'#071d25',alpha:.3}).ellipse(0,0,12,5).stroke({width:player.playerId===this.ownId?2:1,color}));
        const sprite=new Sprite(this.textures[player.team==='blue'?0:8]);sprite.anchor.set(.5,.94);sprite.width=sprite.height=68;root.addChild(sprite);
        const runner=new RunningCat(this.textures[player.team==='blue'?0:8]);runner.visible=false;root.addChild(runner);
        const label=new Text({text:'',style:{fontFamily:'Segoe UI, Arial',fontSize:10,fontWeight:'600',fill:'#fff',stroke:{color:'#102538',width:3}}});
        label.anchor.set(.5,1);root.addChild(label);this.entities.addChild(root);
        node={root,label,sprite,runner,time:0,previous:null};this.nodes.set(player.playerId,node);
      }
      const mine=player.playerId===this.ownId;
      const state=mine&&charge>=0&&!['sliding','recovering','kicking','celebrating'].includes(player.actionState)?'preparing':player.actionState;
      const motion=mine?own:player,speed=Math.hypot(motion.vx,motion.vy);
      node.time+=seconds*Math.max(.25,Math.min(1.7,speed/5.6));
      const running=speed>.2&&!['sliding','recovering','kicking','celebrating'].includes(state);
      const travelled=node.previous?Math.hypot(motion.x-node.previous.x,motion.y-node.previous.y):0;
      node.previous={x:motion.x,y:motion.y};
      node.runner.visible=running;node.sprite.visible=!running;
      if(running)node.runner.advance(travelled<.5?travelled:0,{x:motion.vx,y:motion.vy});
      let pose=0;
      if(state==='preparing'||state==='recovering')pose=4;
      if(state==='sliding')pose=5+(Math.floor(node.time*20)%2);
      if(state==='kicking')pose=3;if(state==='celebrating')pose=7;
      node.sprite.texture=this.textures[(player.team==='blue'?0:8)+pose];
      node.sprite.scale.x=Math.abs(node.sprite.scale.x)*(state==='sliding'&&player.slideX<0?-1:1);
      node.sprite.y=Math.sin(node.time*5)*.5;
      node.sprite.rotation=0;
      const position=worldToScreen(motion,this.team,c);node.root.position.set(position.x,position.y);node.root.zIndex=position.y;
      node.root.scale.set(Math.max(.75,Math.min(1.1,c.scale/16)));
      node.label.text=`${this.names.get(player.playerId)||'Игрок'}${mine?' · Вы':''}`;node.label.position.set(0,-66);
      for(const other of labels)if(Math.abs(other.x-position.x)<70&&Math.abs(other.y-position.y)<20)node.label.y-=17;labels.push(position);
      if(!mine&&player.preparing)this.arrow(position,{x:player.facingX,y:player.facingY},44);
    }
    if(ball){
      // Sort by ground position so a cat occludes the ball behind it.
      const p=worldToScreen(ball,this.team,c);this.ballNode.visible=true;this.ballNode.position.set(p.x,p.y);this.ballNode.zIndex=p.y;
      this.ballNode.scale.set(Math.max(10,b.ballVisualRadius*c.scale));this.ballNode.update(ball,b.ballVisualRadius,ball.possessionVersion);
      const pointer=document.getElementById('ball-pointer')!;
      pointer.hidden=p.x>=15&&p.x<=c.width-15&&p.y>=165&&p.y<=c.height-165;
      pointer.style.left=`${Math.max(24,Math.min(c.width-24,p.x))}px`;pointer.style.top=`${Math.max(174,Math.min(c.height-184,p.y))}px`;
    }else this.ballNode.visible=false;
    if(charge>=0)this.arrow(worldToScreen(own,this.team,c),aim,44+charge*(ownMode==='kick'?50:28));
    const enemy=worldToScreen({x:0,y:this.team==='blue'?b.fieldHeight/2:-b.fieldHeight/2},this.team,c),pointer=document.getElementById('goal-pointer')!;
    pointer.hidden=enemy.y>160&&enemy.y<c.height-160;pointer.textContent=this.team==='blue'?'↑ ВОРОТА КРАСНЫХ':'↓ ВОРОТА СИНИХ';
  }
  private arrow(origin:Vec,aim:Vec,length:number):void{
    const n=Math.hypot(aim.x,aim.y);if(n<.001)return;
    const dx=aim.x/n,dy=-aim.y/n;
    // Flatten the width onto the turf while keeping the tip aligned with the aim.
    const across=Math.hypot(dx,dy/.4),sx=-dy/.4/across,sy=dx*.4/across;
    const point=(along:number,width:number):[number,number]=>[origin.x+dx*along+sx*width,origin.y+dy*along+sy*width];
    const outline=[...point(18,7),...point(length-8,7),...point(length-8,17),...point(length+12,0),...point(length-8,-17),...point(length-8,-7),...point(18,-7)];
    const color='#00d1ff';
    this.aim.poly(outline).stroke({width:16,color,alpha:.06,join:'round'});
    this.aim.poly(outline).stroke({width:9,color,alpha:.14,join:'round'});
    this.aim.poly(outline).fill({color,alpha:.4}).stroke({width:2,color,alpha:.95,join:'round'});
    this.aim.moveTo(...point(23,0)).lineTo(...point(length-4,0)).stroke({width:1,color:'#b2f5ff',alpha:.8});
  }
}
