// The opponent tracker must never claim something false: every bound it shows has to contain the true hidden hand.
// Plays seeded games on the real engine and checks the tracker (fed only seat 0's view) after every move.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,viewMatch,applyAction,legalActions} from '../game/rules.mjs';
await import('../public/game-tracker.js');
const T=globalThis.CatanTracker;
const RES=T.RES;

function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/2**32;};}
function choose(state,seat,rand){
 const la=legalActions(state,seat);
 if(la.choices.discard){const {count,hand}=la.choices.discard,h={...hand},res={};let k=count;while(k>0){const r=RES.filter(x=>h[x]>0)[Math.floor(rand()*RES.filter(x=>h[x]>0).length)];h[r]--;res[r]=(res[r]||0)+1;k--;}return {type:'discard',resources:res};}
 const acts=la.actions;if(!acts.length)return null;
 const of=t=>acts.filter(a=>a.type===t);
 const pick=list=>list[Math.floor(rand()*list.length)];
 for(const t of ['respond_trade','build_city','build_settlement','move_robber','roll','play_monopoly','play_knight','bank_trade','buy_dev_card','build_road']){
  const c=of(t);if(!c.length)continue;
  if(t==='build_road'&&rand()<.5)continue;
  if(t==='bank_trade'&&rand()<.6)continue;
  return pick(c);
 }
 const yop=la.choices.play_year_of_plenty;
 if(yop&&rand()<.5){const r=RES.filter(x=>yop.bank[x]>=yop.count)[0];if(r)return {type:'play_year_of_plenty',resources:{[r]:yop.count}};}
 const offer=la.choices.offer_trade;
 if(offer&&!state.offer&&rand()<.3){const give=RES.find(r=>offer.hand[r]>0);const get=RES.find(r=>r!==give);if(give)return {type:'offer_trade',give:{[give]:1},get:{[get]:1}};}
 if(of('cancel_trade').length)return of('cancel_trade')[0];
 return of('end_turn')[0]||pick(acts);
}
function step(state,rand){
 for(const seat of [0,1,2,3]){const a=choose(state,seat,rand);if(a){const res=applyAction(state,seat,a);return res.state;}}
 return null;
}
function check(tr,state,label){
 const view=viewMatch(state,0),sum=T.summary(tr,view);
 for(const s of [1,2,3]){
  const truth=state.players[s].resources,b=sum.seats[s];
  assert.equal(b.total,RES.reduce((n,r)=>n+truth[r],0),`${label}: total for seat ${s}`);
  for(const r of RES)assert.ok(b.range[r].min<=truth[r]&&truth[r]<=b.range[r].max,`${label}: seat ${s} ${r} true ${truth[r]} outside ${b.range[r].min}-${b.range[r].max}`);
 }
 for(const r of RES)assert.equal(sum.pooled[r],[1,2,3].reduce((n,s)=>n+state.players[s].resources[r],0),`${label}: pooled ${r}`);
 return sum;
}

test('tracker bounds always contain the true opponent hands (full history)',()=>{
 let exactSeen=0,resets=0,moves=0;
 for(const seed of [1,2,3,4,5,6]){
  let state=createMatch({id:'t'+seed,names:['Ari','Ada','Bo','Cy'],seed});
  const rand=rng(seed),tr=T.create();
  T.update(tr,viewMatch(state,0));assert.ok(tr.complete,'starts with complete history');
  for(let i=0;i<1500&&state.phase!=='finished';i++){
   const next=step(state,rand);if(!next)break;state=next;moves++;
   T.update(tr,viewMatch(state,0));
   const sum=check(tr,state,`seed ${seed} move ${i}`);
   exactSeen+=Object.values(sum.seats).filter(x=>x.exact).length;
  }
  resets+=tr.resets.length;
 }
 assert.ok(moves>1000,'played enough moves');
 assert.ok(exactSeen>moves*.3,`tracker is often exact (${exactSeen} exact seat-moves over ${moves} moves)`);
 assert.equal(resets,0,'no resets when every move is observed');
});

test('tracker joins mid-game honestly and recovers after missed history',()=>{
 let state=createMatch({id:'mid',names:['Ari','Ada','Bo','Cy'],seed:9});const rand=rng(9);
 for(let i=0;i<400;i++){const n=step(state,rand);if(!n)break;state=n;}
 const tr=T.create();T.update(tr,viewMatch(state,0));
 assert.equal(tr.complete,false);
 const first=T.summary(tr,viewMatch(state,0));
 for(const s of [1,2,3])assert.equal(first.seats[s].unknown,state.players[s].resourceCount??RES.reduce((n,r)=>n+state.players[s].resources[r],0));
 for(let i=0;i<120&&state.phase!=='finished';i++){const n=step(state,rand);if(!n)break;state=n;T.update(tr,viewMatch(state,0));check(tr,state,'mid '+i);}
 // Skip far ahead so the 60-entry log window no longer overlaps: the tracker must reset rather than guess.
 for(let i=0;i<200&&state.phase!=='finished';i++){const n=step(state,rand);if(!n)break;state=n;}
 T.update(tr,viewMatch(state,0));check(tr,state,'after gap');
});

test('parseVec and production math',()=>{
 assert.deepEqual(T.parseVec('2 brick, 1 ore'),{brick:2,lumber:0,wool:0,grain:0,ore:1});
 assert.equal(T.parseVec('2 bricks'),null);
 assert.equal(T.atLeastOnce(1/6,3).toFixed(3),'0.421');
 const state=createMatch({id:'p',names:['Ari','Ada','Bo','Cy'],seed:3});
 const p=T.production(viewMatch(state,0));
 assert.equal(p[0].total,0,'no buildings, no production');
});
