import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMatch,legalActions} from '../game/rules.mjs';
import {GameStore} from '../lib/game-store.mjs';
import {HistoryService} from '../lib/game-history.mjs';
import {evaluate,practiceOptions,sampleWorld} from '../lib/decision-practice.mjs';
import {FakeDb} from './history-fake-db.mjs';

const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
async function fixture(){
 const db=new FakeDb(),id=randomUUID(),store=new GameStore(db);
 await db.from('catan_games').insert({id,owner_id:OWNER,title:'Practice case',state:createMatch({id,names:['You','A','B','C'],seed:7})});
 for(let i=0;i<75;i++){
  const row=await store.owned(id,OWNER),s=row.state;
  if(s.phase==='play'&&s.current===0&&s.turnPhase==='main')break;
  const seat=s.turnPhase==='discard'?+Object.keys(s.pendingDiscards)[0]:s.current;
  let action=legalActions(s,seat).actions.find(a=>['roll','move_robber','end_turn'].includes(a.type))||legalActions(s,seat).actions[0];
  if(s.turnPhase==='discard'){
   let left=s.pendingDiscards[seat];const resources={};for(const [r,n] of Object.entries(s.players[seat].resources)){resources[r]=Math.min(n,left);left-=resources[r];}
   action={type:'discard',resources};
  }
  await store.act(row,seat,row.revision,action);
 }
 const row=await store.owned(id,OWNER),state=structuredClone(row.state);
 assert.equal(state.current,0);assert.equal(state.turnPhase,'main');
 // Make several plans feasible while keeping the public bank/hand conservation invariant.
 for(const [r,n] of Object.entries({grain:2,ore:3,wool:1})){
  const add=Math.min(n,state.bank[r]);state.bank[r]-=add;state.players[0].resources[r]+=add;
 }
 for(const [seat,r] of [[1,'brick'],[1,'wool'],[2,'lumber'],[2,'ore']]){state.bank[r]--;state.players[seat].resources[r]++;}
 await db.from('catan_games').update({state}).eq('id',id);
 return {db,id,row:await store.owned(id,OWNER),store,owner:new HistoryService({userId:OWNER,db}),other:new HistoryService({userId:OTHER,db})};
}

test('fair evaluator is invariant to actual hidden hands, dev types, deck order and RNG',async()=>{
 const {row}=await fixture(),s=row.state,variant=structuredClone(s);
 const a=Object.keys(variant.players[1].resources).find(r=>variant.players[1].resources[r]>0);
 const b=Object.keys(variant.players[2].resources).find(r=>r!==a&&variant.players[2].resources[r]>0);
 if(a&&b){variant.players[1].resources[a]--;variant.players[1].resources[b]++;variant.players[2].resources[b]--;variant.players[2].resources[a]++;}
 variant.players[1].devCards=[{type:'monopoly',bought:1}];
 variant.players[2].devCards=[{type:'knight',bought:1}];
 s.players[1].devCards=[{type:'yearOfPlenty',bought:1}];s.players[2].devCards=[{type:'victoryPoint',bought:1}];
 variant.devDeck.splice(0,2);s.devDeck.splice(0,2);
 variant.devDeck.reverse();variant.rng={s:123456789};
 assert.deepEqual(practiceOptions(variant),practiceOptions(s));
 assert.deepEqual(sampleWorld(variant,9),sampleWorld(s,9));
 const optionId=practiceOptions(s)[0].id;
 assert.deepEqual(evaluate(variant,{optionId,horizon:2,seed:19,samples:8}),evaluate(s,{optionId,horizon:2,seed:19,samples:8}));
});

test('practice preview contains no later moves; commitment precedes durable reveal and is owner scoped',async()=>{
 const {db,id,row,store,owner,other}=await fixture(),revision=row.revision;
 const preview=await owner.practicePosition(id,revision);
 assert.equal(preview.revision,revision);assert.ok(preview.options.length>1);
 assert.equal('latestRevision' in preview,false);assert.equal('timeline' in preview,false);
 assert.equal('full' in preview,false);assert.equal('devDeck' in preview,false);
 await assert.rejects(other.practicePosition(id,revision),e=>e.status===404);
 await assert.rejects(other.practiceCommit(id,revision,{optionId:preview.options[0].id,reason:'Try city',probability:0.5,horizon:2}),e=>e.status===404);
 const {attempt}=await owner.practiceCommit(id,revision,{optionId:preview.options[0].id,reason:'Production is worth the investment.',probability:0.6,horizon:2});
 assert.equal(attempt.evaluation,null);assert.equal(attempt.reason,'Production is worth the investment.');
 await assert.rejects(other.practiceReveal(attempt.id),e=>e.status===404);
 const current=await store.owned(id,OWNER);
 await store.act(current,current.state.current,current.revision,{type:'end_turn'});
 assert.deepEqual(await owner.practicePosition(id,revision),preview,'later moves do not alter precommit view');
 const revealed=(await owner.practiceReveal(attempt.id)).attempt;
 assert.ok(revealed.revealedAt);assert.equal(revealed.evaluation.samples,32);
 assert.deepEqual((await owner.practiceReveal(attempt.id)).attempt,revealed,'repeat reveal cannot overwrite');
 assert.equal(db.tables.catan_decision_attempts.length,1);
 const list=await owner.practiceAttempts({gameId:id});assert.equal(list.attempts[0].id,attempt.id);
});

test('inconsistent public resource constraints fail explicitly',async()=>{
 const {row}=await fixture(),s=structuredClone(row.state);s.bank.brick=19;
 assert.throws(()=>sampleWorld(s,1),/inconsistent|match/);
});

test('known minima cannot exceed a public opponent hand or the common bank pool',async()=>{
 const {row}=await fixture(),s=row.state;
 const count=Object.values(s.players[1].resources).reduce((a,b)=>a+b,0);
 assert.throws(()=>sampleWorld(s,1,{minimums:{1:{brick:Math.floor(count/2)+1,grain:Math.ceil(count/2)}}}),/minimum exceeds|minimum conflicts/);
 assert.throws(()=>sampleWorld(s,1,{minimums:{1:{brick:19}}}),/Invalid known minimum|minimum exceeds/);
});

test('truncated public log removes only playable progress cards from the unseen deck',()=>{
 const countType=(world,type)=>world.devDeck.filter(card=>card===type).length+world.players.reduce((n,p)=>n+p.devCards.filter(card=>card.type===type).length,0);
 const normal=sampleWorld(createMatch({id:randomUUID(),names:['You','A','B','C'],seed:6}),3);
 assert.equal(countType(normal,'victoryPoint'),5);
 const s=createMatch({id:randomUUID(),names:['You','A','B','C'],seed:7});
 s.devDeck.splice(s.devDeck.indexOf('roadBuilding'),1); // One historical public progress play fell out of the rolling log.
 s.log=[];
 const world=sampleWorld(s,3);
 assert.equal(world.devDeck.length,24);
 assert.equal(world.devDeck.filter(type=>type==='victoryPoint').length,5);
 assert.equal(world.devDeck.filter(type=>type==='knight').length,14);
 assert.equal(countType(world,'victoryPoint'),5);
 assert.equal(world.devDeck.filter(type=>['roadBuilding','yearOfPlenty','monopoly'].includes(type)).length,5);
 // Seven missing plays cannot all be progress cards in a 25-card base deck.
 s.devDeck.splice(0,6);
 assert.throws(()=>sampleWorld(s,3),/unlogged progress plays/);
 const impossible=createMatch({id:randomUUID(),names:['You','A','B','C'],seed:8});
 impossible.players[0].devCards=Array.from({length:6},()=>({type:'victoryPoint',bought:0}));
 assert.throws(()=>sampleWorld(impossible,3),/conflict with the base deck/);
});

test('factual score requires the full chosen turn and exact build site',async()=>{
 const one=await fixture();
 const city=practiceOptions(one.row.state).find(o=>o.actions[0].type==='build_city');assert.ok(city);
 const committed=(await one.owner.practiceCommit(one.id,one.row.revision,{optionId:city.id,reason:'Upgrade the stronger site.',probability:.5,horizon:1})).attempt;
 let row=await one.store.owned(one.id,OWNER);
 row=(await one.store.act(row,0,row.revision,city.actions[0])).row;
 row=(await one.store.act(row,0,row.revision,{type:'end_turn'})).row;
 const exact=await one.owner.realized(row,{revision:committed.revision,option_id:committed.optionId,horizon:1,probability:.5},one.row.state);
 assert.equal(exact.factualMatch,'verified');
 const two=await fixture(),other=legalActions(two.row.state,0).actions.find(a=>a.type==='build_city'&&a.vertex!==city.actions[0].vertex);
 if(other){
  const planned=practiceOptions(two.row.state).find(o=>o.actions[0].type==='build_city');
  const attempt=(await two.owner.practiceCommit(two.id,two.row.revision,{optionId:planned.id,reason:'Try the selected site.',probability:.5,horizon:1})).attempt;
  let different=await two.store.owned(two.id,OWNER);
  different=(await two.store.act(different,0,different.revision,other)).row;
  different=(await two.store.act(different,0,different.revision,{type:'end_turn'})).row;
  assert.equal((await two.owner.realized(different,{revision:attempt.revision,option_id:attempt.optionId,horizon:1,probability:.5},two.row.state)).factualMatch,'unverified');
 }
 const three=await fixture();
 const buy=practiceOptions(three.row.state).find(o=>o.actions[0].type==='buy_dev_card');assert.ok(buy);
 const buying=(await three.owner.practiceCommit(three.id,three.row.revision,{optionId:buy.id,reason:'Draw for a point.',probability:.5,horizon:1})).attempt;
 let extra=await three.store.owned(three.id,OWNER);
 extra=(await three.store.act(extra,0,extra.revision,{type:'buy_dev_card'})).row;
 // A second action before end_turn disqualifies the single-buy plan even if the first action matches.
 const second=legalActions(extra.state,0).actions.find(a=>a.type.startsWith('build_'));
 assert.ok(second);
 extra=(await three.store.act(extra,0,extra.revision,second)).row;
 extra=(await three.store.act(extra,0,extra.revision,{type:'end_turn'})).row;
 assert.equal((await three.owner.realized(extra,{revision:buying.revision,option_id:buying.optionId,horizon:1,probability:.5},three.row.state)).factualMatch,'unverified');
});
