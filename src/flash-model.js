(function(global){
'use strict';
const R=['Wood','Brick','Sheep','Wheat','Ore'],numbers=[2,3,4,5,6,8,9,10,11,12],costs={Road:[1,1,0,0,0],Settlement:[1,1,1,1,0],City:[0,0,0,2,3],'Dev card':[0,0,1,1,1]};
const categories=['Dice facts','Number combinations','Total production','Resource breakdown','Roll outcomes','Upgrades & robber','Build shortfalls','Port arithmetic','Odds and decisions'];
const pips=n=>n>=2&&n<=12?6-Math.abs(7-n):0;
const gcd=(a,b)=>b?gcd(b,a%b):a;
function fraction(a,b=36){if(!a)return '0';const g=gcd(a,b);return b/g===1?String(a/g):`${a/g}/${b/g}`;}
const approx=x=>Number(x.toFixed(2)).toString();
const vector=setup=>{const v=[0,0,0,0,0];for(const s of setup)for(const h of s.hexes)if(!h.blocked)v[h.r]+=pips(h.n)*s.units;return v;};
const sum=v=>v.reduce((a,b)=>a+b,0);
const payout=(setup,n)=>{const v=[0,0,0,0,0];for(const s of setup)for(const h of s.hexes)if(!h.blocked&&h.n===n&&n!==7)v[h.r]+=s.units;return v;};
const site=(ns,offset=0,units=1)=>({units,hexes:ns.map((n,i)=>({n,r:(offset+i)%5}))});
function buildDeck(){const deck=[];function add(id,category,prompt,answer,why,setup=[],extra={}){deck.push({id,category,prompt,answer,why,setup,...extra});}
for(const n of numbers){const p=pips(n);for(const units of [1,2]){const s=[{units,hexes:[{n,r:4}]}],label=units===2?'city':'settlement';add(`die-${n}-${units}-points`,0,`How many production points does this ${label} contribute?`,`${p*units} points`,`${n} has ${p} dice combinations out of 36. Multiply by ${units} production unit${units===2?'s':''}.`,s);add(`die-${n}-${units}-income`,0,`On average, how many ore cards will this spot produce over 36 dice rolls?`,`${p*units} ore`,`${p}/36 × ${units} × 36 = ${p*units}. This is a mean, not a guaranteed payout.`,s);}
add(`die-${n}-chance`,0,`What is the chance of rolling ${n}?`,`${p}/36 = ${approx(100*p/36)}%`,`${p} ordered dice pairs total ${n}. A city changes payout, not the chance of that number.`,[site([n],4)]);add(`die-${n}-wait`,0,`On average, how many dice rolls will you wait for a ${n}?`,`${fraction(36,p)} rolls${36%p?' ≈ '+approx(36/p):''}`,`For independent rolls, mean waiting time = 1/p = 36/${p}. It is not a countdown or guarantee.`,[site([n],4)]);}
add('seven',0,'A 7 is rolled. How many resource cards do you collect from your hexes?','0 resources','7 triggers the robber process, not hex production. Its dice probability is 6/36 = 1/6.');
let k=0;
for(let a=0;a<numbers.length;a++)for(let b=a;b<numbers.length;b++)for(let c=b;c<numbers.length;c++){
const ns=[numbers[a],numbers[b],numbers[c]];if(ns.filter(n=>n===6||n===8).length>1||ns.filter(n=>n===2).length>1||ns.filter(n=>n===12).length>1)continue;
const s=[site(ns,k%5)],v=vector(s),points=sum(v);add(`combo-${ns.join('-')}`,1,'How many production points does this settlement have?',`${points} points`,`${ns.map(pips).join(' + ')} = ${points}. Expect ${fraction(points) } cards per table roll (≈ ${approx(points/36)}).`,s);k++;}
for(let a=0;a<numbers.length;a++)for(let b=a;b<numbers.length;b++){const ns=[numbers[a],numbers[b]];if((a===b&&(ns[0]===2||ns[0]===12))||ns.every(n=>n===6||n===8))continue;const s=[site(ns,(a+b)%5,2)],v=vector(s);add(`coast-${ns.join('-')}`,1,'How many production points does this city have?',`${sum(v)} points`,`2 × (${ns.map(pips).join(' + ')}) = ${sum(v)}. The city doubles both hex payouts.`,s);}
const patterns=[[6,3,9,4],[8,10,5,11],[5,9,4,10],[6,11,9,2],[8,3,10,12],[4,9,5,11],[6,4,3,10],[8,2,5,10],[5,10,4,12],[9,11,3,4],[6,9,3,11],[8,5,2,10]];
// Append deterministic new patterns; preserve all existing card IDs and their schedules.
let seed=73129;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const usedPatterns=new Set(patterns.map(ns=>ns.join('-')));
while(patterns.length<60){const ns=Array.from({length:4},()=>numbers[Math.floor(random()*numbers.length)]);if(ns.some(n=>ns.filter(x=>x===n).length>(n===2||n===12?1:2)))continue;if([ns.slice(0,2),ns.slice(2)].some(pair=>pair.every(n=>n===6||n===8)))continue;const id=ns.join('-');if(!usedPatterns.has(id)){usedPatterns.add(id);patterns.push(ns);}}
patterns.forEach((ns,i)=>{for(let shift=0;shift<5;shift++){
const setup=[site(ns.slice(0,2),shift,1),site(ns.slice(2),shift+2,2)];if(i%3===0)setup[1].hexes[1].r=setup[0].hexes[0].r;
const id=`setup-${i}-${shift}`,v=vector(setup),total=sum(v);const calc=setup.map(s=>`${s.units} × (${s.hexes.map(h=>pips(h.n)).join(' + ')})`).join(' + ');
add(id+'-total',2,'How many production points do this settlement and city have altogether?',`${total} points`,`${calc} = ${total}. ${fraction(total)} expected cards per table roll. Four distinct hexes at two separate coastal sites.`,setup);
const rolls=[4,12,36][i%3];add(id+'-horizon',2,`On average, how many resource cards will these buildings produce over ${rolls} dice rolls?`,`${fraction(total*rolls)} cards${total*rolls%36?' ≈ '+approx(total*rolls/36):''}`,`${total} expected cards per 36 rolls × ${rolls}/36. ${rolls===4?'Four rolls are one round in a four-player game. ':''}Mean production ignores future robber changes, bank shortages, and discards.`,setup);
const target=(shift+i)%5;add(id+'-resource',3,`How many of this setup’s production points come from ${R[target].toLowerCase()}?`,`${v[target]} ${R[target].toLowerCase()} points`,v[target]?`${R[target]} only: ${setup.flatMap(s=>s.hexes.filter(h=>h.r===target).map(h=>`${pips(h.n)} × ${s.units}`)).join(' + ')} = ${v[target]}. Other resources do not count.`:`No ${R[target].toLowerCase()} hex touches these sites. Total production cannot replace a missing resource without trading.`,setup);
if(shift===i%5)add(id+'-vector',3,'Over 36 dice rolls, how many cards of each resource would you collect on average?',v.map((x,j)=>`${R[j]} ${x}`).join(' · '),'Each resource’s production points equal its expected number of cards over 36 rolls. Keep settlement ×1 and city ×2 separate.',setup,{vector:v});
const roll=ns[(i+shift)%4],out=payout(setup,roll);add(id+'-roll',4,`A ${roll} is rolled now. What do you receive?`,out.map((x,j)=>x?`${x} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + ')||'Nothing',`Match the rolled number, then collect 1 per settlement adjacency and 2 per city adjacency. Do not multiply by dice pips for a roll that already happened.`,setup);
const unique=[...new Set(ns)],hit=unique.reduce((x,n)=>x+pips(n),0);if(shift===0)add(id+'-hit',4,'What is the chance that the next dice roll gives you at least one resource card?',`${hit}/36 = ${approx(hit/36*100)}%`,`Count each distinct number once: ${unique.map(n=>`${n} → ${pips(n)}`).join('; ')}. Cities change how many cards arrive, not whether the roll hits.`,setup);
const upgraded=structuredClone(setup);upgraded[0].units=2;const delta=sum(vector([setup[0]]));add(id+'-upgrade',5,'If you upgrade this settlement to a city, how many production points do you gain?',`+${delta} points · ${total+delta} total`,`The upgrade adds one unit on that site: ${setup[0].hexes.map(h=>pips(h.n)).join(' + ')} = ${delta}. Do not add two more units.`,setup);
if(shift===0){const blocked=structuredClone(setup);blocked[1].hexes[0].blocked=true;const loss=2*pips(ns[2]);add(id+'-robber',5,'The robber blocks the marked hex. How many production points do your buildings still have?',`${total-loss} points · ${loss} lost`,`${total} − (2 × ${pips(ns[2])}) = ${total-loss}. The robber removes this city’s two units on one hex only.`,blocked);}
const recipe=Object.keys(costs)[i%4],cost=costs[recipe],missing=cost.map((n,j)=>v[j]===0?n:0);if(shift===0||shift===2)add(id+'-missing',6,`To pay for a ${recipe.toLowerCase()}, which resources must you get through trading because these hexes cannot produce them?`,missing.some(Boolean)?missing.map((n,j)=>n?`${n} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + '):'None — every required resource is produced',`Recipe: ${cost.map((n,j)=>n?`${n} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + ')}. This asks about missing production, not cards currently in hand.`,setup);
}});
for(const [name,cost] of Object.entries(costs)){add('recipe-'+name,6,`What resources pay for one ${name.toLowerCase()}?`,cost.map((x,i)=>x?`${x} ${R[i].toLowerCase()}`:'').filter(Boolean).join(' + '),`${sum(cost)} cards total. Costs and expected income are different quantities.`);for(let i=0;i<10;i++){const hand=cost.map((x,j)=>Math.max(0,x+((i+j)%3)-1)),gap=cost.map((x,j)=>Math.max(0,x-hand[j]));add(`gap-${name}-${i}`,6,`What extra resources do you need to pay for a ${name.toLowerCase()} with this hand? Do not trade any cards yet.`,gap.some(Boolean)?gap.map((x,j)=>x?`${x} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + '):'Nothing — you can pay the recipe',`Compare each resource separately: max(recipe − hand, 0). Surplus in one resource does not directly fill another.`,[],{hand});}}
for(const rate of [2,3,4])for(let hand=2;hand<=12;hand++){
 const reserve=hand%3,available=Math.max(0,hand-reserve),imports=Math.floor(available/rate),left=hand-imports*rate;
 const context=`You have ${hand} sheep. ${reserve===hand?'Keep both sheep for later; do not trade them.':reserve?`Keep ${reserve} sheep for later. You may trade the rest.`:'You may trade all of them.'} ${rate===2?'Your sheep port':rate===3?'Your 3:1 port':'The bank'} lets you trade ${rate} sheep for 1 resource card of your choice.`;
 add(`port-${rate}-${hand}`,7,'How many resource cards can you get by trading the sheep you can spare?',`${imports} resource card${imports===1?'':'s'} · ${left} sheep left`,`${hand} sheep − ${reserve} kept for later = ${available} available to trade. ${imports?`${imports} trade${imports===1?'':'s'} × ${rate} sheep = ${imports*rate} sheep spent. You receive ${imports} resource card${imports===1?'':'s'}.`:`You need ${rate} sheep for one trade, so you cannot make a trade.`}`,[],{hand:[0,0,hand,0,0],context,heldBack:reserve});
}
for(let p=1;p<=15;p++){add(`payback-${p}`,5,`A city upgrade adds ${p} production points. About how many dice rolls would produce 5 extra cards on average?`,`${fraction(180,p)} table rolls${180%p?' ≈ '+approx(180/p):''}`,`5 ÷ (${p}/36) = 180/${p}. Equal card values; excludes VP, robber, reinvestment and variance. This is a planning ratio, not an expected recipe-completion time.`);}
// A spot is the basic visual unit: one building on the corner of three hexes.
// New families reuse the same scenario for several skills, but never within a session.
const triples=deck.filter(c=>c.id.startsWith('combo-')&&c.setup[0].hexes.every(h=>c.setup[0].hexes.filter(x=>x.n===h.n).length<=2));
function scenario(id,setup,extra={}){
 const v=vector(setup),total=sum(v),label=setup.length===1?(setup[0].units===2?'city':'settlement'):'buildings';
 const calc=setup.map(s=>`${s.units===2?'2 × ':''}(${s.hexes.map(h=>pips(h.n)).join(' + ')})`).join(' + ');
 const put=(suffix,cat,q,a,why,shown=setup)=>add(id+'-'+suffix,cat,q,a,why,shown,extra);
 put('total',2,`Over 36 dice rolls, how many resource cards will this ${label==='buildings'?'setup':label} produce on average?`,`${total} cards`,`${calc} = ${total}. Each number contributes its number of ways to roll it; a city collects twice as much. This is an average, not a guaranteed result.`);
 const target=(+id.match(/\d+/)[0])%5;
 put('resource',3,`Over 36 dice rolls, how many ${R[target].toLowerCase()} cards will you collect on average?`,`${v[target]} ${R[target].toLowerCase()}`,v[target]?`${setup.flatMap(s=>s.hexes.filter(h=>h.r===target).map(h=>`${pips(h.n)} × ${s.units}`)).join(' + ')} = ${v[target]}. Count only the ${R[target].toLowerCase()} hexes.`:`None of your buildings touches a ${R[target].toLowerCase()} hex.`);
 put('vector',3,'Over 36 dice rolls, how many cards of each resource will you collect on average?',v.map((x,j)=>`${R[j]} ${x}`).join(' · '),'Add the dice combinations for each resource separately. A settlement collects 1 card when a number hits; a city collects 2.');
 const ns=setup.flatMap(s=>s.hexes.map(h=>h.n)),roll=ns[target%ns.length],out=payout(setup,roll);
 put('roll',4,`A ${roll} is rolled. Which cards do your buildings collect?`,out.map((x,j)=>x?`${x} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + '),'Only matching number tokens produce: 1 card for each touching settlement, 2 for each touching city.');
 const unique=[...new Set(ns)],hit=sum(unique.map(pips));
 put('hit',4,'What is the chance that the next roll gives you at least one resource card?',`${hit}/36 = ${approx(100*hit/36)}%`,`${unique.map(n=>`${n}: ${pips(n)} ways`).join('; ')}. Count each number once, even if it appears on more than one hex.`);
 const settlement=setup.find(s=>s.units===1);
 if(settlement&&setup.filter(s=>s.units===1).length===1){const delta=sum(vector([settlement]));put('upgrade',5,'Upgrade the settlement to a city. How many EXTRA cards would you collect over 36 rolls, on average?',`+${delta} cards`,`${settlement.hexes.map(h=>pips(h.n)).join(' + ')} = ${delta} extra cards. Each touching hex now pays 2 instead of 1.`);}
 const blocked=structuredClone(setup),block=blocked[0].hexes[0];block.blocked=true;
 // If two buildings touch the same tile, a robber blocks both of them.
 if(extra.shared)blocked[1].hexes[0].blocked=true;
 const left=sum(vector(blocked));put('robber',5,'With the robber on the marked hex, how many cards will you collect over 36 rolls on average?',`${left} cards`,`${total} normally − ${total-left} blocked = ${left}. Count all buildings touching the blocked hex.`,blocked);
 const recipe=Object.keys(costs)[target%4],missing=costs[recipe].map((x,j)=>v[j]?0:x);
 put('missing',6,`Which resources for a ${recipe.toLowerCase()} can this setup NOT produce?`,missing.some(Boolean)?missing.map((x,j)=>x?`${x} ${R[j].toLowerCase()}`:'').filter(Boolean).join(' + '):'None — all required resources are produced','This asks about access to resources. It does not assume you already have the cards in hand.');
}
for(let i=0;i<72;i++){
 const base=structuredClone(triples[(i*37)%triples.length].setup[0]);
 base.hexes.forEach((h,j)=>h.r=(i+(i%3===0?0:j))%5);
 for(const units of [1,2])scenario(`spot-${i}-${units}`,[{...base,units}],{rotation:i%3});
}
for(let i=0;i<48;i++){
 const a=structuredClone(triples[(i*29+7)%triples.length].setup[0]);
 const shape=i%4;
 let b;
 for(let j=0;j<triples.length;j++){
  b=structuredClone(triples[(i*17+19+j)%triples.length].setup[0]);b.units=i%3===0?1:2;
  if(shape===3)b.hexes[0]={...a.hexes[0]};
  const ns=[...a.hexes,...(shape===3?b.hexes.slice(1):shape===1?b.hexes.slice(0,2):b.hexes)].map(h=>h.n);
  if(ns.every(n=>ns.filter(x=>x===n).length<=(n===2||n===12?1:2))&&b.hexes.filter(h=>h.n===6||h.n===8).length<=1)break;
 }
 if(shape===0){a.hexes=a.hexes.slice(0,2);scenario(`shore-${i}`,[a]);}
 else if(shape===1){b.hexes=b.hexes.slice(0,2);scenario(`pair-${i}`,[a,b]);}
 else if(shape===2){scenario(`pair-${i}`,[a,b]);}
 else {b.hexes[0]={...a.hexes[0]};scenario(`shared-${i}`,[a,b],{shared:true});}
}
// Express production in cards over a stated number of rolls, rather than undefined points.
for(const c of deck){
 const total=sum(vector(c.setup));
 if(c.id.startsWith('combo-')&&c.setup[0].hexes.some(h=>c.setup[0].hexes.filter(x=>x.n===h.n).length>2))c.retired=true;
 if(c.prompt.includes('production points')){
  if(c.id.startsWith('payback-')){const p=+c.id.split('-')[1];c.prompt=`A city upgrade produces ${p} extra cards per 36 rolls on average. How many rolls would produce 5 extra cards on average?`;continue;}
  if(c.id.endsWith('-upgrade')){const delta=sum(vector([c.setup[0]]));c.prompt='Upgrade the settlement to a city. How many EXTRA cards would you collect over 36 rolls, on average?';c.answer=`+${delta} cards`;}
  else if(c.id.endsWith('-resource')){const target=(+c.id.split('-')[1]+ +c.id.split('-')[2])%5;c.prompt=`Over 36 dice rolls, how many ${R[target].toLowerCase()} cards will you collect on average?`;c.answer=`${vector(c.setup)[target]} ${R[target].toLowerCase()}`;}
  else {c.prompt=`Over 36 dice rolls, how many resource cards will ${c.setup.length===1?'this '+(c.setup[0].units===2?'city':'settlement'):'these buildings'} produce on average?`;c.answer=`${total} cards`;}
  c.why=c.why.replaceAll('points','expected cards per 36 rolls');
 }
 if(c.id.startsWith('combo-'))c.why=c.setup[0].hexes.map(h=>`${h.n} has ${pips(h.n)} way${pips(h.n)===1?'':'s'} to roll it`).join('; ')+`. ${c.setup[0].hexes.map(h=>pips(h.n)).join(' + ')} = ${total} cards per 36 rolls on average.`;
}
 // New IDs leave every existing review schedule intact. Each card states its policy and target.
 for(const n of [5,6,8,9]){
  const p=pips(n)/36,three=1-(1-p)**3;
  add(`odds-hit-${n}`,8,`A missing card comes only from ${n}. With no trades or robber, what is the chance of getting it within 3 table rolls?`,`${approx(three*100)}%`,`P(no ${n} in 3 rolls) = (1 − ${pips(n)}/36)^3. Subtract that from 1. The mean count 3 × ${pips(n)}/36 is not the probability of at least one payout.`);
  add(`odds-correlated-${n}`,8,`A road needs wood and brick. Both pay on ${n}; your hand is empty. No trades, robber or discards. What is the chance of first affording it by roll 3?`,`${approx(three*100)}%`,`One ${n} pays both cards together, so the event is at least one ${n} in three rolls. This is affordability, not the turn on which a road can legally be built.`);
 }
 add('odds-split-six-eight',8,'A road needs wood and brick. Wood pays on 6; brick pays on 8. Empty hand, four table rolls, no trades or losses. Is its chance of affordability the same as if both paid on 6?','No — 17.24% versus 45.02%','The two setups have equal pips. Split numbers require both to occur; shared production needs one hit. The exact four-roll probabilities are 0.172390594 and 0.450159441.');
 add('odds-conditional-city',8,'You predict a 60% chance an opponent can afford a city by their next turn, then a 70% chance they choose it GIVEN they can afford it. What is P(build city)?','42%','P(build) = P(can afford) × P(choose | can afford) = 0.6 × 0.7. The second number must be conditional; board and legal-turn constraints belong in the forecast assumptions.');
 add('odds-pending-score',8,'A 70% city forecast is still pending. What is its Brier score today?','No score yet','Only a resolved yes/no event has a Brier score, (forecast probability − outcome)^2. Pending and void forecasts are excluded.');
 add('odds-void-score',8,'A forecast deadline became unjudgeable because the game ended early. Should it be scored as no?','No — mark it void','An unjudgeable forecast is excluded from scoring and retained in the record. Scoring it as a miss would bias calibration.');
 add('decision-city-trade',8,'You hold 2 wheat and 3 ore and can upgrade a city next legal turn. You trade 1 wheat for 2 ore. What immediate option did you give up?','Immediate city affordability','After the trade you have 1 wheat and 5 ore; the city recipe needs 2 wheat and 3 ore. This is an opportunity cost for the stated city goal, not proof about the best move overall.');
 add('decision-city-brick',8,'Your goal is a city by your next legal build turn. Your hand has 2 wheat, 2 ore and no brick. Which one card directly completes the recipe?','1 ore','A city costs 2 wheat + 3 ore. Brick can matter for another plan, but it does not close this stated recipe gap.');
 add('decision-hidden-hand',8,'You know an opponent has 1 wheat and 3 unknown cards. Can you say they definitely afford a city now?','No','A city needs 2 wheat + 3 ore. Three unknown cards cannot cover the remaining 1 wheat and 3 ore together, so the city is currently ruled out without trading.');
 return deck;

}
const DAY=86400000;
function schedule(previous,grade,now=Date.now()){const p=previous||{reps:0,interval:0,ease:2.5,reviews:0,lapses:0};const q=({again:0,hard:3,good:4,easy:5})[grade];if(q===undefined)throw Error('Invalid review grade');const ease=Math.max(1.3,(p.ease||2.5)+.1-(5-q)*(.08+(5-q)*.02));const interval=q<3?0:p.reps===0?1:p.reps===1?6:Math.ceil(p.interval*(p.ease||2.5));return {reps:q<3?0:p.reps+1,interval,ease,reviews:(p.reviews||0)+1,lapses:(p.lapses||0)+(q<3?1:0),due:now+(q<3?600000:interval*DAY),last:now,grade};}
function family(card){if(card.setup.length===1&&card.setup[0].hexes.length===3)return 'triple-'+card.setup[0].hexes.map(h=>h.n).sort((a,b)=>a-b).join('-');const spot=card.id.match(/^(spot|shore|pair|shared)-(\d+)-/);if(spot)return spot[1]+'-'+spot[2];const setup=card.id.match(/^setup-(\d+)-/);if(setup)return 'setup-'+setup[1];const die=card.id.match(/^die-(\d+)-/);if(die)return 'die-'+die[1];if(card.hand)return card.prompt+'|'+card.hand.join(',');return card.id;}
function shuffled(values,rng=Math.random){const result=[...values];for(let i=result.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
// Give each board shape a turn rather than letting the largest legacy family dominate.
function mixShapes(cards,rng){const groups=new Map();for(const c of shuffled(cards,rng)){const key=c.shared?'shared':c.setup.map(s=>s.hexes.length).join('+')||'hand';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}const lists=shuffled([...groups.values()],rng),result=[];while(lists.some(g=>g.length))for(const g of lists)if(g.length)result.push(g.shift());return result;}
function selectCards(deck,records,category='all',now=Date.now(),newLimit=10,rng=Math.random,recent=[]){
 const eligible=deck.filter(c=>!c.retired&&(category==='all'||c.category===+category)),avoid=new Set(recent);
 // Prefer unseen families across session boundaries; fall back only if the focus runs out.
 const prefer=cards=>[...cards.filter(c=>!avoid.has(family(c))),...cards.filter(c=>avoid.has(family(c)))];
 const due=prefer(shuffled(eligible.filter(c=>records[c.id]&&records[c.id].due<=now),rng));
 const chosen=[],families=new Set();
 for(const c of due)if(!families.has(family(c))){chosen.push(c);families.add(family(c));}
 const groups=shuffled(categories.map((_,i)=>prefer(mixShapes(eligible.filter(c=>c.category===i&&!records[c.id]),rng))),rng);
 let added=0;
 while(added<newLimit&&groups.some(g=>g.length)){for(const group of groups){while(group.length&&families.has(family(group[0])))group.shift();if(group.length&&added<newLimit){const c=group.shift();chosen.push(c);families.add(family(c));added++;}}}
 return chosen;
}
function practiceCards(deck,category='all',limit=20,rng=Math.random,recent=[]){const shuffledDeck=mixShapes(deck.filter(c=>!c.retired&&(category==='all'||c.category===+category)),rng),avoid=new Set(recent),ordered=[...shuffledDeck.filter(c=>!avoid.has(family(c))),...shuffledDeck.filter(c=>avoid.has(family(c)))],seen=new Set(),result=[];for(const c of ordered)if(!seen.has(family(c))){seen.add(family(c));result.push(c);if(result.length===limit)break;}return result;}

// Coordinates are shared by the drawing and its geometry checks.
function boardLayout(card){
 const radius=64,dx=Math.sqrt(3)*radius/2;
 if(card.shared){const [a,b]=card.setup;return [{tiles:[{...a.hexes[0],x:0,y:0},{...a.hexes[1],x:-dx,y:-96},{...a.hexes[2],x:dx,y:-96},{...b.hexes[1],x:-dx,y:96},{...b.hexes[2],x:dx,y:96}],pieces:[{units:a.units,x:0,y:-64},{units:b.units,x:0,y:64}]}];}
 return card.setup.map(s=>{const centers=s.hexes.length===3?[[0,-64],[-dx,32],[dx,32]]:s.hexes.length===2?[[-dx,32],[dx,32]]:[[0,64]],angle=(card.rotation||0)*Math.PI*2/3;return {tiles:s.hexes.map((h,i)=>{const [x,y]=centers[i];return {...h,x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)};}),pieces:[{units:s.units,x:0,y:0}]};});
}
function matchesSituation(card,situation){if(card.retired)return false;if(situation==='all'||!card.setup.length||card.category===0)return true;return situation==='three'?card.setup.length===1&&card.setup[0].hexes.length===3:situation==='coast'?card.setup.length===1&&card.setup[0].hexes.length<3:card.setup.length>1;}
const api={boardLayout,matchesSituation,R,numbers,costs,categories,pips,fraction,vector,payout,sum,buildDeck,schedule,selectCards,family,shuffled,practiceCards};if(typeof module==='object'&&module.exports)module.exports=api;else global.CatanFlashMath=api;
})(typeof window!=='undefined'?window:globalThis);
