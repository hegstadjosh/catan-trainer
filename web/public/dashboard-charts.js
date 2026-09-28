// DashboardCharts: d3 SVG renderers for dashboard views ({kind:'chart'|'stat'|'table'|'note', spec}).
// Every string from a view is untrusted: it is written with textContent / d3 .text() only.
(function(root){
'use strict';
const TONES={wood:'var(--cl-r1)',brick:'var(--cl-r2)',sheep:'var(--cl-r3)',wheat:'var(--cl-r4)',ore:'var(--cl-r5)'};
const ORDER=['var(--cl-accent)','var(--cl-r5)','var(--cl-r2)','var(--cl-r1)','var(--cl-r4)','var(--cl-r3)'];
const OTHER='#c9c6bc';
const HEIGHT={third:170,half:200,full:240};

function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=String(text);return e;}
function fmt(v){
 if(v===null||v===undefined||!Number.isFinite(v))return '—';
 const a=Math.abs(v),d=a>=100?0:a>=10?1:2;
 return Number(v.toFixed(d)).toLocaleString(undefined,{maximumFractionDigits:d});
}
function withUnit(v,unit){
 const s=fmt(v);if(s==='—'||!unit)return s;
 return unit==='%'?s+'%':s+' '+unit;
}
function colors(spec){
 const s=spec.series||[];
 if(spec.type==='bar'&&spec.stacked&&s.length===2&&!s.some(x=>x.tone))return ['var(--cl-accent)',OTHER];
 let k=0;return s.map(x=>x.tone&&TONES[x.tone]?TONES[x.tone]:ORDER[(k++)%ORDER.length]);
}
function label(spec){return `${spec.yLabel||'Value'} by ${spec.xLabel||'category'}`;}

// ---- chart (line / bar) ----
function drawChart(host,spec,height){
 host.textContent='';
 const d3=root.d3;
 if(!d3){host.append(el('p','dash-muted','Charts need d3, which did not load. Use View data.'));return;}
 const series=spec.series||[],x=spec.x||[],cols=colors(spec);
 if(series.length>1){
  const legend=el('div','dash-legend');
  series.forEach((s,i)=>{const item=el('span','dash-legend-item');const sw=el('span','dash-swatch');sw.style.background=cols[i];item.append(sw,document.createTextNode(s.name));legend.append(item);});
  host.append(legend);height-=22;
 }
 const plot=el('div','dash-plot');host.append(plot);
 const w=Math.max(120,plot.getBoundingClientRect().width||host.getBoundingClientRect().width||300);
 const numericX=spec.type==='line'&&x.every(v=>typeof v==='number');
 const labels=x.map(String);
 const longest=d3.max(labels,s=>s.length)||1;
 const m={l:46,r:12,t:20,b:34};
 const svg=d3.select(plot).append('svg').attr('viewBox',`0 0 ${w} ${height}`).attr('width',w).attr('height',height).attr('role','img').attr('aria-label',label(spec));
 svg.append('title').text(label(spec));
 // y domain
 let lo=Infinity,hi=-Infinity;
 if(spec.type==='bar'&&spec.stacked){x.forEach((_,i)=>{let pos=0,neg=0;series.forEach(s=>{const v=s.values[i];if(Number.isFinite(v)){if(v>=0)pos+=v;else neg+=v;}});hi=Math.max(hi,pos);lo=Math.min(lo,neg);});}
 else series.forEach(s=>s.values.forEach(v=>{if(Number.isFinite(v)){hi=Math.max(hi,v);lo=Math.min(lo,v);}}));
 if(!Number.isFinite(hi)){hi=1;lo=0;}
 lo=Math.min(0,lo);if(hi===lo)hi=lo+1;
 const yMin=Number.isFinite(spec.yMin)?spec.yMin:lo,yMax=Number.isFinite(spec.yMax)?spec.yMax:hi+(hi-lo)*.08;
 // x scale + label layout
 const inner=w-m.l-m.r;
 let rotate=false,every=1;
 if(!numericX){
  const band=inner/Math.max(1,x.length),need=longest*6+6;
  if(need>band){if(longest>4&&x.length<=16){rotate=true;m.b=Math.min(80,18+Math.min(longest,22)*4.6);}else every=Math.ceil(need/band);}
 }
 const y=d3.scaleLinear().domain([yMin,yMax]).nice().range([height-m.b,m.t]);
 const xs=numericX?d3.scaleLinear().domain(d3.extent(x)).range([m.l+4,w-m.r-4]):spec.type==='bar'?d3.scaleBand().domain(d3.range(x.length)).range([m.l,w-m.r]).paddingInner(.18).paddingOuter(.08):d3.scalePoint().domain(d3.range(x.length)).range([m.l+6,w-m.r-6]);
 const xAt=i=>numericX?xs(x[i]):spec.type==='bar'?xs(i)+xs.bandwidth()/2:xs(i);
 svg.append('rect').attr('x',m.l).attr('y',m.t).attr('width',inner).attr('height',height-m.t-m.b).attr('fill','none').attr('stroke','var(--cl-line)');
 const yAxis=svg.append('g').attr('class','dash-axis').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(height<190?3:4).tickFormat(v=>spec.unit==='%'?fmt(v)+'%':fmt(v)));
 yAxis.select('.domain').remove();
 const xAxis=numericX?d3.axisBottom(xs).ticks(Math.min(w<360?3:6,x.every(Number.isInteger)?Math.max(1,d3.max(x)-d3.min(x)):6)).tickFormat(v=>x.every(Number.isInteger)&&!Number.isInteger(v)?'':fmt(v)):d3.axisBottom(xs).tickFormat(i=>i%every===0?truncate(labels[i],rotate?22:Math.max(4,Math.floor(inner/Math.max(1,x.length)*every/6))):'');
 const xg=svg.append('g').attr('class','dash-axis').attr('transform',`translate(0,${height-m.b})`).call(xAxis);
 xg.select('.domain').remove();
 if(rotate)xg.selectAll('text').attr('text-anchor','end').attr('transform','rotate(-35)').attr('dx','-.4em').attr('dy','.5em');
 if(spec.yLabel)svg.append('text').attr('class','dash-axis-title').attr('x',m.l).attr('y',12).text(spec.yLabel+(spec.unit&&spec.unit!=='%'?` (${spec.unit})`:''));
 if(spec.xLabel&&!rotate)svg.append('text').attr('class','dash-axis-title').attr('x',(w+m.l-m.r)/2).attr('y',height-3).attr('text-anchor','middle').text(spec.xLabel);
 if(yMin<0&&yMax>0)svg.append('line').attr('x1',m.l).attr('x2',w-m.r).attr('y1',y(0)).attr('y2',y(0)).attr('stroke','var(--cl-line)').attr('stroke-dasharray','3 3');
 const hlIndex=spec.highlightX===undefined?-1:x.findIndex(v=>v===spec.highlightX||String(v)===String(spec.highlightX));

 if(spec.type==='bar'){
  const bw=xs.bandwidth();
  if(spec.stacked){
   x.forEach((_,i)=>{let pos=0,neg=0;series.forEach((s,k)=>{const v=s.values[i];if(!Number.isFinite(v)||v===0)return;const base=v>=0?pos:neg,top=base+v;if(v>=0)pos=top;else neg=top;
    svg.append('rect').attr('x',xs(i)).attr('width',bw).attr('y',y(Math.max(base,top))).attr('height',Math.max(0,Math.abs(y(base)-y(top)))).attr('fill',cols[k]).append('title').text(`${labels[i]} · ${s.name}: ${withUnit(v,spec.unit)}`);});});
  }else{
   const sub=d3.scaleBand().domain(d3.range(series.length)).range([0,bw]).padding(series.length>1?.08:0);
   series.forEach((s,k)=>s.values.forEach((v,i)=>{if(!Number.isFinite(v))return;
    svg.append('rect').attr('x',xs(i)+sub(k)).attr('width',sub.bandwidth()).attr('y',y(Math.max(0,v))).attr('height',Math.max(v===0?0:1,Math.abs(y(v)-y(0)))).attr('fill',cols[k]).append('title').text(`${labels[i]} · ${s.name}: ${withUnit(v,spec.unit)}`);}));
   if(series.length===1&&x.length<=12)series[0].values.forEach((v,i)=>{if(!Number.isFinite(v))return;svg.append('text').attr('class','dash-bar-label').attr('x',xAt(i)).attr('y',y(Math.max(0,v))-4).attr('text-anchor','middle').text(withUnit(v,spec.unit==='%'?'%':''));});
  }
  if(hlIndex>=0)svg.append('rect').attr('x',xs(hlIndex)-2).attr('width',bw+4).attr('y',m.t).attr('height',height-m.t-m.b).attr('fill','none').attr('stroke','var(--cl-accent)').attr('stroke-dasharray','3 3');
  return;
 }
 // line
 const pts=x.length<=25;
 series.forEach((s,k)=>{
  svg.append('path').datum(s.values).attr('fill','none').attr('stroke',cols[k]).attr('stroke-width',2).attr('d',d3.line().defined(v=>Number.isFinite(v)).x((_,i)=>xAt(i)).y(v=>y(v)));
  if(pts)s.values.forEach((v,i)=>{if(Number.isFinite(v))svg.append('circle').attr('cx',xAt(i)).attr('cy',y(v)).attr('r',2.4).attr('fill',cols[k]);});
 });
 if(hlIndex>=0){
  svg.append('line').attr('x1',xAt(hlIndex)).attr('x2',xAt(hlIndex)).attr('y1',m.t).attr('y2',height-m.b).attr('stroke','var(--cl-muted)').attr('stroke-dasharray','2 3');
  const v=series[0].values[hlIndex];
  if(Number.isFinite(v)){const right=xAt(hlIndex)>(m.l+w-m.r)/2;svg.append('circle').attr('cx',xAt(hlIndex)).attr('cy',y(v)).attr('r',4).attr('fill',cols[0]);svg.append('text').attr('class','dash-bar-label').attr('x',xAt(hlIndex)+(right?-7:7)).attr('y',Math.max(m.t+12,y(v)-8)).attr('text-anchor',right?'end':'start').text(withUnit(v,spec.unit));}
 }
 // hover crosshair with a readout of every series at the nearest x
 const guide=svg.append('line').attr('y1',m.t).attr('y2',height-m.b).attr('stroke','var(--cl-fg)').attr('stroke-opacity',.35).style('display','none');
 const read=svg.append('text').attr('class','dash-readout').attr('y',m.t+12).style('display','none');
 const hit=svg.append('rect').attr('x',m.l).attr('y',m.t).attr('width',inner).attr('height',height-m.t-m.b).attr('fill','transparent');
 const positions=x.map((_,i)=>xAt(i));
 const show=px=>{let best=0;positions.forEach((p,i)=>{if(Math.abs(p-px)<Math.abs(positions[best]-px))best=i;});
  guide.attr('x1',positions[best]).attr('x2',positions[best]).style('display',null);
  const right=positions[best]>(m.l+w-m.r)/2;
  read.text(`${labels[best]}: `+series.map(s=>(series.length>1?s.name+' ':'')+withUnit(s.values[best],spec.unit)).join(' · ')).attr('x',positions[best]+(right?-6:6)).attr('text-anchor',right?'end':'start').style('display',null);};
 hit.on('mousemove touchmove',e=>{const [px]=d3.pointer(e.touches?e.touches[0]:e,svg.node());show(px);}).on('mouseleave',()=>{guide.style('display','none');read.style('display','none');});
}
function truncate(s,n){return s.length>n?s.slice(0,n-1)+'…':s;}

// ---- stat / table / note ----
function drawStat(host,spec){
 host.textContent='';
 const grid=el('div','dash-stats');
 (spec.items||[]).forEach(it=>{const b=el('div','dash-stat');const v=el('div','dash-stat-value',fmt(it.value));if(it.unit){const u=el('span','dash-stat-unit',it.unit==='%'?'%':' '+it.unit);v.append(u);}b.append(v,el('div','dash-stat-label',it.label));if(it.note)b.append(el('div','dash-stat-note',it.note));grid.append(b);});
 host.append(grid);
}
function tableEl(columns,rows,align){
 const wrap=el('div','dash-table-wrap'),t=el('table','dash-table'),thead=el('thead'),hr=el('tr');
 columns.forEach((c,i)=>{const th=el('th',null,c);th.scope='col';if(isRight(rows,i,align))th.className='num';hr.append(th);});
 thead.append(hr);t.append(thead);
 const tb=el('tbody');
 rows.forEach(r=>{const tr=el('tr');r.forEach((c,i)=>{const td=el('td',isRight(rows,i,align)?'num':null,c===null||c===undefined?'—':typeof c==='number'?fmt(c):c);tr.append(td);});tb.append(tr);});
 t.append(tb);wrap.append(t);return wrap;
}
function isRight(rows,i,align){if(align&&align[i])return align[i]==='right';return rows.length>0&&rows.every(r=>typeof r[i]==='number'||r[i]===null);}
function drawTable(host,spec){host.textContent='';host.append(tableEl(spec.columns||[],spec.rows||[],spec.align));}
function drawNote(host,spec){
 host.textContent='';
 String(spec.text||'').split(/\n\s*\n/).forEach(p=>{if(p.trim())host.append(el('p','dash-note-p',p.trim()));});
}

// Accessible data alternative for any view.
function dataTable(view){
 if(!view||!view.spec)return null;
 const s=view.spec;
 if(view.kind==='chart'){
  const u=s.unit?` (${s.unit})`:'';
  return tableEl([s.xLabel||'x',...(s.series||[]).map(x=>x.name+u)],(s.x||[]).map((v,i)=>[v,...(s.series||[]).map(x=>x.values[i]??null)]),['left',...(s.series||[]).map(()=>'right')]);
 }
 if(view.kind==='stat')return tableEl(['Label','Value','Unit','Note'],(s.items||[]).map(i=>[i.label,i.value,i.unit||'',i.note||'']),['left','right','left','left']);
 if(view.kind==='table')return tableEl(s.columns||[],s.rows||[],s.align);
 return null;
}

// Render a view into host at a fixed height; redraws charts when the width changes.
function render(host,view,size){
 const height=HEIGHT[size]||HEIGHT.half;
 host.classList.add('dash-view','dash-view-'+(view?.kind||'none'));
 if(!view||!view.spec){host.textContent='';host.append(el('p','dash-muted','Nothing to show.'));return;}
 if(view.kind==='chart'){
  host.style.height=height+'px';
  let lastW=0;
  const draw=()=>{const w=Math.round(host.getBoundingClientRect().width);if(w&&w!==lastW){lastW=w;drawChart(host,view.spec,height);}};
  draw();
  if(root.ResizeObserver){host._ro?.disconnect();host._ro=new ResizeObserver(()=>draw());host._ro.observe(host);}
  if(!lastW)requestAnimationFrame(draw);
 }else if(view.kind==='stat')drawStat(host,view.spec);
 else if(view.kind==='table'){host.style.maxHeight=Math.max(height,200)+'px';drawTable(host,view.spec);}
 else if(view.kind==='note')drawNote(host,view.spec);
 else{host.textContent='';host.append(el('p','dash-muted','Unsupported view.'));}
}

root.DashboardCharts={render,dataTable,fmt,withUnit,HEIGHT};
})(typeof window!=='undefined'?window:globalThis);
