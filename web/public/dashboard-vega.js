// DashboardVega: renders vega tiles with the official Vega / Vega-Lite libraries, loaded only when a
// page has a vega tile. Specs are checked again here (DashboardInputs.vegaErrors), expressions run
// in the Vega interpreter (no Function/eval), and the loader refuses every external resource.
(function(root){
'use strict';
const ASSETS=['/dashboard-assets/vega.min.js','/dashboard-assets/vega-lite.min.js','/dashboard-assets/vega-interpreter.js'];
const HEIGHT={third:150,half:180,full:220};
const COMPOSED=['facet','repeat','concat','hconcat','vconcat'];
const FONT='system-ui,-apple-system,"Segoe UI",sans-serif';
// Field-guide palette: charcoal, slate, brick, wood, wheat, sheep.
const THEME={
 background:null,font:FONT,padding:4,
 view:{stroke:'#dedcd5'},
 axis:{labelColor:'#66645d',titleColor:'#66645d',titleFontWeight:600,titleFontSize:11,labelFontSize:11,gridColor:'#efede7',domainColor:'#dedcd5',tickColor:'#dedcd5'},
 legend:{labelColor:'#252522',titleColor:'#66645d',labelFontSize:11,titleFontSize:11,symbolSize:70},
 header:{labelColor:'#252522',titleColor:'#66645d',labelFontSize:11},
 title:{color:'#252522',fontSize:12,fontWeight:650,anchor:'start'},
 range:{category:['#292925','#727c91','#b86643','#51735b','#bd9438','#939d52','#8a8577','#4f6d8a'],ramp:['#f0efea','#292925'],heatmap:['#f0efea','#727c91','#292925']},
 mark:{color:'#292925'},bar:{color:'#292925'},line:{color:'#292925',strokeWidth:2},point:{color:'#292925'},area:{color:'#727c91',opacity:.7},rect:{color:'#292925'},
 text:{color:'#252522',fontSize:11}
};
let loading=null;
const views=new Map(),tokens=new Map();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=()=>reject(new Error('The chart library did not load. Check your connection and reload.'));document.head.append(s);});}
function load(){
 loading??=ASSETS.reduce((p,src)=>p.then(()=>loadScript(src)),Promise.resolve())
  .then(()=>{if(!root.vega||!root.vegaLite||!root.vegaInterpreter)throw new Error('The chart library did not load.');})
  .catch(e=>{loading=null;throw e;});
 return loading;
}
function merge(a,b){
 if(!b||typeof b!=='object'||Array.isArray(b))return b===undefined?a:b;
 const out={...(a&&typeof a==='object'&&!Array.isArray(a)?a:{})};
 for(const k of Object.keys(b))out[k]=merge(out[k],b[k]);
 return out;
}
function single(spec){return !COMPOSED.some(k=>own(spec,k))&&!(spec.encoding&&(spec.encoding.facet||spec.encoding.row||spec.encoding.column));}
// Inject input values into params, fit single views to the tile, apply the field-guide theme.
function prepare(def,values,size){
 const spec=root.DashboardInputs.injectParams(def,values);
 if(single(spec)){
  if(spec.width===undefined)spec.width='container';
  if(spec.height===undefined)spec.height=HEIGHT[size]||HEIGHT.half;
  if(spec.autosize===undefined)spec.autosize={type:'fit',contains:'padding'};
 }
 spec.config=merge(THEME,spec.config||{});
 delete spec.$schema;
 return spec;
}
function denyLoader(){
 const l=root.vega.loader();
 const deny=()=>Promise.reject(new Error('External resources are disabled on this dashboard.'));
 l.load=deny;l.sanitize=deny;l.http=deny;l.file=deny;
 return l;
}
function message(host,text,cls='dash-muted'){const p=document.createElement('p');p.className=cls;p.textContent=text;host.replaceChildren(p);}

// Draw (or reuse) the chart for component c inside host. Rejects with a readable error.
async function mount(host,c,values){
 const def=c.spec&&c.spec.definition,key=JSON.stringify(def)+'|'+c.size;
 const errors=root.DashboardInputs.vegaErrors(def);
 if(errors.length){message(host,'This chart is not allowed: '+errors[0],'dash-error');return;}
 const cached=views.get(c.id);
 if(cached&&cached.key===key){host.replaceChildren(cached.el);update(c.id,values);return;}
 if(cached){cached.view.finalize();views.delete(c.id);}
 const token={};tokens.set(c.id,token);
 if(!root.vega)message(host,'Loading chart…');
 await load();
 if(tokens.get(c.id)!==token||!host.isConnected)return;
 const el=document.createElement('div');el.className='dash-vega-canvas';
 host.replaceChildren(el);
 let view;
 try{
  const compiled=root.vegaLite.compile(prepare(def,values,c.size),{logger:{level(){return this;},warn(){return this;},info(){return this;},debug(){return this;},error(m){throw new Error(m);}}}).spec;
  view=new root.vega.View(root.vega.parse(compiled,null,{ast:true}),{renderer:'svg',container:el,hover:true,loader:denyLoader(),expr:root.vegaInterpreter.expressionInterpreter,logLevel:root.vega.Error});
  await view.runAsync();
 }catch(e){view?.finalize();message(host,'Chart could not be drawn: '+String(e&&e.message||e).slice(0,200),'dash-error');return;}
 if(tokens.get(c.id)!==token){view.finalize();return;}
 const svg=el.querySelector('svg');if(svg){svg.setAttribute('role','img');svg.setAttribute('aria-label',c.title||'Chart');}
 views.set(c.id,{key,el,view,names:root.DashboardInputs.vegaParamNames(def)});
}
// Push new input values into a drawn chart's params (no recompile).
function update(id,values){
 const v=views.get(id);if(!v||!values)return;
 let changed=false;
 for(const n of v.names){
  if(!own(values,n))continue;
  try{if(v.view.signal(n)!==values[n]){v.view.signal(n,values[n]);changed=true;}}catch{/* param not a top-level signal */}
 }
 if(changed)v.view.runAsync().catch(()=>{});
}
function prune(liveIds){for(const [id,v] of views)if(!liveIds.has(id)){v.view.finalize();views.delete(id);tokens.delete(id);}}
// Rows for "View data": the first inline dataset, as a small table.
function dataRows(def){
 const vals=def&&def.data&&Array.isArray(def.data.values)?def.data.values:null;
 if(!vals||!vals.length)return null;
 const objs=vals.every(r=>r&&typeof r==='object'&&!Array.isArray(r));
 const columns=objs?[...new Set(vals.flatMap(r=>Object.keys(r)))].slice(0,8):['value'];
 const cell=x=>x===null||x===undefined?null:typeof x==='number'?x:typeof x==='object'?JSON.stringify(x).slice(0,60):String(x).slice(0,60);
 return {columns,rows:vals.slice(0,50).map(r=>objs?columns.map(k=>cell(r[k])):[cell(r)]),more:Math.max(0,vals.length-50)};
}
root.DashboardVega={load,mount,update,prune,dataRows,prepare};
})(typeof window!=='undefined'?window:globalThis);
