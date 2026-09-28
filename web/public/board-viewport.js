(function(global){
'use strict';

const MIN=.7,FIT=1,MAX=4,STEP=1.35,SVG='http://www.w3.org/2000/svg';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const dots={1:[[18,18]],2:[[10,10],[26,26]],3:[[10,10],[18,18],[26,26]],4:[[10,10],[26,10],[10,26],[26,26]],5:[[10,10],[26,10],[18,18],[10,26],[26,26]],6:[[10,10],[26,10],[10,18],[26,18],[10,26],[26,26]]};
function die(n){
 const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 36 36');svg.setAttribute('aria-hidden','true');svg.classList.add('gw-die');
 const rect=document.createElementNS(SVG,'rect');for(const [k,v] of Object.entries({x:2,y:2,width:32,height:32,rx:6}))rect.setAttribute(k,v);svg.append(rect);
 for(const [x,y] of dots[n]){const circle=document.createElementNS(SVG,'circle');for(const [k,v] of Object.entries({cx:x,cy:y,r:2.8}))circle.setAttribute(k,v);svg.append(circle);}
 return svg;
}

function mount(board){
 const canvas=document.createElement('div');canvas.className='gw-viewport-canvas';
 const controls=document.createElement('div');controls.className='gw-viewport-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Board zoom');
 const dice=document.createElement('div');dice.className='gw-last-dice';dice.setAttribute('role','status');dice.setAttribute('aria-live','polite');
 const button=(label,text,action)=>{const b=document.createElement('button');b.type='button';b.className='gw-viewport-button';b.setAttribute('aria-label',label);b.textContent=text;b.addEventListener('click',action);controls.append(b);return b;};
 let scale=FIT,x=0,y=0,suppressUntil=0,pinch=null,dragged=false;
 const points=new Map();
 const zoomOut=button('Zoom out','−',()=>zoomAt(scale/STEP));
 const zoomIn=button('Zoom in','+',()=>zoomAt(scale*STEP));
 const fit=button('Fit board','Fit',()=>{scale=FIT;x=0;y=0;paint();});
 board.replaceChildren(canvas,controls,dice);
 board.tabIndex=0;
 board.setAttribute('role','region');
 board.setAttribute('aria-label','Game board. Use the zoom controls, or focus the board and press plus, minus, arrow keys, or zero to fit.');

 function bounds(){
  const width=canvas.clientWidth,height=canvas.clientHeight,view=canvas.querySelector('svg')?.viewBox?.baseVal;
  if(width<=0||height<=0)return {x:0,y:0};
  const ratio=view?.width>0&&view?.height>0?view.width/view.height:width/height;
  const contentWidth=Math.min(width,height*ratio),contentHeight=Math.min(height,width/ratio);
  return {x:Math.max(0,(scale*contentWidth-width)/2),y:Math.max(0,(scale*contentHeight-height)/2)};
 }
 function paint(){
  const b=bounds();x=clamp(Number.isFinite(x)?x:0,-b.x,b.x);y=clamp(Number.isFinite(y)?y:0,-b.y,b.y);
  canvas.style.transform=`translate(${x}px, ${y}px) scale(${scale})`;
  board.classList.toggle('gw-viewport-zoomed',scale>FIT+1e-3);
  zoomOut.disabled=scale<=MIN+1e-3;zoomIn.disabled=scale>=MAX-1e-3;
  fit.disabled=Math.abs(scale-FIT)<1e-3&&Math.abs(x)<.5&&Math.abs(y)<.5;
 }
 function zoomAt(value,clientX,clientY){
  const next=clamp(value,MIN,MAX);if(Math.abs(next-scale)<1e-5)return false;
  const rect=board.getBoundingClientRect(),cx=rect.left+canvas.offsetLeft+canvas.clientWidth/2,cy=rect.top+canvas.offsetTop+canvas.clientHeight/2;
  const ax=(clientX??cx)-cx,ay=(clientY??cy)-cy;
  const ratio=next/scale;
  x=ax-(ax-x)*ratio;y=ay-(ay-y)*ratio;scale=next;paint();return true;
 }
 function setDice(last){
  const pair=Array.isArray(last?.dice)?last.dice:null;
  const a=Number(pair?.[0]),b=Number(pair?.[1]);
  const valid=Number.isInteger(a)&&Number.isInteger(b)&&a>=1&&a<=6&&b>=1&&b<=6;
  const label=document.createElement('span');label.className='gw-last-dice-label';label.textContent='Last roll';
  if(!valid){const empty=document.createElement('span');empty.className='gw-last-dice-empty';empty.textContent='No roll recorded';dice.replaceChildren(label,empty);dice.setAttribute('aria-label','Last roll: no roll recorded');return;}
  const faces=document.createElement('span');faces.className='gw-last-dice-faces';faces.append(die(a),die(b));
  const sum=document.createElement('strong');sum.className='gw-last-dice-sum';sum.textContent=String(a+b);
  dice.replaceChildren(label,faces,sum);dice.setAttribute('aria-label',`Last roll: ${a} plus ${b} equals ${a+b}`);
 }
 function onWheel(e){
  if(e.target.closest('.gw-viewport-controls'))return;
  const delta=e.deltaMode===1?e.deltaY*16:e.deltaMode===2?e.deltaY*board.clientHeight:e.deltaY;
  if(zoomAt(scale*Math.exp(-delta*.002),e.clientX,e.clientY))e.preventDefault();
 }
 function onKey(e){
  if(e.target!==board)return;
  if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(scale*STEP);}
  else if(e.key==='-'||e.key==='_'){e.preventDefault();zoomAt(scale/STEP);}
  else if(e.key==='0'){e.preventDefault();scale=FIT;x=0;y=0;paint();}
  else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&scale>FIT){
   e.preventDefault();const step=40;
   if(e.key==='ArrowLeft')x+=step;if(e.key==='ArrowRight')x-=step;
   if(e.key==='ArrowUp')y+=step;if(e.key==='ArrowDown')y-=step;paint();
  }
 }
 function metrics(){const a=[...points.values()];return {cx:(a[0].x+a[1].x)/2,cy:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};}
 function down(e){
  if(e.target.closest('.gw-viewport-controls')||(e.pointerType==='mouse'&&e.button!==0))return;
  points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
  if(points.size===1){dragged=false;pinch=null;suppressUntil=0;}
  if(points.size===2){pinch=metrics();dragged=true;for(const id of points.keys())board.setPointerCapture?.(id);}
 }
 function move(e){
  const prev=points.get(e.pointerId);if(!prev)return;
  points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:prev.startX,startY:prev.startY});
  if(points.size>=2){
   const next=metrics();if(pinch&&pinch.d>0){zoomAt(scale*next.d/pinch.d,pinch.cx,pinch.cy);x+=next.cx-pinch.cx;y+=next.cy-pinch.cy;paint();}
   pinch=next;dragged=true;return;
  }
  const dx=e.clientX-prev.x,dy=e.clientY-prev.y;
  if(Math.hypot(e.clientX-prev.startX,e.clientY-prev.startY)>5){dragged=true;if(scale>FIT&&!board.hasPointerCapture?.(e.pointerId))board.setPointerCapture?.(e.pointerId);}
  if(scale>FIT){x+=dx;y+=dy;paint();}
 }
 function up(e){
  if(!points.has(e.pointerId))return;
  points.delete(e.pointerId);
  if(dragged)suppressUntil=Date.now()+500;
  if(points.size<2)pinch=null;
  if(!points.size)dragged=false;
 }
 function cancel(e){points.delete(e.pointerId);pinch=null;dragged=false;}
 function click(e){
  if(Date.now()>suppressUntil||e.target.closest('.gw-viewport-controls'))return;
  suppressUntil=0;e.preventDefault();e.stopImmediatePropagation();
 }
 board.addEventListener('wheel',onWheel,{passive:false});board.addEventListener('keydown',onKey);
 board.addEventListener('pointerdown',down);board.addEventListener('pointermove',move);
 board.addEventListener('pointerup',up);board.addEventListener('pointercancel',cancel);
 global.addEventListener('pointerup',up);global.addEventListener('pointercancel',cancel);
 board.addEventListener('click',click,true);
 const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(paint):null;
 resize?.observe(board);
 if(!resize)global.addEventListener('resize',paint);
 paint();
 setDice(null);
 return {
  setSvg(svg){canvas.replaceChildren(svg);paint();},
  setDice,
  state(){return {scale,x,y};},
  fit(){scale=FIT;x=0;y=0;paint();},
  destroy(){resize?.disconnect();if(!resize)global.removeEventListener('resize',paint);board.removeEventListener('wheel',onWheel);board.removeEventListener('keydown',onKey);board.removeEventListener('pointerdown',down);board.removeEventListener('pointermove',move);board.removeEventListener('pointerup',up);board.removeEventListener('pointercancel',cancel);global.removeEventListener('pointerup',up);global.removeEventListener('pointercancel',cancel);board.removeEventListener('click',click,true);}
 };
}

global.CatanBoardViewport={mount};
})(window);
