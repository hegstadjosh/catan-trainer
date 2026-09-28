// Read-only Catan board renderer (standalone SVG). Draws engine geometry from viewMatch().board:
// terrain hexes, number tokens with pips, robber, harbors, roads on edges and settlements/cities at
// their actual vertices. Built with createElementNS + textContent only; no markup strings.
// Usage: CatanBoard.render(geometry,{colors:['#e63946',…],names:['You',…],dice:{total}|null,label}) → <svg>.
(function(){
'use strict';
const NS='http://www.w3.org/2000/svg',K=100,INK='#252522',PAPER='#faf9f6';
const TERRAIN_FILL={forest:'#51735b',hills:'#b86643',pasture:'#939d52',fields:'#bd9438',mountains:'#727c91',desert:'#d8ccae'};
const RES_COLOR={brick:'#b86643',lumber:'#51735b',wool:'#939d52',grain:'#bd9438',ore:'#727c91'};
const RES_NAME={brick:'Brick',lumber:'Lumber',wool:'Wool',grain:'Grain',ore:'Ore'};
const PIPS={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
// Piece silhouettes in board units (hex radius 1), centred on the vertex; same shapes as the game board.
const HOUSE=[[-.16,.14],[.16,.14],[.16,-.04],[0,-.2],[-.16,-.04]];
const CITY=[[-.25,.16],[.25,.16],[.25,-.02],[.115,-.13],[-.02,-.02],[-.02,-.16],[-.135,-.3],[-.25,-.16]];
const pts=(shape,x,y)=>shape.map(([px,py])=>`${((x+px)*K).toFixed(1)},${((y+py)*K).toFixed(1)}`).join(' ');
const hexPts=(x,y,s)=>Array.from({length:6},(_,i)=>{const a=Math.PI/180*(60*i-30);return `${((x+s*Math.cos(a))*K).toFixed(1)},${((y+s*Math.sin(a))*K).toFixed(1)}`;}).join(' ');
function sv(tag,attrs,...kids){
 const el=document.createElementNS(NS,tag);
 for(const [k,v] of Object.entries(attrs||{}))if(v!=null)el.setAttribute(k,String(v));
 for(const k of kids)if(k!=null)el.append(typeof k==='string'?document.createTextNode(k):k);
 return el;
}
const titled=(el,text)=>{el.prepend(sv('title',null,text));return el;};
const boardLayers=new WeakMap();

// Practice targets use only public vertex/edge IDs already present in the rendered board.
// A ring marks a build site; a dashed outline marks a road segment. Pieces remain on top.
function highlight(svg,targets=[]){
 const entry=boardLayers.get(svg);if(!entry)return;
 const {board,layer}=entry;layer.replaceChildren();
 const vertices=new Map(board.vertices.map(v=>[v.id,v])),edges=new Map(board.edges.map(e=>[e.id,e]));
 for(const target of targets){
  if(target.kind==='site'){
   const v=vertices.get(target.id);if(!v)continue;
   layer.append(titled(sv('g',{'aria-label':'Selected build site'},
    sv('circle',{cx:v.x*K,cy:v.y*K,r:36,fill:'none',stroke:PAPER,'stroke-width':15}),
    sv('circle',{cx:v.x*K,cy:v.y*K,r:36,fill:'none',stroke:INK,'stroke-width':7})),
    'Selected build site (outlined ring)'));
  }else if(target.kind==='road'){
   const e=edges.get(target.id);if(!e)continue;
   layer.append(titled(sv('g',{'aria-label':'Selected road segment'},
    sv('line',{x1:e.x1*K,y1:e.y1*K,x2:e.x2*K,y2:e.y2*K,stroke:PAPER,'stroke-width':29,'stroke-linecap':'round'}),
    sv('line',{x1:e.x1*K,y1:e.y1*K,x2:e.x2*K,y2:e.y2*K,stroke:INK,'stroke-width':10,'stroke-dasharray':'14 9','stroke-linecap':'round'})),
    'Selected road segment (dashed outline)'));
  }
 }
}

function render(b,opts={}){
 const colors=opts.colors||[],names=opts.names||[],dice=opts.dice||null;
 const who=s=>names[s]||('Seat '+s),col=s=>colors[s]||'#999';
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 const grow=(x,y,r)=>{x0=Math.min(x0,x-r);y0=Math.min(y0,y-r);x1=Math.max(x1,x+r);y1=Math.max(y1,y+r);};
 b.hexes.forEach(h=>grow(h.x,h.y,1.05));(b.ports||[]).forEach(p=>grow(p.x,p.y,.5));
 const svg=sv('svg',{viewBox:`${(x0*K).toFixed(0)} ${(y0*K).toFixed(0)} ${((x1-x0)*K).toFixed(0)} ${((y1-y0)*K).toFixed(0)}`,class:'cb-board',role:'img','aria-label':opts.label||'Board'});
 const vById=new Map(b.vertices.map(v=>[v.id,v]));
 // harbors: dashed piers to their two corners
 const ports=sv('g',{'aria-hidden':'true'});
 (b.ports||[]).forEach(p=>{
  p.vertices.forEach(id=>{const c=vById.get(id);if(c)ports.append(sv('line',{x1:p.x*K,y1:p.y*K,x2:c.x*K,y2:c.y*K,stroke:'#8b877c','stroke-width':5,'stroke-dasharray':'8 7'}));});
  const res=p.resource||(p.type!=='generic'?p.type:null);
  ports.append(titled(sv('circle',{cx:p.x*K,cy:p.y*K,r:27,fill:res?RES_COLOR[res]:PAPER,stroke:INK,'stroke-width':2.5}),res?`2:1 ${RES_NAME[res]} harbor`:'3:1 harbor'),
   sv('text',{x:p.x*K,y:p.y*K+6,class:'cb-port-t',fill:res?'#fff':INK},res?'2:1':'3:1'));
 });
 svg.append(ports);
 const tiles=sv('g',null);
 b.hexes.forEach(h=>{
  const hot=dice&&h.number===dice.total&&!h.robber;
  const g=sv('g',null,sv('polygon',{points:hexPts(h.x,h.y,.97),fill:TERRAIN_FILL[h.terrain]||'#ccc',stroke:PAPER,'stroke-width':5,'stroke-linejoin':'round'}));
  titled(g,`${h.terrain}${h.number?' '+h.number:''}${h.robber?', robber':''}`);
  if(h.number){
   g.append(sv('circle',{cx:h.x*K,cy:h.y*K,r:25,fill:PAPER,stroke:hot?INK:'none','stroke-width':hot?4:0}),
    sv('text',{x:h.x*K,y:h.y*K+6,class:'cb-num'+(h.number===6||h.number===8?' cb-red':'')},String(h.number)));
   const n=PIPS[h.number]||0;for(let i=0;i<n;i++)g.append(sv('circle',{cx:h.x*K+(i-(n-1)/2)*6,cy:h.y*K+15,r:2,fill:h.number===6||h.number===8?'#a8322a':INK}));
  }
  tiles.append(g);
 });
 svg.append(tiles);
 const rob=b.hexes.find(h=>h.robber);
 if(rob){const X=(rob.x+(rob.number?-.5:0))*K,Y=rob.y*K;svg.append(titled(sv('g',null,
  sv('path',{d:`M${X-15} ${Y+26} L${X+15} ${Y+26} Q${X+15} ${Y+14} ${X+8} ${Y+7} Q${X+15} ${Y-4} ${X+8} ${Y-12} L${X-8} ${Y-12} Q${X-15} ${Y-4} ${X-8} ${Y+7} Q${X-15} ${Y+14} ${X-15} ${Y+26} Z`,fill:INK,stroke:PAPER,'stroke-width':3}),
  sv('circle',{cx:X,cy:Y-20,r:10,fill:INK,stroke:PAPER,'stroke-width':3})),'Robber'));}
 const targetLayer=sv('g',{class:'cb-practice-targets'});svg.append(targetLayer);
 const pieces=sv('g',null);
 b.edges.forEach(e=>{if(e.road&&e.owner!=null){
  const a={x:e.x1+(e.x2-e.x1)*.2,y:e.y1+(e.y2-e.y1)*.2},c={x:e.x1+(e.x2-e.x1)*.8,y:e.y1+(e.y2-e.y1)*.8};
  pieces.append(titled(sv('g',{class:'cb-road'},sv('line',{x1:a.x*K,y1:a.y*K,x2:c.x*K,y2:c.y*K,stroke:INK,'stroke-width':17,'stroke-linecap':'round'}),
   sv('line',{x1:a.x*K,y1:a.y*K,x2:c.x*K,y2:c.y*K,stroke:col(e.owner),'stroke-width':10,'stroke-linecap':'round'})),`${who(e.owner)} road`));
 }});
 b.vertices.forEach(v=>{if(v.building&&v.owner!=null)pieces.append(titled(sv('polygon',{class:'cb-'+v.building,'data-vertex':v.id,points:pts(v.building==='city'?CITY:HOUSE,v.x,v.y),fill:col(v.owner),stroke:INK,'stroke-width':4,'stroke-linejoin':'round'}),`${who(v.owner)} ${v.building}`));});
 svg.append(pieces);
 boardLayers.set(svg,{board:b,layer:targetLayer});
 return svg;
}
window.CatanBoard={render,highlight,RES_COLOR,RES_NAME};
})();
