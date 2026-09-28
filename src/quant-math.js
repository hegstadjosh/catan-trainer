(function(root){
'use strict';
const WAYS=[0,0,1,2,3,4,5,6,5,4,3,2,1];
const GOALS={Road:[1,1,0,0,0],Settlement:[1,1,1,1,0],City:[0,0,0,2,3],'Development card':[0,0,1,1,1],'Settlement + 2 roads':[3,3,1,1,0],'Two cities':[0,0,0,4,6]};
const sum=a=>a.reduce((x,y)=>x+y,0),copy=a=>a.slice(),zero=()=>[0,0,0,0,0];
function vector(v,label){if(!Array.isArray(v)||v.length!==5||v.some(x=>!Number.isInteger(x)||x<0))throw Error(label+' must be five nonnegative integers');return copy(v);}
function productionTable(sources){
 if(!Array.isArray(sources)||sources.length!==5)throw Error('sources must have five dice-number lists');
 const table=Object.fromEntries(Array.from({length:11},(_,i)=>[i+2,zero()]));
 sources.forEach((ns,r)=>{if(!Array.isArray(ns))throw Error('each source must be a list');ns.forEach(n=>{if(!Number.isInteger(n)||n<2||n>12||n===7)throw Error('production number must be 2–12 except 7');table[n][r]++;});});
 return table;
}
function canAfford(hand,need,rates,trades=true){
 let missing=0,imports=0;for(let i=0;i<5;i++){const d=hand[i]-need[i];if(d<0)missing-=d;else imports+=Math.floor(d/rates[i]);}
 return missing===0||(trades&&imports>=missing);
}
function discardHand(hand,limit,need){
 const h=copy(hand),loss=sum(h)>limit?Math.floor(sum(h)/2):0;
 for(let n=0;n<loss;n++){let best=h.findIndex(x=>x>0);for(let i=0;i<5;i++)if(h[i]>0&&h[i]-(need?.[i]||0)>h[best]-(need?.[best]||0))best=i;h[best]--;}
 return {hand:h,loss};
}
function seededRandom(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
function rollFrom(u){let x=Math.floor(u*36);for(let n=2;n<=12;n++){x-=WAYS[n];if(x<0)return n;}return 12;}
function setup(opts){
 const o={players:4,nextTurnIn:4,turns:5,discard:true,discardLimit:7,trades:true,seed:1,samples:20000,maxStates:60000,maxExactWork:4000000,...opts};
 o.need=vector(o.need,'need');o.rates=vector(o.rates||[4,4,4,4,4],'rates');if(o.rates.some(x=>x<2||x>4))throw Error('rates must be 2–4');
 o.table=productionTable(o.sources);o.initial=o.initial||[{hand:o.hand||zero(),p:1}];o.initial=o.initial.map(v=>({hand:vector(v.hand,'hand'),p:v.p}));
 const mass=o.initial.reduce((s,v)=>s+v.p,0);if(o.initial.some(v=>!Number.isFinite(v.p)||v.p<0)||Math.abs(mass-1)>1e-8)throw Error('initial probabilities must sum to 1');
 for(const k of ['players','nextTurnIn','turns','discardLimit','samples','maxStates','maxExactWork'])if(!Number.isInteger(o[k])||o[k]<1)throw Error(k+' must be a positive integer');
 if(o.players>6||o.nextTurnIn>o.players||o.turns>30)throw Error('deadline outside supported range');
 o.checkpoints=Array.from({length:o.turns},(_,k)=>o.nextTurnIn+k*o.players);o.horizon=o.checkpoints.at(-1);return o;
}
function key(h,seen,risk){return h.join(',')+'|'+(+seen)+'|'+(+risk);}
function exact(o){
 let states=new Map();for(const v of o.initial){const seen=canAfford(v.hand,o.need,o.rates,false),k=key(v.hand,seen,false);states.set(k,(states.get(k)||0)+v.p);}
 let built=0,ever=0,risk=0,lost=0,work=0;const byTurn=[],collectByRoll=[];
 for(let t=1;t<=o.horizon;t++){
  const next=new Map(),checkpoint=o.checkpoints.includes(t);
  for(const [k,p] of states){const parts=k.split('|'),h=parts[0].split(',').map(Number),wasSeen=parts[1]==='1',wasRisk=parts[2]==='1';
   for(let n=2;n<=12;n++){const q=p*WAYS[n]/36;if(!q)continue;let hh=h.map((v,i)=>v+o.table[n][i]),drop=0;
    if(n===7&&o.discard){const d=discardHand(hh,o.discardLimit,o.need);hh=d.hand;drop=d.loss;}
    const seen=wasSeen||canAfford(hh,o.need,o.rates,false),anyRisk=wasRisk||drop>0;lost+=q*drop;
    if(checkpoint&&canAfford(hh,o.need,o.rates,o.trades)){built+=q;if(seen)ever+=q;if(anyRisk)risk+=q;continue;}
    const nk=key(hh,seen,anyRisk);next.set(nk,(next.get(nk)||0)+q);
   }
  }
  states=next;work+=states.size*11;if(states.size>o.maxStates||work>o.maxExactWork)return null;
  const seenMass=[...states].reduce((s,[k,p])=>s+(k.split('|')[1]==='1'?p:0),0);
  collectByRoll.push(Math.min(1,ever+seenMass));if(checkpoint)byTurn.push(Math.min(1,built));
 }
 risk+=[...states].reduce((s,[k,p])=>s+(k.endsWith('|1')?p:0),0);
 return {byTurn,collectByRoll,discardRisk:risk,expectedDiscarded:lost,method:'exact',samples:null,se:byTurn.map(()=>0),ci:byTurn.map(p=>[p,p])};
}
function wilson(hits,n){const z=1.96,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return [Math.max(0,c-m),Math.min(1,c+m)];}
function monteCarlo(o){
 const N=Math.min(o.samples,Math.max(1,Math.floor(4000000/o.horizon))),rng=seededRandom(o.seed),built=Array(o.turns).fill(0),collected=Array(o.horizon).fill(0);let risk=0,lost=0;
 for(let s=0;s<N;s++){let u=rng(),pick=o.initial[0],acc=0;for(const item of o.initial){acc+=item.p;if(u<acc){pick=item;break;}}
  let h=copy(pick.hand),seen=canAfford(h,o.need,o.rates,false),hit=0,at=0,hadRisk=false;
  const rolls=Array.from({length:o.horizon},()=>rollFrom(rng()));
  for(let t=1;t<=o.horizon;t++){const n=rolls[t-1];h=h.map((v,i)=>v+o.table[n][i]);if(n===7&&o.discard){const d=discardHand(h,o.discardLimit,o.need);h=d.hand;lost+=d.loss;hadRisk||=d.loss>0;}
   seen||=canAfford(h,o.need,o.rates,false);if(seen)collected[t-1]++;
   if(o.checkpoints[at]===t){if(canAfford(h,o.need,o.rates,o.trades)){hit=t;break;}at++;}
  }
  if(hadRisk)risk++;if(hit){for(let j=0;j<o.turns;j++)if(o.checkpoints[j]>=hit)built[j]++;for(let t=hit;t<o.horizon;t++)if(seen)collected[t]++;}
 }
 return {byTurn:built.map(x=>x/N),collectByRoll:collected.map(x=>x/N),discardRisk:risk/N,expectedDiscarded:lost/N,method:'monte-carlo',samples:N,se:built.map(x=>Math.sqrt(x/N*(1-x/N)/N)),ci:built.map(x=>wilson(x,N))};
}
function deadlineOdds(opts){
 const o=setup(opts);let out=exact(o);if(!out)out=monteCarlo(o);
 const q=p=>{const i=out.byTurn.findIndex(x=>x+1e-12>=p);return i<0?null:i+1;};
 return {...out,collectByRoll:o.trades?null:out.collectByRoll,median:q(.5),p80:q(.8),p95:q(.95),censored:1-out.byTurn.at(-1),checkpoints:o.checkpoints,seed:out.method==='exact'?null:o.seed,policies:{discard:o.discard,discardLimit:o.discardLimit,trades:o.trades,playerTrades:false,robber:false,bankShortage:false,otherSpending:false,buildAtCheckpoints:true,collectionCurve:o.trades?'omitted because trades can build before direct collection':'direct card coverage by roll before first build'}};
}
function handPrior(known,unknown,weights=[1,1,1,1,1]){
 known=vector(known,'known');weights=vector(weights,'weights');if(!Number.isInteger(unknown)||unknown<0||unknown>20)throw Error('unknown must be 0–20');
 const total=sum(weights);if(!total)throw Error('weights need positive mass');if(unknown>12)throw Error('exact hand prior limited to 12 unknown cards');
 let states=new Map([[known.join(','),1]]);for(let n=0;n<unknown;n++){const next=new Map();for(const [k,p] of states){const h=k.split(',').map(Number);for(let i=0;i<5;i++){if(!weights[i])continue;const hh=copy(h);hh[i]++;const kk=hh.join(',');next.set(kk,(next.get(kk)||0)+p*weights[i]/total);}}states=next;}
 return [...states].map(([k,p])=>({hand:k.split(',').map(Number),p}));
}
function goalValues(opts){
 // Seventeen paired scenarios share a seed. Cap their combined sampled roll paths,
 // then report the actual sample count and intervals rather than silently doing less work.
 const horizon=opts.nextTurnIn+(opts.turns-1)*opts.players;
 const requested=opts.samples??20000,comparisonSamples=Math.max(1,Math.min(requested,Math.floor(3000000/(17*horizon))));
 const cfg={...opts,samples:comparisonSamples,maxStates:Math.min(opts.maxStates??60000,6000),maxExactWork:Math.min(opts.maxExactWork??4000000,150000)};
 const base=deadlineOdds(cfg),deadline=base.byTurn.at(-1),cards=[],ports=[];
 for(let i=0;i<5;i++){const h=copy(opts.hand),plus=copy(h);plus[i]++;const less=copy(h);less[i]=Math.max(0,less[i]-1);
  const up=deadlineOdds({...cfg,hand:plus}),down=deadlineOdds({...cfg,hand:less});cards.push({resource:i,plus:up.byTurn.at(-1)-deadline,minus:deadline-down.byTurn.at(-1),plusMedian:up.median,minusMedian:down.median,plusCI:up.ci.at(-1),minusCI:down.ci.at(-1),plusMethod:up.method,minusMethod:down.method,plusSamples:up.samples,minusSamples:down.samples});
  const rates=copy(opts.rates||[4,4,4,4,4]);rates[i]=Math.min(rates[i],2);const r=deadlineOdds({...cfg,rates});ports.push({resource:i,rate:rates[i],delta:r.byTurn.at(-1)-deadline,median:r.median,ci:r.ci.at(-1),method:r.method,samples:r.samples});
 }
 const all3=deadlineOdds({...cfg,rates:(opts.rates||[4,4,4,4,4]).map(x=>Math.min(x,3))});
 const methods=new Set([base.method,all3.method,...cards.flatMap(c=>[c.plusMethod,c.minusMethod]),...ports.map(p=>p.method)]);
 const sampled=[base.samples,all3.samples,...cards.flatMap(c=>[c.plusSamples,c.minusSamples]),...ports.map(p=>p.samples)].filter(n=>n!=null);
 return {goal:copy(opts.need),deadlineTurns:opts.turns,baseline:base,cards,ports,genericPort:{delta:all3.byTurn.at(-1)-deadline,median:all3.median,ci:all3.ci.at(-1),method:all3.method,samples:all3.samples},requestedSamples:requested,comparisonSamples:sampled[0]??null,sampledVariants:sampled.length,comparisonMethod:methods.size===1?base.method:'mixed',comparison:'paired rolls and common seed for Monte Carlo variants; interval overlap is not a paired difference interval'};
}
function tradeEffect({me,opponent,give,get}){
 const a=vector(give,'give'),b=vector(get,'get'),horizon=me.nextTurnIn+(me.turns-1)*me.players;
 const scenarios=opponent.sources&&opponent.goal&&opponent.turns?4:2;
 const comparisonSamples=Math.max(1,Math.min(me.samples??20000,Math.floor(3000000/(scenarios*horizon))));
 const cfg={...me,samples:comparisonSamples,maxStates:Math.min(me.maxStates??60000,6000),maxExactWork:Math.min(me.maxExactWork??4000000,150000)};
 const before=deadlineOdds(cfg);const mine=me.hand.map((x,i)=>x-a[i]+b[i]);if(mine.some(x=>x<0))throw Error('you cannot give cards outside your hand');
 const after=deadlineOdds({...cfg,hand:mine});const prior=opponent.initial||handPrior(opponent.known,opponent.unknown,opponent.weights);const valid=prior.filter(v=>v.hand.every((x,i)=>x>=b[i])),validMass=sum(valid.map(v=>v.p));const rows=[];
 for(const [name,need] of Object.entries(GOALS)){let pre=0,post=0;for(const v of valid){const next=v.hand.map((x,i)=>x+a[i]-b[i]);pre+=v.p*Number(canAfford(v.hand,need,opponent.rates||[4,4,4,4,4]));post+=v.p*Number(canAfford(next,need,opponent.rates||[4,4,4,4,4]));}rows.push({goal:name,before:validMass?pre/validMass:null,after:validMass?post/validMass:null,delta:validMass?(post-pre)/validMass:null});}
 let forecast=null;if(opponent.sources&&opponent.goal&&opponent.turns&&validMass){const cfg={...opponent,need:opponent.goal,initial:valid.map(v=>({hand:v.hand,p:v.p/validMass}))};const pre=deadlineOdds(cfg),post=deadlineOdds({...cfg,initial:valid.map(v=>({hand:v.hand.map((x,i)=>x+a[i]-b[i]),p:v.p/validMass}))});forecast={before:pre,after:post};}
 return {mine:{before,after,delta:after.byTurn.at(-1)-before.byTurn.at(-1)},opponent:{possibleHands:prior.length,feasibleTradePriorMass:validMass,builds:rows,forecast},requestedSamples:me.samples??20000,comparisonSamples:before.samples??after.samples,comparisonMethod:before.method===after.method?before.method:'mixed',assumptions:['Opponent hand is an entered prior, not an observed fact.','Opponent comparisons condition on hands that can give requested cards.','Feasibility is not intent or optimality.','Player trade is assumed accepted and executed immediately.']};
}
function sevenRisk({handSize,sources,rolls,discardLimit=7}){
 if(!Number.isInteger(handSize)||handSize<0||!Number.isInteger(rolls)||rolls<0||rolls>100)throw Error('invalid hand size or rolls');
 const table=productionTable(sources),growth=Object.fromEntries(Object.entries(table).map(([n,row])=>[n,sum(row)]));let states=new Map([[handSize+'|0',1]]),lost=0;
 for(let t=0;t<rolls;t++){const next=new Map();for(const [k,p] of states)for(let n=2;n<=12;n++){const q=p*WAYS[n]/36,[raw,flag]=k.split('|');let hh=+raw+growth[n],hit=flag==='1';if(n===7&&hh>discardLimit){const d=Math.floor(hh/2);hh-=d;lost+=q*d;hit=true;}const nk=hh+'|'+(+hit);next.set(nk,(next.get(nk)||0)+q);}states=next;}
 const risk=[...states].reduce((v,[k,p])=>v+(k.endsWith('|1')?p:0),0);
 return {discardRisk:risk,expectedDiscarded:lost,endingHand:Object.fromEntries(states),policy:'Income by dice outcome; on 7, discard floor(hand/2) if above limit; no spending or theft'};
}
const api={goals:GOALS,productionTable,canAfford,seededRandom,deadlineOdds,handPrior,goalValues,tradeEffect,sevenRisk};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CatanQuant=api;
})(typeof window!=='undefined'?window:globalThis);
