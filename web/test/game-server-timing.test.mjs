import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {gameRoutes} from '../lib/game-routes.mjs';
import {timedGameIdentity} from '../lib/game-timing.mjs';
import {GameStoreError} from '../lib/game-store.mjs';

const ID='11111111-1111-4111-8111-111111111111';
const delay=()=>new Promise(resolve=>setTimeout(resolve,8));

test('auth timing covers success and failure only on game GET/action paths',async()=>{
 const headers=[];
 const res={append:(name,value)=>headers.push([name,value])};
 const verify=async()=>{await delay();return {user:{id:'private-user'}};};
 const get={method:'GET',path:`/api/games/${ID}`};
 assert.equal((await timedGameIdentity(get,res,verify)).user.id,'private-user');
 assert.match(headers[0][1],/^auth;dur=\d+(?:\.\d+)?$/);
 await assert.rejects(timedGameIdentity({method:'POST',path:`/api/games/${ID}/actions`},res,async()=>{throw Error('unavailable');}),/unavailable/);
 assert.equal(headers.length,2,'failed verification still gets timing');
 await timedGameIdentity({method:'GET',path:'/dashboard-assets/game.js'},res,verify);
 assert.equal(headers.length,2,'static routes remain unmarked');
 assert.equal(headers.some(([,value])=>value.includes('private-user')||value.includes(ID)),false);
});

test('game GET and action expose fixed-name timing segments without game data',async()=>{
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:'private-user'};next();});
 gameRoutes(app,()=>({
  async owned(id){await delay();if(id==='fail')throw new GameStoreError('Unavailable',503);return {id:ID,revision:1};},
  async present(row){await delay();return {id:row.id,revision:row.revision,view:{}};},
  async act(row){await delay();return {row:{...row,revision:2},result:{secret:'private-result'}};}
 }));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/games/${ID}`;
 try{
  for(const [method,suffix,expected] of [['GET','',['game_load','game_present']],['POST','/actions',['game_load','game_action','game_present']]]){
   const response=await fetch(url+suffix,{method,headers:{'Content-Type':'application/json'},body:method==='POST'?JSON.stringify({expectedRevision:1,action:{type:'private-action'}}):undefined});
   assert.equal(response.status,200);
   const timing=response.headers.get('server-timing')??'';
   for(const name of expected)assert.match(timing,new RegExp(`(?:^|,\\s*)${name};dur=\\d+(?:\\.\\d+)?`));
   for(const privateText of [ID,'private-user','private-action','private-result'])assert.equal(timing.includes(privateText),false);
  }
  const failure=await fetch(`http://127.0.0.1:${server.address().port}/api/games/fail`);
  assert.equal(failure.status,503);
  assert.match(failure.headers.get('server-timing')??'',/^game_load;dur=\d+(?:\.\d+)?$/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
