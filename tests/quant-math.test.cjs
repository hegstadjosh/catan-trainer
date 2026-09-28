const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../src/model.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} vs ${b}`);
const opt=(sources,extra={})=>({hand:[0,0,0,0,0],sources,need:[1,1,0,0,0],players:1,nextTurnIn:1,turns:4,trades:false,discard:false,...extra});
test('correlated dice preserve exact first-collection probabilities',()=>{
 const shared=M.deadlineOdds(opt([[6],[6],[],[],[]]));
 const split=M.deadlineOdds(opt([[6],[8],[],[],[]]));
 assert.equal(shared.method,'exact');assert.equal(split.method,'exact');
 near(shared.collectByRoll[3],0.45015944120560897);near(split.collectByRoll[3],0.17239059404054263);
 near(shared.byTurn[3],shared.collectByRoll[3]);near(split.byTurn[3],split.collectByRoll[3]);
 near(36/5,7.2);near(36/5+36/5/2,10.8);
});
test('build timing follows checkpoints, even after collecting early',()=>{
 const r=M.deadlineOdds(opt([[6],[6],[],[],[]],{players:4,nextTurnIn:4,turns:2}));
 near(r.collectByRoll[0],5/36);near(r.byTurn[0],1-(31/36)**4);
 assert.deepEqual(r.checkpoints,[4,8]);
});
test('seven income can cause discard from an initial seven-card hand',()=>{
 const risk=M.sevenRisk({handSize:7,sources:[[6],[],[],[],[]],rolls:2});
 near(risk.discardRisk,5/216);near(risk.expectedDiscarded,20/216);
 const r=M.deadlineOdds({hand:[7,0,0,0,0],sources:[[6],[],[],[],[]],need:[8,0,0,0,0],players:2,nextTurnIn:2,turns:1,trades:false});
 assert.ok(r.discardRisk>0);assert.ok(r.collectByRoll[1]>r.byTurn[0]);
});
test('quantiles beyond horizon are censored and seed is reproducible',()=>{
 const p=opt([[2],[],[],[],[]],{turns:3,maxStates:1,samples:1000,seed:81});
 const a=M.deadlineOdds(p),b=M.deadlineOdds(p);
 assert.deepEqual(a,b);assert.equal(a.method,'monte-carlo');assert.equal(a.median,null);
 assert.ok(a.censored>0.5);assert.ok(a.ci[0][0]<=a.byTurn[0]&&a.ci[0][1]>=a.byTurn[0]);
});
test('port and card values depend on goal and exact integer trades',()=>{
 const base={hand:[3,0,0,0,0],sources:[[],[],[],[],[]],rates:[4,4,4,4,4],players:1,nextTurnIn:1,turns:1,discard:false};
 const road=M.goalValues({...base,need:M.costs.Road});
 const city=M.goalValues({...base,need:M.costs.City});
 near(road.ports[0].delta,1);near(city.ports[0].delta,0);
 near(city.cards[1].plus,0);assert.ok(road.cards[1].plus>0);
});
test('trade effect separates my deadline gain from opponent feasibility',()=>{
 const me={hand:[1,0,0,0,0],sources:[[],[],[],[],[]],need:M.costs.Road,players:1,nextTurnIn:1,turns:1,discard:false};
 const opponent={known:[0,1,0,0,0],unknown:0};
 const result=M.tradeEffect({me,opponent,give:[0,0,0,0,0],get:[0,1,0,0,0]});
 near(result.mine.delta,1);near(result.opponent.builds.find(x=>x.goal==='Road').delta,0);
});
test('large comparison caps total paths and reports the actual paired sample count',()=>{
 const cfg={hand:[1,0,0,0,0],sources:[[6,8],[5,9],[4,10],[2],[12]],need:M.goals['Two cities'],rates:[4,4,4,4,4],players:6,nextTurnIn:6,turns:20,discard:true,trades:false,seed:999999,samples:20000};
 const values=M.goalValues(cfg);
 assert.equal(values.requestedSamples,20000);
 assert.equal(values.comparisonSamples,1470);
 assert.equal(values.baseline.method,'monte-carlo');
 assert.equal(values.baseline.samples,1470);
 assert.equal(values.cards[0].plusSamples,1470);
 assert.equal(values.ports[0].samples,1470);
 assert.ok(values.baseline.ci.at(-1)[0]<=values.baseline.byTurn.at(-1));
 const trade=M.tradeEffect({me:cfg,opponent:{known:[0,0,0,0,0],unknown:8},give:[1,0,0,0,0],get:[0,1,0,0,0]});
 assert.equal(trade.comparisonSamples,12500);
 assert.equal(trade.mine.before.samples,12500);
 assert.equal(trade.mine.after.samples,12500);
});
test('exact baseline reports samples used by a mixed comparison variant',()=>{
 const cfg={hand:[1,1,1,1,1],sources:[[6],[8],[],[5],[9]],need:M.costs.Settlement,rates:[4,4,4,4,4],players:4,nextTurnIn:4,turns:4,discard:true,trades:false,seed:1,samples:300};
 const r=M.goalValues(cfg);
 assert.equal(r.baseline.method,'exact');
 assert.equal(r.cards[2].minusMethod,'monte-carlo');
 assert.equal(r.comparisonMethod,'mixed');
 assert.equal(r.comparisonSamples,300);
 assert.ok(r.sampledVariants>0);
});
