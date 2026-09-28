const assert=require('node:assert/strict');
const M=require('../src/model.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
// Independent elementary probabilities and finite-deck stopping identities.
close(M.tail(25,14,3,3),(14/25)*(13/24)*(12/23));
close(M.tail(25,5,1,1),.2);
close(M.tail(25,5,2,1),1-(20/25)*(19/24));
close(M.expectedDraws(25,14,3),5.2);
close(M.expectedBoth(3,0),5.2);
close(M.expectedBoth(0,2),26/3);
assert.equal(M.tail(25,2,8,3),0);
assert.equal(M.tail(0,0,0,1),0);
assert.equal(M.expectedDraws(25,2,3),Infinity);
assert.equal(M.quantile(25,14,3,.5),5);
assert.equal(M.quantile(25,14,3,.8),7);
// Exhaust all equally likely subsets of a tiny deck to validate the distribution.
for(let draws=0;draws<=6;draws++)for(let needed=1;needed<=4;needed++){
 let denom=0,num=0;
 for(let mask=0;mask<64;mask++){
  const bits=Array.from({length:6},(_,i)=>(mask>>i)&1);
  if(M.sum(bits)!==draws)continue;
  denom++;if(M.sum(bits.slice(0,3))>=needed)num++;
 }
 close(M.tail(6,3,draws,needed),num/denom);
}
// Whole-card trades: cannot pool partial trades from different resources.
const rates=[4,4,4,4,4];
assert.equal(M.bankPlan([2,2,0,0,0],[0,0,0,0,1],rates).ready,false);
assert.equal(M.bankPlan([0,0,4,1,2],M.costs.City,[4,4,2,4,4]).ready,true);
assert.equal(M.bankPlan([0,0,3,1,2],M.costs.City,[4,4,2,4,4]).ready,false);
let plan=M.bankPlan([0,0,4,1,2],M.costs.City,[4,4,2,4,4]),hand=[0,0,4,1,2];
for(const t of plan.trades){hand[t.from]-=t.give;hand[t.to]+=t.get;}
M.costs.City.forEach((v,i)=>assert.ok(hand[i]>=v));
close(M.flowTime([0,0,0,0,0],[0,0,0,1,1],M.costs.City,rates),2.8);
assert.equal(M.flowTime([0,0,0,0,0],[0,0,0,0,0],M.costs.City,rates),Infinity);
// Every stated finish is exactly 10 VP with feasible piece counts; budget identity.
for(const route of M.routes){
 assert.equal(route.vp,10);assert.ok(route.s<=5&&route.c<=4&&route.n>=0);
 assert.equal(M.sum(M.budget(route.n,route.c,4,route.minimumDraws)),route.base+8+3*route.minimumDraws);
 assert.ok(route.meanDraws+1e-8>=route.minimumDraws);
}
const expected=[[11,11,3,9,9],[6,6,8,16,18],[7,7,6,14,16]];
M.trajectories.forEach((p,i)=>{
 const end=p.rows[24];assert.equal(end.vp,10);assert.deepEqual(end.total,expected[i]);
 for(const row of p.rows){assert.ok(row.s>=0&&row.s<=5&&row.c<=4&&row.r<=15);}
 for(let t=1;t<25;t++)assert.deepEqual(p.rows[t].total,p.rows[t-1].total.map((v,i)=>v+p.rows[t].spent[i]));
});
console.log('PASS: exact draw probabilities, stopping expectations, bank trades, flow estimates, VP routes, and trajectory accounting.');
const P=require('../src/practice-model.js');
const O=require('../src/opponents.js');
assert.deepEqual(M.bankRates(true,[false,false,true,false,false]),[3,3,2,3,3]);
assert.deepEqual(M.bankRates(false,[true,false,true,false,false]),[2,4,2,4,4]);
assert.deepEqual(P.facts(P.profiles[0]).weights,[2,0,4,7,8]);
assert.deepEqual(P.facts(P.profiles[0]).missing,[1]);
assert.deepEqual(P.facts(P.profiles[0]).strongest,[4]);
const publicCity=P.makeHand(0);assert.deepEqual(publicCity.worlds,[[0,0,0,2,3]]);assert.equal(P.threat(publicCity.worlds,M.costs.City),'yes');
const maybeCity=P.makeHand(1);assert.equal(P.threat(maybeCity.worlds,M.costs.City),'maybe');assert.equal(maybeCity.worlds.length,3);
const inferred=P.makeHand(2);assert.deepEqual(P.summarize(inferred.worlds).min,[0,0,1,0,0]);assert.deepEqual(P.summarize(inferred.worlds).max,[1,1,1,0,0]);assert.equal(P.threat(inferred.worlds,M.costs.Road),'no');
assert.equal(P.threat(P.makeHand(3).worlds,M.costs.City),'yes');
for(let scenario=0;scenario<4;scenario++)for(let r=0;r<5;r++)for(let n=0;n<=2;n++){const extra=[0,0,0,0,0];extra[r]=n;const d=P.makeHand(scenario,extra);assert.ok(d.worlds.length);for(const states of d.history){assert.equal(P.summarize(states).totals.length,1);assert.ok(states.every(h=>h.every(v=>Number.isInteger(v)&&v>=0)));}}
let person=O.emptyOpponent(0);person.total=5;person.known=[0,1,0,1,2];person.guess=[0,0,0,1,0];assert.equal(O.knowledge(person).unknown,1);assert.equal(O.possible(person,M.costs.City),'no');
person.total=6;assert.equal(O.possible(person,M.costs.City),'maybe');
person.known=[0,1,0,2,3];person.guess=[0,0,0,0,0];assert.equal(O.possible(person,M.costs.City),'yes');
const lost=O.applyEvent(person,{type:'hidden-loss',q:1},M.costs);assert.equal(lost.total,5);assert.deepEqual(lost.known,[0,0,0,1,2]);assert.deepEqual(lost.guess,[0,0,0,0,0]);assert.equal(O.knowledge(lost).unknown,2);
const spent=O.applyEvent(lost,{type:'City'},M.costs);assert.equal(spent.total,0);assert.deepEqual(spent.known,[0,0,0,0,0]);
assert.throws(()=>O.applyEvent({...person,total:0,known:[0,0,0,0,0]},{type:'City'},M.costs),/contradicts/);
console.log('PASS: port ownership, setup facts, hidden-hand inference, range correlations, live observations, and guess separation.');
