import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const lib=new URL('../lib/',import.meta.url),mathPath=new URL('../../src/model.js',import.meta.url);
const M=require(mathPath.pathname);
globalThis.CatanMath??=M; // used only until the parent copies src/model.js to lib/catan-math.cjs
const D=require('../lib/dashboard-models.cjs');
const TONES=['wood','brick','sheep','wheat','ore'],UNITS=['','%','cards','rolls','VP'];

function checkView({kind,spec}){
 const finiteOrNull=v=>v===null||Number.isFinite(v);
 if(kind==='chart'){
  assert.ok(['line','bar'].includes(spec.type));
  assert.ok(spec.x.length>=1&&spec.x.length<=(spec.type==='line'?200:40));
  assert.ok(spec.series.length>=1&&spec.series.length<=6);
  for(const s of spec.series){assert.equal(s.values.length,spec.x.length);assert.ok(s.values.every(finiteOrNull));assert.ok(s.name.length<=40);if(s.tone)assert.ok(TONES.includes(s.tone));}
  assert.ok(spec.xLabel.length<=40&&spec.yLabel.length<=40);
  if(spec.unit!==undefined)assert.ok(UNITS.includes(spec.unit));
  for(const k of ['yMin','yMax','highlightX'])if(spec[k]!==undefined)assert.ok(Number.isFinite(spec[k]));
 }else if(kind==='stat'){
  assert.ok(spec.items.length>=1&&spec.items.length<=4);
  for(const i of spec.items){assert.ok(Number.isFinite(i.value));assert.ok(i.label.length<=40);if(i.note)assert.ok(i.note.length<=80);}
 }else if(kind==='table'){
  assert.ok(spec.columns.length<=8&&spec.rows.length<=50);
  for(const r of spec.rows){assert.equal(r.length,spec.columns.length);for(const c of r)assert.ok(c===null||Number.isFinite(c)||(typeof c==='string'&&c.length<=60));}
 }else assert.fail('unknown view kind '+kind);
}
function checkResult(r){
 checkView(r.view);for(const v of r.extraViews||[])checkView(v);
 assert.ok(r.takeaway.length>0&&r.takeaway.length<=140,r.takeaway);
 const text=JSON.stringify(r);
 assert.doesNotMatch(text,/NaN|Infinity|<[a-z/]/i);
 assert.ok(r.keyNumbers&&typeof r.keyNumbers==='object');
 assert.ok(r.method&&Array.isArray(r.assumptions)&&r.assumptions.length);
}

test('catalog shape and defaults compute to valid views',()=>{
 assert.deepEqual(D.catalog.map(m=>m.name),['dice_odds','resource_income','build_eta','dev_card_odds','seven_risk','win_routes','deadline_odds','goal_values','trade_check','trajectory']);
 for(const m of D.catalog){
  assert.ok(m.label&&m.description&&['third','half','full'].includes(m.defaultSize));
  for(const p of m.params){assert.ok(['number','boolean','select','numbers','booleans'].includes(p.type));assert.deepEqual(m.defaults[p.key],p.default);}
  const v=D.validate(m.name,{});assert.ok(v.ok,v.errors.join());assert.deepEqual(v.params,m.defaults);
  checkResult(D.compute(m.name,{}));
 }
 assert.ok(Object.isFrozen(D.catalog[0].params[0].default));
});

test('dice_odds',()=>{
 const r=D.compute('dice_odds',{highlight:[6,8,9]});
 assert.match(r.takeaway,/39%/);assert.match(r.takeaway,/14 of 36/);
 assert.equal(r.view.spec.x.length,11);
 const total=r.view.spec.x.map((_,i)=>r.view.spec.series.reduce((s,x)=>s+(x.values[i]??0),0));
 assert.ok(Math.abs(total.reduce((a,b)=>a+b)-100)<0.05);
 checkResult(D.compute('dice_odds',{highlight:[]}));
});

test('resource_income labels lowest income without assuming a goal bottleneck',()=>{
 const r=D.compute('resource_income',{pips:[5,3,4,6,2],rolls:12});
 assert.match(r.takeaway,/2\.0 Wheat/);assert.doesNotMatch(r.takeaway,/bottleneck/);
 assert.deepEqual(r.keyNumbers.lowestIncome,['Ore']);assert.equal(r.keyNumbers.goalBottleneck,null);
 assert.deepEqual(D.compute('resource_income',{pips:[0,0,0,6,2],goal:'City'}).keyNumbers.goalBottleneck,['Ore']);
 assert.equal(r.keyNumbers.expected.Wheat,2);
 const big=D.compute('resource_income',{pips:[80,30,0,20,16],rolls:60});checkResult(big);
 assert.equal(big.keyNumbers.expected.Wood,round3(80/36*60));
 checkResult(D.compute('resource_income',{pips:[0,0,0,0,0]}));
});
const round3=x=>Math.round(x*1000)/1000;

test('build_eta matches flowTime and is labelled as a proxy',()=>{
 const p={hand:[1,1,0,1,0],pips:[5,3,4,6,2],genericPort:false,ports:[false,false,false,false,false]};
 const r=D.compute('build_eta',p),ratios=M.bankRates(false,p.ports),mu=p.pips.map(x=>x/36);
 assert.match(r.view.spec.x[0],/Now/);assert.equal(r.keyNumbers.proxyRolls.Road,0);
 for(const b of ['Settlement','City','Development card'])assert.ok(Math.abs(r.keyNumbers.proxyRolls[b]-M.flowTime(p.hand,mu,M.costs[b],ratios))<0.01);
 const none=D.compute('build_eta',{hand:[0,0,0,0,0],pips:[0,0,0,0,0]});checkResult(none);
 assert.ok(none.view.spec.x.every(x=>/Not reachable/.test(x)));assert.ok(none.view.spec.series[0].values.every(v=>v===null));
 assert.deepEqual(none.keyNumbers.unreachable.length,4);
 // Whole bank trades count as "Now".
 assert.ok(!D.compute('build_eta',{hand:[4,0,0,0,0],pips:[0,0,0,0,0]}).keyNumbers.now.includes('Road'));
 assert.ok(D.compute('build_eta',{hand:[4,0,0,0,0],pips:[0,0,0,0,0],genericPort:true}).keyNumbers.now.includes('Road'));
 const port=D.compute('build_eta',{hand:[3,0,0,0,0],pips:[0,0,0,0,0],ports:[true,false,false,false,false]});
 assert.ok(port.keyNumbers.now.includes('Road'));
 const all=JSON.stringify(D.catalog.find(m=>m.name==='build_eta'))+r.takeaway+r.method+r.assumptions.join(' ');
 const claims=all.replace(/not an expected wait(ing time)?|Nothing is guaranteed/gi,'');
 assert.doesNotMatch(claims,/expected|guarantee/i);assert.doesNotMatch(claims,/\bETA\b/);
 assert.ok(r.assumptions.some(a=>/not an expected waiting time/.test(a)));
 checkResult(D.compute('build_eta',{hand:[19,19,19,19,19],pips:[80,80,80,80,80],genericPort:true,ports:[true,true,true,true,true]}));
 checkResult(D.compute('build_eta',{hand:[0,0,0,0,0],pips:[1,0,0,0,0]}));
});

test('dev_card_odds agrees with tail and quantile',()=>{
 const r=D.compute('dev_card_odds',{});
 r.view.spec.series[0].values.forEach((v,n)=>assert.ok(Math.abs(v-M.tail(25,14,n,3)*100)<0.01));
 assert.equal(r.view.spec.x.length,26);assert.equal(r.view.spec.highlightX,6);
 assert.equal(r.keyNumbers.cardsFor50,M.quantile(25,14,3,0.5));assert.equal(r.keyNumbers.cardsFor90,M.quantile(25,14,3,0.9));
 assert.match(r.takeaway,new RegExp(`50% by card ${M.quantile(25,14,3,0.5)}, 90% by card ${M.quantile(25,14,3,0.9)}`));
 const miss=D.compute('dev_card_odds',{type:'Monopoly',need:3,remaining:[10,3,1,2,2],bought:4});checkResult(miss);
 assert.match(miss.takeaway,/Not reachable/);assert.equal(miss.keyNumbers.cardsFor50,null);assert.equal(miss.keyNumbers.expectedCards,null);
 checkResult(D.compute('dev_card_odds',{remaining:[0,0,0,0,0],bought:0}));
});

test('seven_risk: 1-(5/6)^k, discard once per seven without double counting',()=>{
 const r=D.compute('seven_risk',{handSize:9,rollsUntilTurn:3,woodNumbers:[],brickNumbers:[]});
 assert.equal(r.keyNumbers.chanceOfSeven,Math.round((1-(5/6)**3)*1e4)/1e4);
 assert.equal(r.keyNumbers.discardIfSeven,4);assert.match(r.takeaway,/42% chance/);
 // Hand 9: first seven loses 4, later sevens find 5 cards and lose nothing, so E = 4 * P(at least one 7).
 assert.ok(Math.abs(r.keyNumbers.expectedCardsLost-4*(1-(5/6)**3))<1e-3);
 assert.equal(D.compute('seven_risk',{handSize:7}).keyNumbers.discardIfSeven,0);
 // Hand 20, 2 rolls: one seven loses 10, two lose 15.
 const h=D.compute('seven_risk',{handSize:20,rollsUntilTurn:2,woodNumbers:[],brickNumbers:[]});
 assert.ok(Math.abs(h.keyNumbers.expectedCardsLost-(2*(1/6)*(5/6)*10+(1/36)*15))<1e-3);
 assert.equal(r.extraViews[0].spec.x.length,12);
});

test('win_routes and trajectory mirror the model data',()=>{
 const base=D.compute('win_routes',{sort:'base'}),min=Math.min(...M.routes.map(r=>r.base+8+3*r.minimumDraws));
 assert.equal(base.view.spec.rows[0][2],min);assert.equal(base.view.spec.rows.length,M.routes.length);
 assert.equal(D.compute('win_routes',{sort:'vp'}).view.spec.rows[0][1],Math.max(...M.routes.map(r=>r.vp)));
 checkResult(D.compute('win_routes',{sort:'draws'}));
 for(const route of [0,1,2])for(const mode of ['total','turn']){
  const t=D.compute('trajectory',{route,mode});checkResult(t);
  assert.deepEqual(t.view.spec.series.map(s=>s.values),[0,1,2,3,4].map(i=>M.trajectories[route].rows.map(r=>(mode==='total'?r.total:r.spent)[i])));
 }
});

test('validate rejects bad params with field-specific errors and never clamps',()=>{
 const bad=(name,params,re)=>{const v=D.validate(name,params);assert.equal(v.ok,false);assert.ok(v.errors.some(e=>re.test(e)),v.errors.join(' | '));assert.throws(()=>D.compute(name,params),e=>e.name==='ValidationError'&&re.test(e.message));};
 bad('resource_income',{pips:[1,2,3,4,81]},/pips\[4\] must be 0–80/);
 assert.deepEqual(D.validate('resource_income',{pips:[1,2,3,4,81]}).errors,['pips[4] must be 0–80']);
 bad('resource_income',{pips:[1,2,3,4]},/pips must have exactly 5 values/);
 bad('resource_income',{pips:[1,2,3,4,1.5]},/pips\[4\] must be an integer/);
 bad('resource_income',{rolls:'12'},/rolls must be a number/);
 bad('resource_income',{rolls:0},/rolls must be 1–60/);
 bad('resource_income',{rolls:Infinity},/rolls must be a number/);
 bad('resource_income',{extra:1},/Unknown parameter "extra"/);
 bad('dice_odds',{highlight:[6,6]},/must not repeat/);
 bad('dice_odds',{highlight:[1]},/highlight\[0\] must be 2–12/);
 bad('dice_odds',{highlight:[2,3,4,5,6,8,9]},/at most 6/);
 bad('build_eta',{genericPort:'yes'},/genericPort must be true or false/);
 bad('build_eta',{ports:[true]},/ports must have exactly 5/);
 bad('build_eta',{hand:[20,0,0,0,0]},/hand\[0\] must be 0–19/);
 bad('dev_card_odds',{type:'Soldier'},/type must be one of/);
 bad('dev_card_odds',{remaining:[14,6,2,2,2]},/remaining\[1\] must be 0–5/);
 bad('dev_card_odds',{remaining:[3,0,0,0,0],bought:4},/bought must be 0–3/);
 bad('dev_card_odds',{need:6},/need must be 1–5/);
 bad('seven_risk',{handSize:-1},/handSize must be 0–40/);
 bad('trajectory',{route:3},/route must be 0–2/);
 bad('win_routes',{sort:'cost'},/sort must be one of/);
 assert.match(D.validate('nope',{}).errors[0],/Unknown model/);
 assert.throws(()=>D.compute('nope',{}),/Unknown model/);
 assert.equal(D.validate('dice_odds',[1]).ok,false);
 assert.ok(D.validate('dice_odds',null).ok);
});

test('runs as a browser script and sets window.DashboardModels',()=>{
 const window={CatanMath:M};
 vm.runInNewContext(fs.readFileSync(new URL('dashboard-models.cjs',lib),'utf8'),{window});
 assert.match(window.DashboardModels.compute('dice_odds',{highlight:[6,8,9]}).takeaway,/39%/);
 assert.equal(window.DashboardModels.catalog.length,10);
});
