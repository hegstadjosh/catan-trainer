// Match history: /history (library) and /history/:id (replay). Data from /api/history/*.
// All text is inserted with textContent (h() below); no markup strings from data.
(function(){
'use strict';
const boot=JSON.parse(document.getElementById('history-boot').textContent);
const main=document.getElementById('hs-main');
const RES=['brick','lumber','wool','grain','ore'];
const {RES_COLOR,RES_NAME}=window.CatanBoard;
const PHASE={setupSettlement:'to place a settlement',setupRoad:'to place a road',roll:'to roll',discard:'discarding',robber:'to move the robber',main:'to build, trade or end the turn',roadBuilding:'to place free roads'};
const DEV={knight:'Knight',victoryPoint:'Victory point',roadBuilding:'Road building',yearOfPlenty:'Year of plenty',monopoly:'Monopoly'};
const PROB={2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};

function h(tag,attrs,...kids){
 const el=document.createElement(tag);
 for(const [k,v] of Object.entries(attrs||{})){
  if(v==null||v===false)continue;
  if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(k==='class')el.className=v;else el.setAttribute(k,v===true?'':String(v));
 }
 for(const k of kids.flat())if(k!=null&&k!==false)el.append(k instanceof Node?k:document.createTextNode(String(k)));
 return el;
}
const NS='http://www.w3.org/2000/svg';
function s(tag,attrs,...kids){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs||{}))if(v!=null)el.setAttribute(k,String(v));for(const k of kids)if(k!=null)el.append(k instanceof Node?k:document.createTextNode(String(k)));return el;}
function toast(text,link){const t=h('div',{class:'hs-toast',role:'status'},text,link?[' ',h('a',{href:link.href},link.text)]:null);document.getElementById('hs-toasts').append(t);setTimeout(()=>t.remove(),link?12000:6000);}
async function api(path,opts={}){
 const res=await fetch(path,{method:opts.method||'GET',credentials:'same-origin',headers:opts.body?{'Content-Type':'application/json'}:{},body:opts.body?JSON.stringify(opts.body):undefined});
 if(res.status===401){location.href='/signin?next='+encodeURIComponent(location.pathname);throw new Error('Please sign in again.');}
 const data=await res.json().catch(()=>({error:'Unexpected response.'}));
 if(!res.ok){const e=new Error(data.error||'Request failed.');e.status=res.status;e.data=data;throw e;}
 return data;
}
const fmtTime=iso=>{if(!iso)return '';const d=new Date(iso);return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
const dot=color=>h('span',{class:'hs-dot',style:'background:'+color,'aria-hidden':'true'});
const chips=(hand,{empty='—'}={})=>{const list=RES.filter(r=>hand&&hand[r]>0);return list.length?h('span',{class:'hs-chips'},list.map(r=>h('span',{class:'hs-chip',title:RES_NAME[r]},h('i',{style:'background:'+RES_COLOR[r],'aria-hidden':'true'}),h('span',{class:'hs-sr'},RES_NAME[r]+' '),String(hand[r])))):h('span',{class:'hs-muted'},empty);};
const statusText={setup:'Setup',playing:'In progress',finished:'Finished'};

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
let filter='all';
async function library(){
 document.title='Match history · Catan field guide';
 let matches;
 try{({matches}=await api('/api/history'));}catch(e){main.replaceChildren(h('p',{class:'hs-error',role:'alert'},e.message));return;}
 const groups={all:m=>true,playing:m=>!m.archived&&m.status!=='finished',finished:m=>m.status==='finished',archived:m=>m.archived};
 const labels={all:'All',playing:'In progress',finished:'Finished',archived:'Archived'};
 const draw=()=>{
  const shown=matches.filter(groups[filter]);
  const seg=h('div',{class:'hs-seg',role:'group','aria-label':'Show'},Object.keys(groups).map(k=>h('button',{type:'button','aria-pressed':String(filter===k),onclick:()=>{filter=k;draw();}},labels[k],h('span',{class:'hs-count'},String(matches.filter(groups[k]).length)))));
  const rows=shown.map(m=>h('li',{class:'hs-lib-row'},
   h('div',{class:'hs-lib-title'},h('a',{href:'/history/'+m.id},m.title),
    m.branchedFrom?h('small',{class:'hs-muted'},'Practice from move '+m.branchedFrom.move):null),
   h('div',{class:'hs-lib-players'},m.players.map(p=>h('span',{class:'hs-pl'+(m.winner===p.seat?' hs-win':'')},dot(p.color),p.name,h('b',null,String(p.seat===0?m.yourVP:p.publicVP)),m.winner===p.seat?h('span',{class:'hs-sr'},' (winner)'):null))),
   h('div',{class:'hs-lib-status'},h('span',{class:'hs-tag hs-'+(m.archived?'archived':m.status)},m.archived?'Archived':statusText[m.status]),h('span',{class:'hs-muted'},`${m.moves} moves`+(m.notes||m.bookmarks?` · ${m.notes} notes · ${m.bookmarks} bookmarks`:''))),
   h('div',{class:'hs-lib-when hs-muted'},fmtTime(m.updatedAt)),
   h('div',{class:'hs-lib-act'},h('a',{class:'hs-btn',href:'/history/'+m.id},'Replay'),h('a',{class:'hs-btn',href:'/practice/'+m.id},'Decision practice'),m.resumeUrl?h('a',{class:'hs-btn hs-primary',href:'/game/'+m.id},'Resume'):null)));
  main.replaceChildren(
   h('div',{class:'hs-head'},h('div',null,h('h1',null,'Match history'),h('p',{class:'hs-muted'},'Every game you play is saved here. Resume unfinished games or replay any game move by move.')),seg),
   shown.length?h('ul',{class:'hs-lib'},rows):h('p',{class:'hs-empty'},matches.length?'No games in this group.':'No games yet. ',matches.length?null:h('a',{href:'/game'},'Start a game')));
 };
 draw();
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------
const S={match:null,rev:1,perspective:'human',reveal:false,cache:new Map(),pos:null,loading:0,editing:null};
const colors=()=>S.match.players.map(p=>p.color),names=()=>S.match.players.map(p=>p.name);
const nameOf=seat=>S.match.players[seat]?.name??'—';
const T=r=>S.match.timeline[r-1];
const q=()=>`perspective=${S.perspective}${S.reveal?'&reveal=1':''}`;

async function loadMatch(){
 const m=await api(`/api/history/${boot.gameId}?${q()}`);
 S.match=m;S.cache.clear();
 return m;
}
async function replay(){
 try{await loadMatch();}catch(e){main.replaceChildren(h('p',{class:'hs-error',role:'alert'},e.status===404?'This game was not found in your account.':e.message),h('p',null,h('a',{href:'/history'},'Back to match history')));return;}
 document.title=S.match.game.title+' · Replay · Catan field guide';
 S.rev=Math.min(Math.max(1,boot.revision||S.match.game.revision),S.match.game.revision);
 layout();
 await seek(S.rev);
 document.addEventListener('keydown',keys);
}

function layout(){
 const g=S.match.game;
 main.replaceChildren(...[
  h('div',{class:'hs-crumb'},h('a',{href:'/history'},'← Match history')),
  h('div',{class:'hs-head'},
   h('div',null,h('h1',null,g.title),h('p',{class:'hs-muted'},h('span',{class:'hs-tag hs-'+(g.archived?'archived':g.status)},g.archived?'Archived':statusText[g.status]),` ${g.moves} moves`,g.branchedFrom?[' · ',h('a',{href:'/history/'+g.branchedFrom.id+'?revision='+g.branchedFrom.revision},'practice from move '+g.branchedFrom.move)]:null)),
   h('div',{class:'hs-head-act'},g.resumeUrl?h('a',{class:'hs-btn hs-primary',href:'/game/'+g.id},'Resume game'):null,perspectiveControl())),
  S.match.coverage.note?h('p',{class:'hs-notice'},S.match.coverage.note):null,
  S.perspective==='full'?h('div',{class:'hs-full',role:'note'},h('strong',null,'Full information'),' Every hand, development card and the deck order are visible. This is not what you saw during the game.',h('button',{type:'button',class:'hs-btn',onclick:()=>setPerspective('human')},'Return to your view')):null,
  h('div',{id:'hs-confirm'}),
  h('div',{class:'hs-grid'},
   h('section',{class:'hs-stage','aria-label':'Board'},h('div',{id:'hs-board',class:'hs-board'}),scrubber(),h('div',{id:'hs-event',class:'hs-event','aria-live':'polite'})),
   h('section',{class:'hs-side','aria-label':'Position'},h('div',{id:'hs-pos'}),h('div',{id:'hs-notes'}),h('div',{id:'hs-practice'})),
   h('section',{class:'hs-moves-wrap','aria-label':'Moves'},h('h2',null,'Moves'),movesList())),
  h('section',{class:'hs-charts','aria-label':'Timeline'},h('h2',null,'Timeline'),h('div',{id:'hs-charts'})),
  h('section',{class:'hs-summary','aria-label':'Production and spending'},h('div',{id:'hs-summary'}))].filter(Boolean));
 drawCharts();drawSummary();
}

function perspectiveControl(){
 return h('div',{class:'hs-seg',role:'group','aria-label':'Perspective'},
  h('button',{type:'button','aria-pressed':String(S.perspective==='human'),onclick:()=>setPerspective('human')},'Your view'),
  h('button',{type:'button','aria-pressed':String(S.perspective==='full'),onclick:()=>setPerspective('full')},'Full information…'));
}
async function setPerspective(p,confirmed=false){
 if(p===S.perspective)return;
 const box=document.getElementById('hs-confirm');
 if(p==='full'&&!confirmed){
  const unfinished=S.match.game.status!=='finished';
  box.replaceChildren(h('div',{class:'hs-confirm',role:'alertdialog','aria-label':'Show full information'},
   h('p',null,h('strong',null,'Show full information? '),unfinished?'This game is not finished. Full information shows every player’s hand, their development cards and the deck order, which you could not see while playing.':'This shows every player’s hand, their development cards and the deck order at each move, which you could not see while playing.'),
   h('div',{class:'hs-row'},h('button',{type:'button',class:'hs-btn hs-danger',onclick:()=>setPerspective('full',true)},'Show full information'),h('button',{type:'button',class:'hs-btn',onclick:()=>box.replaceChildren()},'Cancel'))));
  box.querySelector('.hs-danger').focus();
  return;
 }
 S.perspective=p;S.reveal=p==='full'&&S.match.game.status!=='finished';
 try{await loadMatch();}catch(e){toast(e.message);S.perspective='human';S.reveal=false;return;}
 layout();await seek(S.rev);
}

function scrubber(){
 const max=S.match.game.revision;
 const btn=(label,text,fn,key)=>h('button',{type:'button',class:'hs-btn hs-icon','aria-label':label,title:label+(key?` (${key})`:''),onclick:fn},text);
 return h('div',{class:'hs-scrub'},
  btn('Start','⏮',()=>seek(1),'Home'),btn('Previous move','◀',()=>seek(S.rev-1),'←'),
  h('input',{type:'range',id:'hs-range',min:1,max,value:S.rev,step:1,'aria-label':'Move','aria-valuetext':'',oninput:e=>seek(+e.target.value,{debounce:true})}),
  btn('Next move','▶',()=>seek(S.rev+1),'→'),btn('Latest','⏭',()=>seek(max),'End'),
  h('button',{type:'button',id:'hs-bm',class:'hs-btn','aria-pressed':'false',title:'Bookmark this move (B)',onclick:toggleBookmark},'☆ Bookmark'),
  h('p',{class:'hs-keys hs-muted'},'← → step · Shift ×10 · Home/End · B bookmark · [ ] previous/next note'));
}
function movesList(){
 const marks=noteMarks();
 return h('ol',{class:'hs-moves',id:'hs-moves'},S.match.timeline.map(t=>h('li',null,h('button',{type:'button',class:'hs-move','data-rev':t.revision,onclick:()=>seek(t.revision)},
  h('span',{class:'hs-mnum'},String(t.move)),
  t.actorSeat!=null?dot(S.match.players[t.actorSeat]?.color||'#999'):h('span',{class:'hs-dot hs-dot-none','aria-hidden':'true'}),
  h('span',{class:'hs-mtext'},t.lines.join(' ')||'—'),
  marks.get(t.revision)?h('span',{class:'hs-mark',title:marks.get(t.revision)},marks.get(t.revision).includes('bookmark')?'★':'✎'):null,
  t.board==='unrecorded'?h('span',{class:'hs-sr'},' (board not recorded)'):null))));
}
function noteMarks(){const m=new Map();for(const n of S.match.notes)m.set(n.revision,(m.get(n.revision)?m.get(n.revision)+', ':'')+n.kind);return m;}

let seekTimer=null,seekToken=0;
async function seek(rev,{debounce=false}={}){
 const max=S.match.game.revision;rev=Math.min(Math.max(1,rev|0),max);
 S.rev=rev;
 const range=document.getElementById('hs-range');if(range){range.value=rev;range.setAttribute('aria-valuetext',`Move ${rev-1} of ${max-1}`);}
 history.replaceState(null,'',`/history/${boot.gameId}?revision=${rev}`);
 highlightMove();drawCursor();
 clearTimeout(seekTimer);
 if(debounce){seekTimer=setTimeout(()=>load(rev),120);return;}
 await load(rev);
}
async function load(rev){
 const token=++seekToken,key=rev+'|'+q();
 let pos=S.cache.get(key);
 if(!pos){
  document.getElementById('hs-board')?.classList.add('hs-dim');
  try{pos=await api(`/api/history/${boot.gameId}/positions/${rev}?${q()}`);S.cache.set(key,pos);}
  catch(e){if(token===seekToken)toast(e.message);return;}
  finally{document.getElementById('hs-board')?.classList.remove('hs-dim');}
 }
 if(token!==seekToken)return;
 S.pos=pos;drawPosition();
 for(const n of [rev+1,rev-1])if(n>=1&&n<=S.match.game.revision&&!S.cache.has(n+'|'+q()))api(`/api/history/${boot.gameId}/positions/${n}?${q()}`).then(p=>S.cache.set(n+'|'+q(),p)).catch(()=>{});
}
function highlightMove(){
 const list=document.getElementById('hs-moves');if(!list)return;
 list.querySelector('[aria-current]')?.removeAttribute('aria-current');
 const b=list.querySelector(`[data-rev="${S.rev}"]`);if(b){b.setAttribute('aria-current','step');b.scrollIntoView({block:'nearest'});}
}

function drawPosition(){
 const p=S.pos,t=T(p.revision),board=document.getElementById('hs-board');
 const turnInfo=p.view?`Turn ${p.view.turn}`:(t.turn!=null?`Turn ${t.turn}`:null);
 const label=`Board after move ${p.move}`;
 if(p.board==='recorded')board.replaceChildren(window.CatanBoard.render(p.view.board,{colors:colors(),names:names(),dice:p.view.dice,label}));
 else board.replaceChildren(h('div',{class:'hs-unrec'},h('strong',null,'Board not recorded for this move'),h('p',null,p.note)));
 // event caption
 const ev=p.event;
 document.getElementById('hs-event').replaceChildren(
  h('p',{class:'hs-evhead'},h('strong',null,p.move===0?'Starting position':`Move ${p.move}`),turnInfo?` · ${turnInfo}`:null,ev?.dice?` · rolled ${ev.dice.total}`:null,ev?.at?h('span',{class:'hs-muted'},' · '+fmtTime(ev.at)):null),
  ev?h('ul',{class:'hs-evlines'},ev.lines.map(l=>h('li',null,l))):h('p',{class:'hs-muted'},'No event text was recorded for this move.'));
 drawSide();drawNotes();drawPractice();
 const bm=document.getElementById('hs-bm'),has=S.match.notes.some(n=>n.revision===S.rev&&n.kind==='bookmark');
 bm.setAttribute('aria-pressed',String(has));bm.textContent=has?'★ Bookmarked':'☆ Bookmark';
}

function drawSide(){
 const p=S.pos,box=document.getElementById('hs-pos'),v=p.view;
 const kids=[];
 if(v){
  const cur=v.phase==='finished'?(v.winner!=null?`${nameOf(v.winner)} won`:'Game over'):`${nameOf(v.currentSeat)} ${PHASE[v.turnPhase]||''}`;
  kids.push(h('p',{class:'hs-now'},dot(colors()[v.currentSeat]||'#999'),cur));
  const full=p.full?.available?p.full.seats:null;
  const rows=v.players.map(pl=>h('tr',{class:pl.seat===v.currentSeat?'hs-cur':null},
   h('th',{scope:'row'},dot(pl.color),pl.name,pl.seat===0&&pl.name!=='You'?h('span',{class:'hs-muted'},' (you)'):null),
   h('td',null,String(full?full[pl.seat].totalVP:pl.seat===0?v.me.totalVP:pl.publicVP)),
   h('td',null,String(pl.resourceCount)),h('td',null,String(pl.devCardCount)),h('td',null,String(pl.knightsPlayed)),
   h('td',null,String(pl.roadLength),pl.longestRoad?h('abbr',{title:'Longest road',class:'hs-award'},' LR'):null,pl.largestArmy?h('abbr',{title:'Largest army',class:'hs-award'},' LA'):null)));
  kids.push(h('table',{class:'hs-table'},h('caption',{class:'hs-sr'},'Players at this move'),h('thead',null,h('tr',null,['Player','VP','Cards','Dev','Knights','Road'].map(c=>h('th',{scope:'col'},c)))),h('tbody',null,rows)));
  if(full){
   kids.push(h('h3',null,'Every hand ',h('span',{class:'hs-full-tag'},'full information')),
    h('ul',{class:'hs-hands'},full.map(fs=>h('li',null,h('span',{class:'hs-hname'},dot(colors()[fs.seat]),fs.name),chips(fs.resources,{empty:'no cards'}),fs.devCards.length?h('span',{class:'hs-muted hs-dev'},fs.devCards.map(c=>DEV[c.type]||c.type).join(', ')):null))),
    h('details',{class:'hs-deck'},h('summary',null,`Development deck: ${p.full.devDeck.length} cards`),h('p',{class:'hs-muted'},'Stored order: '+(p.full.devDeck.map(c=>DEV[c]||c).join(', ')||'empty'))));
  }else if(p.perspective==='full'&&p.full&&!p.full.available)kids.push(h('p',{class:'hs-notice'},p.full.reason));
  kids.push(h('h3',null,'Your hand'),h('p',null,chips(v.me.resources,{empty:'No resource cards'})),
   v.me.devCards.length?h('p',{class:'hs-muted'},'Development cards: '+v.me.devCards.map(c=>DEV[c.type]||c.type).join(', ')):null,
   h('p',{class:'hs-muted hs-small'},'Bank: ',RES.map(r=>`${RES_NAME[r]} ${v.bank[r]}`).join(' · '),` · Deck ${v.devDeckCount}`));
 }else{
  kids.push(h('p',{class:'hs-now'},p.currentSeat!=null?[dot(colors()[p.currentSeat]||'#999'),`${nameOf(p.currentSeat)} ${PHASE[p.turnPhase]||''}`]:'—'),
   h('h3',null,'Your hand'),h('p',null,p.yourHand?chips(p.yourHand,{empty:'No resource cards'}):h('span',{class:'hs-muted'},'Not recorded')),
   h('p',{class:'hs-muted hs-small'},'Other players’ counts were not recorded for this move.'));
  if(p.perspective==='full'&&p.full)kids.push(h('p',{class:'hs-notice'},p.full.reason));
 }
 box.replaceChildren(...kids.filter(Boolean));
}

function drawNotes(){
 const box=document.getElementById('hs-notes'),here=S.match.notes.filter(n=>n.revision===S.rev&&n.kind!=='bookmark');
 const kind=h('select',{'aria-label':'Kind'},h('option',{value:'note'},'Note'),h('option',{value:'prediction'},'Prediction'));
 const text=h('textarea',{id:'hs-note-text',rows:3,maxlength:4000,placeholder:'What you noticed, or what you think happens next…','aria-label':'Note for this move'});
 const form=h('form',{class:'hs-note-form',onsubmit:async e=>{e.preventDefault();const body=text.value.trim();if(!body)return text.focus();
  try{const {note}=await api(`/api/history/${boot.gameId}/notes`,{method:'POST',body:{revision:S.rev,kind:kind.value,body}});S.match.notes.push(note);text.value='';refreshMarks();drawNotes();toast('Note saved.');}catch(err){toast(err.message);}}},
  text,h('div',{class:'hs-row'},kind,h('button',{type:'submit',class:'hs-btn hs-primary'},'Save note')));
 box.replaceChildren(h('h2',null,`Notes at ${S.rev===1?'the start':'move '+(S.rev-1)}`),
  here.length?h('ul',{class:'hs-notes'},here.map(noteItem)):h('p',{class:'hs-muted hs-small'},'No notes here yet.'),form);
}
function noteItem(n){
 if(S.editing?.id===n.id){
  const text=h('textarea',{rows:3,maxlength:4000,'aria-label':'Edit note'});text.value=S.editing.draft??n.body;
  text.addEventListener('input',()=>{S.editing.draft=text.value;});
  const save=async()=>{try{const {note}=await api(`/api/history/${boot.gameId}/notes/${n.id}`,{method:'PATCH',body:{expectedVersion:n.version,body:text.value}});replaceNote(note);S.editing=null;drawNotes();toast('Note updated.');}
   catch(e){if(e.data?.code==='version_conflict'&&e.data.note){replaceNote(e.data.note);S.editing={id:n.id,draft:text.value,conflict:e.data.note.body};drawNotes();}else toast(e.message);}};
  setTimeout(()=>text.focus());
  return h('li',{class:'hs-note hs-editing'},S.editing.conflict!=null?h('p',{class:'hs-notice',role:'alert'},'This note changed elsewhere. It now reads: “',S.editing.conflict,'”. Your edit is below; save again to replace it.'):null,text,
   h('div',{class:'hs-row'},h('button',{type:'button',class:'hs-btn hs-primary',onclick:save},'Save'),h('button',{type:'button',class:'hs-btn',onclick:()=>{S.editing=null;drawNotes();}},'Cancel')));
 }
 return h('li',{class:'hs-note'},h('span',{class:'hs-tag hs-'+n.kind},n.kind==='prediction'?'Prediction':'Note'),h('p',{class:'hs-body'},n.body),
  h('div',{class:'hs-row hs-small'},h('span',{class:'hs-muted'},fmtTime(n.updatedAt)),
   h('button',{type:'button',class:'hs-link',onclick:()=>{S.editing={id:n.id};drawNotes();}},'Edit'),
   h('button',{type:'button',class:'hs-link',onclick:()=>removeNote(n)},'Delete')));
}
function replaceNote(note){const i=S.match.notes.findIndex(x=>x.id===note.id);if(i>=0)S.match.notes[i]=note;else S.match.notes.push(note);}
async function removeNote(n){
 try{await api(`/api/history/${boot.gameId}/notes/${n.id}`,{method:'DELETE',body:{expectedVersion:n.version}});S.match.notes=S.match.notes.filter(x=>x.id!==n.id);refreshMarks();drawNotes();drawPosition();toast('Deleted.');}
 catch(e){if(e.data?.note){replaceNote(e.data.note);drawNotes();}toast(e.message);}
}
async function toggleBookmark(){
 const bm=S.match.notes.find(n=>n.revision===S.rev&&n.kind==='bookmark');
 try{
  if(bm){await api(`/api/history/${boot.gameId}/notes/${bm.id}`,{method:'DELETE',body:{expectedVersion:bm.version}});S.match.notes=S.match.notes.filter(x=>x.id!==bm.id);}
  else{const {note}=await api(`/api/history/${boot.gameId}/notes`,{method:'POST',body:{revision:S.rev,kind:'bookmark'}});replaceNote(note);}
  refreshMarks();drawPosition();
 }catch(e){toast(e.message);}
}
function refreshMarks(){const old=document.getElementById('hs-moves');if(old){const top=old.scrollTop;const fresh=movesList();old.replaceWith(fresh);fresh.scrollTop=top;highlightMove();}drawCharts();}

function drawPractice(){
 const p=S.pos,box=document.getElementById('hs-practice');
 const btn=h('button',{type:'button',class:'hs-btn',disabled:!p.canBranch,onclick:async()=>{btn.disabled=true;
  try{const r=await api(`/api/history/${boot.gameId}/branch`,{method:'POST',body:{revision:S.rev}});toast('Practice game created. The original is unchanged.',{href:'/game/'+r.game.id,text:'Open practice game'});}
  catch(e){toast(e.message);}finally{btn.disabled=!p.canBranch;}}},'Practice from this move');
 box.replaceChildren(h('h2',null,'Practice'),h('p',{class:'hs-muted hs-small'},'Fair decision practice hides later moves, locks your prediction before reveal, then compares plans across sampled plausible futures.'),h('a',{class:'hs-btn hs-primary',href:'/practice/'+boot.gameId},'Open decision practice'),
  h('p',{class:'hs-muted hs-small'},p.canBranch?'Start a new game from this exact position. Agent connections are not copied; connect agents in the new game.':'This move has no recorded board, so it cannot become a practice game.'),
  p.canBranch?h('p',{class:'hs-small hs-warn'},'Exact copy: it keeps every hidden hand, the deck order and any dice seed. Playing it forward can show what comes next in the original'+(S.match?.game?.status==='finished'?'.':', which is still unfinished.')):null,btn);
}

function keys(e){
 const tag=e.target.tagName;
 if(tag==='TEXTAREA'||tag==='SELECT'||(tag==='INPUT'&&e.target.type!=='range')||e.metaKey||e.ctrlKey||e.altKey)return;
 const step=e.shiftKey?10:1,marks=[...new Set(S.match.notes.map(n=>n.revision))].sort((a,b)=>a-b);
 const map={ArrowLeft:()=>seek(S.rev-step),ArrowRight:()=>seek(S.rev+step),Home:()=>seek(1),End:()=>seek(S.match.game.revision),
  b:toggleBookmark,B:toggleBookmark,'[':()=>{const r=marks.filter(x=>x<S.rev).at(-1);if(r)seek(r);},']':()=>{const r=marks.find(x=>x>S.rev);if(r)seek(r);}};
 const fn=map[e.key];if(!fn)return;
 e.preventDefault();fn();
}

// ---------------------------------------------------------------------------
// Charts: public VP and cards in hand per seat; click to seek.
// ---------------------------------------------------------------------------
function chart(title,series,maxY){
 const W=640,H=130,P={l:26,r:8,t:8,b:18},n=S.match.game.revision;
 const x=r=>P.l+(n<=1?0:(r-1)/(n-1))*(W-P.l-P.r),y=v=>H-P.b-(v/Math.max(1,maxY))*(H-P.t-P.b);
 const svg=s('svg',{viewBox:`0 0 ${W} ${H}`,class:'hs-chart',role:'img','aria-label':title});
 for(const v of [0,Math.ceil(maxY/2),maxY])svg.append(s('line',{x1:P.l,x2:W-P.r,y1:y(v),y2:y(v),class:'hs-grid'}),s('text',{x:P.l-5,y:y(v)+4,class:'hs-axis','text-anchor':'end'},String(v)));
 series.forEach(sr=>{let d='',pen=false;sr.values.forEach((v,i)=>{if(v==null){pen=false;return;}d+=(pen?'L':'M')+x(i+1).toFixed(1)+' '+y(v).toFixed(1);pen=true;});svg.append(s('path',{d,fill:'none',stroke:sr.color,'stroke-width':sr.width||2,'stroke-linejoin':'round'},s('title',null,sr.name)));});
 svg.append(s('line',{class:'hs-cursor',y1:P.t,y2:H-P.b,x1:x(S.rev),x2:x(S.rev)}));
 svg.addEventListener('click',e=>{const b=svg.getBoundingClientRect(),px=(e.clientX-b.left)/b.width*W;seek(Math.round((px-P.l)/(W-P.l-P.r)*(n-1))+1);});
 svg.dataset.n=n;svg.dataset.l=P.l;svg.dataset.w=W-P.l-P.r;
 return h('figure',{class:'hs-fig'},h('figcaption',null,title),svg,h('div',{class:'hs-legend'},series.map(sr=>h('span',null,dot(sr.color),sr.name))));
}
function drawCharts(){
 const box=document.getElementById('hs-charts');if(!box)return;
 const tl=S.match.timeline,pl=S.match.players;
 const vp=pl.map(p=>({name:p.name,color:p.color,values:tl.map(t=>t.seats?t.seats[p.seat].publicVP:null)}));
 const cards=pl.map(p=>({name:p.name+(p.seat===0&&p.name!=='You'?' (you)':''),color:p.color,values:tl.map(t=>t.seats?t.seats[p.seat].resourceCount:p.seat===0&&t.yourHand?RES.reduce((a,r)=>a+t.yourHand[r],0):null)}));
 const maxOf=ss=>Math.max(2,...ss.flatMap(x=>x.values.filter(v=>v!=null)));
 const recorded=tl.some(t=>t.seats);
 box.replaceChildren(...[chart('Victory points (public)',vp,Math.max(10,maxOf(vp))),chart('Cards in hand',cards,maxOf(cards)),
  recorded?null:h('p',{class:'hs-muted hs-small'},'Other players’ points and card counts appear only for moves with a recorded board.')].filter(Boolean));
}
function drawCursor(){document.querySelectorAll('.hs-chart').forEach(svg=>{const c=svg.querySelector('.hs-cursor'),n=+svg.dataset.n,x=+svg.dataset.l+(n<=1?0:(S.rev-1)/(n-1))*+svg.dataset.w;c.setAttribute('x1',x);c.setAttribute('x2',x);});}

function drawSummary(){
 const sm=S.match.summary,box=document.getElementById('hs-summary'),pl=S.match.players,fin=S.match.game.status==='finished';
 const rows=sm.seats.map(x=>h('tr',null,h('th',{scope:'row'},dot(pl[x.seat].color),pl[x.seat].name),
  h('td',null,chips(x.seat===0&&sm.you.countedRolls>=sm.production.countedRolls?sm.you.produced:x.produced)),h('td',null,chips(x.spent)),
  h('td',null,`${x.built.road} / ${x.built.settlement} / ${x.built.city} / ${x.built.devCard}`),h('td',null,String(x.bankTrades)),h('td',null,String(x.totalVP??x.publicVP))));
 const maxD=Math.max(1,...Object.values(sm.dice)),exp=r=>sm.rolls*PROB[r]/36;
 const bars=h('div',{class:'hs-dice',role:'img','aria-label':'Dice rolls: '+Object.entries(sm.dice).map(([k,v])=>`${k}: ${v}`).join(', ')},
  Object.entries(sm.dice).map(([k,v])=>h('div',{class:'hs-die'},h('div',{class:'hs-die-bar'},h('span',{class:'hs-die-exp',style:`bottom:${(exp(k)/Math.max(maxD,exp(7)))*100}%`}),h('span',{class:'hs-die-fill',style:`height:${(v/Math.max(maxD,exp(7)))*100}%`})),h('b',null,String(v)),h('small',null,k))));
 box.replaceChildren(h('h2',null,fin?'Postgame: production and spending':'Production and spending so far'),
  h('div',{class:'hs-sum-grid'},
   h('div',null,h('table',{class:'hs-table'},h('thead',null,h('tr',null,['Player','Produced','Spent','Roads / settl. / cities / dev','Bank trades','VP'].map(c=>h('th',{scope:'col'},c)))),h('tbody',null,rows)),
    h('p',{class:'hs-muted hs-small'},[sm.production.note,sm.hidden,'Spent counts paid builds only; setup and Road Building pieces are free.'].filter(Boolean).join(' '))),
   h('figure',{class:'hs-fig'},h('figcaption',null,`Dice: ${sm.rolls} rolls (line = expected)`),bars)));
}

if(boot.badPath)main.replaceChildren(h('p',{class:'hs-error'},'That replay link is not valid. '),h('a',{href:'/history'},'Match history'));
else if(boot.gameId)replay();else library();
})();
