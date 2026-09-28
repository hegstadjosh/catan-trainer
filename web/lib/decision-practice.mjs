// Counterfactual practice deliberately reconstructs hidden cards from public constraints.
// Nothing in this module reads an opponent's true hand, dev-card type, deck order or RNG.
import * as E from '../game/engine.mjs';
import {applyAction,legalActions,viewMatch} from '../game/rules.mjs';

const TYPES=['knight','victoryPoint','roadBuilding','yearOfPlenty','monopoly'];
const DECK=[14,5,2,2,2];
const PIPS={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const SAMPLES=32;
const zero=()=>Object.fromEntries(E.RESOURCES.map(r=>[r,0]));
const hash=(seed,salt)=>{let x=(seed>>>0)^0x9e3779b9;for(const c of String(salt))x=Math.imul(x^c.charCodeAt(0),16777619)>>>0;return x||1;};
const rng=seed=>{let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};};
const shuffle=(a,next)=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const key=a=>JSON.stringify(a);
const label=a=>({build_city:'Build a city',build_settlement:'Build a settlement',build_road:'Build a road',buy_dev_card:'Buy a development card',bank_trade:'Trade with the bank',play_knight:'Play a Knight',end_turn:'End turn now'})[a.type]||a.type;
const legal=(s,seat)=>legalActions(s,seat).actions;
const spotScore=(state,v)=>{
 const vertex=E.GEO.vertices[Number(String(v).slice(1))];
 if(!vertex)return 0;
 const around=E.GEO.hexes.filter(h=>h.vertices?.includes(Number(String(v).slice(1))));
 return around.reduce((n,h)=>n+(PIPS[state.hexes[Number(h.id.slice(1))]?.number]||0),0);
};
const best=(state,actions)=>actions.slice().sort((a,b)=>spotScore(state,b.vertex)-spotScore(state,a.vertex)||key(a).localeCompare(key(b)))[0];

export function practiceOptions(state){
 if(state.phase!=='play'||state.current!==0||state.turnPhase!=='main')return [];
 const actions=legal(state,0),out=[];
 const add=(sequence,text)=>{const id=sequence.map(key).join('|');if(!out.some(o=>o.id===id))out.push({id,label:text,actions:sequence});};
 for(const kind of ['build_city','build_settlement','build_road']){
  const candidates=actions.filter(a=>a.type===kind);
  if(candidates.length){const a=best(state,candidates);add([a],`${label(a)}${a.vertex?' at '+a.vertex:a.edge?' at '+a.edge:''}`);}
 }
 const roadSettlements=[];
 for(const road of actions.filter(a=>a.type==='build_road')){
  const afterRoad=applyAction(state,0,road).state;
  const settlement=best(afterRoad,legal(afterRoad,0).filter(a=>a.type==='build_settlement'));
  if(settlement)roadSettlements.push([road,settlement]);
 }
 if(roadSettlements.length){const [road,settlement]=roadSettlements.sort((a,b)=>spotScore(state,b[1].vertex)-spotScore(state,a[1].vertex)||key(a).localeCompare(key(b)))[0];
  add([road,settlement],`Build a road at ${road.edge}, then settle at ${settlement.vertex}`);}
 if(actions.some(a=>a.type==='buy_dev_card'))add([{type:'buy_dev_card'}],'Buy a development card');
 if(actions.some(a=>a.type==='play_knight'))add([{type:'play_knight'}],'Play a Knight, then move the robber');
 const tradeCandidates=[];
 for(const trade of actions.filter(a=>a.type==='bank_trade')){
  const next=applyAction(state,0,trade).state;
  const build=best(next,legal(next,0).filter(a=>a.type.startsWith('build_')||a.type==='buy_dev_card'));
  if(build)tradeCandidates.push([trade,build]);
 }
 if(tradeCandidates.length){const [trade,build]=tradeCandidates.sort((a,b)=>{
  const rank=x=>({build_city:4,build_settlement:3,buy_dev_card:2,build_road:1})[x[1].type]||0;
  return rank(b)-rank(a)||key(a).localeCompare(key(b));
 })[0];add([trade,build],`Trade ${E.tradeRatio(state,0,trade.give)} ${trade.give} for ${trade.get}, then ${label(build).toLowerCase()}`);}
 add([{type:'end_turn'}],'End turn now');
 return out;
}

// Public state is the only seed material for sampling. The full snapshot is overwritten at every
// hidden field before the simulator runs. An optional minimum vector may tighten the prior.
export function sampleWorld(state,seed,{minimums={}}={}){
 const v=viewMatch(state,0),s=structuredClone(state),next=rng(hash(seed,'deal'));
 const cards=[];
 for(const r of E.RESOURCES){
  const count=19-v.bank[r]-v.me.resources[r];
  if(!Number.isInteger(count)||count<0)throw Error('The recorded public bank and hand are inconsistent.');
  cards.push(...Array(count).fill(r));
 }
 const counts=v.players.slice(1).map(p=>p.resourceCount);
 if(counts.reduce((a,b)=>a+b,0)!==cards.length)throw Error('The public hand counts do not match the bank.');
 for(let seat=1;seat<4;seat++){
  s.players[seat].resources=zero();
  const min=minimums[seat]||{};
  const minimumTotal=E.RESOURCES.reduce((n,r)=>n+(min[r]||0),0);
  if(minimumTotal>counts[seat-1])throw Error('Known minimum exceeds the public hand count.');
  for(const r of E.RESOURCES){const n=min[r]||0;if(!Number.isInteger(n)||n<0||n>counts[seat-1])throw Error('Invalid known minimum.');for(let i=0;i<n;i++){const at=cards.indexOf(r);if(at<0)throw Error('Known minimum conflicts with public bank.');cards.splice(at,1);s.players[seat].resources[r]++;}}
 }
 shuffle(cards,next);
 let at=0;
 for(let seat=1;seat<4;seat++){
  const need=counts[seat-1]-E.handSize(s.players[seat].resources);
  for(let j=0;j<need;j++){const card=cards[at++];if(!E.RESOURCES.includes(card))throw Error('Public hand counts exceed the remaining card pool.');s.players[seat].resources[card]++;}
  if(E.handSize(s.players[seat].resources)!==counts[seat-1])throw Error('Sampled hand does not match the public card count.');
 }
 const remaining=Object.fromEntries(TYPES.map((t,i)=>[t,DECK[i]]));
 const remove=(type,count=1)=>{if(!Number.isInteger(count)||count<0||!Object.hasOwn(remaining,type)||remaining[type]<count)throw Error('Known development cards and public plays conflict with the base deck.');remaining[type]-=count;};
 for(const card of s.players[0].devCards)remove(card.type);
 for(let seat=0;seat<4;seat++)remove('knight',v.players[seat].knightsPlayed||0);
 // Played progress cards are public. The rolling log may have dropped older lines, so the
 // unobserved remainder still uses a stated exchangeable prior rather than an exact claim.
 for(const entry of s.log){
  const text=entry.text||'';
  for(const [type,phrase] of [['roadBuilding','played Road Building'],['yearOfPlenty','played Year of Plenty'],['monopoly','played Monopoly']])
   if(text.includes(phrase))remove(type);
 }
 const needed=v.devDeckCount+v.players.slice(1).reduce((n,p)=>n+p.devCardCount,0);
 const available=TYPES.reduce((n,t)=>n+remaining[t],0),missing=available-needed;
 if(missing<0)throw Error('Public development-card counts conflict with the base deck.');
 // A play missing from the rolling log can only be one of the three progress cards.
 // Knights are counted publicly, and Victory Point cards cannot be played away.
 const unloggedProgress=['roadBuilding','yearOfPlenty','monopoly'].flatMap(t=>Array(remaining[t]).fill(t));
 if(missing>unloggedProgress.length)throw Error('Public development-card counts exceed possible unlogged progress plays.');
 shuffle(unloggedProgress,next);
 for(let i=0;i<missing;i++)remaining[unloggedProgress[i]]--;
 const unknown=TYPES.flatMap(t=>Array(remaining[t]).fill(t));shuffle(unknown,next);
 let offset=0;
 for(let seat=1;seat<4;seat++){
  s.players[seat].devCards=unknown.slice(offset,offset+v.players[seat].devCardCount).map(type=>({type,bought:s.turn-1}));
  offset+=v.players[seat].devCardCount;
 }
 s.devDeck=unknown.slice(offset,offset+v.devDeckCount);
 s.rng={s:hash(seed,'actions')};
 s.log=[];
 return s;
}

function robberChoice(state,seat){
 const acts=legal(state,seat).filter(a=>a.type==='move_robber');
 const leader=Math.max(...state.players.map((_,i)=>i===seat?-1:E.publicVP(state,i)));
 return acts.find(a=>a.victim!=null&&E.publicVP(state,a.victim)===leader)||acts.find(a=>a.victim!=null)||acts[0];
}
function discardChoice(state,seat){
 const n=state.pendingDiscards[seat],vec=zero();
 const ordered=E.RESOURCES.slice().sort((a,b)=>state.players[seat].resources[b]-state.players[seat].resources[a]);
 let left=n;for(const r of ordered){const k=Math.min(left,state.players[seat].resources[r]);vec[r]=k;left-=k;}
 return {type:'discard',resources:vec};
}
function policy(state,seat,{allowTrade=true}={}){
 const acts=legal(state,seat);
 for(const type of ['build_city','build_settlement','build_road','buy_dev_card']){
  const pick=best(state,acts.filter(a=>a.type===type));if(pick)return pick;
 }
 for(const trade of allowTrade?acts.filter(a=>a.type==='bank_trade'):[]){
  const next=applyAction(state,seat,trade).state;
  if(legal(next,seat).some(a=>['build_city','build_settlement','buy_dev_card'].includes(a.type)))return trade;
 }
 return {type:'end_turn'};
}
function apply(s,seat,a){return applyAction(s,seat,a).state;}
function run(state,option,horizon,seed){
 let s=structuredClone(state),humanEnds=0,steps=0;
 let mainActions=0;
 const start=E.totalVP(s,0);
 for(const a of option.actions){
  if(a.type==='play_knight'){
   s=apply(s,0,a);const robber=robberChoice(s,0);if(robber)s=apply(s,0,robber);
  }else s=apply(s,0,a);
 }
 if(s.phase!=='finished'&&s.current===0&&s.turnPhase==='main')s=apply(s,0,{type:'end_turn'});
 while(s.phase!=='finished'&&humanEnds<horizon&&steps++<240){
  const seat=s.current,tp=s.turnPhase;
  if(tp==='discard'){for(const x of Object.keys(s.pendingDiscards))s=apply(s,+x,discardChoice(s,+x));continue;}
  if(tp==='robber'){const a=robberChoice(s,seat);if(!a)break;s.rng={s:hash(seed,`steal:${s.turn}`)};s=apply(s,seat,a);continue;}
  if(tp==='roll'){s.rng={s:hash(seed,`dice:${s.turn}`)};s=apply(s,seat,{type:'roll'});continue;}
  if(tp==='main'){
   const a=mainActions>=2||mainActions===1&&s.lastPracticeAction!=='bank_trade'?{type:'end_turn'}:policy(s,seat,{allowTrade:mainActions===0});
   if(a.type==='end_turn'){
    s=apply(s,seat,a);mainActions=0;if(seat===0)humanEnds++;
   }else{const next=apply(s,seat,a);next.lastPracticeAction=a.type;s=next;mainActions++;}
   continue;
  }
  break;
 }
 return {gain:E.totalVP(s,0)-start,censored:humanEnds<horizon&&s.phase!=='finished'};
}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const interval=a=>{const m=mean(a),variance=a.reduce((n,x)=>n+(x-m)**2,0)/Math.max(1,a.length-1),half=1.96*Math.sqrt(variance/a.length);return [m-half,m+half];};
const wilson=(hits,n)=>{const z=1.96,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];};
export function evaluate(state,{optionId,horizon,seed,samples=SAMPLES}={}){
 if(!Number.isInteger(horizon)||horizon<1||horizon>6)throw Error('Choose a horizon of 1–6 future turns.');
 if(!Number.isInteger(samples)||samples<4||samples>128)throw Error('Invalid sample count.');
 const options=practiceOptions(state),choice=options.find(o=>o.id===optionId);
 if(!choice)throw Error('That option is unavailable at this position.');
 const matrix=options.map(()=>[]),censored=options.map(()=>0);
 for(let i=0;i<samples;i++){
  const world=sampleWorld(state,hash(seed,i));
  for(let j=0;j<options.length;j++){
   const outcome=run(world,options[j],horizon,hash(seed,`future:${i}`));
   matrix[j].push(outcome.gain);if(outcome.censored)censored[j]++;
  }
 }
 const chosen=options.indexOf(choice);
 const wins=options.map(()=>0);
 for(let i=0;i<samples;i++){
  const top=Math.max(...matrix.map(a=>a[i])),ties=matrix.map((a,j)=>a[i]===top?j:-1).filter(j=>j>=0);
  for(const j of ties)wins[j]+=1/ties.length;
 }
 const ordinal=horizon===1?'first':horizon===2?'second':horizon===3?'third':`${horizon}th`;
 return {objective:`Victory points gained by the end of your ${ordinal} future turn`,horizon,samples,
  assumptions:'These are selected candidate plans, not every legal move. Opponent resource hands are exchangeable deals from public bank and hand counts; unseen development cards use the base-deck mix after observed plays (older plays may be absent from the rolling log). After the chosen plan, each seat prefers a city, settlement, first legal road by stable ID, then a development card; one enabling bank trade plus a build is allowed, then the turn ends. Robber moves prefer a public leader who can be stolen from. No player trades or special development cards. Dice are paired across options. Intervals describe sampling uncertainty only. The result is a model comparison, not a calibrated win rate or proof of optimal play.',
  chosenOptionId:choice.id,options:options.map((o,j)=>{
   const gains=matrix[j],differences=gains.map((g,i)=>g-matrix[chosen][i]);
   const one=gains.filter(g=>g>=1).length,two=gains.filter(g=>g>=2).length;
   return {id:o.id,label:o.label,meanVpGain:mean(gains),pAtLeastOne:one/samples,pAtLeastOne95Interval:wilson(one,samples),pAtLeastTwo:two/samples,pAtLeastTwo95Interval:wilson(two,samples),
    pairedDifferenceFromChoice:mean(differences),paired95Interval:interval(differences),highestModeledGainShare:wins[j]/samples,censored:censored[j]};
  })};
}
