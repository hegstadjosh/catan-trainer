(function(global){
'use strict';
// Opponent forecasting math. Pure functions: no DOM, no storage, no game access.
// Everything here is conditional on stated assumptions; nothing is learned from data.
const R=['Wood','Brick','Sheep','Wheat','Ore'];
const COSTS={Road:[1,1,0,0,0],Settlement:[1,1,1,1,0],City:[0,0,0,2,3],'Development card':[0,0,1,1,1]};
const EVENTS=[...Object.keys(COSTS),'Other'];
const pips=n=>n>=2&&n<=12?6-Math.abs(7-n):0;
const DICE=Array.from({length:13},(_,n)=>pips(n)/36);
const sum=a=>a.reduce((x,y)=>x+y,0);
const round2=x=>Math.round(x*100)/100;

// "6 9x2 8×2" → buildings on those numbers; x2 marks a city. 7, 2–12 bounds and junk are reported, not guessed.
function parseProduction(texts){
 const payouts=Array.from({length:13},()=>[0,0,0,0,0]),errors=[];
 (texts||[]).slice(0,5).forEach((text,r)=>{for(const token of String(text||'').split(/[\s,;]+/).filter(Boolean)){const m=token.match(/^(\d{1,2})(?:[x×*](\d))?$/i);const n=m?+m[1]:NaN,units=m&&m[2]?+m[2]:1;if(!m||n<2||n>12||n===7||units<1||units>3){errors.push(`${R[r]}: “${token}” is not a number 2–12 (7 never pays)`);continue;}payouts[n][r]+=units;}});
 const weights=[0,0,0,0,0];for(let n=2;n<=12;n++)payouts[n].forEach((u,r)=>weights[r]+=u*pips(n));
 return {payouts,pips:weights,errors,empty:sum(weights)===0};
}

// Every hand with at least the known counts and exactly `total` cards.
function handWorlds(known,total){
 if(!Array.isArray(known)||known.length!==5||known.some(x=>!Number.isInteger(x)||x<0)||!Number.isInteger(total)||total<0)throw Error('Hand counts must be nonnegative integers.');
 const u=total-sum(known);if(!(u>=0))return [];if(u>40)throw Error('Too many unknown cards to enumerate (max 40).');
 const out=[],e=[0,0,0,0,0];
 (function rec(i,left){if(i===4){e[4]=left;out.push(e.slice());return;}for(let k=left;k>=0;k--){e[i]=k;rec(i+1,left-k);}})(0,u);
 return out.map(x=>x.map((v,i)=>v+known[i]));
}
function handRange(known,total){if(!Array.isArray(known)||known.length!==5||known.some(x=>!Number.isInteger(x)||x<0)||!Number.isInteger(total)||total<0)throw Error('Hand counts must be nonnegative integers.');const u=total-sum(known);if(u<0)return {count:0,unknown:u,valid:false};const count=(u+1)*(u+2)*(u+3)*(u+4)/24;return {valid:true,count,unknown:u,min:known.slice(),max:known.map(x=>x+u)};}
const fact=n=>{let f=1;for(let i=2;i<=n;i++)f*=i;return f;};
function normalize(w){if(w!=null&&(!Array.isArray(w)||w.length!==5||w.some(v=>!Number.isFinite(v)||v<0)))throw Error('Hand prior needs five nonnegative resource weights.');const s=sum(w||[]);return s>0?w.map(v=>v/s):[.2,.2,.2,.2,.2];}
// Probability of this exact split of unknown cards when each unknown card is independently resource i with weight w_i.
function multinomial(extra,w){const u=sum(extra);let p=fact(u);extra.forEach((k,i)=>{p*=Math.pow(w[i],k)/fact(k);});return p;}
// Two explicit assumptions, shown side by side so their disagreement is visible.
function affordOdds(known,total,cost,weights){
 const hands=handWorlds(known,total);if(!hands.length)return {valid:false};
 const w=normalize(weights),ok=h=>h.every((v,i)=>v>=cost[i]);let equal=0,weighted=0;
 for(const h of hands){const e=h.map((v,i)=>v-known[i]);if(ok(h)){equal++;weighted+=multinomial(e,w);}}
 return {valid:true,count:hands.length,affording:equal,equalHands:equal/hands.length,cardWeights:weighted,status:equal===hands.length?'guaranteed':equal?'possible':'impossible'};
}

// Chance they can pay `cost` from their own dice income within each of 0..rolls table rolls.
// Assumes: unknown cards split by `weights`; no trades, robber, discards, steals, dev cards or other spending.
// Income is added per dice total, so resources paid by the same number stay correlated.
function capability({known,total,cost,payouts,weights,rolls}){
 if(!Number.isInteger(rolls)||rolls<0||rolls>1000)throw Error('Roll horizon must be 0–1000.');
 if(!Array.isArray(cost)||cost.length!==5||cost.some(v=>!Number.isInteger(v)||v<0))throw Error('Recipe must have five nonnegative integer counts.');
 const w=normalize(weights),start=new Map();
 for(const h of handWorlds(known,total)){const e=h.map((v,i)=>v-known[i]),key=cost.map((c,i)=>Math.max(0,c-h[i])).join(',');start.set(key,(start.get(key)||0)+multinomial(e,w));}
 let dist=start;const cdf=[dist.get('0,0,0,0,0')||0];
 for(let k=1;k<=rolls;k++){const next=new Map();for(const [key,p] of dist){const s=key.split(',').map(Number);for(let n=2;n<=12;n++){const q=DICE[n];if(!q)continue;const pay=payouts?payouts[n]:[0,0,0,0,0],t=s.map((v,i)=>Math.max(0,v-pay[i])).join(',');next.set(t,(next.get(t)||0)+p*q);}}dist=next;cdf.push(dist.get('0,0,0,0,0')||0);}
 const median=cdf.findIndex(x=>x>=.5);
 return {cdf,atDeadline:cdf[rolls],median:median<0?null:median};
}
// How much one more card of each type raises the deadline chance: the card they most want from a trade.
function marginalCards(input){const base=capability(input).atDeadline;return R.map((name,i)=>{const known=input.known.slice();known[i]++;const p=capability({...input,known,total:input.total+1}).atDeadline;return {resource:name,index:i,p,gain:p-base};});}
const atLeastOnce=(p,rolls)=>1-Math.pow(1-p,rolls);

// ---- Forecast records: original fields are frozen at creation; only `res` changes. ----
const ORIGINAL=['id','createdAt','opp','event','detail','turns','rolls','pAfford','pChoose','p','model','evidence'];
function fingerprint(rec){const text=JSON.stringify(ORIGINAL.map(k=>rec[k]??null));let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
const prob=(x,label)=>{const v=Number(x);if(x==null||x===''||!Number.isFinite(v)||v<0||v>1)throw Error(`${label} must be a probability between 0 and 1.`);return v;};
const str=(s,n)=>String(s??'').trim().slice(0,n);
function makeForecast(input,now=new Date()){
 const opp=str(input.opp,24);if(!opp)throw Error('Name the opponent.');
 if(!EVENTS.includes(input.event))throw Error('Choose what they will do.');
 const detail=str(input.detail,300);if(input.event==='Other'&&!detail)throw Error('Describe the event so it can be judged later.');
 const turns=Number(input.turns);if(!Number.isInteger(turns)||!(turns>=1&&turns<=5))throw Error('Deadline must be 1–5 of their turns.');
 const rolls=Number(input.rolls??turns*4);if(!Number.isInteger(rolls)||!(rolls>=1&&rolls<=40))throw Error('Rolls before the deadline must be 1–40.');
 const pAfford=prob(input.pAfford,'Chance they can pay'),pChoose=prob(input.pChoose,'Chance they choose it');
 const m=input.model&&Number.isFinite(input.model.pAffordNoTrade)?{pAffordNoTrade:Math.max(0,Math.min(1,input.model.pAffordNoTrade)),assumption:str(input.model.assumption,120),rolls:Math.floor(input.model.rolls)||rolls}:null;
 const rec={id:str(input.id,40)||'f'+now.getTime().toString(36)+Math.floor(Math.random()*1e6).toString(36),createdAt:now.toISOString(),opp,event:input.event,detail,turns,rolls,pAfford,pChoose,p:pAfford*pChoose,model:m,evidence:str(input.evidence,500)};
 return {...rec,fp:fingerprint(rec),res:{outcome:'pending',afford:'unknown',note:'',at:null,history:[]}};
}
function resolveForecast(rec,{outcome,afford,note},now=new Date()){
 if(!['pending','yes','no','void'].includes(outcome))throw Error('Outcome must be pending, yes, no or void.');
 let a=['unknown','yes','no'].includes(afford)?afford:rec.res?.afford||'unknown';
 if(outcome==='yes'&&rec.event!=='Other')a='yes';// they paid the recipe, so they could pay it
 const when=now.toISOString(),next={outcome,afford:a,note:str(note??rec.res?.note,300),at:outcome==='pending'&&a==='unknown'?null:when};
 const history=Array.isArray(rec.res?.history)?rec.res.history:[];
 return {...rec,res:{...next,history:[...history,{...next,at:when}]}};
}
function sanitizeForecasts(raw){
 if(!Array.isArray(raw))return [];const out=[],seen=new Set();
 for(const f of raw){if(!f||typeof f!=='object'||typeof f.id!=='string'||seen.has(f.id)||!EVENTS.includes(f.event))continue;const nums=['pAfford','pChoose','p'].map(k=>Number(f[k]));if(nums.some(v=>!Number.isFinite(v)||v<0||v>1))continue;seen.add(f.id);
  const rec={id:f.id.slice(0,40),createdAt:str(f.createdAt,40),opp:str(f.opp,24),event:f.event,detail:str(f.detail,300),turns:Math.max(1,Math.min(5,Math.floor(f.turns)||1)),rolls:Math.max(1,Math.min(40,Math.floor(f.rolls)||4)),pAfford:nums[0],pChoose:nums[1],p:nums[2],model:f.model&&Number.isFinite(Number(f.model.pAffordNoTrade))?{pAffordNoTrade:Number(f.model.pAffordNoTrade),assumption:str(f.model.assumption,120),rolls:Math.floor(f.model.rolls)||1}:null,evidence:str(f.evidence,500)};
  const r=f.res||{},history=Array.isArray(r.history)?r.history.filter(h=>h&&['pending','yes','no','void'].includes(h.outcome)&&['unknown','yes','no'].includes(h.afford)).map(h=>({outcome:h.outcome,afford:h.afford,note:str(h.note,300),at:str(h.at,40)})):[];
  out.push({...rec,fp:typeof f.fp==='string'?f.fp.slice(0,8):'',res:{outcome:['pending','yes','no','void'].includes(r.outcome)?r.outcome:'pending',afford:['unknown','yes','no'].includes(r.afford)?r.afford:'unknown',note:str(r.note,300),at:typeof r.at==='string'?r.at.slice(0,40):null,history}});}
 return out;
}
const intact=rec=>rec.fp===fingerprint(rec);
// Server-side guard: for known ids keep the stored original and accept only the new resolution; never drop records.
function enforceImmutable(prev,next){
 const incoming=next||[],byId=new Map(incoming.map(f=>[f.id,f])),known=new Set((prev||[]).map(f=>f.id));
 if(byId.size!==incoming.length)throw Error('Duplicate forecast ID.');
 const kept=(prev||[]).map(p=>{const n=byId.get(p.id);if(!n?.res)return p;
  const oldHistory=p.res?.history||[],newHistory=n.res.history||[];
  if(newHistory.length<oldHistory.length||oldHistory.some((h,i)=>JSON.stringify(h)!==JSON.stringify(newHistory[i])))throw Error('Forecast resolution history cannot be changed.');
  const changed=JSON.stringify(n.res)!==JSON.stringify(p.res);
  if(changed){
   if(newHistory.length!==oldHistory.length+1)throw Error('A resolution change needs exactly one new history entry.');
   const last=newHistory.at(-1);
   if(!['pending','yes','no','void'].includes(last.outcome)||!['unknown','yes','no'].includes(last.afford)||!last.at||last.outcome!==n.res.outcome||last.afford!==n.res.afford||last.note!==n.res.note)throw Error('Invalid resolution history entry.');
  }
  return {...p,res:n.res};});
 const created=incoming.filter(f=>!known.has(f.id));
 if(created.some(f=>!intact(f)||f.res?.outcome!=='pending'||(f.res?.history||[]).length))throw Error('New forecast must be an intact pending commitment.');
 return [...kept,...created];
}

function wilson(x,n,z=1.96){if(!n)return [0,1];const c=(x+z*z/2)/(n+z*z),h=z*Math.sqrt(x*(n-x)/n+z*z/4)/(n+z*z);return [Math.max(0,c-h),Math.min(1,c+h)];}
function brier(pairs){const n=pairs.length;if(!n)return null;const e=pairs.map(([p,o])=>(p-o)**2),mean=sum(e)/n,sd=n>1?Math.sqrt(sum(e.map(v=>(v-mean)**2))/(n-1)):null;return {n,brier:mean,se:sd==null?null:sd/Math.sqrt(n)};}
const BINS=[[0,.2],[.2,.4],[.4,.6],[.6,.8],[.8,1.0001]];
function score(forecasts){
 const all=forecasts||[],done=all.filter(f=>f.res.outcome==='yes'||f.res.outcome==='no'),o=f=>f.res.outcome==='yes'?1:0;
 const overall=brier(done.map(f=>[f.p,o(f)])),rate=done.length?sum(done.map(o))/done.length:null;
 const bins=BINS.map(([lo,hi])=>{const b=done.filter(f=>f.p>=lo&&f.p<hi),x=sum(b.map(o));return {lo,hi:Math.min(1,hi),n:b.length,meanP:b.length?sum(b.map(f=>f.p))/b.length:null,rate:b.length?x/b.length:null,ci:wilson(x,b.length)};});
 const affordKnown=done.filter(f=>f.res.afford==='yes'||f.res.afford==='no');
 const chooseKnown=done.filter(f=>f.res.afford==='yes');
 return {total:all.length,resolved:done.length,pending:all.filter(f=>f.res.outcome==='pending').length,excluded:all.filter(f=>f.res.outcome==='void').length,
  overall,rate,hindsightConstant:rate==null?null:rate*(1-rate),coinFlip:.25,bins,
  afford:brier(affordKnown.map(f=>[f.pAfford,f.res.afford==='yes'?1:0])),
  choose:brier(chooseKnown.map(f=>[f.pChoose,o(f)])),
  enough:done.length>=10};
}
const api={R,COSTS,EVENTS,pips,DICE,parseProduction,handWorlds,handRange,affordOdds,multinomial,capability,marginalCards,atLeastOnce,ORIGINAL,fingerprint,makeForecast,resolveForecast,sanitizeForecasts,intact,enforceImmutable,wilson,score};
if(typeof module==='object'&&module.exports)module.exports=api;else global.CatanForecast=api;
})(typeof window!=='undefined'?window:globalThis);
