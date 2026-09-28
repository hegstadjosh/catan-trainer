// Opponent hand tracker and table math for the Catan game page. Uses only what the human seat's view shows:
// public counts, the bank, the board, your own hand and the log text. Never sees hidden hands.
// Works in the browser (window.CatanTracker) and in Node tests (module.exports).
(function(root){'use strict';
const RES=['brick','lumber','wool','grain','ore'];
const COST={road:{brick:1,lumber:1},settlement:{brick:1,lumber:1,wool:1,grain:1},city:{grain:2,ore:3},dev:{wool:1,grain:1,ore:1}};
const TOTAL=19;
const WAYS={2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
const zero=()=>({brick:0,lumber:0,wool:0,grain:0,ore:0});
const sum=v=>RES.reduce((s,r)=>s+(v[r]||0),0);
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// "2 brick, 1 ore" (the engine's vecText) -> vector
function parseVec(text){
 const v=zero();if(!text||text==='nothing')return v;
 for(const part of text.split(/,\s*/)){const m=/^(\d+) (brick|lumber|wool|grain|ore)$/.exec(part.trim());if(!m)return null;v[m[2]]+=Number(m[1]);}
 return v;
}

// One tracked opponent: min = cards known to be in hand, unknown = cards of unknown type.
function blank(total){return {min:zero(),unknown:total||0};}
function gain(t,vec){RES.forEach(r=>{t.min[r]+=vec[r]||0;});}
// Paying a known cost: those cards must have been there, from known or unknown cards.
function spend(t,vec){RES.forEach(r=>{const n=vec[r]||0,fromKnown=Math.min(n,t.min[r]);t.min[r]-=fromKnown;t.unknown-=n-fromKnown;});if(t.unknown<0)t.bad=true;}
// Losing n cards of unknown type (discard, being robbed): any known card might be among them.
function loseHidden(t,n){
 const before=sum(t.min)+t.unknown;
 RES.forEach(r=>{if(t.min[r]>0&&t.none)delete t.none[r];t.min[r]=Math.max(0,t.min[r]-n);}); // demoted known cards may now be among the unknown ones
 t.unknown=Math.max(0,before-n-sum(t.min));
}
function gainHidden(t,n){t.unknown+=n;}

function create(){return {seats:{},lastSeq:-1,since:null,complete:false,resets:[]};}

// Feed a new view. Processes log entries not seen before, then reconciles with the exact public counts.
function update(st,view){
 const me=view.mySeat,players=view.players||[];
 const names=players.map(p=>({seat:p.seat,name:p.name})).sort((a,b)=>b.name.length-a.name.length);
 const seatOf=name=>{const n=names.find(x=>x.name===name);return n?n.seat:null;};
 const log=view.log||[];
 const fresh=log.filter(e=>e.seq>st.lastSeq);
 if(st.lastSeq<0){
  // First view: tracking is complete only if the log still holds the first entry of the game.
  st.complete=log.length>0&&/Setup begins\.$/.test(log[0].text)&&log[0].seq<=1;
  st.since=log.length?log[0].seq:view.seq;
  players.forEach(p=>{if(p.seat!==me)st.seats[p.seat]=blank(st.complete?0:p.resourceCount);});
  if(!st.complete){st.since=view.seq;st.lastSeq=view.seq;fresh.length=0;}
 }else if(fresh.length&&log[0].seq>st.lastSeq+1){
  // Entries fell out of the window between polls: start over from the exact counts.
  players.forEach(p=>{if(p.seat!==me)st.seats[p.seat]=blank(p.resourceCount);});
  st.resets.push({seq:view.seq,why:'missed history'});fresh.length=0;
 }
 const T=s=>s===me?null:st.seats[s];
 const namesAlt=names.map(n=>esc(n.name)).join('|');
 for(const e of fresh){
  const text=e.text||'',a=e.seat,ta=a!=null?T(a):null;let m;
  if((m=/ placed a settlement and took (.+)\.$/.exec(text))&&ta){const v=parseVec(m[1]);if(v)gain(ta,v);}
  else if(/ rolled \d+\. /.test(text)){
   const body=text.replace(/^.* rolled \d+\. /,'').replace(/ Bank short of .*$/,'').replace(/\.$/,'');
   if(body!=='No production'){
    const re=new RegExp(`(${namesAlt}) got ((?:\\d+ (?:brick|lumber|wool|grain|ore)(?:, )?)+)`,'g');
    let g;while((g=re.exec(body))){const t=T(seatOf(g[1]));const v=parseVec(g[2].replace(/, $/,''));if(t&&v)gain(t,v);}
   }
  }
  else if(/ built a road\.$/.test(text)&&ta)spend(ta,COST.road);
  else if(/ built a settlement\.$/.test(text)&&ta)spend(ta,COST.settlement);
  else if(/ built a city\.$/.test(text)&&ta)spend(ta,COST.city);
  else if(/ bought a (development card|.+ card)\.$/.test(text)&&ta)spend(ta,COST.dev);
  else if((m=/ discarded (\d+) cards\.$/.exec(text))&&ta)loseHidden(ta,Number(m[1]));
  else if((m=new RegExp(`^(${namesAlt}) stole 1 (brick|lumber|wool|grain|ore) from (${namesAlt})\\.$`).exec(text))){
   // Private text: you were the thief or the victim, so the card is known.
   const thief=T(seatOf(m[1])),victim=T(seatOf(m[3])),v={...zero(),[m[2]]:1};
   if(thief)gain(thief,v);if(victim)spend(victim,v);
  }
  else if((m=new RegExp(` moved the robber and stole a card from (${namesAlt})\\.$`).exec(text))){
   const victim=T(seatOf(m[1]));if(victim)loseHidden(victim,1);if(ta)gainHidden(ta,1);
  }
  else if((m=/ played Year of Plenty for (.+)\.$/.exec(text))&&ta){const v=parseVec(m[1]);if(v)gain(ta,v);}
  else if((m=/ played Monopoly on (brick|lumber|wool|grain|ore) and took (\d+)\.$/.exec(text))){
   const r=m[1];
   Object.entries(st.seats).forEach(([s,t])=>{if(Number(s)!==a){t.min[r]=0;t.none={...(t.none||{}),[r]:true};}});
   if(ta)gain(ta,{...zero(),[r]:Number(m[2])});
  }
  else if((m=/ traded (\d+) (brick|lumber|wool|grain|ore) to the bank for 1 (brick|lumber|wool|grain|ore)\.$/.exec(text))&&ta){spend(ta,{...zero(),[m[2]]:Number(m[1])});gain(ta,{...zero(),[m[3]]:1});}
  else if((m=new RegExp(`^(${namesAlt}) accepted: (${namesAlt}) gave (.+) for (.+)\\.$`).exec(text))){
   const acc=T(seatOf(m[1])),from=T(seatOf(m[2])),give=parseVec(m[3]),get=parseVec(m[4]);
   if(give&&get){if(from){spend(from,give);gain(from,get);}if(acc){spend(acc,get);gain(acc,give);}}
  }
  // A stolen card of unknown type clears "known to hold none of" facts for the thief.
  if(ta&&/stole a card/.test(text))delete ta.none;
 }
 if(log.length)st.lastSeq=Math.max(st.lastSeq,log[log.length-1].seq);
 // Reconcile with exact public counts.
 players.forEach(p=>{
  if(p.seat===me)return;const t=st.seats[p.seat]||(st.seats[p.seat]=blank(p.resourceCount));
  const known=sum(t.min),u=p.resourceCount-known;
  if(t.bad||u<0){st.seats[p.seat]=blank(p.resourceCount);st.resets.push({seq:view.seq,seat:p.seat,why:'counts disagreed'});}
  else t.unknown=u;
 });
 return st;
}

// Bounds per opponent and resource, using bank conservation: opponents together hold exactly 19 - bank - yours of each.
function summary(st,view){
 const me=view.mySeat,bank=view.bank||{},mine=(view.me&&view.me.resources)||{};
 const pooled={},slack={};
 RES.forEach(r=>{pooled[r]=TOTAL-(bank[r]||0)-(mine[r]||0);});
 const opps=(view.players||[]).filter(p=>p.seat!==me);
 RES.forEach(r=>{slack[r]=pooled[r]-opps.reduce((s,p)=>s+((st.seats[p.seat]||blank()).min[r]||0),0);});
 const seats={};
 opps.forEach(p=>{
  const t=st.seats[p.seat]||blank(p.resourceCount),range={};
  RES.forEach(r=>{const cap=t.none&&t.none[r]?0:Math.min(t.unknown,Math.max(0,slack[r]));range[r]={min:t.min[r],max:t.min[r]+cap};});
  // If every other resource is pinned, the unknown cards must be the remaining ones.
  const free=RES.filter(r=>range[r].max>range[r].min);
  if(free.length===1)range[free[0]].min=range[free[0]].max=t.min[free[0]]+t.unknown;
  seats[p.seat]={total:p.resourceCount,unknown:t.unknown,range,exact:t.unknown===0||RES.every(r=>range[r].min===range[r].max)};
 });
 return {pooled,slack,seats,complete:st.complete,since:st.since,resets:st.resets.slice(-3)};
}

// ---------- Production and probability ----------
function production(view){
 const b=view.board;if(!b)return {};
 const hx=new Map(b.hexes.map(x=>[x.id,x])),out={};
 (view.players||[]).forEach(p=>{out[p.seat]={pips:zero(),numbers:{},total:0};});
 b.vertices.forEach(v=>{
  if(!v.building||v.owner==null||!out[v.owner])return;
  const units=v.building==='city'?2:1;
  v.hexes.forEach(id=>{const x=hx.get(id);if(!x||!x.resource||!x.number||x.robber||id===view.robberHex)return;
   const o=out[v.owner];o.pips[x.resource]+=(WAYS[x.number]||0)*units;o.total+=(WAYS[x.number]||0)*units;
   (o.numbers[x.resource]||(o.numbers[x.resource]=new Set())).add(x.number);});
 });
 Object.values(out).forEach(o=>{o.perRoll=o.total/36;o.chance={};RES.forEach(r=>{const ns=o.numbers[r]?[...o.numbers[r]]:[];o.chance[r]=ns.reduce((s,n)=>s+WAYS[n],0)/36;});});
 return out;
}
// Rolls before your next turn starts (the other players' rolls), from the turn order.
function rollsUntilMyTurn(view){
 const order=view.order||[],n=order.length||4,me=view.mySeat,cur=view.currentSeat;
 const i=order.indexOf(cur),j=order.indexOf(me);if(i<0||j<0)return n-1;
 let k=(j-i+n)%n;
 if(k===0)return view.turnPhase==='roll'?0:n-1;
 return view.turnPhase==='roll'?k:k-1; // the current player's roll is still to come if they have not rolled
}
const atLeastOnce=(p,k)=>1-Math.pow(1-p,k);

const api={RES,COST,WAYS,parseVec,create,update,summary,production,rollsUntilMyTurn,atLeastOnce};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CatanTracker=api;
})(typeof window!=='undefined'?window:globalThis);
