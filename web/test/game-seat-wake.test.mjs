import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMatch,viewMatch,legalActions,applyAction} from '../game/rules.mjs';
import {gameMcpRoutes} from '../lib/game-mcp.mjs';

const token='catan_seat_'+ 'A'.repeat(43);
function fixture({failStatusAfterMove=0}={}){
 const state=createMatch({id:'synthetic',names:['Human','Agent 1','Agent 2','Agent 3'],seed:7});
 Object.assign(state,{phase:'play',turnPhase:'main',current:1,turn:4,order:[0,1,2,3],setup:{index:8,anchor:null}});
 state.turnState.rolled=true;
 state.players[0].resources.brick=9;state.players[0].devCards.push({type:'victoryPoint',bought:1});
 const row={id:'synthetic',title:'Fixture',revision:1,updated_at:'2026-01-01T00:00:00Z',state};
 let active=true,moves=0,statusFailures=0,statusRequests=0;
 const store={
  async authenticate(value){return active&&value===token?{row,seat:1}:null;},
  async present(current,seat){return {revision:current.revision,view:viewMatch(current.state,seat)};},
  async act(current,seat,expectedRevision,action){
   assert.equal(current,row);assert.equal(seat,1);assert.equal(expectedRevision,row.revision);
   const legal=legalActions(row.state,1);
   if(legal.choices.discard)assert.equal(action.type,'discard');
   else assert.deepEqual(action,legal.actions[0]);
   const result=applyAction(row.state,seat,action);row.state=result.state;row.revision++;moves++;
   statusFailures=failStatusAfterMove;
   return {row,result:result.result};
  }
 };
 return {row,store,revoke:()=>{active=false;},moves:()=>moves,
  failStatus:n=>{statusFailures=n;},statusRequests:()=>statusRequests,
  statusMiddleware:(req,res,next)=>{if(req.path==='/api/game-seat-status'){
   statusRequests++;if(statusFailures-->0)return res.sendStatus(503);
  }next();}};
}
async function server(fx){
 const app=express();app.use(express.json());app.use(fx.statusMiddleware);gameMcpRoutes(app,()=>fx.store,{streamMs:350,pollMs:25});
 const listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));
 const base='http://127.0.0.1:'+listener.address().port;process.env.SITE_URL=base;
 return {base,close:async()=>{listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));}};
}
async function events(url,headers={}){const response=await fetch(url,{headers});return {status:response.status,text:await response.text()};}

test('seat stream is scoped, cursor-resumable, and metadata-only for turns, discard, trade and revoke',async()=>{
 const fx=fixture(),srv=await server(fx),url=srv.base+'/api/game-seat-events';
 try{
  assert.equal((await events(url)).status,401);
  assert.equal((await events(url,{Authorization:'Bearer '+token,Origin:'https://evil.example'})).status,403);
  assert.equal((await events(url+'?after=-1',{Authorization:'Bearer '+token})).status,400);
  let out=await events(url,{Authorization:'Bearer '+token});
  assert.equal(out.status,200);assert.match(out.text,/id: 1\nevent: seat_ready\ndata: {"revision":1,"seat":1}/);
  for(const forbidden of ['ownHand','resources','devCards','rng','Victory Point','9'])assert(!out.text.includes(forbidden),forbidden);
  out=await events(url,{Authorization:'Bearer '+token,'Last-Event-ID':'1'});
  assert(!out.text.includes('event: seat_ready'),'acknowledged revision does not replay');
  fx.row.revision=2;fx.row.state.current=0;fx.row.state.turnPhase='roll';
  out=await events(url,{Authorization:'Bearer '+token,'Last-Event-ID':'1'});
  assert.match(out.text,/id: 2\nevent: seat_waiting/);
  fx.row.revision=3;fx.row.state.turnPhase='discard';fx.row.state.pendingDiscards={1:2};
  out=await events(url,{Authorization:'Bearer '+token,'Last-Event-ID':'2'});
  assert.match(out.text,/id: 3\nevent: seat_ready/,'off-turn discard wakes seat');
  fx.row.revision=4;fx.row.state.turnPhase='main';fx.row.state.pendingDiscards={};
  fx.row.state.offer={id:1,from:0,give:{brick:1},get:{wool:1},to:[1],declined:[]};
  out=await events(url,{Authorization:'Bearer '+token,'Last-Event-ID':'3'});
  assert.match(out.text,/id: 4\nevent: seat_ready/,'off-turn trade reply wakes seat');
  const live=await fetch(url,{headers:{Authorization:'Bearer '+token,'Last-Event-ID':'4'}});
  const reader=live.body.getReader();let streamed='';
  while(!streamed.includes('event: ready'))streamed+=new TextDecoder().decode((await reader.read()).value);
  fx.revoke();
  while(!streamed.includes('event: revoked')){const chunk=await reader.read();if(chunk.done)break;streamed+=new TextDecoder().decode(chunk.value);}
  assert.match(streamed,/event: revoked/,'rotated token closes an existing stream');
  assert.equal((await events(url,{Authorization:'Bearer '+token})).status,401);
 }finally{await srv.close();}
});

test('persistent listener receives a ready event, starts hook, reads fresh seat tools and commits exactly one legal move',async()=>{
 const fx=fixture(),srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-test-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 const hook=fileURLToPath(new URL('./fixtures/seat-action-hook.mjs',import.meta.url));
 try{
  const child=spawn('python3',[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook',process.execPath,hook],{
   env:{...process.env,CATAN_SEAT_TOKEN:token,TEST_MCP_URL:srv.base+'/game-mcp'},stdio:['ignore','pipe','pipe']});
  let timeout;
  const result=await Promise.race([
   new Promise(resolve=>{let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('exit',code=>resolve({code,stderr}));}),
   new Promise((_,reject)=>{timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('seat watcher timed out'));},6000);})
  ]).finally(()=>clearTimeout(timeout));
  assert.equal(result.code,0,result.stderr);
  assert.equal(fx.moves(),1);
  assert.equal(fx.row.revision,2);
  assert.equal(fx.row.state.turnPhase,'roll');
  assert.equal((await readFile(join(home,'seat.cursor'),'utf8')).trim(),'2');
 }finally{await srv.close();await rm(home,{recursive:true,force:true});}
});

test('off-turn discard choice wakes a hook and commits one legal discard through MCP',async()=>{
 const fx=fixture(),srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-discard-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 const hook=fileURLToPath(new URL('./fixtures/seat-action-hook.mjs',import.meta.url));
 fx.row.state.current=0;fx.row.state.turnPhase='discard';fx.row.state.pendingDiscards={1:2};
 fx.row.state.players[1].resources.brick=2;
 try{
  const child=spawn('python3',[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook',process.execPath,hook],{
   env:{...process.env,CATAN_SEAT_TOKEN:token,TEST_MCP_URL:srv.base+'/game-mcp'},stdio:['ignore','pipe','pipe']});
  const result=await new Promise(resolve=>{let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.once('exit',code=>resolve({code,stderr}));});
  assert.equal(result.code,0,result.stderr);
  assert.equal(fx.moves(),1);
  assert.equal(fx.row.revision,2);
  assert.equal(fx.row.state.pendingDiscards[1],undefined);
 }finally{await srv.close();await rm(home,{recursive:true,force:true});}
});

for(const phase of ['startup','after move'])test(`transient status outage at ${phase} recovers without repeating the hook`,async()=>{
 const fx=fixture({failStatusAfterMove:phase==='after move'?4:0});
 if(phase==='startup')fx.failStatus(4);
 const srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-recovery-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 const hook=fileURLToPath(new URL('./fixtures/seat-action-hook.mjs',import.meta.url));
 const child=spawn('python3',[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook',process.execPath,hook],{
  env:{...process.env,CATAN_SEAT_TOKEN:token,TEST_MCP_URL:srv.base+'/game-mcp'},stdio:['ignore','pipe','pipe']});
 try{
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  let timer;
  const code=await Promise.race([
   new Promise(resolve=>child.once('exit',resolve)),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('status recovery timed out')),20000);})
  ]).finally(()=>clearTimeout(timer));
  assert.equal(code,0,stderr);
  assert.match(stderr,/retrying verification without waking an agent/);
  assert.equal(fx.moves(),1,'outage must not replay a completed move');
  assert(fx.statusRequests()>=6);
  assert.equal((await readFile(join(home,'seat.cursor'),'utf8')).trim(),'2');
 }finally{child.kill('SIGKILL');await srv.close();await rm(home,{recursive:true,force:true});}
});

test('a second listener for the same seat cursor cannot start an overlapping wake',async()=>{
 const fx=fixture(),srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-lock-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 const marker=join(home,'in-hook');
 const args=[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook','python3','-c','import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); time.sleep(0.5)',marker];
 const env={...process.env,CATAN_SEAT_TOKEN:token};
 const first=spawn('python3',args,{env,stdio:['ignore','pipe','pipe']});
 try{
  let inHook=false;
  for(let i=0;i<80&&!inHook;i++){await new Promise(resolve=>setTimeout(resolve,10));inHook=await stat(marker).then(()=>true,()=>false);}
  assert(inHook,'first listener acquired lock and started hook');
  const secondArgs=[...args];secondArgs[secondArgs.indexOf('--cursor')+1]=join(home,'alternate.cursor');
  const second=spawn('python3',secondArgs,{env,stdio:['ignore','pipe','pipe']});
  const result=await new Promise(resolve=>{let stderr='';second.stderr.on('data',chunk=>stderr+=chunk);second.on('exit',code=>resolve({code,stderr}));});
  assert.notEqual(result.code,0);assert.match(result.stderr,/already running/);
  assert.equal(await new Promise(resolve=>first.on('exit',resolve)),1,'idle hook is rejected after bounded verification');
 }finally{first.kill('SIGKILL');await srv.close();await rm(home,{recursive:true,force:true});}
});

test('a no-op hook cannot acknowledge a still-actionable seat',async()=>{
 const fx=fixture(),srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-idle-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 try{
  const child=spawn('python3',[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook','python3','-c','pass'],{
   env:{...process.env,CATAN_SEAT_TOKEN:token},stdio:['ignore','pipe','pipe']});
  const result=await new Promise(resolve=>{let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('exit',code=>resolve({code,stderr}));});
  assert.notEqual(result.code,0);assert.match(result.stderr,/without advancing an actionable seat/);
  assert.equal(fx.moves(),0);
  const files=await readdir(home);
  assert(!files.some(name=>name.endsWith('.cursor')),'failed wake did not acknowledge cursor');
 }finally{await srv.close();await rm(home,{recursive:true,force:true});}
});

test('finished game emits only terminal metadata and watcher stops cleanly',async()=>{
 const fx=fixture(),srv=await server(fx),home=await mkdtemp(join(tmpdir(),'catan-seat-done-'));
 const script=fileURLToPath(new URL('../public/catan-seat.py',import.meta.url));
 try{
  fx.row.state.phase='finished';fx.row.state.winner=0;fx.row.revision=2;
  const status=await fetch(srv.base+'/api/game-seat-status',{headers:{Authorization:'Bearer '+token}});
  assert.deepEqual(await status.json(),{revision:2,seat:1,ready:false,finished:true});
  const out=await events(srv.base+'/api/game-seat-events',{Authorization:'Bearer '+token,'Last-Event-ID':'1'});
  assert.match(out.text,/id: 2\nevent: game_finished\ndata: {"revision":2,"seat":1}/);
  assert(!out.text.includes('ownHand'));
  const child=spawn('python3',[script,'--url',srv.base+'/api/game-seat-events','--cursor',join(home,'seat.cursor'),'--once','--hook','python3','-c','raise Exception("hook should not run")'],{
   env:{...process.env,CATAN_SEAT_TOKEN:token},stdio:['ignore','pipe','pipe']});
  const result=await new Promise(resolve=>{let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('exit',code=>resolve({code,stderr}));});
  assert.equal(result.code,0,result.stderr);assert.match(result.stderr,/Game finished/);
  assert.equal(fx.moves(),0);
 }finally{await srv.close();await rm(home,{recursive:true,force:true});}
});
