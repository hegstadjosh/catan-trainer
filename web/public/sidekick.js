// Read-only sidekick connection panel for /game/:id. Loaded before game.js.
// Exposes window.CatanSidekick.render({gameId,status,onChange}) -> <section>.
// All text reaches the DOM through text nodes or setAttribute, never innerHTML.
// The token lives only in the one-time dialog; it is never stored, logged or put in a URL.
(()=>{'use strict';

// ---------- DOM helpers (same shape as game.js) ----------
function setAttrs(el,a){
 if(!a)return;
 for(const [k,v] of Object.entries(a)){
  if(v==null||v===false)continue;
  if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2),v);
  else el.setAttribute(k,v===true?'':String(v));
 }
}
function add(el,kids){for(const k of kids.flat(Infinity)){if(k==null||k===false||k==='')continue;el.append(k instanceof Node?k:String(k));}return el;}
const h=(tag,attrs,...kids)=>{const el=document.createElement(tag);setAttrs(el,attrs);return add(el,kids);};
const enc=encodeURIComponent;
function when(iso){const d=new Date(iso);return isNaN(d)?'at an unknown time':d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'});}

async function api(method,url){
 let r;
 try{r=await fetch(url,{method,credentials:'same-origin',headers:{Accept:'application/json'}});}
 catch{throw new Error('Could not reach the server. Check your connection and try again.');}
 let data=null;try{data=await r.json();}catch{}
 if(!r.ok)throw new Error(r.status===401?'Your session has ended. Sign in again.':(data&&typeof data.error==='string'&&data.error)||`The server could not complete that (error ${r.status}).`);
 return data||{};
}
function toast(text,kind){
 const wrap=document.getElementById('gm-toasts');if(!wrap||!text)return;
 const t=h('div',{class:'gm-toast'+(kind?' gm-toast-'+kind:''),role:kind==='error'?'alert':null},text);
 wrap.append(t);setTimeout(()=>t.remove(),kind==='error'?8000:4000);
}

// ---------- Dialogs: showModal, remove on close, restore focus ----------
function dialog(build,{onClose,label}={}){
 const opener=document.activeElement;
 const d=h('dialog',{class:'gm-dialog','aria-label':label||null});
 const close=()=>{if(d.open)d.close();};
 d.addEventListener('close',()=>{
  d.remove();
  if(opener&&opener.isConnected&&typeof opener.focus==='function')opener.focus();
  onClose&&onClose();
 });
 add(d,[build(close)]);
 document.body.append(d);d.showModal();
 return d;
}
function confirmBox(title,body,okLabel,danger){
 return new Promise(resolve=>{
  let ok=false;
  dialog(close=>h('form',{method:'dialog',class:'gm-dialog-body',onsubmit:e=>{e.preventDefault();ok=true;close();}},
   h('h2',null,title),h('p',null,body),
   h('div',{class:'gm-row gm-end'},h('button',{type:'button',class:'gm-btn',onclick:close},'Cancel'),h('button',{type:'submit',class:'gm-btn '+(danger?'gm-danger':'gm-primary')},okLabel))),{label:title,onClose:()=>resolve(ok)});
 });
}
function copyBlock(label,text){
 const pre=h('pre',{class:'gm-code',tabindex:0},text);
 const btn=h('button',{class:'gm-btn',type:'button','aria-label':'Copy '+label},'Copy');
 btn.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(text);btn.textContent='Copied';setTimeout(()=>{btn.textContent='Copy';},2000);}
  catch{const r=document.createRange();r.selectNodeContents(pre);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);btn.textContent='Press Ctrl/⌘+C';}
 });
 return h('div',{class:'gm-copy'},h('div',{class:'gm-row gm-copy-head'},h('strong',null,label),btn),pre);
}
function absUrl(u,fallbackPath){
 try{const x=new URL(String(u||''),location.origin);if(x.protocol==='https:'||x.protocol==='http:')return x.href;}catch{}
 return location.origin+fallbackPath;
}

// ---------- One-time connection dialog ----------
function showConnection(c,gameId){
 const token=String(c.token||'');
 const endpoint=absUrl(c.endpoint,'/game-info-mcp');
 const eventsUrl=absUrl(c.eventsUrl,'/api/game-events');
 const scriptUrl=location.origin+'/dashboard-assets/catan-sidekick.py';
 const server='catan-sidekick',auth=`Bearer ${token}`;
 const claude=`claude mcp add --transport http ${server} ${endpoint} --header "Authorization: ${auth}"`;
 const codex=`[mcp_servers.${server.replace(/-/g,'_')}]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(auth)} }`;
 const json=JSON.stringify({mcpServers:{[server]:{type:'http',url:endpoint,headers:{Authorization:auth}}}},null,2);
 const prompt=`You are my Catan sidekick. You watch my game and talk it over with me; you cannot make moves. The MCP server "${server}" has three read-only tools:
- game_info {}: the board, my hand (seat 0) and every player's public counts and log.
- game_events {"after": <event id>}: events since that id, to catch up on what changed.
- event_stream_info {}: how the live event feed works.
You see only what I see. Other players' hands and the deck are hidden from you, so reason about them from public information only. When I ask, call game_info first, then give short, concrete advice.`;
 const cursorName='.catan-'+String(gameId).replace(/[^a-zA-Z0-9_-]/g,'')+'-cursor';
 const shell=`curl -fsSLO ${scriptUrl}
read -rs CATAN_SIDEKICK_TOKEN && export CATAN_SIDEKICK_TOKEN   # paste the token, press Enter
python3 catan-sidekick.py --url ${eventsUrl} --cursor ${cursorName} --hook python3 my_agent_hook.py`;
 const hook=`# my_agent_hook.py: receives one event as JSON on stdin; exit 0 = handled.
import json, pathlib, sys
event = json.load(sys.stdin)
seen = pathlib.Path('${cursorName}-handled')
ids = set(seen.read_text().split()) if seen.exists() else set()
if str(event['id']) in ids:
    sys.exit(0)  # already handled: events can repeat after a crash
# Wake your agent here, e.g. run its CLI with the event as context.
with seen.open('a') as f:
    f.write(f"{event['id']}\\n")`;
 dialog(close=>h('div',{class:'gm-dialog-body gm-conn'},
  h('h2',null,'Connect a read-only sidekick'),
  h('div',{class:'gm-warn-box',role:'note'},h('strong',null,'Copy this now. The token is shown only once.'),
   h('p',null,'This browser does not save it. Anyone who has it can read your hand and the public board, but cannot move. Replacing or revoking the sidekick stops this token.'),
   c.expiresAt?h('p',null,`It expires ${when(c.expiresAt)}.`):null),
  h('h3',null,'Simple: talk about the game'),
  h('p',{class:'gm-muted'},'Add the info server to an agent, then chat with it. Use whichever matches your agent; each includes the token.'),
  copyBlock('Claude Code (run in a terminal)',claude),
  copyBlock('Codex (add to ~/.codex/config.toml)',codex),
  copyBlock('Other MCP clients (JSON config)',json),
  copyBlock('Starting prompt',prompt),
  h('details',null,h('summary',null,'Advanced: run a script on every game event'),
   h('p',{class:'gm-muted'},'The listener follows the event feed and runs your hook for each event. Events can repeat after a crash. It saves its place in the cursor file and resumes from there; the feed reconnects about every 25 seconds, which is normal. Nothing wakes your agent unless your hook does it.'),
   h('p',null,h('a',{href:scriptUrl,download:'catan-sidekick.py'},'Download catan-sidekick.py')),
   copyBlock('Terminal',shell),
   h('ul',{class:'gm-muted'},
    h('li',null,'Your hook gets one JSON event on stdin. Exit 0 marks it handled. Any other exit makes the listener retry that event, so no event is skipped.'),
    h('li',null,'An event can arrive twice after a crash. Use event.id to skip repeats.'),
    h('li',null,'Without --hook, the listener prints each event as a JSON line.')),
   copyBlock('Example hook',hook),
   copyBlock('Event feed (SSE, same Bearer token, resumes with Last-Event-ID)',eventsUrl)),
  h('details',null,h('summary',null,'Show the token and endpoint on their own'),copyBlock('Endpoint',endpoint),copyBlock('Token',token)),
  h('div',{class:'gm-row gm-end'},h('button',{type:'button',class:'gm-btn gm-primary',onclick:close},'Done, I copied it'))),{label:'Sidekick connection details'});
}

// ---------- Panel ----------
function render({gameId,status,onChange}={}){
 const section=h('section',{class:'gm-card gm-sidekick','aria-labelledby':'gm-sidekick-h'});
 let st=status&&typeof status==='object'?{connected:!!status.connected,expiresAt:status.expiresAt||null}:null;
 let busy=false;
 const url=`/api/games/${enc(String(gameId||''))}/sidekick/connection`;
 const changed=()=>{try{onChange&&onChange();}catch{}};

 async function create(){
  if(st?.connected&&!await confirmBox('Replace the sidekick token?','The current sidekick token stops working immediately. You will need to give your sidekick the new details.','Replace token'))return;
  busy=true;draw();
  let data;
  try{data=await api('POST',url);}
  catch(e){toast(e.message,'error');busy=false;draw();return;}
  busy=false;st={connected:true,expiresAt:data.expiresAt||null};draw();
  showConnection(data,gameId);
  changed();
 }
 async function revoke(){
  if(!await confirmBox('Revoke the sidekick?','Its token stops working immediately, and any running listener stops.','Revoke',true))return;
  busy=true;draw();
  try{await api('DELETE',url);st={connected:false,expiresAt:null};toast('Sidekick revoked.');changed();}
  catch(e){toast(e.message,'error');}
  busy=false;draw();
 }
 function draw(){
  const had=section.contains(document.activeElement)&&document.activeElement.dataset?.k;
  const line=!st?'Status unknown. Refresh the page to check.':st.connected?`Token active${st.expiresAt?` · expires ${when(st.expiresAt)}`:''}`:'No sidekick connected';
  section.replaceChildren(
   h('h2',{id:'gm-sidekick-h'},'Sidekick (read-only)'),
   h('p',{class:'gm-muted'},'A sidekick is an agent that discusses the game with you. Unlike the agent seats above, it plays no seat and cannot move. It sees what you see: your hand and the public board, never other players’ cards.'),
   h('p',{class:'gm-muted',role:'status'},h('span',{class:'gm-dot'+(st?.connected?' gm-on':''),'aria-hidden':'true'}),line),
   h('div',{class:'gm-row'},
    h('button',{type:'button',class:'gm-btn'+(st?.connected?'':' gm-primary'),'data-k':'sk-conn',disabled:busy,onclick:create},st?.connected?'Replace token':'Connect sidekick'),
    st?.connected?h('button',{type:'button',class:'gm-btn gm-quiet','data-k':'sk-rev',disabled:busy,onclick:revoke},'Revoke'):null));
  if(had){const b=section.querySelector(`[data-k="${had}"]`)||section.querySelector('[data-k="sk-conn"]');b&&b.focus();}
 }
 draw();
 return section;
}

window.CatanSidekick=Object.freeze({render});
})();
