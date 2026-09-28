import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {GameStore,bearerToken,eventCursor} from '../lib/game-store.mjs';
import {gameRoutes} from '../lib/game-routes.mjs';
import {gameMcpRoutes} from '../lib/game-mcp.mjs';
import {gameObserverRoutes} from '../lib/game-observer.mjs';
import {createMatch,viewMatch,legalActions} from '../game/rules.mjs';

// In-memory stand-in for the few supabase-js calls GameStore makes, including the atomic commit RPC.
const KEYS={catan_game_seats:['game_id','seat'],catan_game_observers:['game_id'],catan_games:['id']};
class Query{
 constructor(db,table){Object.assign(this,{db,table,filters:[],op:'select'});}
 select(){if(this.op==='select')this.op='select';return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
 gt(k,v){this.filters.push(r=>r[k]>v);return this;}
 order(k){this.sortKey=k;return this;}
 limit(n){this.max=n;return this;}
 insert(row){this.op='insert';this.row=row;return this;}
 upsert(row){this.op='upsert';this.row=row;return this;}
 update(patch){this.op='update';this.patch=patch;return this;}
 maybeSingle(){this.one='maybe';return this;}
 single(){this.one='single';return this;}
 run(){
  const rows=this.db.tables[this.table]??=[];
  if(this.db.fail)return {data:null,error:{message:'down'}};
  if(this.op==='insert'){const row={revision:1,updated_at:new Date().toISOString(),archived_at:null,...this.row};rows.push(row);return {data:structuredClone(row),error:null};}
  if(this.op==='upsert'){const key=KEYS[this.table],i=rows.findIndex(r=>key.every(k=>r[k]===this.row[k]));if(i>=0)rows[i]={...rows[i],...this.row};else rows.push({...this.row});return {data:null,error:null};}
  let hit=rows.filter(r=>this.filters.every(f=>f(r)));
  if(this.op==='update'){for(const r of hit)Object.assign(r,this.patch);return {data:null,error:null};}
  if(this.sortKey)hit=hit.toSorted((a,b)=>a[this.sortKey]-b[this.sortKey]);
  if(this.max)hit=hit.slice(0,this.max);
  hit=structuredClone(hit);
  return {data:this.one?hit[0]??null:hit,error:null};
 }
 then(ok,bad){return Promise.resolve().then(()=>this.run()).then(ok,bad);}
}
class FakeDb{
 tables={};
 from(t){return new Query(this,t);}
 rpc(name,a){const db=this;return {maybeSingle:()=>Promise.resolve().then(()=>{
  const g=db.tables.catan_games.find(r=>r.id===a.p_game_id&&r.revision===a.p_expected_revision&&!r.archived_at);
  if(!g)return {data:null,error:null};
  Object.assign(g,{state:a.p_state,revision:g.revision+1,updated_at:new Date().toISOString()});
  (db.tables.catan_game_events??=[]).push({game_id:g.id,revision:g.revision,payload:structuredClone(a.p_event),created_at:g.updated_at});
  return {data:structuredClone(g),error:null};})};}
}

async function harness(opts){
 const db=new FakeDb(),store=new GameStore(db),app=express();app.use(express.json());
 gameMcpRoutes(app,()=>store);gameObserverRoutes(app,()=>store,opts);
 app.use((q,r,n)=>{q.user={id:q.get('x-user')};n();});gameRoutes(app,()=>store);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;process.env.SITE_URL=base;
 const clients=[];
 const mcp=async(path,token)=>{const c=new Client({name:'t',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(base+path),{requestInit:{headers:{Authorization:'Bearer '+token}}}));clients.push(c);return c;};
 const api=(method,path,user,body)=>fetch(base+path,{method,headers:{'x-user':user,'content-type':'application/json'},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 return {db,store,base,mcp,api,close:async()=>{for(const c of clients)await c.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';

test('header, cursor and error helpers are strict',()=>{
 const h=v=>bearerToken({headers:{authorization:v}});
 assert.equal(h('Bearer catan_seat_abc'),'catan_seat_abc');assert.equal(h('bearer abc'),'abc');
 for(const bad of [undefined,'','Basic abc','Bearer','Bearer a b','Bearer a,b','abc'])assert.equal(h(bad),null);
 assert.equal(eventCursor(undefined),0);assert.equal(eventCursor('42'),42);
 for(const bad of ['-1','1.5','1e3',' 4','0x10',['1'],'99999999999999999'])assert.equal(eventCursor(bad),null);
});

test('owner routes: ownership, malformed input and 500 for unexpected errors',async()=>{
 const h=await harness();
 try{
  const created=await (await h.api('POST','/api/games',OWNER,{title:'Mine'})).json();const id=created.game.id;
  assert.equal((await h.api('GET','/api/games/'+id,OTHER)).status,404);
  assert.equal((await h.api('POST','/api/games/'+id+'/sidekick/connection',OTHER)).status,404);
  assert.equal((await h.api('POST','/api/games/'+id+'/seats/1/connection',OTHER)).status,404);
  assert.equal((await h.api('GET','/api/games/not-a-uuid',OWNER)).status,404);
  for(const seat of ['0','4','1.0','01','x'])assert.equal((await h.api('POST',`/api/games/${id}/seats/${seat}/connection`,OWNER)).status,400,seat);
  assert.equal((await h.api('POST','/api/games',OWNER,{title:42})).status,400);
  assert.equal((await h.api('POST','/api/games',OWNER,'[1]')).status,400);
  assert.equal((await h.api('POST','/api/games',OWNER,{names:['a','b']})).status,400);
  assert.equal((await h.api('POST',`/api/games/${id}/actions`,OWNER)).status,400,'missing body');
  assert.equal((await h.api('POST',`/api/games/${id}/actions`,OWNER,{expectedRevision:1,action:'roll'})).status,400);
  const rule=await h.api('POST',`/api/games/${id}/actions`,OWNER,{expectedRevision:1,action:{type:'nope'}});assert.equal(rule.status,400);assert.equal((await rule.json()).code,'bad_action');
  assert.equal((await h.api('POST',`/api/games/${id}/actions`,OWNER,{expectedRevision:7,action:{type:'roll'}})).status,409);
  const bug=h.store.list;h.store.list=async()=>{throw new TypeError('secret internal detail');};const err=console.error;console.error=()=>{};
  try{const r=await h.api('GET','/api/games',OWNER);assert.equal(r.status,500);assert(!(await r.text()).includes('secret'));}finally{h.store.list=bug;console.error=err;}
  h.db.fail=true;assert.equal((await h.api('GET','/api/games',OWNER)).status,503);h.db.fail=false;
 }finally{await h.close();}
});

test('seat tokens are bound to one seat and game; sidekick tokens cannot act or cross games',async()=>{
 const h=await harness();
 try{
  const a=await h.store.create(OWNER),b=await h.store.create(OWNER);
  const seat1=await h.store.connection(a,1),sideA=await h.store.observerConnection(a),sideB=await h.store.observerConnection(b);
  assert.equal((await fetch(h.base+'/game-mcp',{method:'POST',headers:{Authorization:'Bearer '+sideA.token}})).status,401);
  assert.equal((await fetch(h.base+'/game-info-mcp',{method:'POST',headers:{Authorization:'Bearer '+seat1.token}})).status,401);
  assert.equal((await fetch(h.base+'/api/game-events',{headers:{Authorization:'Bearer '+seat1.token}})).status,401);
  assert.equal((await fetch(h.base+'/game-mcp',{method:'POST',headers:{Authorization:'Bearer '+seat1.token,Origin:'https://evil.example'}})).status,403);
  const agent=await h.mcp('/game-mcp',seat1.token);
  const state=JSON.parse((await agent.callTool({name:'game_state',arguments:{}})).content[0].text);
  assert.equal(state.game.id,a.id);assert.equal(state.game.view.mySeat,1);assert(!('seats' in state.game));
  for(const p of state.game.view.players)assert(!('resources' in p));
  const cur=a.state.current;
  if(cur!==1){const r=await agent.callTool({name:'game_act',arguments:{expectedRevision:1,action:legalActions(a.state,cur).actions[0]}});assert(r.isError);assert.equal(JSON.parse(r.content[0].text).code,'not_your_turn');}
  const side=await h.mcp('/game-info-mcp',sideA.token);
  assert.deepEqual((await side.listTools()).tools.map(t=>t.name).sort(),['event_stream_info','game_events','game_info']);
  const info=JSON.parse((await side.callTool({name:'game_info',arguments:{}})).content[0].text);
  assert.equal(info.game.id,a.id);assert.equal(info.game.view.mySeat,0);assert.deepEqual(info.game.view.me.resources,viewMatch(a.state,0).me.resources);
  const sideOther=await h.mcp('/game-info-mcp',sideB.token);assert.equal(JSON.parse((await sideOther.callTool({name:'game_info',arguments:{}})).content[0].text).game.id,b.id);
  await h.store.revoke(a,1);await assert.rejects(agent.callTool({name:'game_state',arguments:{}}),e=>e.code===401);
 }finally{await h.close();}
});

test('duplicate submissions commit exactly once',async()=>{
 const h=await harness();
 try{
  const row=await h.store.create(OWNER),seat=row.state.current,action=legalActions(row.state,seat).actions[0];
  const tries=await Promise.allSettled([h.store.act(row,seat,1,action),h.store.act(row,seat,1,action)]);
  assert.equal(tries.filter(t=>t.status==='fulfilled').length,1);assert.equal(tries.find(t=>t.status==='rejected').reason.status,409);
  assert.equal(h.db.tables.catan_game_events.length,1);
 }finally{await h.close();}
});

test('sidekick events never carry opponents’ private log text or hands',async()=>{
 const db=new FakeDb(),store=new GameStore(db);let rnd=7;const pick=n=>(rnd=(rnd*1103515245+12345)%2147483648)%n;
 let privateSeen=0,row=(await db.from('catan_games').insert({id:'33333333-3333-4333-8333-333333333333',owner_id:OWNER,title:'t',state:createMatch({id:'g',names:['H','A','B','C'],seed:11})}).select('*').single()).data;
 for(let i=0;i<1500&&row.state.phase!=='finished';i++){
  const seat=[0,1,2,3].find(s=>legalActions(row.state,s).choices.discard)??[0,1,2,3].find(s=>legalActions(row.state,s).actions.length);
  const legal=legalActions(row.state,seat);let action;
  if(legal.choices.discard){const {count,hand}=legal.choices.discard,resources={};let left=count;for(const r in hand){const n=Math.min(left,hand[r]);if(n)resources[r]=n;left-=n;}action={type:'discard',resources};}
  else{const acts=legal.actions,build=acts.filter(a=>a.type.startsWith('build')||a.type==='move_robber'||a.type==='buy_dev_card');action=build.length&&pick(3)?build[pick(build.length)]:acts[pick(acts.length)];}
  row=(await store.act(row,seat,row.revision,action)).row;
 }
 const events=JSON.stringify((await db.tables.catan_game_events).map(e=>e.payload));
 for(const e of row.state.log)if(e.private&&!e.private.seats.includes(0)){privateSeen++;assert(!events.includes(JSON.stringify(e.private.text)),e.private.text);}
 assert(privateSeen>0,'autoplay should produce opponent-private log entries');
 assert(!/"resources":/.test(events)&&!events.includes('devDeck')&&!events.includes('"rng"'));
});

test('SSE: auth, cursor validation, resume, revoke and cleanup',async()=>{
 const h=await harness({streamMs:1500,pollMs:50});
 try{
  let row=await h.store.create(OWNER);const side=await h.store.observerConnection(row),auth={Authorization:'Bearer '+side.token};
  for(let i=0;i<3;i++){const seat=row.state.current;row=(await h.store.act(row,seat,row.revision,legalActions(row.state,seat).actions[0])).row;}
  assert.equal((await fetch(h.base+'/api/game-events')).status,401);
  assert.equal((await fetch(h.base+'/api/game-events?after=-1',{headers:auth})).status,400);
  assert.equal((await fetch(h.base+'/api/game-events',{headers:{...auth,'Last-Event-ID':'abc'}})).status,400);
  const full=await (await fetch(h.base+'/api/game-events',{headers:{...auth,'Last-Event-ID':'2'}})).text();
  assert.deepEqual([...full.matchAll(/^id: (\d+)$/gm)].map(m=>+m[1]),[3,4]);assert.match(full,/event: ready/);
  const res=await fetch(h.base+'/api/game-events?after=4',{headers:auth}),reader=res.body.getReader();let text='';
  const seat=row.state.current;row=(await h.store.act(row,seat,row.revision,legalActions(row.state,seat).actions[0])).row;
  while(!text.includes('id: 5'))text+=new TextDecoder().decode((await reader.read()).value);
  await h.store.revokeObserver(row);
  for(let c;!(c=await reader.read()).done;)text+=new TextDecoder().decode(c.value);
  assert.match(text,/event: revoked/);assert(!text.includes('id: 4\n'));
  assert.equal((await fetch(h.base+'/api/game-events',{headers:auth})).status,401);
  const again=await h.store.observerConnection(row);assert.notEqual(again.token,side.token);
  const ac=new AbortController(),live=await fetch(h.base+'/api/game-events',{headers:{Authorization:'Bearer '+again.token},signal:ac.signal});assert.equal(live.status,200);ac.abort();
 }finally{await h.close();}
});
