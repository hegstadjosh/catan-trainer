import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {DirectorService,registerDirectorTools,directorRoutes,prepareState,applyOps,mergePatch,gameSchema} from '../lib/game-director.mjs';
import {renderDirector} from '../lib/director-page.mjs';
import {GameStore} from '../lib/game-store.mjs';
import {gameMcpRoutes} from '../lib/game-mcp.mjs';
import {gameObserverRoutes} from '../lib/game-observer.mjs';
import {createMatch,viewMatch,legalActions,applyAction} from '../game/rules.mjs';

// In-memory stand-in for the supabase-js calls used by GameStore and DirectorService, including the atomic commit RPC.
const KEYS={catan_game_seats:['game_id','seat'],catan_game_observers:['game_id'],catan_games:['id']};
class Query{
 constructor(db,table){Object.assign(this,{db,table,filters:[],op:'select'});}
 select(){return this;}
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
  if(this.op==='insert'){const row={revision:1,updated_at:new Date().toISOString(),archived_at:null,...structuredClone(this.row)};rows.push(row);return {data:structuredClone(row),error:null};}
  if(this.op==='upsert'){const key=KEYS[this.table],i=rows.findIndex(r=>key.every(k=>r[k]===this.row[k]));if(i>=0)rows[i]={...rows[i],...this.row};else rows.push({...this.row});return {data:null,error:null};}
  let hit=rows.filter(r=>this.filters.every(f=>f(r)));
  if(this.op==='update'){for(const r of hit)Object.assign(r,this.patch);return {data:null,error:null};}
  if(this.sortKey==='revision')hit=hit.toSorted((a,b)=>a.revision-b.revision);
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
  Object.assign(g,{state:structuredClone(a.p_state),revision:g.revision+1,updated_at:new Date().toISOString()});
  (db.tables.catan_game_events??=[]).push({game_id:g.id,revision:g.revision,payload:structuredClone(a.p_event),created_at:g.updated_at});
  return {data:structuredClone(g),error:null};})};}
}
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const setup=()=>{const db=new FakeDb();return {db,owner:new DirectorService({userId:OWNER,db}),other:new DirectorService({userId:OTHER,db})};};
const rejects=async(p,status,check)=>assert.rejects(p,e=>{assert.equal(e.status,status,e.message);check?.(e);return true;});
const stored=(db,id)=>db.tables.catan_games.find(r=>r.id===id);

// Drive a fresh seeded game through setup using the engine so tests start from a realistic play state.
function playedState(id,seed=5){
 let s=createMatch({id,names:['Human','A1','A2','A3'],seed});
 while(s.phase==='setup'){const a=legalActions(s,s.current).actions[0];s=applyAction(s,s.current,a).state;}
 return s;
}

test('director access requires a verified account id and never crosses owners',async()=>{
 for(const bad of [undefined,'',null,'not-a-uuid',42,{id:OWNER}])assert.throws(()=>new DirectorService({userId:bad,db:new FakeDb()}),e=>e.status===401);
 const {db,owner,other}=setup();
 const {game}=await owner.create({title:'Mine',seed:3});
 const rev=stored(db,game.id).revision,before=JSON.stringify(stored(db,game.id).state);
 await rejects(other.get(game.id),404);
 await rejects(other.replace(game.id,{expectedRevision:rev,state:JSON.parse(before)}),404);
 await rejects(other.patch(game.id,{expectedRevision:rev,ops:[{op:'replace',path:'/turn',value:0}]}),404);
 await rejects(other.reset(game.id,{expectedRevision:rev}),404);
 await rejects(other.clone(game.id),404);
 await rejects(other.issue(game.id,'seat1'),404);
 await rejects(other.archive(game.id),404);
 await rejects(other.view(game.id,2),404);
 assert.deepEqual(await other.list(),[]);
 assert.equal(JSON.stringify(stored(db,game.id).state),before);
 await rejects(owner.get('../etc'),404);
});

test('full snapshot round-trips through export and replace without dropping fields',async()=>{
 const {db,owner}=setup();
 const a=await owner.create({title:'Source',seed:9}),b=await owner.create({title:'Target',seed:10});
 const src=stored(db,a.game.id);src.state=playedState(a.game.id,9); // a realistic mid-game state, ports included
 const exp=await owner.exportState(a.game.id);
 assert.equal(exp.format,'catan-director-state');
 const out=await owner.replace(b.game.id,{expectedRevision:1,state:exp});
 assert.equal(out.revision,2);
 const saved=stored(db,b.game.id).state;
 assert.equal(saved.id,b.game.id,'room id stays pinned');
 assert(out.normalized.some(n=>n.startsWith('id set')));
 const strip=s=>{const c=structuredClone(s);delete c.id;delete c.seq;c.log=c.log.slice(0,exp.state.log.length);return c;};
 assert.deepEqual(strip(saved),strip(exp.state));
 assert.equal(saved.seq,Math.max(exp.state.seq,b.state.seq)+1);
 assert.match(saved.log.at(-1).text,/^Game director replaced the game state/);
 // Legacy states without ports stay without ports.
 const legacy=structuredClone(exp.state);delete legacy.ports;
 await owner.replace(b.game.id,{expectedRevision:2,state:legacy});
 assert(!('ports' in stored(db,b.game.id).state));
});

test('malformed states are rejected with paths and nothing is saved',async()=>{
 const {db,owner}=setup();
 const {game,state}=await owner.create({seed:4});
 const before=JSON.stringify(stored(db,game.id).state);
 const cases=[
  [s=>{delete s.bank;},'/bank'],
  [s=>{s.extra=1;},'/extra'],
  [s=>{s.players[1].secret='x';},'/players/1/secret'],
  [s=>{s.players.pop();},'/players'],
  [s=>{s.players[2].id='seat-9';},'/players/2/id'],
  [s=>{s.players[0].kind='agent';},'/players/0/kind'],
  [s=>{s.players[1].resources.ore=-1;},'/players/1/resources/ore'],
  [s=>{s.players[1].resources.gold=1;},'/players/1/resources/gold'],
  [s=>{s.players[1].resources.ore=2;},'/bank/ore'],
  [s=>{s.hexes[3]={terrain:'desert',resource:null,number:8};},'/hexes/3/number'],
  [s=>{s.hexes[3].resource='ore';s.hexes[3].terrain='hills';},'/hexes/3/resource'],
  [s=>{s.hexes.push(s.hexes[0]);},'/hexes'],
  [s=>{s.robber=19;},'/robber'],
  [s=>{s.buildings['54']={type:'settlement',owner:1};},'/buildings/54'],
  [s=>{s.buildings['07']={type:'settlement',owner:1};},'/buildings/07'],
  [s=>{s.roads['3']=4;},'/roads/3'],
  [s=>{s.order=['0','1','2','3'];},'/order'],
  [s=>{s.phase='play';},'/turnPhase'],
  [s=>{s.devDeck.push('knight');},'/devDeck'],
  [s=>{s.devDeck[0]='wonder';},'/devDeck/0'],
  [s=>{s.ports[0].vertices=[0,53];},'/ports/0/vertices'],
  [s=>{s.ports[1].vertices=[...s.ports[0].vertices];},'/ports/1/vertices'],
  [s=>{s.turnPhase='setupRoad';},'/setup/anchor'],
  [s=>{s.current=s.order[1];},'/current'],
  [s=>{s.dice={d1:3,d2:4,total:8};},'/dice/total'],
  [s=>{s.winner=1;},'/winner'],
  [s=>{s.log.push({seq:1,seat:null,text:'x',html:'<b>'});},'/log/1/html'],
  [s=>{s.rng={s:-5};},'/rng/s']
 ];
 for(const [mutate,path] of cases){
  const s=structuredClone(state);mutate(s);
  await rejects(owner.replace(game.id,{expectedRevision:1,state:s}),400,e=>{assert.equal(e.extra.code,'invalid_state');assert(e.extra.problems.some(p=>p.path===path),path+' → '+JSON.stringify(e.extra.problems));});
 }
 for(const bad of [null,[],'state',42])await rejects(owner.replace(game.id,{expectedRevision:1,state:bad}),400);
 await rejects(owner.patch(game.id,{expectedRevision:1,ops:[{op:'add',path:'/__proto__/polluted',value:true}]}),400);
 await rejects(owner.patch(game.id,{expectedRevision:1,mergePatch:JSON.parse('{"__proto__":{"polluted":true}}')}),400);
 await rejects(owner.patch(game.id,{expectedRevision:1,ops:[{op:'replace',path:'/players/9/name',value:'x'}]}),400);
 await rejects(owner.patch(game.id,{expectedRevision:1,ops:[{op:'move',path:'/turn'}]}),400);
 await rejects(owner.patch(game.id,{expectedRevision:1,ops:[{op:'test',path:'/turn',value:5}]}),409);
 await rejects(owner.patch(game.id,{expectedRevision:1,mergePatch:{offer:null}}),400,e=>assert(e.extra.problems.some(p=>p.path==='/offer'&&/ops "replace"/.test(p.message))));
 assert.equal(({}).polluted,undefined);
 assert.equal(JSON.stringify(stored(db,game.id).state),before);
 assert.equal(stored(db,game.id).revision,1);
 assert.equal(db.tables.catan_game_events,undefined);
});

test('writes need the current revision; a stale write changes nothing',async()=>{
 const {db,owner}=setup();
 const {game}=await owner.create({seed:6});
 await owner.patch(game.id,{expectedRevision:1,ops:[{op:'replace',path:'/players/1/name',value:'Scout'}]});
 await rejects(owner.patch(game.id,{expectedRevision:1,ops:[{op:'replace',path:'/players/1/name',value:'Late'}]}),409,e=>assert.equal(e.extra.currentRevision,2));
 await rejects(owner.patch(game.id,{ops:[{op:'replace',path:'/players/1/name',value:'Late'}]}),400);
 assert.equal(stored(db,game.id).state.players[1].name,'Scout');
 // Two writers racing on the same revision: exactly one commits.
 const tries=await Promise.allSettled([1,2].map(n=>owner.patch(game.id,{expectedRevision:2,ops:[{op:'replace',path:'/players/2/name',value:'W'+n}]})));
 assert.equal(tries.filter(t=>t.status==='fulfilled').length,1);
 assert.equal(tries.find(t=>t.status==='rejected').reason.status,409);
 assert.equal(stored(db,game.id).revision,3);
 assert.equal(db.tables.catan_game_events.length,2);
});

test('scenario edit: hands, board, harbor, buildings and turn, then the engine plays on',async()=>{
 const {db,owner}=setup();
 const {game}=await owner.create({seed:8});
 stored(db,game.id).state=playedState(game.id,8);
 const s=stored(db,game.id).state;
 const seat=1,myVertex=+Object.entries(s.buildings).find(([,b])=>b.owner===seat)[0];
 const ops=[
  {op:'replace',path:'/players/1/resources',value:{brick:4,lumber:4,wool:2,grain:5,ore:6}},
  {op:'replace',path:'/players/3/resources/ore',value:0},
  {op:'replace',path:'/hexes/0',value:{terrain:'mountains',resource:'ore',number:6}},
  {op:'replace',path:'/robber',value:9},
  {op:'replace',path:'/ports/0/type',value:'ore'},
  {op:'replace',path:`/buildings/${myVertex}`,value:{type:'city',owner:seat}},
  {op:'replace',path:'/current',value:seat},
  {op:'replace',path:'/turnPhase',value:'main'},
  {op:'replace',path:'/turnState/rolled',value:true},
  {op:'replace',path:'/turn',value:3},
  {op:'add',path:'/players/1/devCards/-',value:{type:'monopoly',bought:1}},
  {op:'remove',path:'/devDeck/'+s.devDeck.indexOf('monopoly')}
 ];
 const out=await owner.patch(game.id,{expectedRevision:1,ops,normalize:{bank:true},message:'Practice a late-game turn.'});
 assert.equal(out.revision,2);
 for(const label of ['resource hands','development cards in hand','terrain and numbers','robber','harbors','buildings','turn and phase','development deck','bank'])assert(out.changed.includes(label),label);
 assert(out.normalized.some(n=>n.startsWith('bank/')));
 const after=stored(db,game.id).state;
 for(const r of ['brick','lumber','wool','grain','ore'])assert.equal(after.bank[r]+after.players.reduce((n,p)=>n+p.resources[r],0),19);
 assert.equal(after.buildings[myVertex].type,'city');
 const legal=legalActions(after,seat);
 assert(legal.actions.some(a=>a.type==='play_monopoly'));
 assert(legal.actions.some(a=>a.type==='end_turn'));
 assert(legal.actions.some(a=>a.type==='build_city'||a.type==='build_road'||a.type==='buy_dev_card'));
 const acted=await owner.act(game.id,{expectedRevision:2,seat,action:{type:'play_monopoly',resource:'wool'}});
 assert.equal(acted.revision,3);
 assert.equal((await owner.view(game.id,seat)).view.me.devCards.length,0);
 // Without normalize the same kind of hand edit is refused, with the reason and the remedy.
 await rejects(owner.patch(game.id,{expectedRevision:3,ops:[{op:'replace',path:'/players/2/resources/brick',value:9}]}),400,e=>assert(e.extra.problems.some(p=>/normalize\.bank/.test(p.message))));
 // Awards: a seat with 3 knights can be granted Largest Army by recomputation.
 await rejects(owner.patch(game.id,{expectedRevision:3,ops:[{op:'replace',path:'/players/2/knights',value:3}]}),400,e=>assert(e.extra.problems.some(p=>p.path==='/devDeck'&&/knight/.test(p.message))));
 const deck=stored(db,game.id).state.devDeck,fewer=[...deck];for(let i=0;i<3;i++)fewer.splice(fewer.indexOf('knight'),1);
 const aw=await owner.patch(game.id,{expectedRevision:3,ops:[{op:'replace',path:'/players/2/knights',value:3},{op:'replace',path:'/devDeck',value:fewer}],normalize:{awards:true}});
 assert.equal(stored(db,game.id).state.awards.largestArmy,2);assert(aw.changed.includes('awards'));
 await rejects(owner.patch(game.id,{expectedRevision:4,ops:[{op:'replace',path:'/awards/largestArmy',value:3}]}),400);
});

test('reset and clone are explicit; seeded resets are reproducible and keep seats',async()=>{
 const {db,owner}=setup();
 const {game}=await owner.create({seed:1,names:['Me','Ada','Bo','Cy']});
 await owner.issue(game.id,'seat2');
 await owner.reset(game.id,{expectedRevision:1,seed:77});
 const a=structuredClone(stored(db,game.id).state);
 await owner.reset(game.id,{expectedRevision:2,seed:77});
 const b=stored(db,game.id).state;
 assert.deepEqual(a.hexes,b.hexes);assert.deepEqual(a.devDeck,b.devDeck);assert.deepEqual(a.order,b.order);
 assert.deepEqual(b.players.map(p=>p.name),['Me','Ada','Bo','Cy']);assert.equal(b.id,game.id);
 assert(db.tables.catan_game_seats.some(r=>r.game_id===game.id&&r.seat===2&&!r.revoked_at),'connections survive a reset');
 await rejects(owner.reset(game.id,{expectedRevision:3,seed:-1}),400);
 const copy=await owner.clone(game.id,{title:'Branch'});
 assert.notEqual(copy.game.id,game.id);assert.equal(copy.state.id,copy.game.id);
 const {id:_a,...x}=copy.state,{id:_b,...y}=stored(db,game.id).state;assert.deepEqual(x,y);
 assert(!db.tables.catan_game_seats.some(r=>r.game_id===copy.game.id));
 await owner.rename(copy.game.id,{title:'Branch 2'});
 await owner.archive(copy.game.id);
 assert(!(await owner.list()).some(g=>g.id===copy.game.id));
 assert((await owner.list({archived:true})).some(g=>g.id===copy.game.id&&g.title==='Branch 2'));
 await rejects(owner.patch(copy.game.id,{expectedRevision:1,ops:[{op:'replace',path:'/turn',value:0}]}),404);
 await owner.restore(copy.game.id);
 assert((await owner.list()).some(g=>g.id===copy.game.id));
});

test('director edits publish only public text; seat and sidekick tokens get no director access',async()=>{
 const db=new FakeDb(),store=new GameStore(db),owner=new DirectorService({userId:OWNER,db});
 const app=express();app.use(express.json());gameMcpRoutes(app,()=>store);gameObserverRoutes(app,()=>store);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;process.env.SITE_URL=base;const clients=[];
 const mcp=async(path,token)=>{const c=new Client({name:'t',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(base+path),{requestInit:{headers:{Authorization:'Bearer '+token}}}));clients.push(c);return c;};
 try{
  const {game}=await owner.create({seed:12});
  stored(db,game.id).state=playedState(game.id,12);
  const secret={brick:7,lumber:0,wool:3,grain:1,ore:5};
  await owner.patch(game.id,{expectedRevision:1,ops:[{op:'replace',path:'/players/2/resources',value:secret},{op:'add',path:'/players/3/devCards/-',value:{type:'victoryPoint',bought:0}},{op:'remove',path:'/devDeck/'+stored(db,game.id).state.devDeck.indexOf('victoryPoint')}],normalize:{bank:true},message:'Seat 2 starts rich.'});
  const event=db.tables.catan_game_events.at(-1).payload,text=JSON.stringify(event);
  assert.equal(event.type,'director_edit');assert.match(event.message,/Seat 2 starts rich\./);
  assert(!text.includes(JSON.stringify(secret))&&!text.includes('"brick":7'),'opponent hand must not leak');
  assert(!/victoryPoint|devDeck|"rng"/.test(text));
  assert.deepEqual(Object.keys(event).sort(),['actorSeat','changed','currentSeat','dice','log','message','ownHand','phase','result','turnPhase','type','winner']);
  assert.deepEqual(event.ownHand,viewMatch(stored(db,game.id).state,0).me.resources);
  const row=stored(db,game.id);
  const seatTok=await store.connection(row,1),sideTok=await store.observerConnection(row);
  const seat=await mcp('/game-mcp',seatTok.token),side=await mcp('/game-info-mcp',sideTok.token);
  for(const c of [seat,side]){const names=(await c.listTools()).tools.map(t=>t.name);assert(!names.some(n=>n.startsWith('director_')||n==='get_game_schema'),names.join());}
  const sideEvents=JSON.parse((await side.callTool({name:'game_events',arguments:{after:0}})).content[0].text);
  assert.equal(sideEvents.events.at(-1).type,'director_edit');assert(!JSON.stringify(sideEvents).includes('"brick":7'));
  const seatView=JSON.parse((await seat.callTool({name:'game_state',arguments:{}})).content[0].text).game.view;
  assert(seatView.log.some(e=>/^Game director edited the game/.test(e.text)));
  assert(!('resources' in seatView.players[2]));
 }finally{for(const c of clients)await c.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('MCP tools act for the bound account only and ignore any userId argument',async()=>{
 const db=new FakeDb();
 const connect=async userId=>{const server=new McpServer({name:'t',version:'1'});registerDirectorTools(server,{userId,db});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const c=new Client({name:'c',version:'1'});await c.connect(b);return c;};
 assert.throws(()=>registerDirectorTools(new McpServer({name:'t',version:'1'}),{userId:'nobody',db}));
 const mine=await connect(OWNER),theirs=await connect(OTHER);
 const call=async(c,name,args={})=>{const r=await c.callTool({name,arguments:args});return {error:!!r.isError,data:JSON.parse(r.content[0].text)};};
 const names=(await mine.listTools()).tools.map(t=>t.name);
 for(const n of ['get_game_schema','director_list_games','director_create_game','director_get_state','director_replace_state','director_patch_state','director_validate_state','director_reset_game','director_clone_game','director_issue_connection'])assert(names.includes(n),n);
 const created=(await call(mine,'director_create_game',{title:'Agent built',seed:2})).data;
 const id=created.game.id;
 assert.equal((await call(theirs,'director_get_state',{gameId:id,userId:OWNER})).error,true);
 assert.equal((await call(theirs,'director_list_games',{userId:OWNER})).data.games.length,0);
 const full=(await call(mine,'director_get_state',{gameId:id})).data;
 assert.equal(full.state.players.length,4);assert.equal(full.revision,1);
 const dry=await call(mine,'director_validate_state',{gameId:id,state:{...full.state,turn:'x'}});
 assert(dry.error);assert(dry.data.problems.some(p=>p.path==='/turn'));
 const patched=await call(mine,'director_patch_state',{gameId:id,expectedRevision:1,ops:[{op:'replace',path:'/players/0/resources/ore',value:3}],normalize:{bank:true}});
 assert(!patched.error,JSON.stringify(patched.data));assert.equal(patched.data.revision,2);
 const stale=await call(mine,'director_patch_state',{gameId:id,expectedRevision:1,ops:[{op:'replace',path:'/turn',value:0}]});
 assert(stale.error);assert.equal(stale.data.status,409);
 const token=await call(mine,'director_issue_connection',{gameId:id,target:'sidekick'});
 assert.match(token.data.token,/^catan_observer_/);
 assert.equal((await call(theirs,'director_issue_connection',{gameId:id,target:'seat1'})).error,true);
 const schema=(await call(mine,'get_game_schema',{includeGeometry:true,includeExample:true})).data;
 assert.equal(schema.geometry.vertices.length,54);assert.doesNotThrow(()=>prepareState(schema.example,{}));
 await mine.close();await theirs.close();
});

test('browser routes use the session user and return clean errors',async()=>{
 const db=new FakeDb(),app=express();app.use(express.json());
 app.use((q,r,n)=>{const u=q.get('x-user');if(u)q.user={id:u,email:'o@example.com'};n();});
 directorRoutes(app,{makeService:userId=>new DirectorService({userId,db})});app.get('/game-tools',renderDirector);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const api=(method,path,user,body)=>fetch(base+path,{method,headers:{...(user&&{'x-user':user}),'content-type':'application/json'},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 try{
  assert.equal((await api('GET','/api/director/games')).status,401);
  const c=await (await api('POST','/api/director/games',OWNER,{title:'Route game'})).json();const id=c.game.id;
  assert.equal((await api('GET','/api/director/games/'+id,OTHER)).status,404);
  assert.equal((await api('PUT',`/api/director/games/${id}/state`,OWNER,'[1]')).status,400);
  const bad=await api('PUT',`/api/director/games/${id}/state`,OWNER,{expectedRevision:1,state:{version:1}});
  assert.equal(bad.status,400);assert((await bad.json()).problems.length>0);
  assert.equal((await api('PUT',`/api/director/games/${id}/state`,OWNER,{expectedRevision:9,state:c.state})).status,409);
  const ok=await api('PUT',`/api/director/games/${id}/state`,OWNER,{expectedRevision:1,state:c.state});assert.equal(ok.status,200);
  assert.deepEqual(await (await api('GET',`/api/director/games/${id}/revision`,OWNER)).json(),{id,revision:2,updatedAt:stored(db,id).updated_at});
  assert.equal((await api('GET',`/api/director/games/${id}/views/4`,OWNER)).status,400);
  assert.equal((await api('POST',`/api/director/games/${id}/connections/seat0`,OWNER)).status,400);
  const page=await (await fetch(base+'/game-tools?game=%3Cscript%3E',{headers:{'x-user':OWNER}})).text();
  assert(page.includes('"gameId":null')&&!page.includes('<script>'));
  assert((await (await api('GET','/api/director/schema',OWNER)).json()).fields.bank);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('patch helpers follow RFC 6902/7386 and the schema example is a valid state',()=>{
 assert.deepEqual(applyOps({a:[1,2]},[{op:'add',path:'/a/1',value:9},{op:'add',path:'/a/-',value:3},{op:'remove',path:'/a/0'}]),{a:[9,2,3]});
 assert.deepEqual(applyOps({'a/b':{'~':1}},[{op:'replace',path:'/a~1b/~0',value:2}]),{'a/b':{'~':2}});
 assert.deepEqual(mergePatch({a:1,b:{c:2,d:3}},{b:{c:null,e:4}}),{a:1,b:{d:3,e:4}});
 const ex=gameSchema({includeExample:true}).example;
 assert.equal(prepareState(ex,{gameId:'room'}).state.id,'room');
 assert.throws(()=>prepareState(JSON.parse(JSON.stringify(ex).replace('"version":1','"version":2'))),e=>e.extra.problems[0].path==='/version');
});
