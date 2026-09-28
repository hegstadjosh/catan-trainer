(function(){
'use strict';
const boot=JSON.parse(document.getElementById('practice-boot').textContent),main=document.getElementById('practice-main');
const h=(tag,attrs,...children)=>{const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs||{})){if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(k==='class')el.className=v;else if(v!=null)el.setAttribute(k,String(v));}for(const c of children.flat())if(c!=null)el.append(c instanceof Node?c:document.createTextNode(String(c)));return el;};
async function api(path,method='GET',body){const r=await fetch(path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const x=await r.json().catch(()=>({error:'Unexpected response.'}));if(!r.ok)throw Error(x.error||'Request failed.');return x;}
const pct=x=>Math.round(100*x)+'%';
const num=x=>Number(x).toFixed(2);
const display=o=>o?.displayLabel||o?.label||'Saved plan';
function targetText(option){
 const targets=option?.targets||[],sites=targets.filter(t=>t.kind==='site').length,roads=targets.filter(t=>t.kind==='road').length;
 if(!sites&&!roads)return 'This plan has no fixed board location.';
 return [sites?`Outlined ring: ${sites===1?'build site':`${sites} build sites`}.`:null,roads?`Dashed outline: ${roads===1?'road segment':`${roads} road segments`}.`:null].filter(Boolean).join(' ');
}
let positions,position,attempt,attempts=[];
async function start(){
 if(!boot.gameId){main.replaceChildren(h('p',{role:'alert'},'Game not found.'));return;}
 try{positions=await api(`/api/history/${boot.gameId}/practice`);if(!positions.positions.length){main.replaceChildren(h('h1',null,'Decision practice'),h('p',null,'No recorded decision positions yet. A position is available after your roll, during your main phase.'),h('a',{href:'/history/'+boot.gameId},'Return to history'));return;}
  const revision=positions.positions.some(p=>p.revision===boot.revision)?boot.revision:positions.positions.at(-1).revision;
  attempts=(await api(`/api/practice/attempts?gameId=${encodeURIComponent(boot.gameId)}`)).attempts;
  await load(revision);
  if(boot.attempt&&attempts.some(a=>a.id===boot.attempt&&a.revision===revision))await selectAttempt(boot.attempt);
 }catch(e){main.replaceChildren(h('p',{role:'alert',class:'hs-error'},e.message));}
}
async function load(revision){position=await api(`/api/history/${boot.gameId}/practice/${revision}`);attempt=null;history.replaceState(null,'',`/practice/${boot.gameId}?revision=${revision}`);draw();}
function draw(){
 const v=position.view,opts=positions.positions;
 const chooser=h('select',{id:'practice-revision','aria-label':'Decision move',onchange:e=>load(Number(e.target.value)).catch(showError)},opts.map(p=>h('option',{value:p.revision,...(p.revision===position.revision?{selected:''}:{})},`Move ${p.move}`)));
 const boardSvg=window.CatanBoard.render(v.board,{colors:v.players.map(p=>p.color),names:v.players.map(p=>p.name),dice:v.dice,label:`Board at move ${position.move}`});
 const board=h('div',{class:'hs-board practice-board'},boardSvg);
 const legend=h('p',{id:'practice-target-legend',role:'status','aria-live':'polite'});
 const showTarget=option=>{window.CatanBoard.highlight(boardSvg,option?.targets||[]);legend.textContent=targetText(option);boardSvg.setAttribute('aria-label',`Board at move ${position.move}. ${legend.textContent}`);};
 showTarget(position.options.find(o=>o.id===attempt?.optionId)||position.options[0]);
 const ownCards=(v.me.devCards||[]).map(c=>{
  const name={knight:'Knight',roadBuilding:'Road Building',yearOfPlenty:'Year of Plenty',monopoly:'Monopoly',victoryPoint:'Victory Point'}[c.type]||c.type;
  return `${name} (${c.type==='victoryPoint'?'scores now':c.playable?'playable':'bought this turn'})`;
 });
 const person=h('div',{class:'practice-facts'},h('p',null,`Your total VP: ${v.me.totalVP}.`),
  h('p',null,`Your development cards: ${ownCards.join(', ')||'none'}.`),
  h('p',null,`Your hand: ${Object.entries(v.me.resources).filter(([,n])=>n).map(([r,n])=>`${n} ${r}`).join(', ')||'empty'}`),
  h('p',null,`Public scores: ${v.players.map(p=>`${p.name} ${p.publicVP}`).join(' · ')}`),h('p',null,`Bank: ${Object.entries(v.bank).map(([r,n])=>`${r} ${n}`).join(' · ')}`));
 const previous=attempts.filter(a=>a.revision===position.revision);
 const attemptChooser=previous.length?h('label',{class:'practice-choose'},'Saved decisions ',h('select',{'aria-label':'Saved decisions',onchange:e=>{if(e.target.value)selectAttempt(e.target.value).catch(showError);else{attempt=null;history.replaceState(null,'',`/practice/${boot.gameId}?revision=${position.revision}`);draw();}}},
  h('option',{value:'',...(attempt?{}:{selected:''})},'New decision'),previous.map((a,i)=>h('option',{value:a.id,...(attempt?.id===a.id?{selected:''}:{})},`${a.revealedAt?'Compared':'Locked'} · ${new Date(a.createdAt).toLocaleDateString()} · #${previous.length-i}`)))):null;
 const panel=attempt?drawAttempt():drawCommit(showTarget);
 main.replaceChildren(h('div',{class:'hs-crumb'},h('a',{href:'/history'},'← Match history')),
  h('div',{class:'hs-head'},h('div',null,h('h1',null,'Decision practice'),h('p',{class:'hs-muted'},positions.title+' · what you knew at this move')),
   h('div',null,h('label',{class:'practice-choose'},'Position ',chooser),attemptChooser)),
  h('p',{class:'hs-notice'},position.distinction),
  h('div',{class:'practice-grid'},h('section',{'aria-label':'Recorded board'},board,legend,person),h('section',{'aria-label':'Commit and reveal'},panel)),
  h('p',{id:'practice-error',class:'hs-error',role:'alert'}));
}
async function selectAttempt(id){attempt=(await api(`/api/practice/attempts/${id}`)).attempt;history.replaceState(null,'',`/practice/${boot.gameId}?revision=${position.revision}&attempt=${attempt.id}`);draw();}
function showError(e){const box=document.getElementById('practice-error');if(box)box.textContent=e.message;}
function drawCommit(showTarget){
 const group=h('fieldset',{class:'practice-options'},h('legend',null,'Choose your plan'),position.options.map((o,i)=>h('label',{class:'practice-option'},h('input',{type:'radio',name:'plan',value:o.id,...(i===0?{checked:''}:{}),onchange:()=>showTarget(o)}),h('span',null,display(o)))));
 const reason=h('textarea',{id:'practice-reason',rows:4,maxlength:2000,placeholder:'Why is this the best use of your turn?'});
 const prob=h('input',{id:'practice-prob',type:'number',min:0,max:100,step:1,value:50,'aria-label':'Chance percent'});
 const horizon=h('select',{id:'practice-horizon'},[1,2,3,4,5,6].map(n=>h('option',{value:n},`${n} future turn${n>1?'s':''}`)));
 const button=h('button',{type:'button',class:'hs-btn hs-primary',onclick:async()=>{button.disabled=true;try{
  const optionId=group.querySelector('input:checked')?.value;
  const x=await api(`/api/history/${boot.gameId}/practice/${position.revision}/attempts`,'POST',{optionId,reason:reason.value,probability:Number(prob.value)/100,horizon:Number(horizon.value)});
  attempt=x.attempt;attempts.unshift({id:attempt.id,revision:attempt.revision,createdAt:attempt.createdAt,revealedAt:null});history.replaceState(null,'',`/practice/${boot.gameId}?revision=${position.revision}&attempt=${attempt.id}`);draw();
 }catch(e){showError(e);button.disabled=false;}}},'Lock decision');
 return h('div',null,h('h2',null,'Commit before reveal'),h('p',{class:'hs-muted'},position.prompt),group,
  h('label',{class:'practice-field'},'Your reason',reason),
  h('div',{class:'practice-row'},h('label',{class:'practice-field'},'Chance of gaining at least 1 VP',h('span',null,prob,' %')),h('label',{class:'practice-field'},'By the end of your',horizon)),
  h('p',{class:'hs-muted hs-small'},'Your plan, reason and probability become permanent when you lock them.'),button);
}
function drawAttempt(){
 const ev=attempt.evaluation;
 const summary=h('div',{class:'practice-locked'},h('strong',null,'Decision locked'),h('p',null,display(position.options.find(o=>o.id===attempt.optionId))),
  h('p',null,`Your estimate: ${pct(attempt.probability)} by the end of your future turn ${attempt.horizon}.`),h('p',null,`Reason: ${attempt.reason}`));
 if(!ev){const button=h('button',{type:'button',class:'hs-btn hs-primary',onclick:async()=>{button.disabled=true;try{attempt=(await api(`/api/practice/attempts/${attempt.id}/reveal`,'POST')).attempt;const row=attempts.find(a=>a.id===attempt.id);if(row)row.revealedAt=attempt.revealedAt;draw();}catch(e){showError(e);button.disabled=false;}}},'Reveal comparison');
  return h('div',null,h('h2',null,'Your commitment'),summary,button);}
 const rows=ev.options.map(o=>h('tr',{class:o.id===attempt.optionId?'practice-selected':null},h('th',{scope:'row'},display(position.options.find(p=>p.id===o.id)||o)),h('td',null,num(o.meanVpGain)),
  h('td',null,pct(o.pAtLeastOne),h('small',null,`95% sample interval ${pct(o.pAtLeastOne95Interval[0])}–${pct(o.pAtLeastOne95Interval[1])}`)),
  h('td',null,pct(o.pAtLeastTwo)),h('td',null,num(o.pairedDifferenceFromChoice),h('small',null,`${num(o.paired95Interval[0])} to ${num(o.paired95Interval[1])}`)),
  h('td',null,pct(o.highestModeledGainShare)),h('td',null,String(o.censored))));
 const actual=ev.realized;
 return h('div',null,h('h2',null,'Modeled futures'),summary,h('p',null,ev.objective+` · ${ev.samples} paired samples`),
  h('div',{class:'practice-table-wrap'},h('table',{class:'hs-table practice-table'},h('thead',null,h('tr',null,['Plan','Mean VP gain','Gain ≥1','Gain ≥2','Paired gain vs yours','Highest modeled gain share','Unfinished samples'].map(x=>h('th',{scope:'col'},x)))),h('tbody',null,rows))),
  h('p',{class:'hs-muted hs-small'},ev.assumptions),
  h('h3',null,'What actually happened'),h('p',null,actual.resolution==='pending'?'The chosen horizon has not been recorded yet.':`Recorded VP gain: ${actual.vpGain}. ${actual.note}`),
  actual.brierScore!=null?h('p',null,`Brier score for your probability: ${num(actual.brierScore)} (lower is better).`):null,
  h('p',{class:'hs-muted hs-small'},'“Highest modeled gain share” is a fraction of these sampled futures, not the probability a plan is optimal.'));
}
start();
})();
