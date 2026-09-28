// Shared Catan dashboard models. CommonJS on the server, plain script in the browser (window.DashboardModels).
// Depends on the Catan math core: require('./catan-math.cjs') on the server, global CatanMath in the browser.
(function(root){
'use strict';
let mathCache=null;
function math(){
 if(mathCache)return mathCache;
 if(root.CatanMath?.deadlineOdds){mathCache=root.CatanMath;return mathCache;}
 if(typeof module==='object'&&module.exports&&typeof require==='function'){try{mathCache=require('./catan-math.cjs');}catch(e){if(!root.CatanMath)throw e;}}
 if(!mathCache)mathCache=root.CatanMath;
 if(!mathCache)throw new Error('DashboardModels needs CatanMath: load catan-math before dashboard-models');
 return mathCache;
}
const RES=['Wood','Brick','Sheep','Wheat','Ore'],TONES=['wood','brick','sheep','wheat','ore'];
const DECK=[14,5,2,2,2],CARD_TYPES=['Knight','Victory point','Road Building','Year of Plenty','Monopoly'];
const CARD_PLURAL={Knight:'Knights','Victory point':'Victory point cards','Road Building':'Road Building cards','Year of Plenty':'Year of Plenty cards',Monopoly:'Monopoly cards'};
const BUILDS=['Road','Settlement','City','Development card'];
const ROUTE_NAMES=['Expansion + Longest Road','Cities + Largest Army','Cities + hidden points'];
const sum=a=>a.reduce((s,x)=>s+x,0);
const round=(x,d=1)=>{const f=10**d;return Math.round(x*f)/f;};
const fmt=(x,d=1)=>round(x,d).toFixed(d);
const pct=p=>Math.round(p*100)+'%';
const clean=v=>typeof v==='number'?(Number.isFinite(v)?v:null):v;

// Parameter schema helpers.
const int=(key,label,min,max,def,extra={})=>({key,label,type:'number',integer:true,min,max,default:def,...extra});
const ints=(key,label,min,max,def,extra={})=>({key,label,type:'numbers',integer:true,min,max,length:def.length,default:def,...extra});
const pipsParam=()=>ints('pips','Weighted pips per resource',0,80,[5,3,4,6,2],{itemLabels:RES,description:'Pips on each resource; count a city twice. Order: Wood, Brick, Sheep, Wheat, Ore.'});
const sourceParams=()=>RES.map((r,i)=>({key:r.toLowerCase()+'Numbers',label:r+' production numbers',type:'numbers',integer:true,min:2,max:12,minLength:0,maxLength:12,default:i===0?[6]:i===1?[8]:[],description:'Repeat a number for a city or a second producing hex. Omit robber-blocked hexes.'}));
const enteredSources=p=>RES.map(r=>p[r.toLowerCase()+'Numbers']);
const quantOpts=p=>({hand:p.hand,sources:enteredSources(p),need:math().goals[p.goal],rates:math().bankRates(p.genericPort,p.ports),players:p.players,nextTurnIn:p.nextTurnIn,turns:p.turns,discard:p.discard,trades:p.trades,seed:p.seed,samples:p.samples});
const quantParams=()=>[ints('hand','Cards in hand',0,40,[0,0,0,0,0],{itemLabels:RES}),...sourceParams(),{key:'goal',label:'Build goal',type:'select',options:[...BUILDS,'Settlement + 2 roads','Two cities'],default:'Settlement'},int('players','Players',2,6,4),int('nextTurnIn','Rolls until your next build turn',1,6,4),int('turns','Deadline in your turns',1,20,3),{key:'genericPort',label:'3:1 port',type:'boolean',default:false},{key:'ports',label:'2:1 ports',type:'booleans',length:5,itemLabels:RES,default:[false,false,false,false,false]},{key:'discard',label:'Apply seven discards',type:'boolean',default:true},{key:'trades',label:'Allow bank and port trades',type:'boolean',default:true},int('seed','Simulation seed',1,999999,1),int('samples','Maximum sampled paths',100,20000,10000)];

const catalog=[
 {name:'dice_odds',label:'Dice odds',description:'How often your numbers come up on a single roll of two dice.',defaultSize:'half',
  params:[{key:'highlight',label:'Your numbers',type:'numbers',integer:true,min:2,max:12,minLength:0,maxLength:6,unique:true,default:[6,8]}]},
 {name:'resource_income',label:'Resource income',description:'Average resources over a number of rolls; choose a goal to see its slowest ingredient under this average-income proxy.',defaultSize:'third',
  params:[pipsParam(),int('rolls','Rolls (all players)',1,60,12),{key:'goal',label:'Goal for slowest ingredient',type:'select',options:['None',...BUILDS],default:'None'}]},
 {name:'build_eta',label:'Build pace (average-income proxy)',description:'A smooth-income proxy for how many rolls of average income cover each build, counting bank and port trades. Not an expected wait.',defaultSize:'half',
  params:[ints('hand','Cards in hand',0,19,[1,1,0,1,0],{itemLabels:RES}),pipsParam(),
   {key:'genericPort',label:'3:1 port',type:'boolean',default:false},
   {key:'ports',label:'2:1 ports',type:'booleans',length:5,itemLabels:RES,default:[false,false,false,false,false]}]},
 {name:'dev_card_odds',label:'Dev card odds',description:'Chance of drawing at least N cards of one type as you buy development cards.',defaultSize:'third',
  params:[{key:'type',label:'Card type',type:'select',options:CARD_TYPES,default:'Knight'},int('need','Cards needed',1,5,3),
   ints('remaining','Cards left in deck',0,14,[14,5,2,2,2],{itemLabels:CARD_TYPES,itemMax:DECK,description:'Unseen cards of each type; each at most the starting count (14, 5, 2, 2, 2).'}),
   int('bought','Cards you plan to buy',0,25,6,{description:'At most the total cards left in the deck.'})]},
 {name:'seven_risk',label:'Seven risk',description:'Chance a 7 is rolled before your turn, and what it would cost your hand.',defaultSize:'third',
  params:[int('handSize','Cards in hand',0,40,9),int('rollsUntilTurn','Rolls before your turn',1,12,3),...sourceParams()]},
 {name:'win_routes',label:'Win routes',description:'Ten-point purchase budgets including paid roads and minimum development-card buys.',defaultSize:'full',
  params:[{key:'sort',label:'Sort by',type:'select',options:['base','vp','draws'],default:'base'},int('paidRoads','Paid roads per route (scenario)',3,13,4)]},
 {name:'deadline_odds',label:'Deadline affordability',description:'Chance your entered production and hand cover a build by each legal build turn.',defaultSize:'full',params:quantParams()},
 {name:'goal_values',label:'Goal-dependent values',description:'How one card or a port changes build affordability by your deadline.',defaultSize:'full',params:quantParams()},
 {name:'trade_check',label:'Trade effect',description:'Your deadline change and what a plausible opponent hand could afford after a trade.',defaultSize:'full',params:[...quantParams(),ints('give','You give',0,20,[0,0,0,0,0],{itemLabels:RES}),ints('get','You receive',0,20,[0,1,0,0,0],{itemLabels:RES}),ints('opponentKnown','Opponent known minimum',0,20,[0,0,0,0,0],{itemLabels:RES}),int('opponentUnknown','Opponent unknown cards',0,8,2)]},
 {name:'trajectory',label:'Winning trajectory',description:'Resources a sample winning game spends, turn by turn.',defaultSize:'full',
  params:[int('route','Route (0 Expansion + Longest Road, 1 Cities + Largest Army, 2 Cities + hidden points)',0,2,0,{optionLabels:ROUTE_NAMES}),
   {key:'mode',label:'Show',type:'select',options:['total','turn'],default:'total'}]}
];
for(const m of catalog)m.defaults=Object.fromEntries(m.params.map(p=>[p.key,Array.isArray(p.default)?[...p.default]:p.default]));
const byName=Object.fromEntries(catalog.map(m=>[m.name,m]));
(function freeze(o){Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);})(catalog);

function checkNumber(p,v,path,errors,max=p.max){
 if(typeof v!=='number'||!Number.isFinite(v)){errors.push(`${path} must be a number`);return;}
 if(p.integer&&!Number.isInteger(v)){errors.push(`${path} must be an integer`);return;}
 if(v<p.min||v>max)errors.push(`${path} must be ${p.min}–${max}`);
}
function checkParam(p,v,errors){
 const k=p.key;
 if(p.type==='number')return checkNumber(p,v,k,errors);
 if(p.type==='boolean'){if(typeof v!=='boolean')errors.push(`${k} must be true or false`);return;}
 if(p.type==='select'){if(!p.options.includes(v))errors.push(`${k} must be one of: ${p.options.join(', ')}`);return;}
 if(!Array.isArray(v)){errors.push(`${k} must be an array`);return;}
 if(p.length!=null&&v.length!==p.length){errors.push(`${k} must have exactly ${p.length} values${p.itemLabels?' ('+p.itemLabels.join(', ')+')':''}`);return;}
 if(p.minLength!=null&&v.length<p.minLength)errors.push(`${k} must have at least ${p.minLength} values`);
 if(p.maxLength!=null&&v.length>p.maxLength){errors.push(`${k} must have at most ${p.maxLength} values`);return;}
 v.forEach((x,i)=>{
  if(p.type==='booleans'){if(typeof x!=='boolean')errors.push(`${k}[${i}] must be true or false`);}
  else checkNumber(p,x,`${k}[${i}]`,errors,p.itemMax?p.itemMax[i]:p.max);
 });
 if(p.unique&&new Set(v).size!==v.length)errors.push(`${k} must not repeat a value`);
}
function validate(name,params){
 const m=byName[name];
 if(!m)return {ok:false,params:null,errors:[`Unknown model "${name}". Available models: ${catalog.map(c=>c.name).join(', ')}`]};
 if(params==null)params={};
 if(typeof params!=='object'||Array.isArray(params))return {ok:false,params:null,errors:['params must be an object']};
 const errors=[],out={};
 for(const k of Object.keys(params))if(!m.params.some(p=>p.key===k))errors.push(`Unknown parameter "${k}" for ${name}. Allowed: ${m.params.map(p=>p.key).join(', ')}`);
 for(const p of m.params){
  const v=params[p.key]===undefined?m.defaults[p.key]:params[p.key];
  checkParam(p,v,errors);out[p.key]=Array.isArray(v)?[...v]:v;
 }
 if(name==='dev_card_odds'&&!errors.length){const total=sum(out.remaining);if(out.bought>total)errors.push(`bought must be 0–${total} (the cards left in the deck)`);}
 if(['deadline_odds','goal_values','trade_check'].includes(name)&&out.nextTurnIn>out.players)errors.push('nextTurnIn must be no greater than players');
 for(const r of RES){const k=r.toLowerCase()+'Numbers';if(out[k]?.includes(7))errors.push(k+' cannot include 7: no resource production on a 7');}
 return errors.length?{ok:false,params:null,errors}:{ok:true,params:out,errors:[]};
}

const chart=spec=>({kind:'chart',spec});
const models={
 dice_odds({highlight}){
  const x=[],ways=[];for(let n=2;n<=12;n++){x.push(n);ways.push(6-Math.abs(n-7));}
  const hit=new Set(highlight),hitWays=sum(highlight.map(n=>6-Math.abs(n-7)));
  const pctOf=w=>round(w/36*100,2),series=highlight.length
   ?[{name:'Your numbers',values:x.map((n,i)=>hit.has(n)?pctOf(ways[i]):null)},{name:'Other numbers',values:x.map((n,i)=>hit.has(n)?null:pctOf(ways[i]))}]
   :[{name:'Chance per roll',values:ways.map(pctOf)}];
  const nums=[...highlight].sort((a,b)=>a-b);
  return {view:chart({type:'bar',x,series,xLabel:'Dice total',yLabel:'Chance per roll',unit:'%',stacked:highlight.length>0}),
   takeaway:highlight.length?`Your ${nums.join('·')} hit on ${pct(hitWays/36)} of rolls (${hitWays} of 36).`:'7 is the most common total: 17% of rolls (6 of 36).',
   keyNumbers:{ways:Object.fromEntries(x.map((n,i)=>[n,ways[i]])),highlight:nums,hitWays,hitChance:round(hitWays/36,4)},
   method:'Two fair dice: ways out of 36',assumptions:['Each roll is two fair six-sided dice.','A hit means the total matches one of your numbers; the robber is ignored.']};
 },
 resource_income({pips,rolls,goal}){
  const exp=pips.map(p=>p/36*rolls),min=Math.min(...pips),weak=RES.filter((_,i)=>pips[i]===min);
  const top=exp.indexOf(Math.max(...exp));
  const need=math().costs[goal],required=need?need.map((v,i)=>v?Math.max(0,v)/(pips[i]||0):0):null;
  const slow=required?Math.max(...required):null,goalBottleneck=required?RES.filter((_,i)=>need[i]&&required[i]===slow):null;
  const takeaway=sum(pips)===0?'No income: every resource has 0 pips.'
   :`Over ${rolls} rolls: ~${fmt(exp[top])} ${RES[top]}, ${fmt(Math.min(...exp))} ${weak[0]}.`+(goalBottleneck?` For ${goal}, ${goalBottleneck.join(' and ')} is slowest per required card.`:'');
  return {view:chart({type:'bar',x:RES,series:RES.map((r,i)=>({name:r,tone:TONES[i],values:RES.map((_,j)=>j===i?round(exp[i],2):null)})),xLabel:'Resource',yLabel:'Average cards collected',unit:'cards',stacked:true}),
   takeaway,keyNumbers:{rolls,pips:[...pips],expected:Object.fromEntries(RES.map((r,i)=>[r,round(exp[i],3)])),lowestIncome:weak,goalBottleneck},
   method:'Average income: pips/36 per roll × rolls',
   assumptions:['Rolls counts every player\'s roll, not only yours.','These are averages; actual income varies roll to roll.','Ignores the robber, 7s, and bank shortages.']};
 },
 build_eta({hand,pips,genericPort,ports}){
  const M=math(),ratios=M.bankRates(genericPort,ports),mu=pips.map(p=>p/36),rows=BUILDS.map(b=>{
   const cost=M.costs[b],plan=M.bankPlan(hand,cost,ratios);
   if(plan.ready)return {build:b,now:true,rolls:0,trades:plan.trades.map(t=>({give:t.give,from:RES[t.from],get:t.get,to:RES[t.to]}))};
   const t=M.flowTime(hand,mu,cost,ratios);
   return {build:b,now:false,rolls:Number.isFinite(t)?round(t,2):null};
  });
  const short=b=>b==='Development card'?'Dev card':b,label=r=>r.now?'Now':r.rolls==null?'not reachable':`${fmt(r.rolls)} rolls`;
  return {view:chart({type:'bar',x:rows.map(r=>`${short(r.build)} · ${r.now?'Now':r.rolls==null?'Not reachable':fmt(r.rolls)}`),
    series:[{name:'Average-income rolls',values:rows.map(r=>r.rolls)}],xLabel:'Build',yLabel:'Rolls of average income',unit:'rolls'}),
   takeaway:`At average income: ${rows.map(r=>`${short(r.build)} ${label(r)}`).join(', ')}.`,
   keyNumbers:{proxyRolls:Object.fromEntries(rows.map(r=>[r.build,r.rolls])),now:rows.filter(r=>r.now).map(r=>r.build),unreachable:rows.filter(r=>r.rolls==null).map(r=>r.build),tradesNow:Object.fromEntries(rows.filter(r=>r.now&&r.trades.length).map(r=>[r.build,r.trades])),bankRates:Object.fromEntries(RES.map((r,i)=>[r,ratios[i]]))},
   method:'Fractional flow proxy: average income (pips/36) plus bank/port trades',
   assumptions:['A proxy, not an expected waiting time: income is treated as a smooth average flow, and real rolls are random.','Nothing is guaranteed; unlucky rolls can take much longer.','Surplus can be traded fractionally at your bank/port rates; "Now" uses whole trades only.','Rolls counts every player\'s roll. Ignores the robber, 7s, and player trades.','"Not reachable" means no income or surplus can ever cover the cost.']};
 },
 dev_card_odds({type,need,remaining,bought}){
  const M=math(),ti=CARD_TYPES.indexOf(type),K=remaining[ti],N=sum(remaining),x=[],values=[];
  for(let n=0;n<=N;n++){x.push(n);values.push(round(M.tail(N,K,n,need)*100,2));}
  const reachable=K>=need,q=p=>{const n=M.quantile(N,K,need,p);return Number.isFinite(n)?n:null;};
  const at=M.tail(N,K,bought,need),q50=q(0.5),q90=q(0.9),e=M.expectedDraws(N,K,need),nm=need===1?type:CARD_PLURAL[type];
  const takeaway=reachable?`${need} ${nm}: ${pct(at)} within ${bought} cards; 50% by card ${q50}, 90% by card ${q90}.`
   :`Not reachable: only ${K} ${K===1?type:CARD_PLURAL[type]} left, so ${need} cannot be drawn.`;
  return {view:chart({type:'line',x,series:[{name:`≥${need} ${nm}`.slice(0,40),values}],xLabel:'Development cards bought',yLabel:'Chance',unit:'%',yMin:0,yMax:100,highlightX:bought}),
   takeaway,keyNumbers:{type,need,remaining:[...remaining],deckSize:N,bought,reachable,chanceAtBought:round(at,4),cardsFor50:q50,cardsFor90:q90,expectedCards:Number.isFinite(e)?round(e,2):null},
   method:'Hypergeometric draw without replacement',
   assumptions:['Cards are drawn at random from the unseen deck you entered.','Chance of at least the needed count; cards in other players\' hands count as unseen only if you left them in the deck.']};
 },
 seven_risk({handSize,rollsUntilTurn:k,...sources}){
  const chance=r=>1-(5/6)**r,discard=h=>h>7?Math.floor(h/2):0;
  const modeled=math().sevenRisk({handSize,sources:enteredSources(sources),rolls:k});
  const expected=modeled.expectedDiscarded;
  const p=chance(k),d=discard(handSize),x=[],values=[];for(let r=1;r<=12;r++){x.push(r);values.push(round(chance(r)*100,2));}
  return {view:{kind:'stat',spec:{items:[{label:'Chance of a 7',value:round(p*100,1),unit:'%',note:`At least one in ${k} roll${k>1?'s':''}`},{label:'Discard if 7 now',value:d,unit:'cards',note:handSize>7?`Half of ${handSize}, rounded down`:'Future income may change this'},{label:'Expected cards lost',value:round(expected,2),unit:'cards',note:'With entered production'}]}},
   chart:chart({type:'line',x,series:[{name:'Chance of a 7',values}],xLabel:'Rolls before your turn',yLabel:'Chance',unit:'%',yMin:0,yMax:100,highlightX:k}),
   takeaway:`${pct(p)} chance of a 7 in ${k} roll${k>1?'s':''}; ${pct(modeled.discardRisk)} chance of discarding after entered production.`,
   keyNumbers:{handSize,rolls:k,chanceOfSeven:round(p,4),chanceOfDiscard:round(modeled.discardRisk,4),discardIfSeven:d,expectedCardsLost:round(expected,3)},
   method:'Exact dice-by-dice hand-size calculation; on a 7 discard ⌊h/2⌋ when h > 7',
   assumptions:['Entered production arrives on each matching dice roll; no spending, theft or bank shortage.','A hand of seven can grow before a later 7 and then require a discard.','Counts only the rolls before your turn.']};
 },
 win_routes({sort,paidRoads}){
  const rs=math().routes.map(r=>({...r,minimumCards:r.base+2*paidRoads+3*r.minimumDraws,meanCards:r.base+2*paidRoads+3*r.meanDraws}));
  const cmp={base:(a,b)=>a.minimumCards-b.minimumCards,vp:(a,b)=>b.vp-a.vp||a.minimumCards-b.minimumCards,draws:(a,b)=>a.minimumDraws-b.minimumDraws||a.meanDraws-b.meanDraws||a.minimumCards-b.minimumCards}[sort];
  rs.sort(cmp);const top=rs[0];
  const takeaway=sort==='base'?`Fewest cards under ${paidRoads} paid roads each: ${top.name} (${top.minimumCards} minimum).`:sort==='vp'?`All listed routes reach ${top.vp} VP; ${top.name} uses ${top.minimumCards} minimum cards.`
   :`Fewest required dev draws: ${top.name} (${top.minimumDraws} minimum); road and card buys are counted.`;
  return {view:{kind:'table',spec:{columns:['Route','VP','Minimum cards','Mean-draw cards','Min dev draws'],align:['left','right','right','right','right'],rows:rs.map(r=>[r.name,r.vp,r.minimumCards,round(r.meanCards,1),r.minimumDraws])}},
   takeaway,keyNumbers:{sort,paidRoads,routes:rs.map(r=>({name:r.name,vp:r.vp,minimumCards:r.minimumCards,meanCards:round(r.meanCards,2),minimumDraws:r.minimumDraws,meanDraws:round(r.meanDraws,2)}))},
   method:'4 per new settlement + 5 per city + 2 per paid road + 3 per development purchase',
   assumptions:['The same entered paid-road count is charged to every route; real legal paths differ.','Starts from the two opening settlements and roads.','Awards are assumed secured; card draws use a fresh deck without competitors.','Fewest purchased cards is not a forecast of winning speed or strategic value.']};
 },
 deadline_odds(p){
  const r=math().deadlineOdds(quantOpts(p)),chance=r.byTurn.at(-1),label=round(chance*100,1);
  return {view:chart({type:'line',x:r.checkpoints,series:[{name:'Built by this turn',values:r.byTurn.map(x=>round(x*100,2))}],xLabel:'Table roll at your build turn',yLabel:'Chance built by then',unit:'%',yMin:0,yMax:100}),
   takeaway:`${p.goal}: ${label}% by build turn ${p.turns}; ${round(r.censored*100,1)}% later than this horizon.`,
   keyNumbers:{goal:p.goal,chanceByTurn:r.byTurn,checkpoints:r.checkpoints,median:r.median,p80:r.p80,p95:r.p95,censored:r.censored,discardRisk:r.discardRisk,expectedDiscarded:r.expectedDiscarded,method:r.method,samples:r.samples,seed:r.seed,confidence95:r.ci,policies:r.policies},
   method:r.method==='exact'?'Exact forward dice-outcome probabilities':'Seeded Monte Carlo with 95% Wilson intervals',
   assumptions:['Affordability is checked only on your entered build turns; board placement and piece supply are not checked.','Seven discards use a goal-surplus-first deterministic policy.','No robber movement, player trades, other spending or bank shortage.','Null quantiles mean later than the entered horizon.']};
 },
 goal_values(p){
  const r=math().goalValues(quantOpts(p)),base=r.baseline.byTurn.at(-1),rows=r.cards.map((v,i)=>[RES[i],`${round((base+v.plus)*100,1)}% (+${round(v.plus*100,1)} pts)`,`${round((base-v.minus)*100,1)}%`,`${round((base+r.ports[i].delta)*100,1)}% (+${round(r.ports[i].delta*100,1)} pts)`]);
  return {view:{kind:'table',spec:{columns:['Resource','With +1 card','With −1 card','With 2:1 port'],align:['left','right','right','right'],rows}},
   takeaway:`${p.goal} by turn ${p.turns}: ${round(base*100,1)}% baseline; ${r.baseline.method==='exact'?'baseline exact':'baseline 95% interval '+round(r.baseline.ci.at(-1)[0]*100,1)+'–'+round(r.baseline.ci.at(-1)[1]*100,1)+'% from '+r.comparisonSamples+' paired paths'}${r.comparisonMethod==='mixed'?'; some comparison rows use '+r.comparisonSamples+' paired paths':''}.`,
   keyNumbers:{goal:p.goal,deadlineTurns:p.turns,baseline:base,cards:r.cards,ports:r.ports,genericPort:r.genericPort,baselineCI:r.baseline.ci.at(-1),method:r.comparisonMethod,requestedSamples:r.requestedSamples,actualSamples:r.comparisonSamples,sampledVariants:r.sampledVariants},
   method:'Difference in chance of covering the selected build by its deadline',
   assumptions:['Each row changes only one card or one port from the entered position.','Monte Carlo variants use paired dice rolls; shown intervals are for each chance, not the difference.','Feasibility is not strategic optimality; access to a port has a separate cost.']};
 },
 trade_check(p){
  const me=quantOpts(p),opponent={known:p.opponentKnown,unknown:p.opponentUnknown,weights:[1,1,1,1,1],rates:[4,4,4,4,4]};
  const r=math().tradeEffect({me,opponent,give:p.give,get:p.get}),rows=r.opponent.builds.map(x=>[x.goal,x.before==null?'n/a':round(x.before*100,1),x.after==null?'n/a':round(x.after*100,1)]);
  return {view:{kind:'table',spec:{columns:['Opponent can afford now','Before %','After %'],align:['left','right','right'],rows}},
   takeaway:`Your ${p.goal} chance: ${round(r.mine.before.byTurn.at(-1)*100,1)}% → ${round(r.mine.after.byTurn.at(-1)*100,1)}% by turn ${p.turns}; ${round(r.opponent.feasibleTradePriorMass*100,1)}% of hands can give.`,
   keyNumbers:{myBefore:r.mine.before.byTurn.at(-1),myAfter:r.mine.after.byTurn.at(-1),myDelta:r.mine.delta,myBeforeCI:r.mine.before.ci.at(-1),myAfterCI:r.mine.after.ci.at(-1),opponent:r.opponent,requestedSamples:r.requestedSamples,actualSamples:r.comparisonSamples,method:r.comparisonMethod},
   method:'Your deadline simulation plus exact mixture over possible opponent hands',
   assumptions:['Opponent unknown cards are assumed uniformly distributed over resource types, not inferred from play.','Opponent percentages condition on hands that can give the requested cards.','Affordable builds are capabilities, not predictions of choice or a win rate.']};
 },
 trajectory({route,mode}){
  const tr=math().trajectories[route],key=mode==='total'?'total':'spent',x=tr.rows.map(r=>r.t);
  const win=tr.rows.find(r=>r.vp>=10),cards=sum(tr.rows[tr.rows.length-1].total);
  const awards=tr.rows.flatMap(r=>r.actions.filter(a=>a.vp).map(a=>({turn:r.t,vp:a.vp,note:a.note||a.type})));
  return {view:chart({type:'bar',x,series:RES.map((r,i)=>({name:r,tone:TONES[i],values:tr.rows.map(row=>row[key][i])})),xLabel:'Turn',yLabel:mode==='total'?'Cards spent so far':'Cards spent this turn',unit:'cards',stacked:true}),
   takeaway:win?`${tr.name}: 10 VP by turn ${win.t} using ${cards} cards.`:`${tr.name}: ${tr.rows[tr.rows.length-1].vp} VP by turn 24 using ${cards} cards.`,
   keyNumbers:{route:tr.name,mode,winTurn:win?win.t:null,cardsSpent:cards,vpByTurn:tr.rows.map(r=>r.vp),awards},
   method:'Scripted sample game: build costs summed by turn',
   assumptions:['One illustrative schedule, not an optimal or expected game.','Counts cards spent on builds and development cards; trades and discards are not shown.']};
 }
};

function compute(name,params){
 const v=validate(name,params);
 if(!v.ok){const e=new Error(`Invalid ${name} parameters: ${v.errors.join('; ')}`);e.name='ValidationError';e.errors=v.errors;e.model=name;throw e;}
 const out=models[name](v.params);
 const walk=o=>Array.isArray(o)?o.map(walk):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,x])=>[k,walk(x)])):clean(o);
 return walk({view:out.view,...(out.chart?{extraViews:[out.chart]}:{}),takeaway:out.takeaway,keyNumbers:out.keyNumbers,method:out.method,assumptions:out.assumptions,params:v.params});
}

const api={catalog,validate,compute,names:catalog.map(m=>m.name)};
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.DashboardModels=api;
})(typeof window!=='undefined'?window:globalThis);
