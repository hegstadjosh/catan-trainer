// Dashboard client: pages, tiles, live polling, follow-agent, editing, and the Connect agent panel.
// Untrusted text (titles, captions, labels, agent data) is only ever written with textContent.
(function(){
'use strict';
const boot=JSON.parse(document.getElementById('dashboard-boot').textContent||'{}');
const LIMIT_PAGES=20,LIMIT_TILES=24,POLL_MS=3000,UNDO_MS=8000;
const STARTER=[['dice_odds','Dice odds','half'],['build_eta','Build progress','half'],['dev_card_odds','Dev card odds','third'],['seven_risk','Seven risk','third'],['resource_income','Resource income','third']];
const SIZES=[['third','Third'],['half','Half'],['full','Full']];
const OPTION_TEXT={base:'Base cost',vp:'Victory points',draws:'Dev card draws',total:'Cumulative',turn:'Per turn'};
const reducedMotion=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const Charts=window.DashboardCharts;
const Models=()=>window.DashboardModels||null;
const Inputs=()=>window.DashboardInputs;
const Vega=()=>window.DashboardVega;
const TYPE_MS=600,BUTTON_MS=350,TEXT_MS=800;
// Live input values: pending = changed here but not yet saved; base = saved value when the change started
// (used to detect another writer changing the same field); errors/conflicts are shown inline per field.
const IN={pending:{},base:{},errors:{},conflicts:{},typing:new Set(),timer:null,saving:false,again:false};

const S={
 mode:'loading',          // loading | page | empty | missing | connect | error
 pages:[],page:null,server:null,seq:0,
 catalog:[],connections:null,connectionsError:'',
 follow:localStorage.getItem('catan-dash-follow')!=='off',
 arrange:false,picker:false,creating:false,renaming:false,
 editing:null,             // {id,isNew,draft,baseUpdatedAt,conflict,error,remoteChanged}
 banner:null,              // {pageId,componentId}
 stale:false,              // remote change deferred while editing
 fails:0,writing:0,polling:false,timer:null,
 status:{text:'Connecting…',tone:''},
 pulse:new Set(),openData:new Set(),focusAfter:null,
 disconnecting:null,
};
const $=id=>document.getElementById(id);
const side=$('dash-side'),main=$('dash-main'),toasts=$('dash-toasts'),announcer=$('dash-announce');
const statusEl=h('p',{class:'dash-status',role:'status','aria-live':'polite'});

// ---------- tiny DOM helper (text only) ----------
function h(tag,attrs,...kids){
 const e=document.createElement(tag);
 for(const [k,v] of Object.entries(attrs||{})){
  if(v===undefined||v===null||v===false)continue;
  if(k==='class')e.className=v;
  else if(k==='text')e.textContent=String(v);
  else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);
  else if(k==='value')e.value=v;
  else if(k==='checked'||k==='disabled'||k==='hidden'||k==='open'||k==='selected')e[k]=Boolean(v);
  else e.setAttribute(k,v===true?'':String(v));
 }
 for(const kid of kids.flat()){if(kid===null||kid===undefined||kid===false)continue;e.append(kid instanceof Node?kid:document.createTextNode(String(kid)));}
 return e;
}
const btn=(text,onclick,attrs={})=>h('button',{type:'button',class:'dash-btn',onclick,...attrs},text);
function announce(msg){announcer.textContent='';setTimeout(()=>{announcer.textContent=msg;},30);}
function clock(iso){const d=iso?new Date(iso):new Date();return isNaN(d)?'':d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function ago(iso){
 const d=new Date(iso);if(isNaN(d))return '';
 const s=Math.round((Date.now()-d)/1000);
 if(s<60)return 'just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';
 return d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===new Date().getFullYear()?undefined:'numeric'});
}
const newId=()=>'c_'+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>(b%36).toString(36)).join('');
const clone=v=>JSON.parse(JSON.stringify(v));

// ---------- API ----------
async function api(method,path,body){
 let r;
 try{r=await fetch(path,{method,credentials:'same-origin',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined});}
 catch(e){const err=new Error('You appear to be offline.');err.network=true;throw err;}
 let data=null;
 if(r.status!==204){try{data=await r.json();}catch{data=null;}}
 if(r.status===401){location.href='/signin?next='+encodeURIComponent(location.pathname);throw new Error('Please sign in again.');}
 if(!r.ok){const err=new Error((data&&typeof data.error==='string'&&data.error)||`Request failed (${r.status}).`);err.status=r.status;err.data=data;throw err;}
 return data||{};
}

// ---------- status + toasts ----------
function setStatus(text,tone=''){S.status={text,tone};statusEl.textContent=text;statusEl.dataset.tone=tone;}
function live(msg){setStatus('● Live'+(msg?' · '+msg:''),'live');}
function toast(text,actions=[],ms=6000){
 const t=h('div',{class:'dash-toast',role:'status'},h('span',{text}));
 let timer;
 const close=()=>{clearTimeout(timer);t.remove();};
 actions.forEach(([label,fn])=>t.append(btn(label,()=>{close();fn();},{class:'dash-btn dash-link'})));
 t.append(btn('✕',close,{class:'dash-btn dash-icon','aria-label':'Dismiss'}));
 toasts.append(t);
 if(ms)timer=setTimeout(close,ms);
 return close;
}
function errorToast(e,retry){toast(e.network?'Could not reach the server. Nothing was lost on this screen.':e.message,retry?[['Retry',retry]]:[],retry?10000:7000);}

// ---------- dialogs (no window.prompt/alert) ----------
function confirmDialog({title,body,confirm,danger}){
 return new Promise(resolve=>{
  const d=h('dialog',{class:'dash-dialog','aria-labelledby':'dash-dialog-title'});
  const done=v=>{d.close();d.remove();resolve(v);};
  d.append(h('h2',{id:'dash-dialog-title',text:title}),h('p',{text:body}),
   h('div',{class:'dash-row dash-end'},btn('Cancel',()=>done(false)),btn(confirm,()=>done(true),{class:'dash-btn '+(danger?'dash-danger':'dash-primary')})));
  d.addEventListener('cancel',e=>{e.preventDefault();done(false);});
  document.body.append(d);d.showModal();d.querySelector('.dash-primary,.dash-danger').focus();
 });
}

// ---------- popover menu ----------
let menuEl=null;
function closeMenu(){if(menuEl){const anchor=menuEl._anchor;menuEl.remove();menuEl=null;anchor?.setAttribute('aria-expanded','false');}}
function openMenu(anchor,items){
 if(menuEl&&menuEl._anchor===anchor){closeMenu();return;}
 closeMenu();
 const m=h('div',{class:'dash-menu',role:'menu'});
 items.filter(Boolean).forEach(([label,fn,attrs])=>m.append(h('button',{type:'button',role:'menuitem',class:'dash-menu-item',onclick:()=>{closeMenu();fn();},...(attrs||{})},label)));
 m._anchor=anchor;anchor.setAttribute('aria-expanded','true');
 document.body.append(m);
 const r=anchor.getBoundingClientRect(),mw=m.offsetWidth;
 m.style.top=(window.scrollY+r.bottom+4)+'px';
 m.style.left=Math.max(8,Math.min(window.scrollX+r.right-mw,window.scrollX+document.documentElement.clientWidth-mw-8))+'px';
 menuEl=m;m.querySelector('button:not([disabled])')?.focus();
 m.addEventListener('keydown',e=>{
  const list=[...m.querySelectorAll('button:not([disabled])')],i=list.indexOf(document.activeElement);
  if(e.key==='ArrowDown'){e.preventDefault();list[(i+1)%list.length]?.focus();}
  else if(e.key==='ArrowUp'){e.preventDefault();list[(i-1+list.length)%list.length]?.focus();}
  else if(e.key==='Escape'){e.preventDefault();closeMenu();anchor.focus();}
  else if(e.key==='Tab')closeMenu();
 });
}
document.addEventListener('click',e=>{if(menuEl&&!menuEl.contains(e.target)&&e.target!==menuEl._anchor&&!menuEl._anchor.contains(e.target))closeMenu();});

// ---------- components ----------
const ENVELOPE=['id','kind','title','caption','size','spec','source'];
function envelope(c){const out={};for(const k of ENVELOPE)if(c[k]!==undefined&&c[k]!==null&&!(k==='caption'&&c[k]===''))out[k]=clone(c[k]);return out;}
// Same resolve + compute path as the server (shared DashboardInputs + DashboardModels).
function computeLocal(env,values=liveValues()){
 const M=Models(),I=Inputs();
 if(env.kind!=='model'||!M||!I)return null;
 try{return I.computeModel(M,env.spec,values);}
 catch(e){return {errors:e.errors||[e.message]};}
}
// Optimistic stand-in for a component the server has not resolved yet.
function localResolve(env,prior,values){
 const out={...clone(env),createdBy:prior?.createdBy||'user',updatedAt:prior?.updatedAt||null};
 if(env.kind==='model'){const r=computeLocal(env,values);out.computed=r?.computed||(prior&&JSON.stringify(prior.spec)===JSON.stringify(env.spec)?prior.computed:null);if(r?.errors)out.error=r.errors.join(' ');}
 return out;
}
const hasRefs=c=>c.kind==='model'&&Inputs()?.refsIn(c.spec?.params).keys.length>0;
const catalogEntry=name=>S.catalog.find(m=>m.name===name);
const isAgentData=c=>c.kind!=='model'&&c.kind!=='input'&&!c.invalid&&(c.kind!=='note'||c.source||c.createdBy==='agent');

// ---------- writes (serialized; compare-and-swap with one merge retry) ----------
class Stale extends Error{}
function idx(list,id){const i=list.findIndex(c=>c.id===id);if(i<0)throw new Stale('That tile no longer exists.');return i;}
let queue=Promise.resolve();
function commit(label,fn,opts={}){
 const run=()=>doCommit(label,fn,opts);
 const p=queue.then(run,run);queue=p.catch(()=>{});return p;
}
async function doCommit(label,fn,{optimistic=true,onStale,onError,quiet}={}){
 if(!S.server)return false;
 const pageId=S.server.id;
 let base=S.server,next;
 try{next=fn(base.components.map(envelope));}catch(e){if(e instanceof Stale){onStale?onStale(e):toast(e.message);return false;}throw e;}
 if(!next)return false;
 if(optimistic){const byId=new Map(base.components.map(c=>[c.id,c])),values={...(Inputs()?.valuesOf(next)||{}),...IN.pending};S.page={...base,components:next.map(env=>localResolve(env,byId.get(env.id),values))};render();}
 S.writing++;
 try{
  for(let attempt=0;attempt<2;attempt++){
   try{
    const {page}=await api('PUT','/api/dashboard/pages/'+pageId,{expectedRevision:base.revision,components:next});
    if(S.server?.id===pageId){acceptServer(page,{own:true});if(!S.editing&&!S.renaming)render();}
    if(!quiet)live(label+' · '+clock());
    return true;
   }catch(e){
    if(e.status===409&&e.data?.page&&attempt===0){
     base=e.data.page;if(S.server?.id===pageId)acceptServer(base,{own:false});
     try{next=fn(base.components.map(envelope));}
     catch(err){if(err instanceof Stale){render();onStale?onStale(err):toast('This page changed elsewhere first. '+err.message+' Your change was not applied.');return false;}throw err;}
     if(!next)return false;
     continue;
    }
    throw e;
   }
  }
  return false;
 }catch(e){
  if(S.server?.id===pageId){S.page=S.server;render();}
  if(onError)onError(e);else errorToast(e,()=>commit(label,fn,opts));
  return false;
 }finally{S.writing--;}
}
// Install a server page. Remote (not own) changes pulse and report what changed.
function acceptServer(page,{own}){
 const prev=S.server;
 // A poll begun before our write can return the revision we just saved.
 if(!own&&prev?.id===page.id&&page.revision<=prev.revision)return;
 S.server=page;
 if(!own&&prev&&prev.id===page.id)inputConflicts();
 const meta=S.pages.find(p=>p.id===page.id);if(meta){meta.revision=page.revision;meta.title=page.title;}
 if(!own&&prev&&prev.id===page.id){
  const before=new Map(prev.components.map(c=>[c.id,c.updatedAt]));
  const changed=page.components.filter(c=>!before.has(c.id)||before.get(c.id)!==c.updatedAt);
  changed.forEach(c=>S.pulse.add(c.id));
  if(changed.length){
   const c=changed[changed.length-1],verb=before.has(c.id)?'updated':c.createdBy==='agent'?'agent added':'added';
   live(changed.length>1?`${changed.length} tiles changed ${clock()}`:`${verb} '${c.title}' ${clock()}`);
  }else if(prev.title!==page.title)live(`page renamed ${clock()}`);
  else if(prev.components.length!==page.components.length)live(`tile removed ${clock()}`);
  if(S.editing){const e=page.components.find(c=>c.id===S.editing.id);if(e&&e.updatedAt!==S.editing.baseUpdatedAt)S.editing.remoteChanged=true;}
  if(S.follow&&changed.length)S.focusAfter={id:changed[changed.length-1].id,scroll:true};
 }
 if(S.editing||S.renaming){
  if(!own){S.stale=true;updateEditorNotice();}
  else S.page=page;
  return;
 }
 S.page=page;
}

// ---------- pages ----------
async function loadPages(){const {pages}=await api('GET','/api/dashboard/pages');S.pages=pages;}
async function openPage(id,{push=true,record=true,highlight=null,replace=false,fallback=false}={}){
 if(S.editing&&S.editing.id&&!(await confirmDialog({title:'Discard your edit?',body:'You have an open tile edit. Leaving this page discards it.',confirm:'Discard edit',danger:true})))return;
 if(S.server&&S.server.id!==id&&Object.keys(IN.pending).length)await saveInputs();
 if(S.server?.id!==id)resetInputs();
 S.editing=null;S.renaming=false;S.picker=false;S.banner=null;S.stale=false;
 try{
  const {page}=await api('GET','/api/dashboard/pages/'+encodeURIComponent(id));
  S.server=S.page=page;S.mode='page';S.pulse.clear();
  if(highlight){S.pulse.add(highlight);S.focusAfter={id:highlight,scroll:true};}
  const url='/dashboard/'+page.id;
  if(replace||location.pathname===url)history.replaceState({pageId:page.id},'',url);else if(push)history.pushState({pageId:page.id},'',url);
  if(!S.pages.some(p=>p.id===page.id))S.pages.unshift({id:page.id,title:page.title,revision:page.revision});
  document.title=page.title+' · Dashboard';
  render();
  if(record)api('POST','/api/dashboard/view',{pageId:page.id}).then(v=>{if(Number.isFinite(v?.seq)&&v.seq>S.seq)S.seq=v.seq;}).catch(()=>{});
 }catch(e){
  if(e.status===404&&fallback){S.pages=S.pages.filter(p=>p.id!==id);if(S.pages[0])return openPage(S.pages[0].id,{replace:true,record:false});S.mode='empty';S.server=S.page=null;history.replaceState({},'','/dashboard');render();}
  else if(e.status===404){S.mode='missing';S.server=S.page=null;render();}
  else errorToast(e,()=>openPage(id,{push,record,highlight}));
 }
}
async function createPage(title,components){
 if(S.pages.length>=LIMIT_PAGES){toast(`You have ${LIMIT_PAGES} pages, the limit. Archive one to add another.`);return;}
 try{
  const {page}=await api('POST','/api/dashboard/pages',{title,components:components||[]});
  S.pages.unshift({id:page.id,title:page.title,revision:page.revision});
  S.creating=false;
  await openPage(page.id);
  announce(`Created page ${page.title}`);
  return page;
 }catch(e){errorToast(e);}
}
async function createExample(name){
 if(S.pages.length>=LIMIT_PAGES){toast(`You have ${LIMIT_PAGES} pages, the limit. Archive one to add another.`);return;}
 try{const {page}=await api('POST','/api/dashboard/pages/examples/'+encodeURIComponent(name));S.pages.unshift({id:page.id,title:page.title,revision:page.revision});S.picker=false;await openPage(page.id);announce(`Created page ${page.title}`);}
 catch(e){errorToast(e);}
}
function starterComponents(){
 return STARTER.map(([model,title,size])=>({id:newId(),kind:'model',title,size,caption:'Edit the numbers to match your game.',spec:{model,params:{}}}));
}
async function renamePage(title){
 title=title.trim();S.renaming=false;
 if(!title||!S.server||title===S.server.title){flushStale();render();return;}
 const id=S.server.id,prev=S.server.title;
 S.page={...S.page,title};render();
 try{const {page}=await api('PUT','/api/dashboard/pages/'+id,{expectedRevision:S.server.revision,title});acceptServer(page,{own:true});live('renamed page · '+clock());}
 catch(e){
  if(e.status===409&&e.data?.page){
   try{const {page}=await api('PUT','/api/dashboard/pages/'+id,{expectedRevision:e.data.page.revision,title});acceptServer(page,{own:true});live('renamed page · '+clock());}
   catch(e2){acceptServer(e.data.page,{own:true});errorToast(e2);}
  }else{S.page={...S.server,title:prev};errorToast(e,()=>renamePage(title));}
 }
 flushStale();render();
}
async function duplicatePage(){
 if(!S.server)return;
 const title=('Copy of '+S.server.title).slice(0,80);
 await createPage(title,S.server.components.filter(c=>!c.invalid).map(envelope));
}
async function archivePage(){
 const p=S.server;if(!p)return;
 const ok=await confirmDialog({title:`Archive “${p.title}”?`,body:`The page and its ${p.components.length} tile${p.components.length===1?'':'s'} leave your page list. Your agent can no longer open it.`,confirm:'Archive page',danger:true});
 if(!ok)return;
 try{
  await api('DELETE','/api/dashboard/pages/'+p.id,{expectedRevision:S.server.revision});
  S.pages=S.pages.filter(x=>x.id!==p.id);
  toast(`Archived “${p.title}”.`);
  S.server=S.page=null;
  if(S.pages[0])await openPage(S.pages[0].id,{replace:true});else{S.mode='empty';history.replaceState({},'','/dashboard');render();}
 }catch(e){
  if(e.status===409&&e.data?.page){acceptServer(e.data.page,{own:false});render();toast('Your agent changed this page just now. Review it, then archive again.');}
  else errorToast(e);
 }
}
function flushStale(){if(S.stale&&!S.editing&&!S.renaming){S.stale=false;S.page=S.server;}}

// ---------- tile operations ----------
function tileTitle(id){return (S.page?.components.find(c=>c.id===id)||{}).title||'tile';}
function moveTile(id,delta){
 const list=S.page.components,i=list.findIndex(c=>c.id===id),j=i+delta;
 if(i<0||j<0||j>=list.length)return;
 S.flipFrom=snapshot();
 S.focusAfter={id,selector:document.activeElement?.dataset?.focusKey};
 commit('moved tile',l=>{const k=idx(l,id);const [c]=l.splice(k,1);l.splice(Math.max(0,Math.min(l.length,k+delta)),0,c);return l;});
 announce(`Moved '${tileTitle(id)}' to position ${j+1} of ${list.length}`);
}
function resizeTile(id,size){
 S.focusAfter={id,selector:document.activeElement?.dataset?.focusKey};
 commit('resized tile',l=>{const k=idx(l,id);if(l[k].size===size)return null;l[k].size=size;return l;});
 announce(`'${tileTitle(id)}' is now ${size} width`);
}
function removeTile(id){
 const at=S.page.components.findIndex(c=>c.id===id);if(at<0)return;
 const env=envelope(S.page.components[at]);
 if(S.editing?.id===id)S.editing=null;
 commit('removed tile',l=>{l.splice(idx(l,id),1);return l;});
 toast(`Removed “${env.title}”.`,[['Undo',()=>{
  commit('restored tile',l=>{if(l.length>=LIMIT_TILES)throw new Stale(`This page already has ${LIMIT_TILES} tiles.`);const e=clone(env);if(l.some(c=>c.id===e.id))e.id=newId();l.splice(Math.min(at,l.length),0,e);S.pulse.add(e.id);return l;});
 }]],UNDO_MS);
}
function duplicateTile(id){
 commit('duplicated tile',l=>{if(l.length>=LIMIT_TILES)throw new Stale(`A page holds at most ${LIMIT_TILES} tiles.`);const k=idx(l,id);let e=clone(l[k]);e=Inputs().renameKeys(e,Inputs().collectInputs(l).fields.keys());e.id=newId();e.title=(e.title+' (copy)').slice(0,80);l.splice(k+1,0,e);S.pulse.add(e.id);return l;});
}
async function addTile(env){
 if(S.page.components.length>=LIMIT_TILES){toast(`A page holds at most ${LIMIT_TILES} tiles. Remove one first.`);return;}
 S.picker=false;S.pulse.add(env.id);
 const ok=await commit(`added '${env.title}'`,l=>{if(l.length>=LIMIT_TILES)throw new Stale(`A page holds at most ${LIMIT_TILES} tiles.`);l.push(env);return l;});
 if(ok){startEdit(env.id,true);}
}
function modelTile(m){return {id:newId(),kind:'model',title:m.label||m.name,size:m.defaultSize||'half',spec:{model:m.name,params:clone(m.defaults||{})}};}
function uniqueKey(stem){const taken=Inputs().collectInputs(S.page.components).fields;let n=1,k=stem;while([...taken.keys()].some(x=>x.toLowerCase()===k.toLowerCase()))k=stem+(++n);return k;}
const VEGA_EXAMPLE={kind:'vega',title:'Ways to roll each total',size:'half',spec:{definition:{$schema:'https://vega.github.io/schema/vega-lite/v6.json',data:{values:[2,3,4,5,6,7,8,9,10,11,12].map(t=>({total:t,ways:6-Math.abs(t-7)}))},mark:'bar',encoding:{x:{field:'total',type:'ordinal',title:'Dice total',axis:{labelAngle:0}},y:{field:'ways',type:'quantitative',title:'Ways out of 36'}}}},source:{label:'Entered by me'}};
const DATA_EXAMPLES={
 chart:{kind:'chart',title:'My chart',size:'half',spec:{type:'bar',x:['Wood','Brick','Sheep','Wheat','Ore'],series:[{name:'Cards collected',values:[4,2,5,6,1]}],xLabel:'Resource',yLabel:'Cards',unit:'cards'},source:{label:'Entered by me'}},
 stat:{kind:'stat',title:'My numbers',size:'third',spec:{items:[{label:'Victory points',value:7,unit:'VP'},{label:'Cards in hand',value:5,unit:'cards'}]},source:{label:'Entered by me'}},
 table:{kind:'table',title:'My table',size:'half',spec:{columns:['Player','VP','Cards'],rows:[['Red',7,5],['Blue',6,3]]},source:{label:'Entered by me'}},
 vega:VEGA_EXAMPLE,
};

// ---------- editor ----------
function startEdit(id,isNew=false){
 const c=S.page.components.find(x=>x.id===id);if(!c)return;
 if(S.editing&&S.editing.id!==id){toast('Finish or cancel the open edit first.');focusTile(S.editing.id);return;}
 closeMenu();
 const draft=envelope(c);
 if(draft.kind==='model'){const m=catalogEntry(draft.spec.model);if(m)draft.spec.params=Inputs().fillDefaults(m,draft.spec.params||{});}
 S.editing={id,isNew,draft,baseUpdatedAt:c.updatedAt,conflict:false,error:'',remoteChanged:false,json:null};
 S.arrange=false;render();
 const f=document.querySelector(`[data-id="${CSS.escape(id)}"] input, [data-id="${CSS.escape(id)}"] textarea`);f?.focus();
}
function cancelEdit(){const id=S.editing?.id;S.editing=null;flushStale();render();if(id)focusTile(id);}
async function saveEdit(){
 const ed=S.editing;if(!ed)return;
 const draft=clone(ed.draft);
 draft.title=(draft.title||'').trim();
 if(!draft.title){ed.error='Title is required.';updateEditorNotice();return;}
 if(draft.caption!==undefined)draft.caption=draft.caption.replace(/\s*\n+\s*/g,' ').trim();
 if(draft.kind==='model'){const r=computeLocal(draft);if(r?.errors){ed.error=r.errors.join(' ');updateEditorNotice();return;}}
 if(ed.jsonError){ed.error=ed.jsonError;updateEditorNotice();return;}
 const force=ed.conflict;
 const saving=document.querySelector('.dash-editor [data-save]');if(saving){saving.disabled=true;saving.textContent='Saving…';}
 const ok=await commit(`edited '${draft.title}'`,l=>{
  const k=idx(l,ed.id);
  const cur=S.server.components.find(c=>c.id===ed.id);
  if(!force&&cur&&cur.updatedAt!==ed.baseUpdatedAt)throw new Stale('conflict');
  l[k]=envelope(draft);return l;
 },{optimistic:false,
  onStale:e=>{
   if(!S.editing)return;
   const cur=S.server.components.find(c=>c.id===ed.id);
   if(!cur){S.editing.error='This tile was removed elsewhere. Your edit was not saved. Cancel to close, or copy your changes first.';}
   else{S.editing.conflict=true;S.editing.baseUpdatedAt=cur.updatedAt;S.editing.error='This tile changed elsewhere. Your edit was not saved.';}
   updateEditorNotice(true);
  },
  onError:e=>{if(!S.editing)return;S.editing.error=e.network?'Could not reach the server. Your edit is still here; try Save again.':e.message;updateEditorNotice();}});
 if(ok){const id=ed.id;S.editing=null;S.stale=false;S.page=S.server;S.pulse.add(id);render();focusTile(id);}
}
function updateEditorNotice(showReapply){
 const box=document.querySelector('.dash-editor .dash-editor-notice');
 const save=document.querySelector('.dash-editor [data-save]');
 if(save){save.disabled=false;save.textContent=S.editing?.conflict?'Reapply my edit':'Save';}
 if(!box||!S.editing)return;
 box.textContent='';
 const msgs=[];
 if(S.editing.error)msgs.push(S.editing.error);
 else if(S.editing.remoteChanged)msgs.push('This tile changed elsewhere while you were editing. Saving will ask before overwriting.');
 else if(S.stale)msgs.push('This page changed elsewhere. Other updates appear when you close this edit.');
 box.hidden=!msgs.length;box.textContent=msgs.join(' ');
 if(S.editing.conflict&&showReapply)box.append(' ',btn('Keep agent version',()=>cancelEdit(),{class:'dash-btn dash-link'}));
}

const linkChip=(key,unlink)=>h('span',{class:'dash-link-chip',title:`Reads the page input “${key}”`},'↔ '+key,unlink?btn('Unlink',unlink,{class:'dash-btn dash-link','aria-label':`Stop reading input ${key}; use its current value`}):null);
function paramField(p,params,onChange){
 const id='p-'+p.key+'-'+Math.random().toString(36).slice(2,7);
 const help=p.description?h('small',{class:'dash-help',text:p.description}):null;
 const val=params[p.key];
 const set=v=>{params[p.key]=v;onChange();};
 const I=Inputs(),current=k=>liveValues()[k];
 if(I.isRef(val))return h('div',{class:'dash-field'},h('span',{class:'dash-label',text:p.label}),linkChip(val.input,()=>{set(current(val.input));rerenderEditor();}),help);
 const num=(value,min,max,labelText,apply,extra={})=>h('input',{type:'number',inputmode:'numeric',min,max,step:p.integer===false?'any':1,value:value??'','aria-label':labelText,oninput:e=>apply(e.target.value===''?null:Number(e.target.value)),...extra});
 if(p.type==='boolean')return h('div',{class:'dash-field'},h('label',{class:'dash-check'},h('input',{type:'checkbox',checked:!!val,onchange:e=>set(e.target.checked)}),p.label),help);
 if(p.type==='select'||(p.type==='number'&&p.optionLabels)){
  const opts=p.type==='select'?p.options.map((o,i)=>[o,p.optionLabels?.[i]||OPTION_TEXT[o]||o]):p.optionLabels.map((l,i)=>[i,l]);
  const sel=h('select',{id,onchange:e=>set(p.type==='select'?e.target.value:Number(e.target.value))},opts.map(([v,l])=>h('option',{value:v,selected:String(v)===String(val),text:l})));
  return h('div',{class:'dash-field'},h('label',{for:id,text:p.optionLabels&&p.type==='number'?p.label.replace(/\s*\(.*\)$/,''):p.label}),sel,help);
 }
 if(p.type==='number')return h('div',{class:'dash-field'},h('label',{for:id,text:p.label}),h('div',{class:'dash-inline'},num(val,p.min,p.max,p.label,set,{id}),h('small',{class:'dash-help',text:`${p.min}–${p.max}`})),help);
 if(p.type==='numbers'&&!p.length){
  // A set of distinct numbers in a range (e.g. dice numbers): toggle chips.
  const chosen=new Set(Array.isArray(val)?val:[]);
  const wrap=h('div',{class:'dash-chips',role:'group','aria-label':p.label});
  const draw=()=>{wrap.textContent='';for(let n=p.min;n<=p.max;n++){const on=chosen.has(n);wrap.append(h('button',{type:'button',class:'dash-chip','aria-pressed':on?'true':'false',disabled:!on&&p.maxLength&&chosen.size>=p.maxLength,onclick:()=>{on?chosen.delete(n):chosen.add(n);set([...chosen].sort((a,b)=>a-b));draw();wrap.querySelector(`[data-n="${n}"]`)?.focus();},'data-n':n},String(n)));}};
  draw();
  return h('div',{class:'dash-field dash-field-wide'},h('span',{class:'dash-label',text:p.label+(p.maxLength?` (up to ${p.maxLength})`:'')}),wrap,help);
 }
 if(p.type==='numbers'){
  const arr=Array.isArray(val)?val.slice():Array(p.length).fill(0);
  return h('fieldset',{class:'dash-field dash-field-wide'},h('legend',{text:p.label}),
   h('div',{class:'dash-grid-inputs'},arr.map((v,i)=>{const lbl=p.itemLabels?.[i]||`#${i+1}`,max=p.itemMax?.[i]??p.max;return h('label',{class:'dash-mini-field'},h('span',{text:lbl}),I.isRef(v)?linkChip(v.input):num(v,p.min,max,`${p.label}: ${lbl} (${p.min}–${max})`,x=>{arr[i]=x;set(arr.slice());}));})),help);
 }
 if(p.type==='booleans'){
  const arr=Array.isArray(val)?val.slice():Array(p.length).fill(false);
  return h('fieldset',{class:'dash-field dash-field-wide'},h('legend',{text:p.label}),
   h('div',{class:'dash-grid-inputs'},arr.map((v,i)=>I.isRef(v)?h('span',{class:'dash-check'},(p.itemLabels?.[i]||`#${i+1}`)+' ',linkChip(v.input)):h('label',{class:'dash-check'},h('input',{type:'checkbox',checked:!!v,onchange:e=>{arr[i]=e.target.checked;set(arr.slice());}}),p.itemLabels?.[i]||`#${i+1}`))),help);
 }
 return h('p',{class:'dash-muted',text:`${p.label}: unsupported field type.`});
}

function editorTile(c){
 const ed=S.editing,d=ed.draft;
 const form=h('form',{class:'dash-editor','aria-label':'Edit '+(c.title||'tile'),onsubmit:e=>{e.preventDefault();saveEdit();},onkeydown:e=>{if(e.key==='Escape'){e.preventDefault();cancelEdit();}}});
 const size=h('div',{class:'dash-seg',role:'radiogroup','aria-label':'Tile width'},SIZES.map(([v,l])=>h('label',{class:'dash-seg-item'},h('input',{type:'radio',name:'size-'+c.id,value:v,checked:(d.size||'half')===v,onchange:()=>{d.size=v;}}),h('span',{text:l}))));
 form.append(
  h('div',{class:'dash-editor-head'},h('h2',{text:ed.isNew?'New tile':'Edit tile'}),h('span',{class:'dash-muted',text:d.kind==='model'?'Model · '+(catalogEntry(d.spec.model)?.label||d.spec.model):d.kind==='note'?'Text note':d.kind==='input'?'Input fields':d.kind==='vega'?'Vega-Lite chart':'Data · '+d.kind})),
  h('div',{class:'dash-field'},h('label',{for:'ed-title',text:'Title'}),h('input',{id:'ed-title',maxlength:80,required:true,value:d.title||'',oninput:e=>{d.title=e.target.value;}})),
  h('div',{class:'dash-field'},h('label',{for:'ed-caption',text:'Caption (optional)'}),h('input',{id:'ed-caption',maxlength:280,value:d.caption||'',oninput:e=>{d.caption=e.target.value;}})),
  h('div',{class:'dash-field'},h('span',{class:'dash-label',text:'Width'}),size),
 );
 if(d.kind==='model'){
  const m=catalogEntry(d.spec.model);
  const preview=h('div',{class:'dash-editor-preview'}),take=h('p',{class:'dash-takeaway'}),errs=h('p',{class:'dash-error',role:'alert',hidden:true});
  let t;
  const refresh=()=>{clearTimeout(t);t=setTimeout(()=>{
   const r=computeLocal(d);
   if(!r){take.textContent='Preview appears after you save.';return;}
   if(r.errors){errs.hidden=false;errs.textContent=r.errors.join(' ');return;}
   errs.hidden=true;take.textContent=r.computed.takeaway||'';preview.textContent='';const v=h('div');preview.append(v);Charts.render(v,r.computed.view,'third');
  },120);};
  const fields=h('div',{class:'dash-params'});
  if(m)m.params.forEach(p=>fields.append(paramField(p,d.spec.params,refresh)));
  else fields.append(h('p',{class:'dash-muted',text:'Model settings are loading.'}));
  if(m?.description)form.append(h('p',{class:'dash-muted',text:m.description}));
  if(hasRefs(d))form.append(h('p',{class:'dash-help',text:'↔ settings read live values from this page’s input tiles. Change them there, or Unlink to type a fixed value.'}));
  form.append(fields,errs,h('div',{class:'dash-preview-box'},h('span',{class:'dash-label',text:'Preview'}),take,preview));
  requestAnimationFrame(refresh);
 }else if(d.kind==='note'){
  form.append(h('div',{class:'dash-field dash-field-wide'},h('label',{for:'ed-note',text:'Note text (blank line starts a paragraph)'}),h('textarea',{id:'ed-note',rows:6,maxlength:2000,oninput:e=>{d.spec={text:e.target.value};}},d.spec?.text||'')));
 }else{
  const needsSource=d.kind!=='input';
  const src=d.source||{label:''};if(needsSource)d.source=src;
  const err=h('p',{class:'dash-error',role:'alert',hidden:true});
  const area=h('textarea',{id:'ed-json',class:'dash-code',rows:d.kind==='vega'?16:10,spellcheck:'false',oninput:e=>{try{d.spec=JSON.parse(e.target.value);ed.jsonError='';err.hidden=true;}catch(x){ed.jsonError='The data is not valid JSON: '+x.message;err.hidden=false;err.textContent=ed.jsonError;}}},JSON.stringify(d.spec,null,1));
  if(needsSource)form.append(h('div',{class:'dash-field'},h('label',{for:'ed-src',text:'Source (shown on the tile)'}),h('input',{id:'ed-src',maxlength:120,required:true,value:src.label||'',oninput:e=>{src.label=e.target.value;}})));
  form.append(h('details',{class:'dash-advanced',open:ed.isNew||d.kind==='input'},h('summary',{text:d.kind==='input'?'Fields as JSON':'Advanced: edit data as JSON'}),
    h('p',{class:'dash-muted',text:d.kind==='input'?'Each field: key, label, type (number, text, select, toggle), value; numbers may have min, max, step, unit. Change values on the tile itself.':d.kind==='vega'?'Inline Vega-Lite JSON: {"definition": {…}}. Params named like an input key follow that input. No URLs or images.':'Agents normally supply this data. The server checks it and explains any problem.'}),
    h('label',{for:'ed-json',class:'dash-label',text:`${d.kind} spec`}),area,err,
    h('div',{class:'dash-row'},h('span',{class:'dash-muted',text:'Insert example:'}),Object.keys(DATA_EXAMPLES).map(k=>btn(k,()=>{d.kind=k;d.spec=clone(DATA_EXAMPLES[k].spec);area.value=JSON.stringify(d.spec,null,1);ed.jsonError='';err.hidden=true;},{class:'dash-btn dash-quiet'})))));
 }
 form.append(h('p',{class:'dash-editor-notice',role:'alert',hidden:true}),
  h('div',{class:'dash-row dash-end'},btn('Cancel',cancelEdit),h('button',{type:'submit',class:'dash-btn dash-primary','data-save':''},ed.conflict?'Reapply my edit':'Save')));
 const art=h('article',{class:`dash-tile dash-size-${d.size||c.size||'half'} is-editing`,'data-id':c.id},form);
 requestAnimationFrame(()=>updateEditorNotice(ed.conflict));
 return art;
}

// ---------- rendering ----------
function render(){
 closeMenu();
 S.keepInput=captureInputFocus();
 IN.quiet=true;try{renderInner();}finally{IN.quiet=false;}
}
function renderInner(){
 // Keep keyboard focus on the same control across re-renders.
 const a=document.activeElement;
 if(!S.focusAfter&&a&&main.contains(a)){const t=a.closest('[data-id]');if(t&&!S.editing)S.focusAfter={id:t.dataset.id,selector:a.dataset.focusKey||null,keep:true};}
 renderSide();
 main.textContent='';
 if(S.mode==='loading'){main.append(h('p',{class:'dash-loading',text:'Loading your dashboard…'}));return;}
 if(S.mode==='error'){main.append(h('section',{class:'dash-empty'},h('h1',{text:'The dashboard could not load'}),h('p',{text:S.loadError||'Please try again.'}),btn('Try again',()=>{S.mode='loading';render();init();},{class:'dash-btn dash-primary'})));return;}
 main.append(header());
 if(S.banner)main.append(bannerEl());
 if(S.mode==='connect'){main.append(connectPanel());return;}
 if(S.mode==='empty'){main.append(emptyState());return;}
 if(S.mode==='missing'){main.append(h('section',{class:'dash-empty'},h('h1',{text:'Page not found'}),h('p',{text:'This page does not exist, was archived, or belongs to another account.'}),S.pages[0]?btn('Open '+S.pages[0].title,()=>openPage(S.pages[0].id,{replace:true}),{class:'dash-btn dash-primary'}):btn('Create page',()=>{S.creating=true;render();},{class:'dash-btn dash-primary'})));return;}
 if(S.picker)main.append(picker());
 main.append(grid());
 afterRender();
}
function afterRender(){
 drawHosts(main);
 if(Object.keys(IN.pending).length)applyLive();
 const live=new Set((S.page?.components||[]).filter(c=>c.kind==='vega').map(c=>c.id));Vega()?.prune(live);
 if(S.keepInput){const k=S.keepInput;S.keepInput=null;restoreInputFocus(k);}
 if(S.pulse.size){const ids=[...S.pulse];S.pulse.clear();ids.forEach(id=>{const t=main.querySelector(`[data-id="${CSS.escape(id)}"]`);if(t){t.classList.remove('dash-pulse');void t.offsetWidth;t.classList.add('dash-pulse');setTimeout(()=>t.classList.remove('dash-pulse'),2100);}});}
 if(S.flipFrom){const f=S.flipFrom;S.flipFrom=null;flip(f);}
 if(S.focusAfter){const f=S.focusAfter;S.focusAfter=null;const t=main.querySelector(`[data-id="${CSS.escape(f.id)}"]`);if(t){if(f.scroll)t.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'nearest'});else{const target=(f.selector&&t.querySelector(`[data-focus-key="${f.selector}"]:not([disabled])`))||(f.selector&&t.querySelector('[data-focus-key]:not([disabled])'))||t;target.focus({preventScroll:Boolean(f.keep)});}}}
}
function drawHosts(scope){
 scope.querySelectorAll('[data-view-host]').forEach(host=>{const c=host._comp,i=Number(host.dataset.viewHost);const view=i===0?viewOf(c):c.computed?.extraViews?.[i-1];Charts.render(host,view,c.size);});
 scope.querySelectorAll('[data-vega-host]').forEach(host=>{const c=host._comp;Vega().mount(host,c,liveValues()).catch(e=>{const p=h('p',{class:'dash-error',text:e.message||'Chart could not be drawn.'});host.replaceChildren(p);});});
}
function focusTile(id){requestAnimationFrame(()=>main.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus());}
function viewOf(c){
 if(c.kind==='model')return c.computed?.view||null;
 return {kind:c.kind,spec:c.spec};
}

function renderSide(){
 side.textContent='';
 const full=S.pages.length>=LIMIT_PAGES;
 side.append(h('div',{class:'dash-side-head'},h('h2',{text:'Pages'}),btn('+',()=>{S.creating=!S.creating;render();if(S.creating)focusNewPage();},{class:'dash-btn dash-icon','aria-label':'New page',title:full?'Page limit reached':'New page',disabled:full})));
 if(S.creating)side.append(newPageForm());
 if(full)side.append(h('p',{class:'dash-help',text:`${LIMIT_PAGES} pages is the limit. Archive one to add another.`}));
 const list=h('ul',{class:'dash-page-list'});
 S.pages.forEach(p=>{const cur=S.mode==='page'&&S.page?.id===p.id;list.append(h('li',null,h('a',{href:'/dashboard/'+p.id,class:'dash-page-link','aria-current':cur?'page':null,onclick:e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();if(!cur||S.mode!=='page')openPage(p.id);}},p.title)));});
 if(!S.pages.length&&S.mode!=='loading')list.append(h('li',{class:'dash-help',text:'No pages yet.'}));
 side.append(list,agentBlock());
}
function agentBlock(){
 const box=h('section',{class:'dash-agent-block','aria-label':'Connected agents'},h('h2',{text:'Agents'}));
 if(S.connections===null)box.append(h('p',{class:'dash-help',text:S.connectionsError||'Checking…'}));
 else if(!S.connections.length)box.append(h('p',{class:'dash-help',text:'No agent connected.'}));
 else S.connections.forEach(c=>box.append(h('p',{class:'dash-agent'},h('span',{class:'dash-dot','aria-hidden':'true'}),h('span',{text:connName(c)}),h('small',{class:'dash-help',text:' · connected '+ago(c.granted_at)}))));
 box.append(h('a',{href:'#connect',class:'dash-btn dash-quiet dash-block',onclick:e=>{e.preventDefault();showConnect();}},S.connections?.length?'Manage agents':'Connect agent…'));
 return box;
}
const connName=c=>c?.client?.name||c?.client?.client_name||c?.client?.id||'Unnamed client';
function focusNewPage(){[...document.querySelectorAll('.dash-new-page input')].find(i=>i.offsetParent)?.focus();}
function newPageForm(){
 const input=h('input',{maxlength:80,placeholder:'Page name','aria-label':'New page name',required:true,onkeydown:e=>{if(e.key==='Escape'){S.creating=false;render();}}});
 return h('form',{class:'dash-new-page',onsubmit:e=>{e.preventDefault();const t=input.value.trim();if(t)createPage(t);}},input,h('button',{type:'submit',class:'dash-btn dash-primary'},'Create'),btn('Cancel',()=>{S.creating=false;render();}));
}

function header(){
 const head=h('header',{class:'dash-head'});
 // mobile page switcher
 const sel=h('select',{class:'dash-mobile-pages','aria-label':'Page',onchange:e=>{const v=e.target.value;if(v==='__new'){S.creating=true;render();focusNewPage();}else if(v==='__connect')showConnect();else openPage(v);}},
  S.mode!=='page'?h('option',{value:'',selected:true,text:S.mode==='connect'?'Connect agent':'Choose a page'}):null,
  S.pages.map(p=>h('option',{value:p.id,selected:S.mode==='page'&&S.page?.id===p.id,text:p.title})),
  h('option',{value:'__new',disabled:S.pages.length>=LIMIT_PAGES,text:'+ New page'}),h('option',{value:'__connect',text:'Connect agent…'}));
 head.append(h('div',{class:'dash-mobile-row'},sel));
 if(S.creating)head.append(h('div',{class:'dash-mobile-only'},newPageForm()));
 const titleRow=h('div',{class:'dash-title-row'});
 if(S.mode==='page'&&S.page){
  if(S.renaming){
   let done=false;
   const input=h('input',{class:'dash-title-input',value:S.page.title,maxlength:80,'aria-label':'Page name',
    onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();done=true;renamePage(input.value);}else if(e.key==='Escape'){done=true;S.renaming=false;flushStale();render();}},
    onblur:()=>{if(!done){done=true;renamePage(input.value);}}});
   titleRow.append(input);requestAnimationFrame(()=>{input.focus();input.select();});
  }else titleRow.append(h('h1',{class:'dash-title',text:S.page.title}),btn('✎',()=>{if(S.editing){toast('Finish or cancel the open edit first.');return;}S.renaming=true;render();},{class:'dash-btn dash-icon','aria-label':'Rename page',title:'Rename page'}));
 }else if(S.mode==='connect')titleRow.append(h('h1',{class:'dash-title',text:'Connect an agent'}));
 else titleRow.append(h('h1',{class:'dash-title',text:'Your workspace'}));
 titleRow.append(statusEl);
 head.append(titleRow);
 if(S.mode==='page'&&S.page){
  const n=S.page.components.length,fullTiles=n>=LIMIT_TILES;
  const tools=h('div',{class:'dash-tools',role:'toolbar','aria-label':'Page tools'},
   h('label',{class:'dash-check dash-follow'},h('input',{type:'checkbox',checked:S.follow,onchange:e=>{S.follow=e.target.checked;localStorage.setItem('catan-dash-follow',S.follow?'on':'off');announce(S.follow?'Following your agent':'Not following your agent');}}),'Follow agent'),
   btn('Arrange',()=>{if(S.editing){toast('Finish or cancel the open edit first.');return;}S.arrange=!S.arrange;render();},{'aria-pressed':S.arrange?'true':'false',class:'dash-btn'+(S.arrange?' is-on':'')}),
   btn('+ Add tile',()=>{S.picker=!S.picker;render();main.querySelector('.dash-picker button')?.focus();},{class:'dash-btn dash-primary',disabled:fullTiles,'aria-expanded':S.picker?'true':'false',title:fullTiles?`A page holds at most ${LIMIT_TILES} tiles`:null}),
   (()=>{const b=btn('⋯',e=>openMenu(b,[['Rename',()=>{S.renaming=true;render();}],['Duplicate page',duplicatePage,{disabled:S.pages.length>=LIMIT_PAGES}],['Archive page…',archivePage]]),{class:'dash-btn dash-icon','aria-label':'Page actions','aria-haspopup':'menu','aria-expanded':'false'});return b;})(),
   h('span',{class:'dash-help dash-count',text:`${n}/${LIMIT_TILES} tiles${fullTiles?' · limit reached':''}`}));
  head.append(tools);
 }
 return head;
}
function bannerEl(){
 const b=S.banner,title=S.pages.find(p=>p.id===b.pageId)?.title||'a page';
 return h('div',{class:'dash-banner',role:'status'},h('span',{text:`Your agent opened “${title}”.`}),
  btn('Go',async()=>{const x=S.banner;S.banner=null;if(S.editing&&!(await confirmDialog({title:'Discard your edit?',body:'Going to the agent’s page discards your open tile edit.',confirm:'Discard and go',danger:true}))){S.banner=x;return;}S.editing=null;if(x.pageId===S.page?.id&&S.mode==='page'){S.pulse.add(x.componentId);S.focusAfter={id:x.componentId,scroll:true};render();}else openPage(x.pageId,{highlight:x.componentId,record:false});},{class:'dash-btn dash-primary'}),
  btn('Dismiss',()=>{S.banner=null;render();},{class:'dash-btn dash-quiet'}));
}
function emptyState(){
 const full=S.pages.length>=LIMIT_PAGES;
 return h('section',{class:'dash-empty'},
  h('h1',{text:'Your dashboard is empty'}),
  h('p',{text:'Build personal pages of Catan charts, notes, and information shared by your connected agents. For built-in move planning and rules, use Analyze.'}),
  h('div',{class:'dash-row'},
   btn('Start with examples',()=>createPage('Starter: my odds',starterComponents()),{class:'dash-btn dash-primary',disabled:full}),
   btn('Live hand tracker',()=>createExample('live_hand'),{disabled:full}),
   btn('Create page',()=>{S.creating=true;render();focusNewPage();},{disabled:full}),
   btn('Connect agent…',showConnect,{class:'dash-btn dash-quiet'})),
  full?h('p',{class:'dash-help',text:`${LIMIT_PAGES} pages is the limit.`}):null);
}
function picker(){
 const items=S.catalog.map(m=>h('li',null,h('button',{type:'button',class:'dash-pick',onclick:()=>addTile(modelTile(m))},h('strong',{text:m.label||m.name}),h('span',{text:m.description||''}))));
 items.push(h('li',null,h('button',{type:'button',class:'dash-pick',onclick:()=>addTile({id:newId(),kind:'note',title:'Note',size:'half',spec:{text:'Write your note here.'}})},h('strong',{text:'Text note'}),h('span',{text:'Plain text for plans or reminders.'}))));
 items.unshift(
  h('li',null,h('button',{type:'button',class:'dash-pick',onclick:()=>addTile({id:newId(),kind:'input',title:'Inputs',size:'third',spec:{fields:[{key:uniqueKey('count'),label:'Count',type:'number',value:0,min:0,max:99,step:1,integer:true}]}})},h('strong',{text:'Inputs'}),h('span',{text:'Counters, choices and switches you change during a game. Models and charts can read them.'}))),
  h('li',null,h('button',{type:'button',class:'dash-pick',onclick:()=>addTile({...clone(VEGA_EXAMPLE),id:newId()})},h('strong',{text:'Custom graph (Vega-Lite)'}),h('span',{text:'Any line, bar, area, scatter, heatmap or histogram from inline data. Usually made by your agent.'}))));
 items.push(h('li',null,h('button',{type:'button',class:'dash-pick',onclick:()=>addTile({...clone(DATA_EXAMPLES.table),id:newId()})},h('strong',{text:'Your own data (advanced)'}),h('span',{text:'A table, chart or stats you enter as JSON. Labelled with its source.'}))));
 items.push(h('li',{class:'dash-pick-examples'},h('span',{class:'dash-help',text:'Example pages:'}),btn('Live hand tracker',()=>createExample('live_hand'),{class:'dash-btn dash-quiet',disabled:S.pages.length>=LIMIT_PAGES}),btn('Custom graph controls',()=>createExample('custom_graph'),{class:'dash-btn dash-quiet',disabled:S.pages.length>=LIMIT_PAGES})));
 if(!S.catalog.length)items.unshift(h('li',{class:'dash-help',text:'Loading the model catalog…'}));
 return h('section',{class:'dash-picker','aria-label':'Add a tile'},h('div',{class:'dash-row dash-between'},h('h2',{text:'Add a tile'}),btn('Close',()=>{S.picker=false;render();},{class:'dash-btn dash-quiet'})),h('ul',null,items));
}
function grid(){
 const g=h('div',{class:'dash-grid'+(S.arrange?' is-arranging':''),onkeydown:gridKeys});
 const list=S.page.components;
 if(!list.length){
  g.append(h('div',{class:'dash-grid-empty'},h('p',{text:'This page has no tiles yet.'}),h('div',{class:'dash-row'},btn('+ Add tile',()=>{S.picker=true;render();},{class:'dash-btn dash-primary'}),btn('Connect agent…',showConnect,{class:'dash-btn dash-quiet'})),h('p',{class:'dash-help',text:'Or ask your agent: “Show my dice odds for 6, 8 and 9 on my Catan dashboard.”'})));
  return g;
 }
 list.forEach((c,i)=>g.append(S.editing?.id===c.id?editorTile(c):tile(c,i,list.length)));
 return g;
}
function tile(c,i,n){
 const size=SIZES.some(s=>s[0]===c.size)?c.size:'half';
 const titleId='t-'+c.id;
 const art=h('article',{class:`dash-tile dash-size-${size}`+(c.invalid?' is-invalid':''),'data-id':c.id,tabindex:S.arrange?0:-1,'aria-labelledby':titleId});
 const menuBtn=btn('⋯',()=>openMenu(menuBtn,[
  !c.invalid?['Edit',()=>startEdit(c.id)]:null,
  ['View data',()=>{const d=art.querySelector('details.dash-data');if(d){d.open=true;d.querySelector('summary').focus();}}],
  !c.invalid?['Duplicate',()=>duplicateTile(c.id),{disabled:n>=LIMIT_TILES}]:null,
  i>0?['Move earlier',()=>moveTile(c.id,-1)]:null,
  i<n-1?['Move later',()=>moveTile(c.id,1)]:null,
  ['Remove',()=>removeTile(c.id)],
 ]),{class:'dash-btn dash-icon dash-tile-menu','aria-label':`Actions for ${c.title}`,'aria-haspopup':'menu','aria-expanded':'false'});
 const agentData=isAgentData(c);
 art.append(h('div',{class:'dash-tile-head'},h('h2',{id:titleId,class:'dash-tile-title',title:c.title,text:c.title}),agentData?h('span',{class:'dash-chip-tag',title:'The app did not compute these numbers',text:c.createdBy==='agent'?'Agent data':'Your data'}):null,menuBtn));
 const takeaway=c.kind==='model'?c.computed?.takeaway:(c.kind!=='note'?c.caption:null);
 if(takeaway)art.append(h('p',{class:'dash-takeaway',text:takeaway}));
 if(c.kind==='model'&&!c.computed)art.append(c.error?h('p',{class:'dash-error',role:'status',text:'Cannot compute: '+c.error}):h('p',{class:'dash-muted',text:'Computing…'}));
 else if(c.kind==='input')art.append(inputBody(c));
 else if(c.kind==='vega'){const host=h('div',{class:'dash-vega dash-vega-'+size,'data-vega-host':''});host._comp=c;art.append(host);}
 else{
  const host=h('div',{'data-view-host':0});host._comp=c;art.append(host);
  (c.computed?.extraViews||[]).forEach((v,k)=>{const x=h('div',{'data-view-host':k+1,class:'dash-extra'});x._comp=c;art.append(x);});
 }
 if(c.kind==='model'&&c.caption||c.kind==='note'&&c.caption)art.append(captionEl(c.caption));
 art.append(provenance(c));
 const dt=c.kind==='vega'?vegaTable(c):c.kind==='input'?null:Charts.dataTable(viewOf(c));
 if(dt||c.source?.detail||c.source?.asOf){
  const d=h('details',{class:'dash-data',open:S.openData.has(c.id),ontoggle:e=>{e.target.open?S.openData.add(c.id):S.openData.delete(c.id);}},h('summary',{text:'View data'}));
  if(c.source?.detail)d.append(h('p',{class:'dash-help',text:'Detail: '+c.source.detail}));
  if(c.source?.asOf)d.append(h('p',{class:'dash-help',text:'As of '+c.source.asOf}));
  if(dt)d.append(dt);
  art.append(d);
 }
 if(S.arrange)art.append(h('div',{class:'dash-arrange',role:'group','aria-label':'Arrange '+c.title},
  btn('◀ Earlier',()=>moveTile(c.id,-1),{disabled:i===0,'data-focus-key':'earlier'}),
  btn('Later ▶',()=>moveTile(c.id,1),{disabled:i===n-1,'data-focus-key':'later'}),
  h('div',{class:'dash-seg',role:'group','aria-label':'Width'},SIZES.map(([v,l])=>btn(l,()=>resizeTile(c.id,v),{class:'dash-btn dash-seg-btn'+(size===v?' is-on':''),'aria-pressed':size===v?'true':'false','data-focus-key':'size-'+v}))),
  btn('✕ Remove',()=>removeTile(c.id),{class:'dash-btn dash-quiet'})));
 return art;
}
function captionEl(text){
 const p=h('p',{class:'dash-caption dash-clamp',text});
 const wrap=h('div',null,p);
 if(text.length>140){const more=btn('More',()=>{const open=p.classList.toggle('dash-clamp');more.textContent=open?'More':'Less';more.setAttribute('aria-expanded',open?'false':'true');},{class:'dash-btn dash-link dash-more','aria-expanded':'false'});wrap.append(more);}
 return wrap;
}
function provenance(c){
 const f=h('footer',{class:'dash-prov'});
 const by=c.createdBy==='agent'?'agent':'you',when=c.updatedAt?' '+clock(c.updatedAt):'';
 if(c.invalid){f.append(h('span',{text:'⚠ This tile has invalid stored data. Remove it or ask your agent to replace it.'}));return f;}
 if(c.kind==='model'){
  f.append(h('span',{text:`▪ Model · ${c.computed?.method||'Catan math'} · added by ${by}`}));
  const a=c.computed?.assumptions||[];
  if(a.length)f.append(h('details',{class:'dash-assume'},h('summary',{'aria-label':'Assumptions',text:'ⓘ'}),h('ul',null,a.map(x=>h('li',{text:x})))));
 }else if(c.kind==='input'){
  const used=[...new Set(c.spec.fields.flatMap(f=>Inputs().dependents(S.page.components,f.key).map(d=>d.title)))];
  f.append(h('span',{text:`Inputs · saved on this page${when?' at'+when:''}${used.length?' · drives '+used.join(', '):''}`}));
 }else if(isAgentData(c)){
  f.append(h('span',{text:`◌ ${c.createdBy==='agent'?'Agent data':'Your data'} · ${c.source?.label||'no source given'} · added by ${by}${when}`}));
 }else f.append(h('span',{text:`Note · by ${by}${when}`}));
 return f;
}
function gridKeys(e){
 if(!S.arrange||!e.altKey)return;
 const t=e.target.closest('[data-id]');if(!t)return;
 const id=t.dataset.id;
 const map={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
 if(map[e.key]){e.preventDefault();moveTile(id,map[e.key]);}
 else if(['1','2','3'].includes(e.key)||['Digit1','Digit2','Digit3'].includes(e.code)){e.preventDefault();resizeTile(id,SIZES[Number((e.code||'').slice(-1)||e.key)-1][0]);}
}
function snapshot(){const m=new Map();main.querySelectorAll('.dash-tile[data-id]').forEach(t=>m.set(t.dataset.id,t.getBoundingClientRect()));return m;}
function flip(before){
 if(reducedMotion)return;
 main.querySelectorAll('.dash-tile[data-id]').forEach(t=>{const a=before.get(t.dataset.id);if(!a)return;const b=t.getBoundingClientRect(),dx=a.left-b.left,dy=a.top-b.top;if(!dx&&!dy)return;
  t.style.transform=`translate(${dx}px,${dy}px)`;t.style.transition='none';requestAnimationFrame(()=>{t.style.transition='transform 150ms ease';t.style.transform='';});});
}

// ---------- input tiles ----------
function serverValues(){return S.server&&Inputs()?Inputs().valuesOf(S.server.components):{};}
function liveValues(){return Object.assign(Object.create(null),serverValues(),IN.pending);}
function currentValue(key){return Object.hasOwn(IN.pending,key)?IN.pending[key]:serverValues()[key];}
function resetInputs(){clearTimeout(IN.timer);Object.assign(IN,{pending:{},base:{},errors:{},conflicts:{},timer:null,again:false});IN.typing.clear();}
const showVal=v=>typeof v==='number'?String(Number(v.toFixed(6))):typeof v==='boolean'?(v?'on':'off'):String(v);
function inputBody(c){
 const wrap=h('div',{class:'dash-inputs','data-input-tile':c.id});
 c.spec.fields.forEach(f=>wrap.append(inputRow(f)));
 return wrap;
}
function inputRow(f){
 const id='in-'+f.key,err=IN.errors[f.key],conflict=IN.conflicts[f.key],v=currentValue(f.key),dirty=Object.hasOwn(IN.pending,f.key);
 const help=err?id+'-err':conflict?id+'-conflict':null;
 const row=h('div',{class:'dash-in-row'+(err?' has-error':'')+(dirty?' is-dirty':''),'data-field':f.key});
 const label=h('label',{for:id,class:'dash-in-label',title:f.help||null,text:f.label});
 let control;
 if(f.type==='number'){
  const atMin=f.min!=null&&v<=f.min,atMax=f.max!=null&&v>=f.max;
  const intOnly=f.integer||(Number.isInteger(f.step??1)&&Number.isInteger(f.min??0));
  const input=h('input',{id,class:'dash-in-num',type:'text',inputmode:intOnly&&(f.min??0)>=0?'numeric':'decimal',autocomplete:'off',spellcheck:'false','data-input-key':f.key,value:err?.draft??showVal(v),'aria-invalid':err?'true':null,'aria-describedby':help,
   oninput:e=>typedNumber(f,e.target.value),onblur:()=>{if(IN.quiet)return;IN.typing.delete(f.key);if(IN.timer)saveInputs();},
   onkeydown:e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();bump(f,e.key==='ArrowUp'?1:-1);}else if(e.key==='Enter'){e.preventDefault();IN.typing.delete(f.key);saveInputs();}},
   onfocus:e=>e.target.select()});
  control=h('div',{class:'dash-stepper'},
   btn('−',()=>bump(f,-1),{class:'dash-btn dash-step','aria-label':`Decrease ${f.label}`,'data-input-step':f.key+':-',disabled:atMin}),
   input,
   btn('+',()=>bump(f,1),{class:'dash-btn dash-step','aria-label':`Increase ${f.label}`,'data-input-step':f.key+':+',disabled:atMax}),
   f.unit?h('span',{class:'dash-in-unit',text:f.unit}):null);
 }else if(f.type==='select'){
  control=h('select',{id,class:'dash-in-select','data-input-key':f.key,'aria-describedby':help,onchange:e=>setValue(f,f.options[e.target.selectedIndex].value,{delay:BUTTON_MS})},
   f.options.map(o=>h('option',{selected:o.value===v,text:o.label})));
 }else if(f.type==='toggle'){
  control=h('span',{class:'dash-switch'},h('input',{id,type:'checkbox',role:'switch',checked:!!v,'data-input-key':f.key,'aria-describedby':help,onchange:e=>setValue(f,e.target.checked,{delay:BUTTON_MS})}),h('span',{class:'dash-switch-track','aria-hidden':'true'}));
 }else{
  control=h('input',{id,class:'dash-in-text',type:'text',maxlength:200,autocomplete:'off','data-input-key':f.key,value:err?.draft??v??'','aria-invalid':err?'true':null,'aria-describedby':help,
   oninput:e=>{IN.typing.add(f.key);setValue(f,e.target.value,{delay:TEXT_MS});},onblur:()=>{if(IN.quiet)return;IN.typing.delete(f.key);if(IN.timer)saveInputs();},onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();saveInputs();}}});
 }
 row.append(label,control);
 if(err)row.append(h('p',{class:'dash-in-error',id:id+'-err',text:err.message}));
 if(conflict)row.append(h('p',{class:'dash-in-conflict',id:id+'-conflict'},`Your agent set this to ${showVal(conflict.theirs)}. Yours (${showVal(conflict.mine)}) was not saved. `,btn('Use mine',()=>{delete IN.conflicts[f.key];setValue(f,conflict.mine,{delay:0});},{class:'dash-btn dash-link'})));
 return row;
}
function fieldOf(key){for(const c of S.server?.components||[])if(c.kind==='input')for(const f of c.spec.fields)if(f.key===key)return f;return null;}
function typedNumber(f,text){
 IN.typing.add(f.key);
 const r=Inputs().parseDraft(f,text);
 if(r.error){IN.errors[f.key]={message:r.error,draft:text};clearTimeout(IN.timer);IN.timer=null;refreshInputs();return;}
 setValue(f,r.value,{delay:TYPE_MS,draft:text});
}
function bump(f,dir){setValue(f,Inputs().stepValue(f,currentValue(f.key),dir),{delay:BUTTON_MS});IN.typing.delete(f.key);}
// Check the models that read a key accept the new values; returns an error message or ''.
function modelError(key){
 const values=liveValues(),M=Models();if(!M)return '';
 for(const c of S.server?.components||[]){
  if(c.kind!=='model'||!Inputs().refsIn(c.spec.params).keys.includes(key))continue;
  const r=Inputs().resolveModel(M,c.spec,values);
  if(r.errors)return `“${c.title}” cannot use this: ${r.errors[0]}`;
 }
 return '';
}
function setValue(f,value,{delay=BUTTON_MS,draft}={}){
 const I=Inputs(),e=I.valueError(f,value);
 if(e){IN.errors[f.key]={message:e.replace(/^input "[^"]+" /,'Must be ').replace('Must be must','Must'),draft:draft??showVal(value)};refreshInputs();return;}
 delete IN.errors[f.key];delete IN.conflicts[f.key];
 const saved=serverValues()[f.key];
 if(!Object.hasOwn(IN.base,f.key))IN.base[f.key]=saved;
 IN.pending[f.key]=value;
 if(value===saved&&!IN.saving){delete IN.pending[f.key];delete IN.base[f.key];}
 const me=modelError(f.key);
 if(me)IN.errors[f.key]={message:me,draft:draft??showVal(value),soft:true};
 applyLive();refreshInputs();
 scheduleSave(delay);
}
function scheduleSave(delay){clearTimeout(IN.timer);IN.timer=setTimeout(saveInputs,delay);setStatus('● Live · saving…','live');}
// Recompute bound model tiles and push values into Vega params, without a full render.
function applyLive(){
 if(!S.page||!Inputs())return;
 const values=liveValues();
 S.page.components.forEach((c,i)=>{
  if(c.kind==='vega'){Vega()?.update(c.id,values);return;}
  if(!hasRefs(c))return;
  const r=computeLocal(c,values);if(!r)return;
  const next={...c,computed:r.computed||null,error:r.errors?r.errors.join(' '):undefined};
  const old=main.querySelector(`.dash-tile[data-id="${CSS.escape(c.id)}"]`);
  if(!old||old.classList.contains('is-editing'))return;
  if(JSON.stringify(c.computed)===JSON.stringify(next.computed)&&c.error===next.error)return;
  S.page.components[i]=next;
  const fresh=tile(next,i,S.page.components.length);old.replaceWith(fresh);drawHosts(fresh);
 });
}
// Rebuild input tiles in place, keeping focus, the caret and anything half-typed.
// Removing a focused input fires blur; IN.quiet stops that from flushing a debounced save early.
function refreshInputs(){
 const keep=captureInputFocus();
 IN.quiet=true;
 try{main.querySelectorAll('[data-input-tile]').forEach(w=>{const c=S.page?.components.find(x=>x.id===w.dataset.inputTile);if(c&&c.kind==='input')w.replaceWith(inputBody(c));});}
 finally{IN.quiet=false;}
 restoreInputFocus(keep);
}
function captureInputFocus(){
 const a=document.activeElement;if(!a||!main.contains(a))return null;
 const key=a.dataset.inputKey,step=a.dataset.inputStep;if(!key&&!step)return null;
 return {key,step,text:a.type==='text'?a.value:null,start:a.selectionStart,end:a.selectionEnd};
}
function restoreInputFocus(k){
 if(!k)return;
 const el=main.querySelector(k.key?`[data-input-key="${CSS.escape(k.key)}"]`:`[data-input-step="${CSS.escape(k.step)}"]`);
 if(!el)return;
 if(k.key&&k.text!==null&&(IN.typing.has(k.key)||IN.errors[k.key])&&el.value!==k.text)el.value=k.text;
 if(el.disabled){const f=el.closest('.dash-in-row')?.querySelector('[data-input-key]');f?.focus({preventScroll:true});return;}
 el.focus({preventScroll:true});
 if(k.key&&k.text!==null&&k.start!=null)try{el.setSelectionRange(k.start,k.end);}catch{}
}
// Another writer changed a field this screen is still changing: keep theirs, offer "Use mine".
function inputConflicts(){
 const theirs=serverValues();
 for(const k of Object.keys(IN.pending)){
  if(!Object.hasOwn(theirs,k)){delete IN.pending[k];delete IN.base[k];continue;}
  if(theirs[k]!==IN.base[k]&&theirs[k]!==IN.pending[k]){IN.conflicts[k]={key:k,theirs:theirs[k],mine:IN.pending[k]};delete IN.pending[k];delete IN.base[k];delete IN.errors[k];IN.typing.delete(k);}
 }
}
function settle(sent){for(const [k,v] of Object.entries(sent))if(IN.pending[k]===v){delete IN.pending[k];delete IN.base[k];}}
function afterInputSave(){if(!S.editing&&!S.renaming){S.page=S.server;render();}else{refreshInputs();applyLive();}}
async function saveInputs(){
 clearTimeout(IN.timer);IN.timer=null;
 if(!S.server)return;
 if(IN.saving){IN.again=true;return;}
 const send={};for(const [k,v] of Object.entries(IN.pending))if(!IN.errors[k])send[k]=v;
 if(!Object.keys(send).length){if(S.status.text.includes('saving'))live('');return;}
 IN.saving=true;
 const pageId=S.server.id;let rev=S.server.revision;
 try{
  for(let attempt=0;attempt<3;attempt++){
   try{
    const {page}=await api('PATCH','/api/dashboard/pages/'+pageId+'/inputs',{expectedRevision:rev,values:send});
    settle(send);
    if(S.server?.id===pageId){acceptServer(page,{own:true});afterInputSave();}
    live(`saved ${Object.keys(send).map(k=>fieldOf(k)?.label||k).join(', ')} · ${clock()}`);
    return;
   }catch(e){
    if(e.status!==409||!e.data?.page||attempt===2)throw e;
    // Someone else saved first: re-apply only the fields this screen changed, never theirs.
    const theirs=Inputs().valuesOf(e.data.page.components);
    const {apply,conflicts}=Inputs().mergeValues(IN.base,send,theirs);
    for(const c of conflicts){delete IN.pending[c.key];delete IN.base[c.key];delete send[c.key];if(!c.missing)IN.conflicts[c.key]=c;}
    for(const k of Object.keys(send))if(!Object.hasOwn(apply,k)){settle({[k]:send[k]});delete send[k];}
    for(const k of Object.keys(apply))IN.base[k]=theirs[k];
    if(S.server?.id===pageId)acceptServer(e.data.page,{own:false});
    rev=e.data.page.revision;
    if(!Object.keys(apply).length){afterInputSave();if(conflicts.length)announce('Your agent changed the same input first.');return;}
   }
  }
 }catch(e){
  if(e.network){setStatus('Offline — your values stay here and save when the connection returns','warn');IN.timer=setTimeout(saveInputs,4000);}
  else if(e.status===400||e.status===404){for(const k of Object.keys(send))IN.errors[k]={message:e.message,draft:showVal(send[k])};setStatus('Not saved — see the highlighted input','warn');}
  else{errorToast(e,saveInputs);}
  refreshInputs();
 }finally{
  IN.saving=false;
  if(IN.again){IN.again=false;scheduleSave(0);}
 }
}
window.addEventListener('pagehide',()=>{if(!S.server)return;const send={};for(const [k,v] of Object.entries(IN.pending))if(!IN.errors[k])send[k]=v;if(Object.keys(send).length)fetch('/api/dashboard/pages/'+S.server.id+'/inputs',{method:'PATCH',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:S.server.revision,values:send})}).catch(()=>{});});
function vegaTable(c){
 const d=Vega()?.dataRows(c.spec?.definition);if(!d)return null;
 const wrap=h('div');
 const t=Charts.dataTable({kind:'table',spec:{columns:d.columns,rows:d.rows}});if(t)wrap.append(t);
 if(d.more)wrap.append(h('p',{class:'dash-help',text:`…and ${d.more} more rows.`}));
 return wrap;
}
function rerenderEditor(){if(S.editing)render();}

// ---------- connect panel ----------
function showConnect(){
 if(S.editing){toast('Finish or cancel the open edit first.');return;}
 S.prevMode=S.mode==='connect'?S.prevMode:S.mode;S.mode='connect';
 if(location.hash!=='#connect')history.pushState({connect:true},'',location.pathname+'#connect');
 loadConnections();render();main.focus();
}
function leaveConnect(){
 S.mode=S.page?'page':(S.pages.length?'loading':'empty');
 history.replaceState({},'',S.page?'/dashboard/'+S.page.id:'/dashboard');
 if(S.mode==='loading')openPage(S.pages[0].id,{replace:true});else render();
}
function copyRow(text,label){
 const code=h('code',{class:'dash-copy-text',text});
 const b=btn('Copy',async()=>{try{await navigator.clipboard.writeText(text);b.textContent='Copied';announce('Copied '+label);}catch{const r=document.createRange();r.selectNodeContents(code);const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Press ⌘C / Ctrl+C';}setTimeout(()=>{b.textContent='Copy';},2000);},{'aria-label':'Copy '+label});
 return h('div',{class:'dash-copy'},code,b);
}
function connectPanel(){
 const url=boot.mcpUrl;
 const tabs=[
  ['Claude Code',[h('p',{text:'Run this in a terminal:'}),copyRow(`claude mcp add --transport http catan ${url}`,'Claude Code command'),h('p',{text:'Then start Claude Code, type /mcp, choose “catan”, and authorize. Sign in with the same Google account you use here and approve access.'})]],
  ['Codex',[h('p',{text:'Run these in a terminal:'}),copyRow(`codex mcp add catan --url ${url}`,'Codex add command'),copyRow('codex mcp login catan','Codex login command'),h('p',{text:'The login opens your browser. Sign in with the same Google account and approve access.'})]],
  ['ChatGPT',[h('p',{text:'In ChatGPT settings, add a custom connector (remote MCP server). Some plans require turning on developer mode first.'}),h('ol',null,h('li',{text:'Use this server URL:'}),copyRow(url,'MCP URL'),h('li',{text:'Choose OAuth authentication.'}),h('li',{text:'Sign in with the same Google account and approve access.'}))]],
 ];
 S.connectTab??=0;
 const tabBar=h('div',{class:'dash-tabs',role:'tablist','aria-label':'Agent app'});
 const panel=h('div',{class:'dash-tabpanel',role:'tabpanel',id:'connect-panel'});
 const show=i=>{S.connectTab=i;tabBar.querySelectorAll('[role=tab]').forEach((t,k)=>{t.setAttribute('aria-selected',k===i?'true':'false');t.tabIndex=k===i?0:-1;});panel.textContent='';panel.setAttribute('aria-labelledby','tab-'+i);panel.append(...tabs[i][1]);};
 tabs.forEach(([name],i)=>tabBar.append(h('button',{type:'button',role:'tab',id:'tab-'+i,class:'dash-tab','aria-controls':'connect-panel',onclick:()=>show(i),onkeydown:e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const k=(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;show(k);tabBar.children[k].focus();}}},name)));
 show(S.connectTab);
 const prompts=['List the Catan dashboard components you can make, then show my dice odds for 6, 8 and 9.','I have 1 wood, 1 brick, 1 wheat; my pips are wood 5, brick 3, sheep 4, wheat 6, ore 2. Add a build-pace chart to my Catan dashboard and show it.','Make a Catan dashboard page “Knight plan” showing how many dev cards I need for 3 knights.'];
 return h('section',{class:'dash-connect'},
  h('div',{class:'dash-row dash-between'},h('p',{class:'dash-lede',text:'Let your agent build and organize your dashboard. The MCP tools can create, edit, resize and reorder every component, manage saved pages, and bring results into view. Sign in with your Catan account to connect.'}),btn('Back to dashboard',leaveConnect,{class:'dash-btn'})),
  h('h2',{text:'1. Add the server'}),
  h('p',null,'MCP server URL (remote, OAuth sign-in — no keys to paste):'),copyRow(url,'MCP server URL'),
  tabBar,panel,
  h('p',{class:'dash-help',text:'Whether your app can add a remote MCP server depends on your account, plan, and workspace settings. Instructions follow each app’s documented commands; if a menu differs, look for “MCP”, “connectors”, or “custom tools”.'}),
  h('h2',{text:'2. Try it'}),
  h('p',{class:'dash-help',text:'Keep this dashboard open. With Follow agent on, it jumps to what your agent shows you.'}),
  h('ul',{class:'dash-prompts'},prompts.map((p,i)=>h('li',null,copyRow(p,'example prompt '+(i+1))))),
  h('h2',{text:'3. Connected agents'}),
  connectionsTable());
}
function connectionsTable(){
 if(S.connections===null)return h('p',{class:'dash-help',text:S.connectionsError||'Loading connections…'},S.connectionsError?btn('Retry',loadConnections,{class:'dash-btn dash-link'}):null);
 if(!S.connections.length)return h('p',{class:'dash-help',text:'No agents connected yet. After you authorize one, it appears here.'});
 const tb=h('tbody');
 S.connections.forEach(c=>{
  const id=c.client?.id,name=connName(c);
  const action=S.disconnecting===id?h('div',{class:'dash-row'},h('span',{text:`Disconnect “${name}”? It stops working immediately.`}),btn('Disconnect',()=>disconnect(id,name),{class:'dash-btn dash-danger'}),btn('Cancel',()=>{S.disconnecting=null;render();}))
   :btn('Disconnect',()=>{S.disconnecting=id;render();},{class:'dash-btn dash-quiet','aria-label':'Disconnect '+name});
  tb.append(h('tr',null,h('th',{scope:'row',text:name}),h('td',{text:ago(c.granted_at)}),h('td',{text:Array.isArray(c.scopes)?c.scopes.join(' '):(c.scopes||'')}),h('td',null,action)));
 });
 return h('div',{class:'dash-table-wrap'},h('table',{class:'dash-table'},h('thead',null,h('tr',null,h('th',{scope:'col',text:'Agent'}),h('th',{scope:'col',text:'Connected'}),h('th',{scope:'col',text:'Scopes'}),h('th',{scope:'col',text:''}))),tb));
}
async function loadConnections(){
 try{const {connections}=await api('GET','/api/agent-connections');S.connections=Array.isArray(connections)?connections:[];S.connectionsError='';}
 catch(e){S.connections=null;S.connectionsError=e.network?'Could not load connected agents.':'Could not load connected agents: '+e.message;}
 if(S.mode!=='loading')render();
}
async function disconnect(id,name){
 try{await api('DELETE','/api/agent-connections/'+encodeURIComponent(id));S.connections=(S.connections||[]).filter(c=>c.client?.id!==id);S.disconnecting=null;live(`disconnected ${name}`);toast(`Disconnected “${name}”.`);render();}
 catch(e){errorToast(e,()=>disconnect(id,name));}
}

// ---------- polling + follow ----------
function typing(){const a=document.activeElement;return a&&(a.matches('input,textarea,select')||a.isContentEditable)&&main.contains(a);}
async function poll(){
 if(document.hidden||S.polling||S.mode==='loading'||S.mode==='error')return;
 S.polling=true;
 try{
  const v=await api('GET','/api/dashboard/view');
  if(S.fails>=3||S.status.tone!=='live')live('');
  S.fails=0;
  const pagesChanged=JSON.stringify(v.pages.map(p=>[p.id,p.title]))!==JSON.stringify(S.pages.map(p=>[p.id,p.title]));
  S.pages=v.pages;
  if(Number.isFinite(v.seq)&&v.seq>S.seq){
   S.seq=v.seq;
   if(v.actor==='agent'&&v.pageId)followAgent(v.pageId,v.componentId);
  }
  if(S.mode==='page'&&S.server){
   const meta=v.pages.find(p=>p.id===S.server.id);
   if(!meta){toast(`“${S.server.title}” was archived.`);S.server=S.page=null;S.editing=null;if(v.pages[0])openPage(v.pages[0].id,{replace:true});else{S.mode='empty';render();}}
   else if(meta.revision!==S.server.revision&&!S.writing&&!IN.saving){
    const {page}=await api('GET','/api/dashboard/pages/'+S.server.id);
    if(S.server&&page.id===S.server.id&&page.revision>=S.server.revision&&!S.writing&&!IN.saving){acceptServer(page,{own:false});if(!S.editing&&!S.renaming)render();else renderSide();}
   }else if(pagesChanged&&!S.editing&&!S.renaming)renderSide();
  }else if(pagesChanged){if(S.mode==='empty'&&S.pages.length)openPage(S.pages[0].id,{replace:true,record:false});else if(!typing())render();else renderSide();}
 }catch(e){
  S.fails++;
  if(S.fails>=3)setStatus('Offline — retrying','warn');
 }finally{S.polling=false;}
}
function followAgent(pageId,componentId){
 const busy=S.editing||S.renaming||S.creating||typing();
 if(S.follow&&!busy){
  if(S.mode==='page'&&S.page?.id===pageId){if(componentId){S.pulse.add(componentId);S.focusAfter={id:componentId,scroll:true};}render();}
  else openPage(pageId,{highlight:componentId,record:false});
  const title=S.pages.find(p=>p.id===pageId)?.title;if(title)live(`agent opened '${title}' ${clock()}`);
 }else{S.banner={pageId,componentId};if(S.editing||S.renaming){const b=main.querySelector('.dash-banner');const nb=bannerEl();b?b.replaceWith(nb):main.querySelector('.dash-head')?.after(nb);}else render();}
}
function schedule(){clearInterval(S.timer);S.timer=null;if(!document.hidden)S.timer=setInterval(poll,POLL_MS);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(S.timer);S.timer=null;setStatus('Paused while this tab is hidden','');}else{poll();schedule();}});

// ---------- navigation ----------
window.addEventListener('popstate',()=>{
 if(location.hash==='#connect'){if(S.mode!=='connect')showConnect();return;}
 if(S.mode==='connect'){S.mode=S.page?'page':'empty';}
 const m=location.pathname.match(/^\/dashboard\/([0-9a-f-]{36})$/i);
 if(m&&m[1]!==S.page?.id)openPage(m[1],{push:false});else render();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuEl){closeMenu();}});

// ---------- boot ----------
async function loadCatalog(){
 const M=Models();
 if(M?.catalog){S.catalog=M.catalog;return;}
 try{const {models}=await api('GET','/api/dashboard/models');S.catalog=Array.isArray(models)?models:[];}catch{S.catalog=[];}
}
async function init(){
 setStatus('Connecting…');
 loadCatalog().then(()=>{if(S.picker||S.editing)render();});
 loadConnections();
 try{
  const v=await api('GET','/api/dashboard/view');
  S.seq=Number(v.seq)||0;S.pages=Array.isArray(v.pages)?v.pages:[];
  live('');
  const target=boot.pageId||v.pageId||S.pages[0]?.id;
  if(boot.badPath){S.mode='missing';render();}
  else if(!target){S.mode='empty';render();}
  const wantConnect=location.hash==='#connect';
  if(target&&!boot.badPath)await openPage(target,{replace:true,record:Boolean(boot.pageId)&&boot.pageId!==v.pageId,fallback:!boot.pageId});
  if(wantConnect&&S.mode!=='missing'){history.replaceState({connect:true},'',location.pathname+'#connect');S.mode='connect';render();}
 }catch(e){S.mode='error';S.loadError=e.network?'Could not reach the server. Check your connection.':e.message;render();}
 schedule();
}
init();
})();
