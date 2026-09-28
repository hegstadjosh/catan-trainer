(function(global){
'use strict';
const names=['Wood','Brick','Sheep','Wheat','Ore'];
const costs={Road:[1,1,0,0,0],Settlement:[1,1,1,1,0],City:[0,0,0,2,3],'Development card':[0,0,1,1,1]};
const deck=[14,5,2,2,2],types=['Knight','Victory point','Road Building','Year of Plenty','Monopoly'];
const sum=a=>a.reduce((s,x)=>s+x,0);
function choose(n,k){if(!Number.isInteger(n)||!Number.isInteger(k)||n<0||k<0||k>n)return 0;k=Math.min(k,n-k);let v=1;for(let i=1;i<=k;i++)v=v*(n-k+i)/i;return v;}
function tail(N,K,n,r){if(r<=0)return 1;if(n<r||K<r||N<1)return 0;n=Math.min(n,N);let p=0;for(let j=r;j<=Math.min(K,n);j++)p+=choose(K,j)*choose(N-K,n-j)/choose(N,n);return Math.max(0,Math.min(1,p));}
function jointTail(n,rk,rv){let p=0;for(let k=rk;k<=Math.min(14,n);k++)for(let v=rv;v<=Math.min(5,n-k);v++)p+=choose(14,k)*choose(5,v)*choose(6,n-k-v)/choose(25,n);return Math.max(0,Math.min(1,p));}
function expectedBoth(rk,rv){if(!rk&&!rv)return 0;let e=0;for(let n=0;n<25;n++)e+=1-jointTail(n,rk,rv);return e;}
function expectedDraws(N,K,r){return r===0?0:K<r?Infinity:r*(N+1)/(K+1);}
function quantile(N,K,r,p){for(let n=0;n<=N;n++)if(tail(N,K,n,r)>=p-1e-12)return n;return Infinity;}
function bankPlan(hand,cost,ratios){
 const missing=cost.map((c,i)=>Math.max(0,c-hand[i]));
 const slots=hand.map((h,i)=>Math.floor(Math.max(0,h-cost[i])/ratios[i]));
 if(sum(missing)>sum(slots))return {ready:false,missing,trades:[]};
 const trades=[];
 for(let to=0;to<5;to++)for(let from=0;from<5&&missing[to]>0;from++){
  const n=Math.min(missing[to],slots[from]);if(n){trades.push({from,to,give:n*ratios[from],get:n});slots[from]-=n;missing[to]-=n;}
 }
 return {ready:true,missing,trades};
}
function flowTime(hand,mu,cost,ratios){
 const feasible=t=>{let needed=0,available=0;for(let i=0;i<5;i++){const balance=hand[i]+t*mu[i]-cost[i];if(balance>=0)available+=balance/ratios[i];else needed-=balance;}return available+1e-10>=needed;};
 if(feasible(0))return 0;if(sum(mu)===0)return Infinity;
 let lo=0,hi=1;while(!feasible(hi)&&hi<1e7)hi*=2;if(!feasible(hi))return Infinity;
 for(let n=0;n<60;n++){const mid=(lo+hi)/2;if(feasible(mid))hi=mid;else lo=mid;}return hi;
}
const routeSpecs=[
 ['Buildings only',2,4,0,0,0],['Wide expansion',4,3,0,0,0],
 ['Four cities + road',0,4,1,0,0],['Expansion + road',2,3,1,0,0],['Wide + road',4,2,1,0,0],
 ['Four cities + army',0,4,0,1,0],['Expansion + army',2,3,0,1,0],
 ['Three cities + both',0,3,1,1,0],['Two cities + both',2,2,1,1,0],
 ['Four cities + 2 hidden VP',0,4,0,0,2],['Road + 1 hidden VP',1,3,1,0,1],['Army + 1 hidden VP',1,3,0,1,1]
];
const routes=routeSpecs.map(([name,s,c,l,a,v])=>{const n=s+c-2,base=4*n+5*c;return {name,s,c,l,a,v,n,base,minimumDraws:3*a+v,meanDraws:expectedBoth(3*a,v),vp:s+2*c+2*l+2*a+v};});
const e=(t,type,note='',vp=0)=>({t,type,note,vp});
const schedules=[
 {name:'Expansion + Longest Road',events:[e(1,'Road'),e(2,'Road'),e(3,'Settlement'),e(5,'Road'),e(6,'Road'),e(7,'Settlement'),e(9,'Road'),e(10,'Road'),e(11,'Settlement'),e(13,'City'),e(15,'Road'),e(17,'City'),e(20,'Road'),e(20,'Award','Take Longest Road',2),e(23,'City')]},
 {name:'Cities + Largest Army',events:[e(3,'City'),e(5,'Development card','Draw knight'),e(6,'Play','Play knight 1'),e(7,'City'),e(8,'Road'),e(9,'Road'),e(10,'Settlement'),e(11,'Development card','Draw knight'),e(12,'Play','Play knight 2'),e(13,'City'),e(14,'Development card','Progress card; unused'),e(15,'Road'),e(16,'Road'),e(17,'Settlement'),e(18,'Development card','Draw knight'),e(19,'Play','Play knight 3; take Largest Army',2),e(20,'Development card','Progress card; unused'),e(21,'Development card','Knight; unused'),e(24,'City')]},
 {name:'Cities + hidden points',events:[e(2,'Road'),e(3,'Road'),e(4,'Settlement'),e(6,'City'),e(8,'Development card','Knight; unused'),e(9,'Road'),e(10,'Road'),e(11,'Settlement'),e(13,'City'),e(15,'Development card','Progress card; unused'),e(17,'City'),e(19,'Road'),e(20,'Development card','Draw victory point',1),e(24,'City'),e(24,'Development card','Draw victory point',1)]}
];
const trajectories=schedules.map(path=>{
 let total=[0,0,0,0,0],vp=2,s=2,c=0,r=2;const rows=[];
 for(let t=0;t<=24;t++){
  const actions=path.events.filter(a=>a.t===t),spent=[0,0,0,0,0];
  for(const a of actions){(costs[a.type]||[0,0,0,0,0]).forEach((v,i)=>spent[i]+=v);if(a.type==='City'){s--;c++;vp++;}if(a.type==='Settlement'){s++;vp++;}if(a.type==='Road')r++;vp+=a.vp;}
  total=total.map((v,i)=>v+spent[i]);rows.push({t,total:[...total],spent,vp,s,c,r,actions});
 }return {...path,rows};
});
function bankRates(generic,specific){return specific.map(owned=>owned?2:generic?3:4);}
function budget(n,c,r,d){return [n+r,n+r,n+d,n+2*c+d,3*c+d];}
const quant=typeof module==='object'&&module.exports?require('./quant-math.js'):global.CatanQuant;
const api={names,costs,deck,types,sum,choose,tail,jointTail,expectedBoth,expectedDraws,quantile,bankPlan,flowTime,routes,trajectories,budget,bankRates,...quant};
if(typeof module==='object'&&module.exports)module.exports=api;else global.CatanMath=api;
})(typeof window!=='undefined'?window:globalThis);
