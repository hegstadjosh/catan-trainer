// Game tools: the owner's full-state scenario editor for their own rooms.
// One JSON draft is the single source of edits; quick controls rewrite that draft. Saving sends the
// draft with the revision it was loaded from. A light revision poll only announces newer revisions
// and never replaces the draft. Connection tokens live only in memory while shown.
(()=>{
'use strict';
const RES=['brick','lumber','wool','grain','ore'];
const PHASES={setup:['setupSettlement','setupRoad'],play:['roll','discard','robber','main','roadBuilding'],finished:[null]};
const boot=JSON.parse(document.getElementById('director-boot').textContent);
const side=document.getElementById('dr-side'),main=document.getElementById('dr-main');
const S={games:[],archived:false,id:boot.gameId,loaded:null,draft:'',dirty:false,remoteRevision:null,result:null,token:null,confirmReset:false,busy:false,connections:null};

function h(tag,attrs,...kids){
 const el=document.createElement(tag);
 for(const [k,v] of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(k==='value')el.value=v;else el.setAttribute(k,v===true?'':v);}
 for(const kid of kids.flat(Infinity))if(kid!=null&&kid!==false)el.append(kid instanceof Node?kid:String(kid));
 return el;
}
async function api(method,url,body){
 let r;
 try{r=await fetch(url,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}
 catch{const e=new Error('Could not reach the server. Check your connection and try again.');e.status=0;throw e;}
 let data=null;try{data=await r.json();}catch{}
 if(!r.ok){const e=new Error(r.status===401?'Your session has ended. Sign in again.':(data&&data.error)||`The server could not complete that (error ${r.status}).`);e.status=r.status;e.data=data;throw e;}
 return data||{};
}
function toast(text,kind){
 const wrap=document.getElementById('dr-toasts');
 const t=h('div',{class:'dr-toast'+(kind?' dr-toast-'+kind:''),role:kind==='error'?'alert':null},text);
 wrap.append(t);setTimeout(()=>t.remove(),kind==='error'?8000:4000);
}
async function run(fn){if(S.busy)return;S.busy=true;renderMain();try{await fn();}catch(e){toast(e.message,'error');}finally{S.busy=false;renderMain();}}

// ---------- Game list ----------
async function loadList(){
 try{S.games=(await api('GET','/api/director/games'+(S.archived?'?archived=1':''))).games;}catch(e){toast(e.message,'error');}
 renderSide();
}
function renderSide(){
 side.replaceChildren(
  h('h2',{},'Your games'),
  h('div',{class:'dr-tabs',role:'group','aria-label':'Show'},
   h('button',{class:'dr-btn dr-small'+(S.archived?'':' dr-on'),type:'button','aria-pressed':String(!S.archived),onclick:()=>{S.archived=false;loadList();}},'Active'),
   h('button',{class:'dr-btn dr-small'+(S.archived?' dr-on':''),type:'button','aria-pressed':String(S.archived),onclick:()=>{S.archived=true;loadList();}},'Archived')),
  S.games.length?h('ul',{class:'dr-list'},S.games.map(g=>h('li',{},h('a',{href:'/game-tools?game='+g.id,'aria-current':g.id===S.id?'page':null,onclick:ev=>{ev.preventDefault();select(g.id);}},h('span',{class:'dr-list-title'},g.title),h('span',{class:'dr-muted dr-small-text'},'Revision '+g.revision))))):h('p',{class:'dr-muted'},S.archived?'No archived games.':'No games yet.'),
  S.archived?null:createForm());
}
function createForm(){
 const title=h('input',{id:'dr-new-title',maxlength:80,placeholder:'New game',autocomplete:'off'});
 const seed=h('input',{id:'dr-new-seed',inputmode:'numeric',pattern:'[0-9]*',placeholder:'Random',autocomplete:'off'});
 return h('details',{class:'dr-create',open:S.games.length?null:true},h('summary',{},'New game'),h('form',{onsubmit:ev=>{ev.preventDefault();run(async()=>{const body={title:title.value.trim()||'New game'};if(seed.value.trim())body.seed=Number(seed.value);const d=await api('POST','/api/director/games',body);toast('Game created.');await loadList();select(d.game.id,d);});}},
  h('label',{for:'dr-new-title'},'Title'),title,h('label',{for:'dr-new-seed'},'Seed (optional)'),seed,
  h('p',{class:'dr-muted dr-small-text'},'A seed makes the board, dice and deck reproducible. Leave it empty for a random game.'),
  h('button',{class:'dr-btn',type:'submit'},'Create game')));
}

// ---------- Selected game ----------
async function select(id,snapshot){
 if(S.dirty&&id!==S.id&&!confirm('Discard your unsaved edits to this game?'))return;
 S.id=id;S.token=null;S.result=null;S.confirmReset=false;S.connections=null;
 history.replaceState(null,'',id?'/game-tools?game='+id:'/game-tools');
 renderSide();
 if(!id)return renderMain();
 try{load(snapshot||await api('GET','/api/director/games/'+id));}catch(e){S.loaded=null;renderMain();toast(e.message,'error');return;}
 loadConnections();
}
function load(snap){S.loaded=snap;S.draft=JSON.stringify(snap.state,null,2);S.dirty=false;S.remoteRevision=snap.revision;renderMain();}
async function loadConnections(){if(!S.loaded||S.loaded.game.archived)return;try{S.connections=await api('GET',`/api/director/games/${S.id}/connections`);}catch{S.connections=null;}renderConnections();}
const parsed=()=>{try{const v=JSON.parse(S.draft);return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}};
function setDraft(text,{fromEditor=false}={}){
 S.draft=text;S.dirty=text!==JSON.stringify(S.loaded.state,null,2);
 if(!fromEditor){const ta=document.getElementById('dr-json');if(ta)ta.value=text;}
 renderStatus();renderQuick();
}
function editDraft(mutate){const s=parsed();if(!s)return;mutate(s);setDraft(JSON.stringify(s,null,2));}
const normalizeOpts=()=>({bank:!!document.getElementById('dr-norm-bank')?.checked,awards:!!document.getElementById('dr-norm-awards')?.checked});

function renderMain(){
 if(!S.id){main.replaceChildren(h('h1',{},'Game tools'),h('p',{},'Choose a game, or create one, to inspect and edit its full state.'),h('p',{class:'dr-muted'},'This editor shows every hand and the development deck. Use the Games page to play.'));return;}
 if(!S.loaded){main.replaceChildren(h('p',{class:'dr-muted',role:'status'},'Loading…'));return;}
 const g=S.loaded.game,archived=g.archived;
 const titleInput=h('input',{id:'dr-title',value:g.title,maxlength:80,autocomplete:'off'});
 main.replaceChildren(
  h('div',{class:'dr-head'},
   h('div',{class:'dr-grow'},h('h1',{},g.title),h('p',{class:'dr-muted'},`Revision ${S.loaded.revision}`+(archived?' · Archived':''))),
   h('div',{class:'dr-actions'},
    archived?null:h('a',{class:'dr-btn',href:'/game/'+g.id},'Open board'),
    h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:()=>run(async()=>{const d=await api('POST',`/api/director/games/${g.id}/clone`,{});toast('Copied to “'+d.game.title+'”.');await loadList();select(d.game.id,d);})},'Clone'),
    h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:()=>run(exportFile)},'Export'),
    archived?h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:()=>run(async()=>{await api('POST',`/api/director/games/${g.id}/restore`);toast('Game restored.');S.archived=false;await loadList();await select(g.id);})},'Restore'):
     h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:()=>run(async()=>{await api('POST',`/api/director/games/${g.id}/archive`);toast('Game archived. It is listed under Archived.');await loadList();S.dirty=false;await select(g.id);})},'Archive'))),
  h('div',{class:'dr-notice',role:'note'},h('strong',{},'Full game state. '),'This view reveals every player’s hand, the development deck order and any random seed. It is an editor for setting up scenarios, not the playing board. Saved edits appear to all players as a “Game director” line in the game log; hands are never announced.'),
  h('div',{id:'dr-remote'}),
  h('form',{class:'dr-rename',onsubmit:ev=>{ev.preventDefault();run(async()=>{const d=await api('PATCH','/api/director/games/'+g.id,{title:titleInput.value});S.loaded.game.title=d.game.title;toast('Renamed.');loadList();});}},h('label',{for:'dr-title'},'Title'),h('div',{class:'dr-row'},titleInput,h('button',{class:'dr-btn',type:'submit',disabled:S.busy},'Rename'))),
  archived?h('p',{class:'dr-muted'},'Restore this game to edit it. You can still export or clone it.'):editor(),
  archived?null:h('section',{class:'dr-card',id:'dr-connections','aria-labelledby':'dr-conn-h'},h('h2',{id:'dr-conn-h'},'Agent connections')),
  archived?null:resetCard());
 renderRemote();renderStatus();renderQuick();renderResult();renderConnections();
}

function editor(){
 const ta=h('textarea',{id:'dr-json',class:'dr-json',spellcheck:'false',autocapitalize:'off',autocomplete:'off','aria-describedby':'dr-status',oninput:ev=>setDraft(ev.target.value,{fromEditor:true})});
 ta.value=S.draft;
 const file=h('input',{type:'file',accept:'application/json,.json',class:'dr-sr',id:'dr-import',onchange:ev=>importFile(ev.target)});
 return h('section',{class:'dr-card','aria-labelledby':'dr-edit-h'},
  h('h2',{id:'dr-edit-h'},'Edit state'),
  h('div',{id:'dr-quick'}),
  h('label',{for:'dr-json',class:'dr-label'},'Full state (JSON)'),
  h('p',{class:'dr-muted dr-small-text'},'Vertices, edges and hexes are numbers here (12, 40, 7); the board calls them v12, e40, h7. ',h('a',{href:'/api/director/schema',target:'_blank',rel:'noopener'},'Field reference')),
  ta,
  h('div',{class:'dr-checks'},
   h('label',{},h('input',{type:'checkbox',id:'dr-norm-bank',checked:true}),' Balance the bank to match the hands'),
   h('label',{},h('input',{type:'checkbox',id:'dr-norm-awards'}),' Recompute Longest Road and Largest Army')),
  h('p',{id:'dr-status',class:'dr-status',role:'status'}),
  h('div',{class:'dr-actions'},
   h('button',{class:'dr-btn dr-primary',type:'button',disabled:S.busy,onclick:save},'Save'),
   h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:check},'Check'),
   h('button',{class:'dr-btn',type:'button',disabled:S.busy,onclick:()=>{if(!S.dirty||confirm('Discard your unsaved edits?')){setDraft(JSON.stringify(S.loaded.state,null,2));S.result=null;renderResult();}}},'Discard edits'),
   h('label',{class:'dr-btn',for:'dr-import'},'Import file…'),file),
  h('div',{id:'dr-result'}));
}

function renderStatus(){
 const el=document.getElementById('dr-status');if(!el)return;
 const valid=!!parsed();
 el.textContent=!valid?'The draft is not valid JSON yet.':S.dirty?`Unsaved changes, based on revision ${S.loaded.revision}.`:`Matches saved revision ${S.loaded.revision}.`;
 el.className='dr-status'+(!valid?' dr-bad':S.dirty?' dr-warn':'');
}
function renderRemote(){
 const el=document.getElementById('dr-remote');if(!el)return;
 if(!S.loaded||S.remoteRevision==null||S.remoteRevision<=S.loaded.revision){el.replaceChildren();return;}
 el.replaceChildren(h('div',{class:'dr-banner',role:'status'},
  h('span',{class:'dr-grow'},`The game has moved to revision ${S.remoteRevision} since you loaded revision ${S.loaded.revision}.`+(S.dirty?' Loading the latest discards your unsaved draft.':'')),
  S.dirty?h('button',{class:'dr-btn dr-small',type:'button',onclick:copyDraft},'Copy draft'):null,
  h('button',{class:'dr-btn dr-small',type:'button',onclick:reloadLatest},'Load latest')));
}
async function reloadLatest(){if(S.dirty&&!confirm('Load the latest state and discard your draft?'))return;await run(async()=>{load(await api('GET','/api/director/games/'+S.id));S.result=null;});}
async function copyDraft(){try{await navigator.clipboard.writeText(S.draft);toast('Draft copied.');}catch{toast('Copy failed. Select the text and copy it manually.','error');}}

// ---------- Quick controls (edit the draft) ----------
function renderQuick(){
 const el=document.getElementById('dr-quick');if(!el)return;
 if(el.contains(document.activeElement))return; // do not redraw under the cursor
 const s=parsed();
 if(!s||!Array.isArray(s.players)||s.players.length!==4){el.replaceChildren(h('p',{class:'dr-muted'},'Common edits are available when the draft is valid JSON with four players.'));return;}
 const num=(value,label,onset,max=19)=>h('input',{type:'number',min:0,max,step:1,inputmode:'numeric',value:String(value??0),'aria-label':label,class:'dr-num',onchange:ev=>{const n=Number(ev.target.value);if(Number.isInteger(n)&&n>=0)editDraft(x=>onset(x,n));}});
 const select=(id,label,options,value,onset)=>h('div',{class:'dr-field'},h('label',{for:id},label),h('select',{id,onchange:ev=>editDraft(x=>onset(x,ev.target.value))},options.map(([v,t])=>h('option',{value:v,selected:String(v)===String(value)},t))));
 const phases=Object.keys(PHASES),tps=PHASES[s.phase]||[];
 el.replaceChildren(
  h('fieldset',{class:'dr-quick'},h('legend',{},'Turn'),
   h('div',{class:'dr-grid4'},
    select('dr-q-phase','Phase',phases.map(p=>[p,p]),s.phase,(x,v)=>{x.phase=v;x.turnPhase=PHASES[v][0];if(v!=='finished')x.winner=null;if(v==='setup')x.turn=0;else if(v==='play'&&x.turn<1)x.turn=1;}),
    select('dr-q-tp','Step',tps.map(p=>[p??'',p??'—']),s.turnPhase??'',(x,v)=>{x.turnPhase=v||null;if(v==='main'&&x.turnState)x.turnState.rolled=true;if(v==='roll'&&x.turnState)x.turnState.rolled=false;}),
    select('dr-q-current','Current seat',s.players.map((p,i)=>[i,`${i} · ${p.name}`]),s.current,(x,v)=>{x.current=Number(v);}),
    h('div',{class:'dr-field'},h('label',{for:'dr-q-turn'},'Turn number'),Object.assign(num(s.turn,'Turn number',(x,n)=>{x.turn=n;},9999),{id:'dr-q-turn'})))),
  h('fieldset',{class:'dr-quick'},h('legend',{},'Hands'),
   h('div',{class:'dr-table-wrap'},h('table',{class:'dr-table'},
    h('thead',{},h('tr',{},h('th',{scope:'col'},'Seat'),RES.map(r=>h('th',{scope:'col'},r)),h('th',{scope:'col'},'Dev cards'),h('th',{scope:'col'},'Knights'))),
    h('tbody',{},s.players.map((p,i)=>h('tr',{},h('th',{scope:'row'},`${i} · ${p.name}`),RES.map(r=>h('td',{},num(p.resources?.[r],`${p.name} ${r}`,(x,n)=>{x.players[i].resources[r]=n;}))),h('td',{class:'dr-muted'},Array.isArray(p.devCards)?String(p.devCards.length):'—'),h('td',{},num(p.knights,`${p.name} knights played`,(x,n)=>{x.players[i].knights=n;},14))))),
    h('tfoot',{},h('tr',{},h('th',{scope:'row'},'Bank'),RES.map(r=>h('td',{class:'dr-muted'},String(s.bank?.[r]??'—'))),h('td',{class:'dr-muted'},Array.isArray(s.devDeck)?s.devDeck.length+' in deck':''),h('td',{}))))),
   h('p',{class:'dr-muted dr-small-text'},'The bank column shows the draft. With “Balance the bank” checked, saving recomputes it as 19 minus the hands.')));
}

// ---------- Save, check, import, export ----------
function draftOrWarn(){const s=parsed();if(!s){toast('The draft is not valid JSON. Fix it before saving.','error');return null;}return s;}
async function save(){
 const state=draftOrWarn();if(!state)return;
 await run(async()=>{
  try{
   const d=await api('PUT',`/api/director/games/${S.id}/state`,{expectedRevision:S.loaded.revision,state,normalize:normalizeOpts()});
   S.result={kind:'saved',...d};
   load(await api('GET','/api/director/games/'+S.id));
   toast(`Saved revision ${d.revision}.`);loadList();
  }catch(e){
   if(e.status===409){S.result={kind:'conflict',message:e.message};S.remoteRevision=Math.max(S.remoteRevision||0,e.data?.currentRevision||0,S.loaded.revision+1);renderRemote();}
   else if(e.data?.problems)S.result={kind:'invalid',...e.data};
   else throw e;
  }
 });
}
async function check(){
 const state=draftOrWarn();if(!state)return;
 await run(async()=>{try{S.result={kind:'valid',...await api('POST',`/api/director/games/${S.id}/validate`,{state,normalize:normalizeOpts()})};}catch(e){if(e.data?.problems)S.result={kind:'invalid',...e.data};else throw e;}});
}
function renderResult(){
 const el=document.getElementById('dr-result');if(!el)return;const r=S.result;
 if(!r){el.replaceChildren();return;}
 const list=(title,items,cls)=>items?.length?h('div',{class:cls},h('h3',{},title),h('ul',{},items.map(i=>h('li',{},typeof i==='string'?i:[h('code',{},i.path||'(state)'),' ',i.message])))):null;
 const head=r.kind==='conflict'?h('p',{class:'dr-bad',role:'alert'},'Not saved. '+r.message+' Your draft is still here.'):
  r.kind==='invalid'?h('p',{class:'dr-bad',role:'alert'},'Not saved. The state has problems:'):
  r.kind==='valid'?h('p',{class:'dr-ok'},'The draft is valid.'+(r.changed?.length?' Saving would change: '+r.changed.join(', ')+'.':' It matches the saved state.')):
  h('p',{class:'dr-ok'},`Saved revision ${r.revision}.`+(r.changed?.length?' Changed: '+r.changed.join(', ')+'.':''));
 el.replaceChildren(h('div',{class:'dr-result'},head,list('Problems',r.problems,'dr-problems'),list('Warnings (allowed)',r.warnings,'dr-warnings'),list('Adjusted automatically',r.normalized,'dr-notes')));
}
function importFile(input){
 const f=input.files?.[0];input.value='';if(!f)return;
 if(f.size>500000)return toast('That file is too large for a game state.','error');
 f.text().then(text=>{let v;try{v=JSON.parse(text);}catch{return toast('That file is not valid JSON.','error');}
  const state=v&&v.format==='catan-director-state'?v.state:v;
  setDraft(JSON.stringify(state,null,2));S.result=null;renderResult();toast('Imported into the draft. Check, then Save to apply it.');
 });
}
async function exportFile(){
 const d=await api('GET',`/api/director/games/${S.id}/export`);
 const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));
 const a=h('a',{href:url,download:`catan-${d.title.replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,40)}-r${d.revision}.json`});
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ---------- Connections ----------
const TARGETS=[['seat1',1],['seat2',2],['seat3',3],['sidekick',null]];
function renderConnections(){
 const el=document.getElementById('dr-connections');if(!el)return;
 const c=S.connections,s=S.loaded.state;
 const status=t=>{if(!c)return 'Status unavailable';const x=t==='sidekick'?c.sidekick:c.seats.find(z=>'seat'+z.seat===t);return x?.connected?'Connected':'Not connected';};
 el.replaceChildren(h('h2',{id:'dr-conn-h'},'Agent connections'),
  h('p',{class:'dr-muted dr-small-text'},'Seat tokens let an agent play one seat. The sidekick token is read-only: public game plus your hand. Issuing replaces the old token.'),
  S.token?h('div',{class:'dr-token',role:'alert'},h('p',{},h('strong',{},`Token for ${S.token.label}. `),'It is shown once and is not saved in this browser. Give it only to the agent that uses it.'),
   h('code',{class:'dr-token-code'},S.token.token),h('p',{class:'dr-small-text'},'Endpoint: ',h('code',{},S.token.endpoint)),
   h('div',{class:'dr-actions'},h('button',{class:'dr-btn dr-small',type:'button',onclick:async()=>{try{await navigator.clipboard.writeText(S.token.token);toast('Token copied.');}catch{toast('Copy failed. Select the token and copy it.','error');}}},'Copy token'),h('button',{class:'dr-btn dr-small',type:'button',onclick:()=>{S.token=null;renderConnections();}},'Hide token'))):null,
  h('ul',{class:'dr-conns'},TARGETS.map(([t,seat])=>{const label=seat?`Seat ${seat} · ${s.players?.[seat]?.name??''}`:'Read-only sidekick';return h('li',{},h('span',{class:'dr-grow'},h('strong',{},label),h('span',{class:'dr-muted'},' — '+status(t))),
   h('button',{class:'dr-btn dr-small',type:'button',disabled:S.busy,onclick:()=>run(async()=>{const d=await api('POST',`/api/director/games/${S.id}/connections/${t}`);S.token={label,token:d.token,endpoint:d.endpoint};await loadConnections();})},'Issue token'),
   h('button',{class:'dr-btn dr-small dr-quiet',type:'button',disabled:S.busy,onclick:()=>run(async()=>{await api('DELETE',`/api/director/games/${S.id}/connections/${t}`);toast(label+' disconnected.');await loadConnections();})},'Disconnect'));})));
}

// ---------- Reset ----------
function resetCard(){
 const seed=h('input',{id:'dr-reset-seed',inputmode:'numeric',pattern:'[0-9]*',placeholder:'Random',autocomplete:'off'});
 return h('section',{class:'dr-card dr-danger-zone','aria-labelledby':'dr-reset-h'},h('h2',{id:'dr-reset-h'},'Reset game'),
  h('p',{class:'dr-muted dr-small-text'},'Deals a new board, deck and turn order and clears all pieces and hands. Seats, names and agent connections stay. Export first if you may want this state back.'),
  h('label',{for:'dr-reset-seed'},'Seed (optional)'),seed,
  S.confirmReset?h('div',{class:'dr-actions'},
   h('button',{class:'dr-btn dr-danger',type:'button',disabled:S.busy,onclick:()=>run(async()=>{const body={expectedRevision:S.loaded.revision};if(seed.value.trim())body.seed=Number(seed.value);const d=await api('POST',`/api/director/games/${S.id}/reset`,body);S.confirmReset=false;load(await api('GET','/api/director/games/'+S.id));toast(`Game reset (revision ${d.revision}).`);loadList();})},'Confirm reset'),
   h('button',{class:'dr-btn',type:'button',onclick:()=>{S.confirmReset=false;renderMain();}},'Cancel')):
   h('div',{class:'dr-actions'},h('button',{class:'dr-btn',type:'button',disabled:S.busy||S.dirty,title:S.dirty?'Save or discard your edits first':null,onclick:()=>{S.confirmReset=true;renderMain();}},'Reset game…')));
}

// ---------- Revision poll: announce only ----------
setInterval(async()=>{
 if(document.hidden||!S.id||!S.loaded||S.loaded.game.archived)return;
 try{const r=await api('GET',`/api/director/games/${S.id}/revision`);if(r.id===S.id&&r.revision>(S.remoteRevision||0)){S.remoteRevision=r.revision;renderRemote();}}catch{}
},5000);
window.addEventListener('beforeunload',ev=>{if(S.dirty){ev.preventDefault();ev.returnValue='';}});

loadList();select(S.id);
})();
