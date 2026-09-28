(function(global){
'use strict';
// Small, inspectable situations. The answer is a consequence of the stated policy,
// never a prediction of the best move or a learned win rate.
const F=global.CatanForecast||(typeof require==='function'?require('./forecast-model.js'):null);
const TYPES=['correlation','timing','opportunity','forecast'];
const pct=p=>`${Math.round(100*p)}%`;
function rng(seed){let x=(Number(seed)>>>0)||1;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function generate(type,seed=Date.now()){
 const random=rng(seed),kind=TYPES.includes(type)?type:TYPES[Math.floor(random()*TYPES.length)];
 if(kind==='correlation'){
  const n=[4,5,6,8,9,10][Math.floor(random()*6)],other=14-n,rolls=3+Math.floor(random()*4);
  const same=F.parseProduction([String(n),String(n),'','','']);
  const split=F.parseProduction([String(n),String(other),'','','']);
  const input={known:[0,0,0,0,0],total:0,cost:F.COSTS.Road,rolls};
  const a=F.capability({...input,payouts:same.payouts}).atDeadline,b=F.capability({...input,payouts:split.payouts}).atDeadline;
  return {type:kind,seed,prompt:`Empty hand, no trades, spending, robber or discards. A road costs wood + brick. Setup A pays both on ${n}; setup B pays wood on ${n} and brick on ${other}. Which is more likely to afford a road within ${rolls} table rolls?`,options:[['A','A: same number'],['B','B: split numbers'],['equal','Equal']],correct:'A',explanation:`The same pips hide the joint payout. A needs one hit on ${n} (${pct(a)} by ${rolls}); B needs both numbers (${pct(b)}). This is first affordability, not permission to build on a turn.`};
 }
 if(kind==='timing'){
  const n=[5,6,8,9][Math.floor(random()*4)],rolls=3+Math.floor(random()*5),p=F.pips(n)/36,hit=F.atLeastOnce(p,rolls);
  return {type:kind,seed,prompt:`A missing card comes only from a ${n}, which pays one. No trades, robber or other spending. What is the chance of at least one payout within ${rolls} table rolls?`,options:[['mean',pct(rolls*p)],['chance',pct(hit)],['one',pct(p)]],correct:'chance',explanation:`Chance of no ${n} in ${rolls} rolls is (1 − ${F.pips(n)}/36)^${rolls}; subtract from 1. ${pct(rolls*p)} is the expected count misread as a chance; ${pct(p)} is only one roll.`};
 }
 if(kind==='opportunity'){
  const wheat=1+Math.floor(random()*2),ore=2+Math.floor(random()*2);
  return {type:kind,seed,prompt:`You hold 2 wheat and 3 ore: a city recipe. A neighbor offers ${ore} ore for ${wheat} wheat. You plan to upgrade on your next legal build turn, and no other income is guaranteed. What is the immediate opportunity cost?`,options:[['city','You lose immediate city affordability'],['none','No cost: ore is always valuable'],['win','The trade lowers your win chance by a known amount']],correct:'city',explanation:`After the trade you have ${2-wheat} wheat and ${3+ore} ore. The city still needs 2 wheat. This compares recipe access under the stated goal; it cannot establish win probability or overall optimality.`};
 }
 const afford=[.3,.5,.7,.8][Math.floor(random()*4)],choose=[.25,.75][Math.floor(random()*2)],joint=afford*choose;
 return {type:kind,seed,prompt:`You assign ${pct(afford)} to “they can afford a city by their next turn” and ${pct(choose)} to “they choose a city GIVEN that they can afford it.” What is your chance they build a city by then?`,options:[['product',pct(joint)],['afford',pct(afford)],['choose',pct(choose)]],correct:'product',explanation:`P(build) = P(can afford) × P(choose city | can afford) = ${pct(joint)}. “Choose” must be conditional; an unconditional choice estimate cannot be multiplied this way. A legal site and build turn are separate conditions.`};
}
const api={TYPES,generate};if(typeof module==='object'&&module.exports)module.exports=api;else global.CatanOddsDrills=api;
})(typeof window!=='undefined'?window:globalThis);
