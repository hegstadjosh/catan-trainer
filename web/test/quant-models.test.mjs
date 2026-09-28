import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
globalThis.CatanMath=require('../../src/model.js');
const D=require('../lib/dashboard-models.cjs');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} vs ${b}`);
test('deadline model keeps shared-number production and legal build-turn CDF',()=>{
 const p={hand:[0,0,0,0,0],woodNumbers:[6],brickNumbers:[6],sheepNumbers:[],wheatNumbers:[],oreNumbers:[],goal:'Road',players:4,nextTurnIn:4,turns:1,discard:false,trades:false};
 const shared=D.compute('deadline_odds',p),split=D.compute('deadline_odds',{...p,brickNumbers:[8]});
 near(shared.keyNumbers.chanceByTurn[0],0.45015944120560897);
 near(split.keyNumbers.chanceByTurn[0],0.17239059404054263);
 assert.deepEqual(shared.keyNumbers.checkpoints,[4]);
 assert.match(shared.assumptions.join(' '),/placement/);
});
test('seven risk counts production before a seven',()=>{
 const r=D.compute('seven_risk',{handSize:7,rollsUntilTurn:2,woodNumbers:[6],brickNumbers:[]});
 near(r.keyNumbers.chanceOfDiscard,Math.round(5/216*1e4)/1e4);
 near(r.keyNumbers.expectedCardsLost,Math.round(20/216*1e3)/1e3);
 assert.match(r.takeaway,/chance of discarding/);
});
test('goal and port values depend on entered recipe',()=>{
 const p={hand:[3,0,0,0,0],woodNumbers:[],brickNumbers:[],sheepNumbers:[],wheatNumbers:[],oreNumbers:[],players:2,nextTurnIn:1,turns:1,discard:false};
 const road=D.compute('goal_values',{...p,goal:'Road'}),city=D.compute('goal_values',{...p,goal:'City'});
 near(road.keyNumbers.ports[0].delta,1);near(city.keyNumbers.ports[0].delta,0);
 assert.match(road.assumptions.join(' '),/not strategic optimality/);
});
test('mixed exact and sampled goal comparisons disclose actual sampled paths',()=>{
 const r=D.compute('goal_values',{hand:[1,1,1,1,1],woodNumbers:[6],brickNumbers:[8],sheepNumbers:[],wheatNumbers:[5],oreNumbers:[9],goal:'Settlement',players:4,nextTurnIn:4,turns:4,discard:true,trades:false,seed:1,samples:300});
 assert.equal(r.keyNumbers.method,'mixed');
 assert.equal(r.keyNumbers.actualSamples,300);
 assert.ok(r.keyNumbers.sampledVariants>0);
 assert.match(r.takeaway,/some comparison rows use 300 paired paths/);
});
test('trade model declares plausible-hand assumption and feasible-give mass',()=>{
 const p={hand:[1,0,0,0,0],woodNumbers:[],brickNumbers:[],sheepNumbers:[],wheatNumbers:[],oreNumbers:[],goal:'Road',players:2,nextTurnIn:1,turns:1,discard:false,give:[0,0,0,0,0],get:[0,1,0,0,0],opponentKnown:[0,0,0,0,0],opponentUnknown:1};
 const r=D.compute('trade_check',p);near(r.keyNumbers.myDelta,1);
 assert.ok(r.keyNumbers.opponent.feasibleTradePriorMass>0&&r.keyNumbers.opponent.feasibleTradePriorMass<1);
 assert.match(r.assumptions.join(' '),/not inferred/);
});
test('invalid production and timing are rejected before computation',()=>{
 assert.equal(D.validate('deadline_odds',{woodNumbers:[7]}).ok,false);
 assert.equal(D.validate('deadline_odds',{players:2,nextTurnIn:3}).ok,false);
});
