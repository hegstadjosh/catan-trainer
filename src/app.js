(() => {
'use strict';
const root=document.getElementById('catan-lab'),M=window.CatanMath,$=id=>root.querySelector('#'+id);
const defaults={page:'opponents',genericPort:false,specificPorts:[false,false,true,false,false],opponents:null,practice:null,hand:[1,1,4,1,2],pips:[5,5,4,4,3],sources:[[6],[8],[9],[5],[10]],goal:'Settlement',players:4,nextTurnIn:4,deadlineTurns:3,quantDiscards:true,quantTrades:true,rates:[4,4,2,4,4],engineKind:'city',enginePips:12,engineRoads:1,horizon:24,portResource:2,portReserve:1,routeRoads:4,deck:[...M.deck],devTarget:0,devNeeded:3,devBuys:5,knightPips:5,knightUnits:2,knightRolls:4,path:0,pathMode:'cumulative',turn:12};
let state=JSON.parse(JSON.stringify(defaults)),opponentsUI,practiceUI;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(Number(x))?Number(x):lo));
const fixed=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'∞';
const percent=v=>(v*100).toFixed(1)+'%';
const swatch=i=>`<span class="cl-swatch" style="background:var(--cl-r${i+1})"></span>`;
const sourcePips=ns=>ns.reduce((sum,n)=>sum+6-Math.abs(7-n),0);
const invalidSources=new Set();
const paid=a=>a.map((v,i)=>v?`${v} ${M.names[i].toLowerCase()}`:'').filter(Boolean).join(' + ')||'None';
function restore(s){if(!s||typeof s!=='object')return;for(const key of Object.keys(defaults)){if(!(key in s)||key==='sources')continue;if(Array.isArray(defaults[key])){if(Array.isArray(s[key])&&s[key].length===5)state[key]=s[key].map((v,i)=>key==='rates'?[2,3,4].includes(+v)?+v:4:Math.floor(clamp(v,0,key==='deck'?M.deck[i]:80)));}else if(typeof defaults[key]==='number')state[key]=clamp(s[key],0,120);else if(typeof s[key]==='string')state[key]=s[key];}state.page=['play','reference','dev','paths','opponents','practice'].includes(state.page)?state.page:'opponents';state.genericPort=typeof s.genericPort==='boolean'?s.genericPort:state.rates.includes(3);state.specificPorts=Array.isArray(s.specificPorts)&&s.specificPorts.length===5?s.specificPorts.map(Boolean):state.rates.map(r=>r===2);state.rates=M.bankRates(state.genericPort,state.specificPorts);if(s.opponents&&typeof s.opponents==='object')state.opponents=s.opponents;if(s.practice&&typeof s.practice==='object')state.practice=s.practice;state.path=Math.round(clamp(state.path,0,2));state.turn=Math.round(clamp(state.turn,0,24));state.devTarget=Math.round(clamp(state.devTarget,0,1));state.portResource=Math.round(clamp(state.portResource,0,4));state.devNeeded=Math.round(clamp(state.devNeeded,1,14));state.pathMode=state.pathMode==='turn'?'turn':'cumulative';state.engineKind=state.engineKind==='settlement'?'settlement':'city';state.sources=Array.isArray(s.sources)&&s.sources.length===5?s.sources.map(a=>Array.isArray(a)?a.filter(n=>Number.isInteger(n)&&n>=2&&n<=12&&n!==7).slice(0,12):[]):[[],[],[],[],[]];state.pips=state.pips.map((v,i)=>state.sources[i].length?sourcePips(state.sources[i]):v);state.goal=M.goals[state.goal]?state.goal:'Settlement';state.players=Math.round(clamp(state.players,2,6));state.nextTurnIn=Math.round(clamp(state.nextTurnIn,1,state.players));state.deadlineTurns=Math.round(clamp(state.deadlineTurns,1,20));state.quantDiscards=s.quantDiscards!==false;state.quantTrades=s.quantTrades!==false;}
try{if(window.openai?.widgetState?.modelContent)restore(window.openai.widgetState.modelContent);else restore(JSON.parse(localStorage.getItem('catan-field-guide-v1')||'null'));}catch{}
const guidePages=new Set(['play','reference','dev','paths','opponents','practice']);
if(guidePages.has(location.hash.slice(1)))state.page=location.hash.slice(1);
if(location.hash==='#practice-odds')state.page='practice';
if(location.hash==='#opponents-forecast')state.page='opponents';
function save(){try{localStorage.setItem('catan-field-guide-v1',JSON.stringify(state));}catch{}window.openai?.setWidgetState?.({modelContent:{...state},privateContent:null})?.catch(()=>{});}
function setPage(page,push=false){if(!guidePages.has(page))return;state.page=page;if(push&&location.hash!=='#'+page)history.pushState(null,'','#'+page);root.querySelectorAll('[data-page]').forEach(b=>{const selected=b.dataset.page===page;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});root.querySelectorAll('section[role=tabpanel]').forEach(p=>p.hidden=p.id!=='page-'+page);practiceUI?.setActive(page==='practice');requestAnimationFrame(drawVisible);}
root.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{setPage(b.dataset.page,true);save();}));
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(guidePages.has(page)){setPage(page);save();}else if(page==='practice-odds'){setPage('practice');practiceUI?.openOdds();}else if(page==='opponents-forecast'){setPage('opponents');opponentsUI?.openForecast();}});
window.addEventListener('popstate',()=>{const page=location.hash.slice(1);if(guidePages.has(page)){setPage(page);save();}});
root.addEventListener('toggle',()=>requestAnimationFrame(drawVisible),true);
root.querySelector('.cl-nav').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const bs=[...root.querySelectorAll('[data-page]')],i=bs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();let j=e.key==='Home'?0:e.key==='End'?bs.length-1:(i+(e.key==='ArrowRight'?1:bs.length-1))%bs.length;bs[j].focus();setPage(bs[j].dataset.page,true);save();});
$('play-inputs').innerHTML=M.names.map((name,i)=>`<tr><th>${swatch(i)}${name}</th><td><input type="number" aria-label="${name} in hand" data-hand="${i}" min="0" max="80" value="${state.hand[i]}"></td><td><input type="text" data-source="${i}" inputmode="numeric" aria-label="${name} production dice numbers" placeholder="e.g. 6, 8"></td><td><input type="number" aria-label="${name} weighted pips for flow estimate" data-pips="${i}" min="0" max="80" value="${state.pips[i]}"><small class="pl-pip-mode" id="pip-mode-${i}"></small></td><td><strong id="bank-rate-${i}">${state.rates[i]}:1</strong></td></tr>`).join('');
for(const [attr,key] of [['hand','hand'],['pips','pips']])root.querySelectorAll('[data-'+attr+']').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{const i=+input.dataset[attr];state[key][i]=Math.floor(clamp(input.value,attr==='rate'?2:0,attr==='rate'?4:80));input.value=state[key][i];renderPlay();save();}));

$('generic-port').onchange=()=>{state.genericPort=$('generic-port').checked;renderPlay();save();};
root.querySelectorAll('[data-port]').forEach(input=>input.onchange=()=>{state.specificPorts[+input.dataset.port]=input.checked;renderPlay();save();});
$('port-resource').innerHTML=M.names.map((r,i)=>`<option value="${i}">${r}</option>`).join('');
$('pl-goal').innerHTML=Object.keys(M.goals).map(g=>`<option value="${g}">${g}</option>`).join('');
function syncQuantInputs(){root.querySelectorAll('[data-source]').forEach(el=>el.value=state.sources[+el.dataset.source].join(', '));$('pl-goal').value=state.goal;$('pl-players').value=state.players;$('pl-next-turn').value=state.nextTurnIn;$('pl-deadline').value=state.deadlineTurns;$('pl-discards').checked=state.quantDiscards;$('pl-trades').checked=state.quantTrades;}
syncQuantInputs();
root.querySelectorAll('[data-source]').forEach(el=>el.addEventListener('change',()=>{const i=+el.dataset.source,raw=el.value.trim(),parts=raw?raw.split(/[\s,]+/):[];if(parts.length>12||parts.some(x=>!/^\d+$/.test(x)||+x<2||+x>12||+x===7)){invalidSources.add(i);el.setAttribute('aria-invalid','true');renderQuant();return;}invalidSources.delete(i);el.removeAttribute('aria-invalid');state.sources[i]=parts.map(Number);state.pips[i]=sourcePips(state.sources[i]);el.value=state.sources[i].join(', ');renderPlay();save();}));
for(const [id,key,lo,hi] of [['pl-players','players',2,6],['pl-next-turn','nextTurnIn',1,6],['pl-deadline','deadlineTurns',1,20]])$(id).addEventListener('change',()=>{state[key]=Math.round(clamp($(id).value,lo,hi));state.nextTurnIn=Math.min(state.nextTurnIn,state.players);syncQuantInputs();scheduleQuant();save();});
$('pl-goal').addEventListener('change',()=>{state.goal=$('pl-goal').value;scheduleQuant();save();});
for(const [id,key] of [['pl-discards','quantDiscards'],['pl-trades','quantTrades']])$(id).addEventListener('change',()=>{state[key]=$(id).checked;scheduleQuant();save();});
root.querySelectorAll('[data-quant-preset]').forEach(b=>b.addEventListener('click',()=>{state.hand=[0,0,0,0,0];state.sources=[[6],[b.dataset.quantPreset==='shared'?6:8],[],[],[]];state.pips=state.sources.map(sourcePips);state.goal='Road';state.players=4;state.nextTurnIn=4;state.deadlineTurns=1;state.quantDiscards=false;state.quantTrades=false;root.querySelectorAll('[data-hand]').forEach(el=>el.value=0);invalidSources.clear();root.querySelectorAll('[data-source]').forEach(el=>el.removeAttribute('aria-invalid'));syncQuantInputs();renderPlay();save();}));
const bindings=[['engine-kind','engineKind'],['engine-pips','enginePips'],['engine-roads','engineRoads'],['engine-horizon','horizon'],['port-resource','portResource'],['port-reserve','portReserve'],['route-roads','routeRoads'],['dev-target','devTarget'],['dev-needed','devNeeded'],['dev-buys','devBuys'],['knight-pips','knightPips'],['knight-units','knightUnits'],['knight-rolls','knightRolls'],['path-choice','path'],['path-mode','pathMode'],['path-turn','turn']];
$('path-choice').innerHTML=M.trajectories.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('');
for(const [id,key] of bindings){const input=$(id);input.value=state[key];input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{if(typeof defaults[key]==='number'){state[key]=Math.floor(clamp(input.value,input.hasAttribute('min')?+input.getAttribute('min'):0,input.hasAttribute('max')?+input.getAttribute('max'):120));input.value=state[key];}else state[key]=input.value;renderAll();save();});}
const payoffs=['Move robber; steal ≤1 card; army progress','+1 hidden VP','Up to two legal roads','Two chosen resource cards','All opponents’ cards of one named resource'];
const conditions=['Blocked production, useful theft, attainable army','Immediate win or short finishing route','Two roads advance a real plan','Choice completes a valuable recipe','Target resource is concentrated in other hands'];
$('dev-deck').innerHTML=M.types.map((type,i)=>`<tr><th>${type}</th><td><input class="cl-deck-input" type="number" min="0" max="${M.deck[i]}" value="${state.deck[i]}" aria-label="${type} remaining" data-deck="${i}"></td><td id="dev-chance-${i}"></td><td>${payoffs[i]}</td><td>${conditions[i]}</td></tr>`).join('');
root.querySelectorAll('[data-deck]').forEach(input=>input.addEventListener('input',()=>{const i=+input.dataset.deck;state.deck[i]=Math.floor(clamp(input.value,0,M.deck[i]));input.value=state.deck[i];renderDev();save();}));
$('recipe-table').innerHTML=Object.entries(M.costs).map(([name,cost])=>`<tr><th>${name}</th>${cost.map(v=>`<td>${v||'–'}</td>`).join('')}<td><strong>${M.sum(cost)}</strong></td></tr>`).join('');
$('dice-table').innerHTML=[[6,8,5],[5,9,4],[4,10,3],[3,11,2],[2,12,1]].map(([a,b,p])=>`<tr><th>${a} / ${b}</th><td>${p}</td><td>${percent(p/36)}</td><td>${fixed(36/p)}</td></tr>`).join('')+'<tr><th>7 · robber</th><td>6</td><td>16.7%</td><td>6.0</td></tr>';
$('path-legend').innerHTML=M.names.map((r,i)=>`<span>${swatch(i)}${r}</span>`).join('');
let quantTimer;
function quantOptions(){return {hand:state.hand,sources:state.sources,need:M.goals[state.goal],rates:state.rates,players:state.players,nextTurnIn:state.nextTurnIn,turns:state.deadlineTurns,discard:state.quantDiscards,trades:state.quantTrades,samples:4000,maxStates:6000,seed:1};}
function scheduleQuant(){clearTimeout(quantTimer);$('pl-quant-values').textContent='';quantTimer=setTimeout(renderQuant,180);}
function quantBlocker(){
 if(invalidSources.size)return 'Correct the marked dice numbers. Use 2–12 except 7, separated by commas; at most 12 per resource.';
 const missing=M.names.filter((_,i)=>!state.sources[i].length&&state.pips[i]>0);
 return missing.length?'Add dice numbers for '+missing.join(', ')+' to calculate deadline odds. Your saved pips still drive the rough flow estimate below.':'';
}
function renderQuant(){
 const error=$('pl-quant-error'),blocker=quantBlocker();error.textContent=blocker;$('pl-compare').disabled=Boolean(blocker);
 if(blocker){$('pl-quant-summary').textContent='';$('pl-quant-values').textContent='';return;}
 try{const r=M.deadlineOdds(quantOptions()),last=r.byTurn.at(-1),ci=r.ci.at(-1),percent1=x=>(100*x).toFixed(1)+'%';
  const quant=x=>x==null?`later than turn ${state.deadlineTurns}`:`turn ${x}`;
  $('pl-quant-summary').innerHTML=`<p class="pl-quant-lead"><strong>${percent1(last)}</strong> chance to afford a ${state.goal.toLowerCase()} by build turn ${state.deadlineTurns}.</p>${state.sources.some((ns,i)=>!ns.length&&state.pips[i]>0)?'<p class="pl-quant-warning">Pips without dice numbers affect only the rough flow estimate below. This deadline result counts no production from those resources.</p>':''}<div class="pl-quant-metrics"><div><strong>${quant(r.median)}</strong><small>Median affordable turn</small></div><div><strong>${quant(r.p80)}</strong><small>80% affordable turn</small></div><div><strong>${percent1(r.discardRisk)}</strong><small>Chance of discard before affordability</small></div><div><strong>${r.method==='exact'?'Exact':r.samples.toLocaleString()+' paths'}</strong><small>${r.method==='exact'?'Dice-state calculation':'Seeded simulation'}</small></div></div><table><thead><tr><th>Your build turn</th><th>Table roll</th><th>Affordable by then</th></tr></thead><tbody>${r.byTurn.map((p,i)=>`<tr><td>${i+1}</td><td>${r.checkpoints[i]}</td><td>${percent1(p)}</td></tr>`).join('')}</tbody></table><p class="pl-caption">${r.method==='exact'?'Exact under these assumptions':`95% interval at deadline: ${percent1(ci[0])}–${percent1(ci[1])}; seed ${r.seed}`}. ${percent1(r.censored)} remains beyond this horizon. Build turns allow whole-card bank and port trades when selected.</p>`;
 }catch(e){error.textContent=e.message;$('pl-quant-summary').textContent='';$('pl-quant-values').textContent='';}
}
$('pl-compare').addEventListener('click',()=>{if(quantBlocker()){renderQuant();return;}const button=$('pl-compare');button.disabled=true;button.textContent='Comparing…';setTimeout(()=>{try{if(quantBlocker()){renderQuant();button.textContent='Compare card and port changes';return;}const q=M.goalValues({...quantOptions(),samples:2000,maxStates:3000}),base=q.baseline.byTurn.at(-1);$('pl-quant-values').innerHTML=`<h3>What changes this deadline?</h3><p class="pl-caption">Baseline: ${(100*base).toFixed(1)}% by build turn ${state.deadlineTurns}${q.baseline.method==='monte-carlo'?` (95% interval ${(100*q.baseline.ci.at(-1)[0]).toFixed(1)}–${(100*q.baseline.ci.at(-1)[1]).toFixed(1)}%)`:''}.</p><table><thead><tr><th>Resource</th><th>With one more card</th><th>With 2:1 port</th></tr></thead><tbody>${q.cards.map((v,i)=>`<tr><th>${M.names[i]}</th><td>${(100*(base+v.plus)).toFixed(1)}% (${v.plus>=0?'+':''}${(100*v.plus).toFixed(1)} pts)</td><td>${(100*(base+q.ports[i].delta)).toFixed(1)}% (${q.ports[i].delta>=0?'+':''}${(100*q.ports[i].delta).toFixed(1)} pts)</td></tr>`).join('')}</tbody></table><p class="pl-caption">Port value assumes you already own it; reaching it has a cost. ${q.comparisonMethod==='exact'?'Every comparison was calculated exactly under these assumptions.':(q.comparisonMethod==='mixed'?'Some comparison rows use':'Comparison rows use')+' '+q.comparisonSamples.toLocaleString()+' paired seeded paths; individual 95% intervals are available in the dashboard model.'} Capability does not prove the best move.</p>`;}catch(e){$('pl-quant-error').textContent=e.message;}button.disabled=false;button.textContent='Compare card and port changes';},30);});
function renderPlay(){
 state.rates=M.bankRates(state.genericPort,state.specificPorts);$('generic-port').checked=state.genericPort;root.querySelectorAll('[data-port]').forEach(input=>{const i=+input.dataset.port;input.checked=state.specificPorts[i];$('bank-rate-'+i).textContent=state.rates[i]+':1';});
 root.querySelectorAll('[data-pips]').forEach(input=>{const i=+input.dataset.pips,fromNumbers=state.sources[i].length>0;input.value=state.pips[i];input.readOnly=fromNumbers;$('pip-mode-'+i).textContent=fromNumbers?'calculated':'flow only';});
 const mu=state.pips.map(x=>x/36);
 $('play-production').innerHTML=`<strong>${fixed(M.sum(mu),2)}</strong> expected cards / table roll · <strong>${fixed(4*M.sum(mu),1)}</strong> / four-player round`;
 $('play-actions').innerHTML=Object.entries(M.costs).map(([name,cost])=>{const plan=M.bankPlan(state.hand,cost,state.rates),t=M.flowTime(state.hand,mu,cost,state.rates);const trades=plan.trades.map(a=>`${a.give} ${M.names[a.from].toLowerCase()} → ${a.get} ${M.names[a.to].toLowerCase()}`).join('; ');const missing=cost.map((c,i)=>Math.max(0,c-state.hand[i]));return `<tr><th>${name}<div class="cl-mini">${M.sum(cost)} cards</div></th><td>${plan.ready?'<span class="cl-ready">Ready'+(trades?' via bank':'')+'</span>':'Missing '+paid(missing)}${trades?`<div class="cl-mini">${trades}<br>${M.sum(cost)+plan.trades.reduce((v,t)=>v+t.give-t.get,0)} cards leave your hand in total</div>`:''}</td><td>${plan.ready?'0':t<1?'&lt;1 · fractional proxy':fixed(t)}</td></tr>`;}).join('');
 const isCity=state.engineKind==='city',cost=isCity?5:4+2*state.engineRoads,muAdded=state.enginePips/36,gain=muAdded*state.horizon,payback=muAdded?cost/muAdded:Infinity;
 $('engine-roads').disabled=isCity;
 $('engine-result').innerHTML=`Pay ${cost} cards → add <strong>${fixed(muAdded,2)}</strong> / roll<br>${fixed(gain)} expected cards over ${state.horizon} rolls · ${fixed(gain-cost)} net · payback <strong>${fixed(payback)}</strong> rolls`;
 const surplus=Math.max(0,state.hand[state.portResource]-state.portReserve),r=state.portResource;
 $('port-output').innerHTML=`<div class="cl-result"><strong>${surplus}</strong> surplus ${M.names[r].toLowerCase()} in hand</div><table><thead><tr><th>Exchange</th><th>Imports</th><th>Unused surplus</th><th>Gain vs 4:1</th></tr></thead><tbody>${[4,3,2].map(rate=>`<tr><th>${rate}:1${rate===state.rates[r]?' · current':''}</th><td>${Math.floor(surplus/rate)}</td><td>${surplus%rate}</td><td>+${Math.floor(surplus/rate)-Math.floor(surplus/4)}</td></tr>`).join('')}</tbody></table>`;
 scheduleQuant();
 if(state.page==='play')drawEngine();
}
function renderReference(){
 $('route-table').innerHTML=M.routes.map(r=>{const min=r.base+2*state.routeRoads+3*r.minimumDraws,mean=r.base+2*state.routeRoads+3*r.meanDraws,parts=[r.c?`${r.c} cities`:'',r.s?`${r.s} settlements`:'',r.l?'road':'',r.a?'army':'',r.v?`${r.v} VP cards`:''].filter(Boolean);const warning=r.l&&state.routeRoads<3;return `<tr><td><strong>${parts.join(' + ')}</strong>${warning?'<div class="cl-caption cl-warn">Needs ≥3 paid roads for award</div>':''}</td><td>${r.n}</td><td>${r.minimumDraws}</td><td>${fixed(r.meanDraws)}</td><td>${min}${warning?'*':''}</td><td>${fixed(mean)}${warning?'*':''}</td><td class="cl-budget">${M.budget(r.n,r.c,state.routeRoads,r.minimumDraws).join(' · ')}</td></tr>`;}).join('');
}
function devMetrics(){const N=M.sum(state.deck),K=state.deck[state.devTarget],r=state.devNeeded,b=Math.min(state.devBuys,N);return {N,K,r,b,p:N?M.tail(N,K,b,r):0,e:M.expectedDraws(N,K,r)};}
function renderDev(){
 const {N,K,r,b,p,e}=devMetrics();
 for(let i=0;i<5;i++)$('dev-chance-'+i).textContent=N?percent(state.deck[i]/N):'—';
 $('dev-buys').max=N;state.devBuys=b;$('dev-buys').value=b;
 $('dev-odds').innerHTML=N?`<strong>${percent(p)}</strong> chance of at least ${r} ${state.devTarget===0?(r===1?'knight':'knights'):(r===1?'VP card':'VP cards')} in ${b} ${b===1?'purchase':'purchases'}<br>Costs ${3*b} cards · mean purchases to target <strong>${fixed(e,2)}</strong> (${fixed(3*e,1)} resources)`:'<strong>No cards remaining</strong> · choose a nonempty deck scenario';
 $('dev-quantiles').innerHTML=`<table><thead><tr><th>Chance of reaching target</th><th>50%</th><th>80%</th><th>95%</th></tr></thead><tbody><tr><th>Purchases needed</th>${[.5,.8,.95].map(p=>`<td>${fixed(M.quantile(N,K,r,p),0)}</td>`).join('')}</tr></tbody></table>`;
 const restored=state.knightPips*state.knightUnits*state.knightRolls/36;
 $('knight-result').innerHTML=`<strong>${fixed(restored,2)}</strong> expected cards restored<br>With a successful theft: ${fixed(restored+1,2)} gross cards gained; excludes army and denial value.`;
 if(state.page==='dev')drawDev();
}
function renderPaths(){
 const path=M.trajectories[state.path],row=path.rows[state.turn],end=path.rows[24];
 $('path-turn-label').textContent=state.turn;
 $('path-detail').innerHTML=`<strong>${row.actions.map(a=>a.note||'Build '+a.type.toLowerCase()).join(' · ')||(state.turn===0?'Free setup':'No purchase')}</strong><br>${row.vp} VP · ${row.s} settlements · ${row.c} cities · ${row.r} roads · ${M.sum(row.total)} cards paid`;
 $('path-budget').innerHTML=M.names.map((r,i)=>`<tr><th>${swatch(i)}${r}</th><td>${row.spent[i]}</td><td>${row.total[i]}</td><td>${end.total[i]}</td></tr>`).join('')+`<tr><th>Total</th><td>${M.sum(row.spent)}</td><td>${M.sum(row.total)}</td><td>${M.sum(end.total)}</td></tr>`;
 $('path-compare').innerHTML=M.trajectories.map(p=>{const row=p.rows[state.turn];return `<tr><th>${p.name}</th>${row.total.map(v=>`<td>${v}</td>`).join('')}<td>${row.vp}</td></tr>`;}).join('');
 $('path-ledger').innerHTML=path.rows.filter(r=>r.actions.length).map(r=>`<tr><td>${r.t}</td><td>${r.actions.map(a=>a.note||'Build '+a.type.toLowerCase()).join('; ')}</td><td>${paid(r.spent)}</td><td>${M.sum(r.total)}</td><td>${r.vp}</td></tr>`).join('');
 if(state.page==='paths')drawPaths();
}
function frame(id,xDomain,yDomain,xLabel,yLabel,height=230){
 const host=$(id),w=host.getBoundingClientRect().width;if(w<50)return null;
 const m={l:58,r:18,t:27,b:43},svg=d3.select(host).selectAll('svg').data([null]).join('svg').attr('viewBox',`0 0 ${w} ${height}`).attr('width',w).attr('height',height).attr('role','img').attr('aria-label',`${yLabel} by ${xLabel}`);svg.selectAll('*').remove();
 const x=d3.scaleLinear().domain(xDomain).range([m.l+3,w-m.r-3]),y=d3.scaleLinear().domain(yDomain).nice().range([height-m.b-3,m.t+3]);
 svg.append('title').text(`${yLabel} by ${xLabel}`);
 svg.append('rect').attr('data-chart-frame','').attr('x',m.l).attr('y',m.t).attr('width',w-m.l-m.r).attr('height',height-m.t-m.b).attr('fill','none').attr('stroke','var(--cl-line)');
 svg.append('g').attr('transform',`translate(0,${height-m.b})`).call(d3.axisBottom(x).ticks(w<400?3:6).tickFormat(d3.format('d')));
 svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4));
 svg.append('text').attr('class','axis-title').attr('data-axis','y').attr('x',m.l).attr('y',15).text(yLabel);
 svg.append('text').attr('class','axis-title').attr('data-axis','x').attr('x',(w+m.l-m.r)/2).attr('y',height-5).attr('text-anchor','middle').text(xLabel);
 return {svg,x,y,w,height,m};
}
function linePlot(id,points,selected,xLabel,yLabel,percentAxis=false){
 const xx=d3.extent(points,d=>d.x),yy=d3.extent([...points.map(d=>d.y),0]),span=yy[1]-yy[0]||1;const ymax=percentAxis?100:yy[1]+span*.08,ymin=percentAxis?0:Math.min(0,yy[0]-span*.08);
 const f=frame(id,[xx[0],xx[1]||1],[ymin,ymax],xLabel,yLabel);if(!f)return;
 const {svg,x,y,m,w,height}=f;
 if(ymin<0&&ymax>0)svg.append('line').attr('x1',m.l).attr('x2',w-m.r).attr('y1',y(0)).attr('y2',y(0)).attr('stroke','var(--cl-line)').attr('stroke-dasharray','3 3');
 svg.append('path').datum(points).attr('d',d3.line().x(d=>x(d.x)).y(d=>y(d.y))).attr('fill','none').attr('stroke','var(--cl-accent)').attr('stroke-width',2);
 const point=points.find(d=>d.x===selected)||points[0];
 svg.append('line').attr('x1',x(point.x)).attr('x2',x(point.x)).attr('y1',m.t).attr('y2',height-m.b).attr('stroke','var(--cl-line)');
 svg.append('circle').attr('cx',x(point.x)).attr('cy',y(point.y)).attr('r',4).attr('fill','var(--cl-accent)');
 svg.append('text').attr('x',x(point.x)+(point.x>(xx[1]+xx[0])/2?-8:8)).attr('y',Math.max(m.t+13,Math.min(height-m.b-7,y(point.y)-9))).attr('text-anchor',point.x>(xx[1]+xx[0])/2?'end':'start').text(fixed(point.y)+(percentAxis?'%':' cards'));
 const hit=svg.append('rect').attr('data-chart-hit','').attr('x',m.l).attr('y',m.t).attr('width',w-m.l-m.r).attr('height',height-m.t-m.b).attr('fill','transparent');
 hit.append('title').text(`${xLabel}: ${point.x}; ${yLabel}: ${fixed(point.y)}`);
 hit.on('mousemove',(event)=>{const [px]=d3.pointer(event,svg.node()),i=d3.bisector(d=>d.x).center(points,x.invert(px));hit.select('title').text(`${xLabel}: ${points[i].x}; ${yLabel}: ${fixed(points[i].y)}`);});
}
function drawEngine(){const cost=state.engineKind==='city'?5:4+2*state.engineRoads,H=Math.max(36,state.horizon),points=Array.from({length:H+1},(_,t)=>({x:t,y:t*state.enginePips/36-cost}));linePlot('engine-chart',points,state.horizon,'Future table rolls','Net resources after build cost');}
function drawDev(){const {N,K,r,b}=devMetrics(),points=Array.from({length:Math.max(1,N)+1},(_,n)=>({x:n,y:N?100*M.tail(N,K,n,r):0}));linePlot('dev-chart',points,b,'Development cards purchased','Chance of reaching target (%)',true);}
function drawPaths(){
 const rows=M.trajectories[state.path].rows,values=rows.map(r=>state.pathMode==='turn'?r.spent:r.total),max=d3.max(values,M.sum),f=frame('path-chart',[-.6,24.6],[0,max*1.06||1],'Your turn (invented timing)',state.pathMode==='turn'?'Resources spent this turn':'Resources spent cumulatively',285);if(!f)return;
 const {svg,x,y,m,w,height}=f,bw=(w-m.l-m.r)/27;
 values.forEach((v,t)=>{let acc=0;v.forEach((amount,i)=>{if(amount)svg.append('rect').attr('x',x(t)-bw/2).attr('y',y(acc+amount)).attr('width',bw).attr('height',y(acc)-y(acc+amount)).attr('fill',`var(--cl-r${i+1})`).attr('opacity',t>state.turn?.22:.86);acc+=amount;});});
 svg.append('line').attr('x1',x(state.turn)).attr('x2',x(state.turn)).attr('y1',m.t).attr('y2',height-m.b).attr('stroke','var(--cl-fg)');
 svg.append('rect').attr('data-chart-hit','').attr('x',m.l).attr('y',m.t).attr('width',w-m.l-m.r).attr('height',height-m.t-m.b).attr('fill','transparent').style('cursor','pointer').on('click',event=>{const [px]=d3.pointer(event,svg.node());state.turn=Math.round(clamp(x.invert(px),0,24));$('path-turn').value=state.turn;renderPaths();save();});
}
function drawVisible(){if(typeof d3==='undefined')return;if(state.page==='play')drawEngine();if(state.page==='dev')drawDev();if(state.page==='paths')drawPaths();}
function renderAll(){renderPlay();renderReference();renderDev();renderPaths();}
new ResizeObserver(drawVisible).observe(root);
window.addEventListener('openai:set_globals',event=>{const s=event.detail?.globals?.widgetState?.modelContent;if(!s)return;restore(s);for(const [id,key] of bindings)$(id).value=state[key];for(const [attr,key] of [['hand','hand'],['pips','pips'],['rate','rates'],['deck','deck']])root.querySelectorAll('[data-'+attr+']').forEach(i=>i.value=state[key][+i.dataset[attr]]);syncQuantInputs();opponentsUI?.restore(state.opponents);practiceUI?.restore(state.practice);setPage(guidePages.has(location.hash.slice(1))?location.hash.slice(1):state.page);renderAll();});
opponentsUI=window.CatanOpponents.init({root,initial:state.opponents,onSave(value){state.opponents=value;save();},
 onForecastCreate:window.CatanAccount?input=>window.CatanAccount.createForecast(input):null,
 onForecastResolve:window.CatanAccount?(id,input)=>window.CatanAccount.resolveForecast(id,input):null,
 onForecastLocal(value){state.opponents=value;}});
practiceUI=window.CatanPracticeUI.init({root,initial:state.practice,onSave(value){state.practice=value;save();}});
renderAll();setPage(state.page);if(location.hash==='#practice-odds')practiceUI?.openOdds();if(location.hash==='#opponents-forecast')opponentsUI?.openForecast();
})();
