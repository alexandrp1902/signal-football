export type Point3 = {x:number;y:number;z:number};
export type Panel = {black:boolean;corners:Point3[]};
const unit=(p:Point3):Point3=>{const n=Math.hypot(p.x,p.y,p.z);return{x:p.x/n,y:p.y/n,z:p.z/n};};
const dot=(a:Point3,b:Point3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:Point3,b:Point3):Point3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
export function rotate(p:Point3,axis:Point3,angle:number):Point3{
  const c=Math.cos(angle),s=Math.sin(angle),d=dot(axis,p)*(1-c),v=cross(axis,p);
  return{x:p.x*c+v.x*s+axis.x*d,y:p.y*c+v.y*s+axis.y*d,z:p.z*c+v.z*s+axis.z*d};
}
/** The actual football topology: 12 pentagons and 20 hexagons on a sphere. */
export function soccerMesh():Panel[]{
  const phi=(1+Math.sqrt(5))/2,vertices:Point3[]=[];
  for(const a of [-1,1])for(const b of [-phi,phi])vertices.push(unit({x:0,y:a,z:b}),unit({x:a,y:b,z:0}),unit({x:b,y:0,z:a}));
  const adjacent=(i:number,j:number)=>i!==j&&dot(vertices[i],vertices[j])>.44;
  const corner=(i:number,j:number)=>unit({x:2*vertices[i].x+vertices[j].x,y:2*vertices[i].y+vertices[j].y,z:2*vertices[i].z+vertices[j].z});
  const panels:Panel[]=vertices.map((normal,i)=>{
    const u=unit(cross(normal,Math.abs(normal.z)<.9?{x:0,y:0,z:1}:{x:0,y:1,z:0})),v=cross(normal,u);
    const neighbours=vertices.map((_,j)=>j).filter(j=>adjacent(i,j));
    neighbours.sort((a,b)=>Math.atan2(dot(vertices[a],v),dot(vertices[a],u))-Math.atan2(dot(vertices[b],v),dot(vertices[b],u)));
    return{black:true,corners:neighbours.map(j=>corner(i,j))};
  });
  for(let i=0;i<12;i++)for(let j=i+1;j<12;j++)for(let k=j+1;k<12;k++)if(adjacent(i,j)&&adjacent(j,k)&&adjacent(k,i))
    panels.push({black:false,corners:[corner(i,j),corner(j,i),corner(j,k),corner(k,j),corner(k,i),corner(i,k)]});
  return panels;
}
/** Sample curved spherical seams, then clip at the visible hemisphere. */
export function projectPanel(corners:Point3[]):number[]{
  const outline:Point3[]=[];
  for(let i=0;i<corners.length;i++)for(let sample=0;sample<5;sample++){
    const a=corners[i],b=corners[(i+1)%corners.length],t=sample/5;
    outline.push(unit({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}));
  }
  const clipped:Point3[]=[];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    if(a.z>=0)clipped.push(a);
    if((a.z>=0)!==(b.z>=0)){const t=a.z/(a.z-b.z);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:0});}
  }
  return clipped.flatMap(p=>[p.x,p.y]);
}
