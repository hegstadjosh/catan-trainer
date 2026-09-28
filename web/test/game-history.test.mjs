import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {HistoryService,registerHistoryTools,historyRoutes} from '../lib/game-history.mjs';
import {renderHistory} from '../lib/history-page.mjs';
import {DirectorService} from '../lib/game-director.mjs';
import {GameStore} from '../lib/game-store.mjs';
import {gameMcpRoutes} from '../lib/game-mcp.mjs';
import {gameObserverRoutes} from '../lib/game-observer.mjs';
import {mcpRoutes,buildServer} from '../lib/mcp.mjs';
import {createMatch,legalActions,viewMatch} from '../game/rules.mjs';
import {FakeDb} from './history-fake-db.mjs';

const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const rejects=(p,status,code)=>assert.rejects(p,e=>{assert.equal(e.status,status,e.message);if(code)assert.equal(e.extra?.code,code);return true;});
const stored=(db,id)=>db.tables.catan_games.find(r=>r.id===id);

async function newGame(db,{seed=7,title='Test match',owner=OWNER}={}){
 const id=randomUUID();
 return (await db.from('catan_games').insert({id,owner_id:owner,title,state:createMatch({id,names:['You','Ann','Bo','Cy'],seed})}).select('*').single()).data;
}
// Deterministic legal move for whoever must act (builds before ending the turn; discards when owed).
function choose(s){
 const owe=Object.entries(s.pendingDiscards||{}).filter(([,n])=>n>0).map(([k])=>+k);
 if(s.turnPhase==='discard'&&owe.length){
  const seat=owe[0],c=legalActions(s,seat).choices.discard,r={};let k=c.count;
  for(const res of Object.keys(c.hand)){const t=Math.min(c.hand[res],k);if(t){r[res]=t;k-=t;}}
  return [seat,{type:'discard',resources:r}];
 }
 const L=legalActions(s,s.current).actions;
 const roads=Object.values(s.roads).filter(o=>o===s.current).length;
 for(const t of ['roll','build_city','build_settlement','move_robber','buy_dev_card',roads<2+2*s.turn/8?'build_road':null,'end_road_building','end_turn']){const a=L.find(x=>x.type===t);if(a)return [s.current,a];}
 return [s.current,L[0]];
}
async function play(db,id,n,{until}={}){
 const store=new GameStore(db);
 for(let i=0;i<n;i++){
  const row=await store.owned(id,OWNER);
  if(row.state.phase==='finished'||until?.(row.state))return row;
  const [seat,action]=choose(row.state);
  await store.act(row,seat,row.revision,action);
 }
 return store.owned(id,OWNER);
}
const setup=()=>{const db=new FakeDb();return {db,mine:new HistoryService({userId:OWNER,db}),theirs:new HistoryService({userId:OTHER,db})};};
const hands=s=>s.players.map(p=>p.resources);

test('history access needs a verified account and never crosses owners',async()=>{
 for(const bad of [undefined,'','nope',42,{id:OWNER}])assert.throws(()=>new HistoryService({userId:bad,db:new FakeDb()}),e=>e.status===401);
 const {db,mine,theirs}=setup();
 const g=await newGame(db);await play(db,g.id,12);
 const {note}=await mine.createNote(g.id,{revision:3,body:'mine'});
 assert.deepEqual(await theirs.list(),[]);
 await rejects(theirs.match(g.id),404);
 await rejects(theirs.position(g.id,2),404);
 await rejects(theirs.listNotes(g.id),404);
 await rejects(theirs.createNote(g.id,{revision:2,body:'x'}),404);
 await rejects(theirs.updateNote(g.id,note.id,{expectedVersion:1,body:'hijack'}),404);
 await rejects(theirs.deleteNote(g.id,note.id,{expectedVersion:1}),404);
 await rejects(theirs.branch(g.id,{revision:3}),404);
 // a note id from another game is not reachable through this game
 const g2=await newGame(db,{seed:8});
 await rejects(mine.updateNote(g2.id,note.id,{expectedVersion:1,body:'x'}),404);
 for(const id of ['../x','',null,'1234'])await rejects(mine.match(id),404);
 assert.equal((await mine.list()).length,2);
});

test('snapshots are captured atomically for creation, every move and director edits, and replay is immutable',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db);
 const seen=[structuredClone(stored(db,g.id).state)];
 const store=new GameStore(db);
 for(let i=0;i<30;i++){const row=await store.owned(g.id,OWNER);const [seat,a]=choose(row.state);await store.act(row,seat,row.revision,a);seen.push(structuredClone(stored(db,g.id).state));}
 const director=new DirectorService({userId:OWNER,db});
 const rev=stored(db,g.id).revision;
 await director.patch(g.id,{expectedRevision:rev,ops:[{op:'replace',path:'/players/1/resources/ore',value:3}],normalize:{bank:true}});
 seen.push(structuredClone(stored(db,g.id).state));
 const row=stored(db,g.id),snaps=db.tables.catan_game_snapshots.filter(s=>s.game_id===g.id);
 assert.equal(row.revision,32);
 assert.equal(snaps.length,row.revision,'one snapshot per revision, including creation');
 assert.equal(db.tables.catan_game_events.filter(e=>e.game_id===g.id).length,row.revision-1,'one event per move/edit');
 for(const s of snaps){const {log,...rest}=seen[s.revision-1];assert.deepEqual(s.state,rest,'snapshot '+s.revision+' equals the state at that revision');}
 // log deltas rebuild the rolling log exactly
 const ordered=snaps.toSorted((a,b)=>a.revision-b.revision),lastReset=ordered.findLastIndex(s=>s.log_reset);
 assert.equal(lastReset,0,'only creation stores a full log when nothing was rewritten');
 assert.deepEqual(ordered.flatMap(s=>s.log_added).slice(-200),row.state.log);
 const stable=async()=>{const {latestRevision,...rest}=await mine.position(g.id,10);return JSON.stringify(rest);};
 const before=await stable();
 await play(db,g.id,15);
 assert.equal(await stable(),before,'later moves never change an earlier position');
 const p=await mine.position(g.id,10,{perspective:'full',revealUnfinished:true});
 assert.deepEqual(p.full.seats.map(x=>x.resources),hands(seen[9]));
 assert.equal((await mine.match(g.id)).timeline.find(t=>t.revision===32).type,'director_edit');
});

// Security review finding 1: a director rewrite that deletes or edits earlier log lines must replay
// (and branch) with the rewritten log, not the old lines plus the new ones.
test('replay and branch logs match the true log after director deletions and rewrites',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db,{seed:5});
 const truth=new Map([[1,structuredClone(stored(db,g.id).state.log)]]);
 const record=()=>{const r=stored(db,g.id);truth.set(r.revision,structuredClone(r.state.log));};
 const store=new GameStore(db);
 for(let i=0;i<6;i++){const row=await store.owned(g.id,OWNER);const [seat,a]=choose(row.state);await store.act(row,seat,row.revision,a);record();}
 const director=new DirectorService({userId:OWNER,db});
 // drop the second entry and edit the first, as a director_replace_state import would
 let row=stored(db,g.id);const edited=structuredClone(row.state);
 edited.log=[{...edited.log[0],text:edited.log[0].text+' (edited)'},...edited.log.slice(2)];
 await director.replace(g.id,{expectedRevision:row.revision,state:edited});record();
 const rewriteRev=stored(db,g.id).revision;
 for(let i=0;i<4;i++){const r=await store.owned(g.id,OWNER);const [seat,a]=choose(r.state);await store.act(r,seat,r.revision,a);record();}
 // a JSON Patch removal of the newest line, then more moves
 row=stored(db,g.id);
 await director.patch(g.id,{expectedRevision:row.revision,ops:[{op:'remove',path:`/log/${row.state.log.length-1}`}]});record();
 for(let i=0;i<3;i++){const r=await store.owned(g.id,OWNER);const [seat,a]=choose(r.state);await store.act(r,seat,r.revision,a);record();}
 const snaps=db.tables.catan_game_snapshots.filter(s=>s.game_id===g.id);
 assert.equal(snaps.find(s=>s.revision===rewriteRev).log_reset,true,'a deletion stores the whole log');
 assert.ok(snaps.filter(s=>s.log_reset).length<=3,'ordinary moves store deltas');
 for(const [rev,log] of truth){
  assert.deepEqual(await mine.logAt(g.id,rev),log,'rebuilt log at revision '+rev);
  const snap=await mine.snapshot(stored(db,g.id),rev);
  assert.deepEqual(snap.state.log,log);
 }
 const p=await mine.position(g.id,rewriteRev);
 assert.equal(p.view.log.some(l=>l.text===truth.get(1)[0].text),false,'the pre-edit line is gone from the replay');
 const b=await mine.branch(g.id,{revision:rewriteRev+1});
 const branchLog=stored(db,b.game.id).state.log;
 assert.deepEqual(branchLog.slice(0,-1),truth.get(rewriteRev+1),'the branch copies the true log');
 assert.match(branchLog.at(-1).text,/Practice branch/);
 // exact copies keep hidden information and say so (security review finding 2)
 assert.deepEqual(stored(db,b.game.id).state.devDeck,(await mine.snapshot(stored(db,g.id),rewriteRev+1)).state.devDeck,'deck order preserved exactly');
 assert.equal(b.exactCopy.sourceFinished,false);assert.equal(b.exactCopy.seededDice,true);
 assert.match(b.exactCopy.notice,/hidden hand.*deck.*reveal/s);
 // the first snapshot of a game recorded only after the migration carries its whole earlier log
 db.recording=false;const legacy=await newGame(db,{seed:9});await play(db,legacy.id,5);db.recording=true;
 const lr=await play(db,legacy.id,1);
 assert.deepEqual(await mine.logAt(legacy.id,lr.revision),lr.state.log);
});

test('human perspective shows only what seat 0 saw; full information is explicit and labeled',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db,{seed:11});
 const row=await play(db,g.id,80);
 const secret=row.state.players.slice(1).map(p=>p.resources);
 for(const r of [1,5,20,40,row.revision]){
  const p=await mine.position(g.id,r);
  assert.equal(p.perspective,'human');assert.equal(p.full,undefined);
  const text=JSON.stringify(p);
  assert.doesNotMatch(text,/"devDeck"|"rng"|"private"|"hands"/);
  for(const pl of p.view.players.filter(x=>x.seat!==0)){assert.equal(pl.resources,undefined);assert.equal(pl.vpCards,undefined);}
  assert.deepEqual(Object.keys(p.view.me.resources).sort(),['brick','grain','lumber','ore','wool']);
 }
 const m=await mine.match(g.id);
 assert.equal(m.timeline[0].hands,undefined);
 assert.doesNotMatch(JSON.stringify(m),/"hands"|devDeck/);
 await rejects(mine.position(g.id,20,{perspective:'full'}),403,'reveal_required');
 await rejects(mine.match(g.id,{perspective:'full'}),403,'reveal_required');
 await rejects(mine.position(g.id,20,{perspective:'omniscient'}),400);
 const f=await mine.position(g.id,row.revision,{perspective:'full',revealUnfinished:true});
 assert.match(f.full.label,/Full information/);
 assert.deepEqual(f.full.seats.slice(1).map(x=>x.resources),secret);
 assert.equal(f.full.devDeck.length,row.state.devDeck.length);
 assert.equal((await mine.match(g.id,{perspective:'full',revealUnfinished:true})).timeline.at(-1).hands.length,4);
});

test('before/after a move and no future information leaks into a position',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db,{seed:3});
 const row=await play(db,g.id,120);
 const m=await mine.match(g.id);
 const roll=m.timeline.find(t=>t.type==='roll'&&t.revision>20);
 const before=await mine.position(g.id,roll.revision-1),after=await mine.position(g.id,roll.revision);
 assert.equal(before.view.turnPhase,'roll');
 assert.deepEqual(after.view.dice,roll.dice);
 assert.deepEqual(after.view.me.resources,roll.yourHand,'position hand equals the hand recorded with that event');
 assert.deepEqual(before.view.me.resources,m.timeline[roll.revision-2].yourHand);
 // Everything in a position must come from revision ≤ r: pieces, hands, log lines and notes.
 await mine.createNote(g.id,{revision:roll.revision+5,body:'later note'});
 const snapR=db.tables.catan_game_snapshots.find(s=>s.game_id===g.id&&s.revision===roll.revision).state;
 const pos=await mine.position(g.id,roll.revision);
 assert.equal(pos.view.board.vertices.filter(v=>v.building).length,Object.keys(snapR.buildings).length);
 assert.equal(pos.view.board.edges.filter(e=>e.road).length,Object.keys(snapR.roads).length);
 assert.ok(Object.keys(snapR.roads).length<Object.keys(row.state.roads).length,'fixture must build after r');
 assert.equal(pos.notes.length,0);
 const future=m.timeline.filter(t=>t.revision>roll.revision).flatMap(t=>t.lines);
 const shown=new Set(pos.view.log.map(l=>l.text));
 assert.ok(!future.some(l=>shown.has(l)&&!m.timeline.filter(t=>t.revision<=roll.revision).some(t=>t.lines.includes(l))),'no later log line appears');
 assert.ok(pos.view.log.every(l=>l.seq<=snapR.seq));
});

test('games played before recording report unrecorded boards honestly and cannot branch there',async()=>{
 const {db,mine}=setup();
 db.recording=false;
 const g=await newGame(db,{seed:5});
 await play(db,g.id,20);
 db.recording=true; // migration applied mid-game
 const row=await play(db,g.id,10);
 const m=await mine.match(g.id);
 assert.equal(m.timeline.length,row.revision);
 assert.equal(m.coverage.recordedFrom,22);
 assert.match(m.coverage.note,/Revisions 1–21 were played before match history recording began/);
 assert.equal(m.timeline.filter(t=>t.board==='unrecorded').length,21);
 const t5=m.timeline[4];
 assert.equal(t5.seats,null);assert.ok(t5.yourHand,'your hand was always recorded with events');
 const p=await mine.position(g.id,5,{perspective:'full',revealUnfinished:true});
 assert.equal(p.board,'unrecorded');assert.equal(p.view,null);assert.equal(p.full.available,false);assert.equal(p.canBranch,false);
 assert.match(p.note,/before match history recording began/);
 assert.deepEqual(p.yourHand,m.timeline[4].yourHand);
 await rejects(mine.branch(g.id,{revision:5}),409,'snapshot_unavailable');
 assert.equal((await mine.position(g.id,row.revision)).board,'recorded');
 assert.equal((await mine.position(g.id,25)).source,'snapshot');
 // a legacy game with no snapshots at all still has its latest position
 db.recording=false;const old=await newGame(db,{seed:6});await play(db,old.id,6);
 const om=await mine.match(old.id);
 assert.equal(om.coverage.recordedRevisions,1);assert.equal(om.timeline.at(-1).board,'recorded');
 assert.equal((await mine.position(old.id,om.game.revision)).source,'current');
});

test('notes, bookmarks and predictions persist per position with compare-and-swap',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db);await play(db,g.id,10);
 const xss='<img src=x onerror=alert(1)></script>"\'';
 const {note}=await mine.createNote(g.id,{revision:4,kind:'prediction',body:xss});
 assert.equal(note.body,xss,'stored verbatim; the page renders it as text');
 assert.equal(note.version,1);assert.equal(note.move,3);
 const up=(await mine.updateNote(g.id,note.id,{expectedVersion:1,body:'Ann will build a city next'})).note;
 assert.equal(up.version,2);
 await assert.rejects(mine.updateNote(g.id,note.id,{expectedVersion:1,body:'stale'}),e=>e.status===409&&e.extra.code==='version_conflict'&&e.extra.note.body==='Ann will build a city next');
 await rejects(mine.deleteNote(g.id,note.id,{expectedVersion:1}),409,'version_conflict');
 await rejects(mine.updateNote(g.id,note.id,{body:'x'}),400);
 await rejects(mine.createNote(g.id,{revision:4,kind:'essay',body:'x'}),400);
 await rejects(mine.createNote(g.id,{revision:4,body:'   '}),400);
 await rejects(mine.createNote(g.id,{revision:4,body:'x'.repeat(4001)}),400);
 await rejects(mine.createNote(g.id,{revision:999,body:'x'}),404);
 await rejects(mine.createNote(g.id,{revision:0,body:'x'}),400);
 const b1=await mine.createNote(g.id,{revision:6,kind:'bookmark'}),b2=await mine.createNote(g.id,{revision:6,kind:'bookmark'});
 assert.equal(b2.existing,true);assert.equal(b2.note.id,b1.note.id);
 assert.equal((await mine.listNotes(g.id,{revision:6})).notes.length,1);
 assert.equal((await mine.position(g.id,4)).notes[0].body,'Ann will build a city next');
 // stored between sessions: a fresh service instance reads the same notes
 const again=new HistoryService({userId:OWNER,db});
 assert.equal((await again.listNotes(g.id)).notes.length,2);
 assert.deepEqual(await again.deleteNote(g.id,note.id,{expectedVersion:2}),{deleted:true,id:note.id});
 await rejects(again.deleteNote(g.id,note.id,{expectedVersion:2}),404);
 const lib=(await again.list()).find(x=>x.id===g.id);
 assert.equal(lib.bookmarks,1);assert.equal(lib.notes,0);
});

test('branching copies an exact recorded position into a new game without grants and leaves the original alone',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db,{seed:9});
 const row=await play(db,g.id,40);
 const store=new GameStore(db);
 await store.connection(row,1);await store.observerConnection(row);
 const origState=JSON.stringify(stored(db,g.id).state),origRev=stored(db,g.id).revision;
 const snapCount=db.tables.catan_game_snapshots.filter(s=>s.game_id===g.id).length;
 const r=await mine.branch(g.id,{revision:25});
 assert.match(r.note,/not copied/);
 const copy=stored(db,r.game.id);
 assert.equal(copy.branched_from,g.id);assert.equal(copy.branched_from_revision,25);assert.equal(copy.revision,1);assert.equal(copy.owner_id,OWNER);
 const snap=db.tables.catan_game_snapshots.find(s=>s.game_id===g.id&&s.revision===25).state;
 const {log,id,...rest}=copy.state;const {id:_,...want}=snap;
 assert.deepEqual(rest,want,'branch state equals the recorded position');
 assert.equal(id,r.game.id);
 assert.match(log.at(-1).text,/Practice branch of “Test match” from move 24/);
 assert.equal(JSON.stringify(stored(db,g.id).state),origState);assert.equal(stored(db,g.id).revision,origRev);
 assert.equal(db.tables.catan_game_snapshots.filter(s=>s.game_id===g.id).length,snapCount);
 assert.equal(db.tables.catan_game_seats.filter(s=>s.game_id===r.game.id).length,0);
 assert.equal((db.tables.catan_game_observers||[]).filter(s=>s.game_id===r.game.id).length,0);
 assert.equal(await store.authenticate('catan_seat_'+'A'.repeat(43)),null);
 // the branch is playable and its own history starts at its first revision
 await play(db,r.game.id,5);
 assert.equal((await mine.match(r.game.id)).game.branchedFrom.revision,25);
 await rejects(mine.branch(g.id,{revision:0}),400);
 await rejects(mine.branch(g.id,{revision:3,title:'x'.repeat(81)}),400);
 for(let i=0;i<18;i++)await newGame(db,{seed:i});
 await assert.rejects(mine.branch(g.id,{revision:3}),e=>e.status===409&&/20 active games/.test(e.message));
});

test('a finished game: full information without extra confirmation, event counts and postgame summary',async()=>{
 const {db,mine}=setup();
 const g=await newGame(db,{seed:4});
 const row=await play(db,g.id,3000);
 assert.equal(row.state.phase,'finished','fixture game finishes');
 const m=await mine.match(g.id);
 const events=db.tables.catan_game_events.filter(e=>e.game_id===g.id);
 assert.equal(m.timeline.length,row.revision);assert.equal(events.length,row.revision-1);
 const rolls=events.filter(e=>e.payload.type==='roll');
 assert.equal(m.summary.rolls,rolls.length);
 assert.equal(Object.values(m.summary.dice).reduce((a,b)=>a+b,0),rolls.length);
 for(const kind of ['build_city','build_settlement','build_road','buy_dev_card']){
  const key={build_city:'city',build_settlement:'settlement',build_road:'road',buy_dev_card:'devCard'}[kind];
  for(let s=0;s<4;s++)assert.equal(m.summary.seats[s].built[key],events.filter(e=>e.payload.type===kind&&e.payload.actorSeat===s).length);
 }
 assert.equal(m.summary.seats[0].built.city*3,m.summary.seats[0].spent.ore-m.summary.seats[0].built.devCard);
 assert.equal(m.summary.production.countedRolls,rolls.length-m.summary.dice[7]);
 assert.deepEqual(m.summary.you.produced,m.summary.seats[0].produced,'own-hand production matches snapshot production');
 assert.equal(m.summary.seats[row.state.winner].totalVP>=10,true);
 const f=await mine.position(g.id,row.revision,{perspective:'full'});
 assert.equal(f.full.available,true);
 assert.equal((await mine.list())[0].status,'finished');assert.equal((await mine.list())[0].resumeUrl,null);
});

test('MCP history tools are bound to the verified account and absent from seat and sidekick endpoints',async()=>{
 const db=new FakeDb();
 const g=await newGame(db);await play(db,g.id,8);
 const theirs=await newGame(db,{owner:OTHER,seed:2});
 const server=new McpServer({name:'t',version:'1'});
 registerHistoryTools(server,{userId:OWNER,db});
 assert.throws(()=>registerHistoryTools(new McpServer({name:'t',version:'1'}),{userId:'x',db}),e=>e.status===401);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);
 const c=new Client({name:'c',version:'1'});await c.connect(b);
 const call=async(name,args)=>{const r=await c.callTool({name,arguments:args});return {err:r.isError,data:JSON.parse(r.content[0].text)};};
 const names=(await c.listTools()).tools.map(t=>t.name).sort();
 assert.deepEqual(names,['history_add_note','history_branch','history_delete_note','history_get_match','history_get_position','history_list_matches','history_list_notes','history_update_note','practice_commit','practice_get_position','practice_list_attempts','practice_list_positions','practice_reveal'].sort());
 assert.deepEqual((await call('history_list_matches',{userId:OTHER})).data.matches.map(m=>m.id),[g.id]);
 assert.equal((await call('history_get_match',{gameId:theirs.id,userId:OTHER})).data.status,404);
 const full=await call('history_get_position',{gameId:g.id,revision:3,perspective:'full'});
 assert.equal(full.err,true);assert.equal(full.data.code,'reveal_required');
 assert.equal((await call('history_get_position',{gameId:g.id,revision:3,perspective:'full',revealUnfinished:true})).data.full.available,true);
 const n=(await call('history_add_note',{gameId:g.id,revision:3,body:'watch the 8'})).data.note;
 assert.equal((await call('history_update_note',{gameId:g.id,noteId:n.id,expectedVersion:1,body:'watch the 6'})).data.note.version,2);
 assert.equal((await call('history_update_note',{gameId:g.id,noteId:n.id,expectedVersion:1,body:'stale'})).data.code,'version_conflict');
 const br=(await call('history_branch',{gameId:g.id,revision:4})).data;
 assert.equal(stored(db,br.game.id).branched_from,g.id);
 assert.equal((await call('history_delete_note',{gameId:g.id,noteId:n.id,expectedVersion:2})).data.deleted,true);
 // seat and sidekick tokens: no history, director or full-state tools
 const store=new GameStore(db),row=stored(db,g.id);
 const seat=await store.connection(row,1),side=await store.observerConnection(row);
 const app=express();app.use(express.json());gameMcpRoutes(app,()=>new GameStore(db));gameObserverRoutes(app,()=>new GameStore(db));
 const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 try{
  for(const [path,token] of [['/game-mcp',seat.token],['/game-info-mcp',side.token]]){
   const cl=new Client({name:'x',version:'1'});
   await cl.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}${path}`),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
   const list=(await cl.listTools()).tools.map(t=>t.name);
   assert.ok(!list.some(t=>/^(history_|director_)|get_game_schema/.test(t)),list.join());
   await cl.close();
  }
 }finally{http.close();}
});

test('account /mcp registers owner game tools only for a verified principal',async()=>{
 const seen=[];
 const app=express();app.use(express.json());
 mcpRoutes(app,{resolvePrincipal:async req=>req.get('authorization')==='Bearer good'?{user:{id:OWNER},supabase:{}}:null,createStore:()=>({}),gameTools:(server,userId)=>{seen.push(userId);registerHistoryTools(server,{userId,db:new FakeDb()});}});
 const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 const url=`http://127.0.0.1:${http.address().port}/mcp`;
 try{
  const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer bad'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(bad.status,401);assert.deepEqual(seen,[]);
  const cl=new Client({name:'x',version:'1'});
  await cl.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer good'}}}));
  assert.ok((await cl.listTools()).tools.some(t=>t.name==='history_get_match'));
  assert.ok(seen.every(u=>u===OWNER)&&seen.length>0);
  await cl.close();
 }finally{http.close();}
 // buildServer without a verified user id registers no game tools
 let called=false;buildServer({},{gameTools:()=>{called=true;}});assert.equal(called,false);
});

test('browser routes: session required, owner scoped, perspective query, clean errors, escaped page',async()=>{
 const db=new FakeDb();
 const g=await newGame(db);await play(db,g.id,8);
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{const u=req.get('x-user');if(u)req.user={id:u};next();});
 historyRoutes(app,{makeService:userId=>new HistoryService({userId,db})});
 app.get(['/history','/history/:id'],renderHistory);
 const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 const base=`http://127.0.0.1:${http.address().port}`;
 const call=async(method,path,{user=OWNER,body}={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user&&{'x-user':user})},body:body&&JSON.stringify(body)});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()};};
 try{
  assert.equal((await call('GET','/api/history',{user:null})).status,401);
  assert.equal((await call('GET','/api/history')).body.matches.length,1);
  assert.equal((await call('GET','/api/history/'+g.id,{user:OTHER})).status,404);
  assert.equal((await call('GET',`/api/history/${g.id}/positions/3`)).body.perspective,'human');
  assert.equal((await call('GET',`/api/history/${g.id}/positions/3?perspective=full`)).body.code,'reveal_required');
  assert.equal((await call('GET',`/api/history/${g.id}/positions/3?perspective=full&reveal=1`)).body.full.available,true);
  assert.equal((await call('GET',`/api/history/${g.id}/positions/abc`)).status,400);
  assert.equal((await call('POST',`/api/history/${g.id}/notes`,{body:[1]})).status,400);
  const n=(await call('POST',`/api/history/${g.id}/notes`,{body:{revision:2,body:'hi'}})).body.note;
  assert.equal((await call('PATCH',`/api/history/${g.id}/notes/${n.id}`,{body:{expectedVersion:9,body:'x'}})).status,409);
  assert.equal((await call('DELETE',`/api/history/${g.id}/notes/${n.id}`,{body:{expectedVersion:1}})).body.deleted,true);
  assert.equal((await call('POST',`/api/history/${g.id}/branch`,{body:{revision:3}})).status,200);
  const page=await call('GET','/history/'+g.id+'?revision=4');
  assert.match(page.body,/"revision":4/);
  const evil=await call('GET','/history/%3Cscript%3E');
  assert.doesNotMatch(evil.body,/<script>alert|<\/script><script>/);
  assert.match(evil.body,/"badPath":true/);
 }finally{http.close();}
 // boot data cannot close its script tag
 const out={};renderHistory({params:{},query:{},user:{email:'</script><script>alert(1)</script>'}},{set(){return this;},type(){return this;},send(b){out.b=b;}});
 assert.doesNotMatch(out.b,/<script>alert/);
});
