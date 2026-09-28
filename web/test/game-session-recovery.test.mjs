import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {AuthApiError,AuthRetryableFetchError,AuthSessionMissingError} from '@supabase/supabase-js';
import {authFailureStatus,identity} from '../lib/session.mjs';

const source=readFileSync(new URL('../public/game.js',import.meta.url),'utf8');
const between=(from,to)=>{
 const start=source.indexOf(from),end=source.indexOf(to,start);
 assert.ok(start>=0&&end>start,`game client section ${from}`);
 return source.slice(start,end);
};
const readSource=between('async function readGame(){','// ---------- Toasts and dialogs ----------');
const apiSource=between('async function api(method,url,body){','async function readGame(){');
const refreshSource=between('let authFailures=0;','async function gamePage(){');
const failed=status=>Object.assign(new Error(`HTTP ${status}`),{status});

function harness(outcomes){
 const initial={revision:7,seats:[],sidekick:null};
 const main={children:['board'],replaceChildren(...next){this.children=next;}};
 const state={game:initial,syncOk:true,lastSync:0};
 const calls={api:[],render:0,sync:0,timers:[],removed:0};
 let index=0;
 const context={
  S:state,main,boot:{gameId:'synthetic-game'},enc:encodeURIComponent,
  api:async(method,url)=>{calls.api.push([method,url]);const outcome=outcomes[index++];if(outcome instanceof Error)throw outcome;return {game:outcome||initial};},
  setGame:game=>{state.game=game;},render:()=>{calls.render++;},renderAgents:()=>{},renderPrompt:()=>{},renderOpps:()=>{},renderSync:()=>{calls.sync++;},
  errorBox:message=>({message}),
  document:{visibilityState:'visible',removeEventListener:()=>{calls.removed++;}},
  setTimeout:(fn,ms)=>{if(ms===300)queueMicrotask(fn);else calls.timers.push(ms);return calls.timers.length+1;},
  clearTimeout:()=>{},Date,
 };
 vm.createContext(context);
 vm.runInContext(`${readSource}\n${refreshSource}\nthis.subject={readGame,refresh,poll,stopped:()=>stopped};`,context);
 return {...context.subject,main,state,calls};
}

test('retryable Supabase verification failure is not classified as signed-out',()=>{
 assert.equal(authFailureStatus(new AuthRetryableFetchError('network down',0)),503);
 assert.equal(authFailureStatus(new AuthRetryableFetchError('gateway',503)),503);
 assert.equal(authFailureStatus(new Error('unexpected auth failure')),503);
 assert.equal(authFailureStatus(new AuthSessionMissingError()),401);
 assert.equal(authFailureStatus(new AuthApiError('revoked',401,'session_not_found')),401);
});

test('server identity distinguishes unavailable Auth from a revoked session',async()=>{
 const client=error=>({auth:{getUser:async()=>({data:{user:null},error})}});
 await assert.rejects(identity({}, {},()=>client(new AuthRetryableFetchError('offline',0))),error=>error.status===503);
 assert.equal((await identity({}, {},()=>client(new AuthSessionMissingError()))).user,null);
 const confirmed={id:'synthetic-user',email_confirmed_at:'2026-01-01T00:00:00Z'};
 assert.equal((await identity({}, {},()=>({auth:{getUser:async()=>({data:{user:confirmed},error:null})}}))).user,confirmed);
});

test('a failed move request is submitted once and never automatically replayed',async()=>{
 let count=0;
 const context={fetch:async()=>{count++;return {ok:false,status:401,json:async()=>({error:'Please sign in again.'})};},Error,JSON};
 vm.createContext(context);
 vm.runInContext(`${apiSource}\nthis.api=api;`,context);
 await assert.rejects(context.api('POST','/api/games/synthetic/actions',{action:{type:'end_turn'}}),error=>error.status===401);
 assert.equal(count,1);
});

test('transient 401 followed by same-revision success keeps the board and recovers live status',async()=>{
 const h=harness([failed(401),failed(401),{revision:7,seats:[],sidekick:null}]);
 await h.refresh(false);
 assert.deepEqual(h.main.children,['board']);
 assert.equal(h.state.syncOk,false);
 assert.equal(h.stopped(),false);
 await h.refresh(false);
 assert.deepEqual(h.main.children,['board']);
 assert.equal(h.state.syncOk,true);
 assert.equal(h.calls.render,0,'same revision need not redraw the still-present board');
 assert.deepEqual(h.calls.api.map(([method])=>method),['GET','GET','GET']);
});

test('revoked session eventually shows sign-in and stops scheduling, without replaying a move',async()=>{
 const h=harness(Array.from({length:4},()=>failed(401)));
 await h.refresh(false);
 await h.poll();
 assert.equal(h.stopped(),true);
 assert.match(h.main.children[0].message,/Sign in again/);
 assert.equal(h.calls.timers.length,0,'poll finally must not reschedule after stop');
 assert.deepEqual(h.calls.api.map(([method])=>method),['GET','GET','GET','GET']);
});

test('temporary service failure never becomes a sign-out decision',async()=>{
 const h=harness([failed(503),failed(503),{revision:7,seats:[],sidekick:null}]);
 await h.refresh(false);
 assert.equal(h.stopped(),false);
 assert.deepEqual(h.main.children,['board']);
 await h.refresh(false);
 assert.equal(h.state.syncOk,true);
});
