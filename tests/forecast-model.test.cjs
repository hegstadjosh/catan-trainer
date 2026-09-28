const assert=require('node:assert/strict');
const F=require('../src/forecast-model.js');
const close=(a,b,eps=1e-9,msg)=>assert(Math.abs(a-b)<=eps,`${msg||''} ${a} vs ${b}`);
const road=F.COSTS.Road,city=F.COSTS.City;

// Brief toy regression: wood+brick both on 6 vs wood 6 / brick 8, empty hand, no trades/robber/discards.
const same=F.parseProduction(['6','6','','','']),split=F.parseProduction(['6','8','','','']);
assert.deepEqual(same.pips,split.pips,'equal pips: the pip view cannot tell these apart');
const a=F.capability({known:[0,0,0,0,0],total:0,cost:road,payouts:same.payouts,rolls:4});
const b=F.capability({known:[0,0,0,0,0],total:0,cost:road,payouts:split.payouts,rolls:4});
close(a.atDeadline,.4501594412,1e-9,'same number by 4');close(b.atDeadline,.1723905940,1e-9,'split by 4');
const mean=payouts=>{const c=F.capability({known:[0,0,0,0,0],total:0,cost:road,payouts,rolls:600}).cdf;return c.reduce((s,x)=>s+(1-x),0);};
close(mean(same.payouts),7.2,1e-6,'mean same');close(mean(split.payouts),10.8,1e-6,'mean split');
// Median roll is the first roll count with at least a 50% chance.
assert.equal(F.capability({known:[0,0,0,0,0],total:0,cost:road,payouts:same.payouts,rolls:20}).median,5);

// Parsing keeps cities and rejects 7 rather than guessing.
const parsed=F.parseProduction(['6 9x2','','','','7 13 x']);
assert.equal(parsed.payouts[6][0],1);assert.equal(parsed.payouts[9][0],2);assert.equal(parsed.pips[0],5+8);assert.equal(parsed.errors.length,3);

// Hand possibilities from known minimums + total.
const range=F.handRange([1,0,0,0,2],5);assert.equal(range.count,15);assert.deepEqual(range.min,[1,0,0,0,2]);assert.deepEqual(range.max,[3,2,2,2,4]);
assert.equal(F.handRange([2,2,0,0,0],3).valid,false,'known cards above the total are inconsistent');

// Two assumptions give different numbers for the same facts: equal hands 1/126 vs independent 1/5 cards 10/3125.
const odds=F.affordOdds([0,0,0,0,0],5,city,null);close(odds.equalHands,1/126);close(odds.cardWeights,10/3125);assert.equal(odds.status,'possible');
// Weights matter: if unknown cards lean ore/wheat, the city is likelier.
assert(F.affordOdds([0,0,0,0,0],5,city,[0,0,0,2,3]).cardWeights>odds.cardWeights*20);
assert.equal(F.affordOdds([0,0,0,2,3],6,city).status,'guaranteed');assert.equal(F.affordOdds([0,0,0,2,3],6,city).cardWeights,1);
// Weighted probabilities over all hands sum to 1.
{let s=0;for(const h of F.handWorlds([1,0,0,0,0],4))s+=F.multinomial(h.map((v,i)=>v-[1,0,0,0,0][i]),[.1,.2,.3,.25,.15]);close(s,1,1e-12,'multinomial sums');}

// With no income the chance never changes; with income it rises monotonically.
const flat=F.capability({known:[0,0,0,1,1],total:4,cost:city,payouts:null,rolls:8}).cdf;assert(flat.every(x=>x===flat[0]));
const prod=F.parseProduction(['','','','6 9','8 10x2']);
const rising=F.capability({known:[0,0,0,1,1],total:4,cost:city,payouts:prod.payouts,rolls:8}).cdf;for(let i=1;i<rising.length;i++)assert(rising[i]>=rising[i-1]-1e-15);
// Marginal card: when they already hold the wheat, only ore helps.
const m=F.marginalCards({known:[0,0,0,2,1],total:3,cost:city,payouts:prod.payouts,rolls:4});
assert.equal(m.reduce((x,y)=>y.gain>x.gain?y:x).resource,'Ore');assert.equal(m[0].gain,0);

// Forecast records: capability and choice stay separate; the original is frozen.
const f=F.makeForecast({opp:'Red',event:'City',detail:'on the 6-ore spot',turns:2,pAfford:.6,pChoose:.7,evidence:'kept wheat',model:{pAffordNoTrade:.41,assumption:'unknown cards ~ production',rolls:8}},new Date('2026-09-28T12:00:00Z'));
assert.equal(f.p,.42);assert.equal(f.rolls,8);assert(F.intact(f));
assert.throws(()=>F.makeForecast({opp:'Red',event:'City',turns:2,pAfford:60,pChoose:.5}),/probability/);
assert.throws(()=>F.makeForecast({opp:'Red',event:'Other',turns:1,pAfford:.5,pChoose:.5}),/Describe/);
const tampered={...f,p:.9};assert.equal(F.intact(tampered),false);
const resolved=F.resolveForecast(f,{outcome:'yes'});assert.equal(resolved.res.afford,'yes','building it proves they could pay');
const guarded=F.enforceImmutable([f],[{...tampered,res:resolved.res}]);assert.equal(guarded[0].p,.42);assert.equal(guarded[0].res.outcome,'yes');
assert.equal(F.enforceImmutable([f],[]).length,1,'deletions are refused');
assert.equal(F.sanitizeForecasts([f,{...f},{id:'x',event:'Fly',p:.2}]).length,1,'duplicates and malformed records dropped');
assert.equal(resolved.res.history.length,1,'resolution has an audit entry');
assert.equal(F.enforceImmutable([f],[resolved])[0].res.history.length,1);
assert.throws(()=>F.enforceImmutable([resolved],[{...resolved,res:{...resolved.res,history:[]}}]),/history/,'history cannot be erased');
assert.throws(()=>F.enforceImmutable([f],[{...f,res:{...f.res,outcome:'yes'}}]),/history/,'outcome cannot change without an audit entry');
const many=Array.from({length:301},(_,i)=>({...f,id:'f'+i}));
assert.equal(F.sanitizeForecasts(many).length,301,'stored forecasts are never silently truncated');
assert.equal(F.enforceImmutable(many,[]).length,301,'write guard preserves every historical record');

// Scoring: only yes/no count; void and pending are reported separately; choice is scored only where ability is known.
const mk=(p,outcome,afford='unknown',pChoose=1)=>F.resolveForecast(F.makeForecast({opp:'B',event:'Road',turns:1,pAfford:p/pChoose>1?1:p/pChoose,pChoose}),{outcome,afford});
const set=[mk(.8,'yes'),mk(.8,'no','yes',.8),mk(.2,'no'),mk(.5,'void','yes'),mk(.6,'pending','yes')];
const s=F.score(set);assert.equal(s.resolved,3);assert.equal(s.excluded,1);assert.equal(s.pending,1);
close(s.overall.brier,(0.04+0.64+0.04)/3,1e-12,'brier');assert.equal(s.enough,false);
assert.equal(s.choose.n,2,'two resolved forecasts had ability known yes');assert.equal(s.afford.n,2,'pending and void capability labels are excluded');
const [lo,hi]=F.wilson(0,5);close(lo,0);close(hi,.4345,1e-3,'wilson upper for 0/5');
const tiny=F.makeForecast({opp:'B',event:'Road',turns:1,pAfford:.01,pChoose:.01});
assert.equal(tiny.p,.0001,'new commitments retain the full event probability for scoring');
console.log('forecast-model tests passed');
