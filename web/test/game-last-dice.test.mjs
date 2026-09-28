import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,applyAction,legalActions,viewMatch} from '../game/rules.mjs';
import {GameStore,publicRollDice} from '../lib/game-store.mjs';

const names=['Human','Agent A','Agent B','Agent C'];
const act=(state,action)=>applyAction(state,state.current,action).state;
function ready(seed=3){
 let state=createMatch({id:'synthetic',names,seed});
 while(state.phase==='setup')state=act(state,legalActions(state,state.current).actions[0]);
 return state;
}
const toPublic=d=>({dice:[d.d1,d.d2],total:d.total});

test('latest actual roll remains public after end turn, reload, and the next turn',()=>{
 let state=ready();
 assert.equal(state.lastDice,null);
 assert.equal(viewMatch(state,0).lastDice,null);
 state=act(state,{type:'roll'});
 const first=toPublic(state.dice);
 assert.deepEqual(viewMatch(state,0).lastDice,first);
 if(state.turnPhase==='discard')for(const [seat,n] of Object.entries(state.pendingDiscards)){
  const discard={};let left=n;
  for(const [resource,count] of Object.entries(state.players[seat].resources)){const take=Math.min(count,left);if(take)discard[resource]=take;left-=take;}
  state=applyAction(state,Number(seat),{type:'discard',resources:discard}).state;
 }
 if(state.turnPhase==='robber'){
  const move=legalActions(state,state.current).actions.find(a=>a.type==='move_robber');
  state=act(state,move);
 }
 state=act(state,{type:'end_turn'});
 assert.equal(state.dice,null,'current-turn dice clears');
 assert.deepEqual(state.lastDice,{d1:first.dice[0],d2:first.dice[1],total:first.total});
 assert.deepEqual(viewMatch(structuredClone(state),1).lastDice,first,'saved state survives reload');
 const next=act(state,{type:'roll'});
 assert.deepEqual(viewMatch(next,0).lastDice,toPublic(next.dice));
});

test('a seven persists both actual faces; setup and unknown old rolls stay blank',()=>{
 const setup=createMatch({id:'synthetic',names,seed:8});
 assert.equal(viewMatch(setup,0).lastDice,null);
 let seven;
 for(let seed=0;seed<1000&&!seven;seed++){
  const state=ready(seed);
  const next=act(state,{type:'roll'});
  if(next.dice.total===7)seven=next;
 }
 assert.ok(seven);
 assert.equal(seven.lastDice.total,7);
 assert.deepEqual(viewMatch(seven,3).lastDice,toPublic(seven.dice));
 const faces=toPublic(seven.dice);
 while(seven.turnPhase==='discard')for(const [seat,n] of Object.entries(seven.pendingDiscards)){
  let left=n;const resources={};
  for(const [resource,count] of Object.entries(seven.players[seat].resources)){const take=Math.min(count,left);if(take)resources[resource]=take;left-=take;}
  seven=applyAction(seven,Number(seat),{type:'discard',resources}).state;
 }
 seven=act(seven,legalActions(seven,seven.current).actions.find(a=>a.type==='move_robber'));
 seven=act(seven,{type:'end_turn'});
 assert.equal(viewMatch(structuredClone(seven),0).dice,null);
 assert.deepEqual(viewMatch(structuredClone(seven),0).lastDice,faces);
 delete setup.lastDice;
 assert.equal(viewMatch(setup,0).lastDice,null);
});

test('legacy fallback uses only the latest recorded public roll for the authorized game',async()=>{
 const state=ready();
 delete state.lastDice;
 state.dice=null;
 const calls=[];
 const events=[{payload:{type:'roll',dice:{d1:2,d2:5,total:7}}}];
 const db={from(table){assert.equal(table,'catan_game_events');return {
  select(fields){assert.equal(fields,'payload');return this;},
  eq(field,value){calls.push([field,value]);return this;},
  order(field,options){assert.equal(field,'revision');assert.deepEqual(options,{ascending:false});return this;},
  limit(n){assert.equal(n,1);return Promise.resolve({data:events,error:null});}
 };}};
 const store=new GameStore(db);
 const row={id:'synthetic',title:'Fixture',revision:5,updated_at:'2026-01-01T00:00:00Z',state};
 const shown=await store.present(row,0);
 assert.deepEqual(calls,[['game_id','synthetic'],['payload->>type','roll']]);
 assert.deepEqual(shown.view.lastDice,{dice:[2,5],total:7});
 assert.equal(shown.view.dice,null);
 assert.equal(state.lastDice,undefined,'public fallback does not mutate old saved state');
 events.length=0;
 assert.equal((await store.present(row,0)).view.lastDice,null,'missing roll evidence stays unknown');
 events.push({payload:{type:'roll',dice:{d1:6,d2:6,total:7}}});
 assert.equal((await store.present(row,0)).view.lastDice,null,'inconsistent evidence is rejected');
 assert.equal(publicRollDice({dice:{d1:2,d2:5,total:7}}).total,7);
});
