// Local UI harness for /history over the in-memory fake DB, signed in as one fake user. Seeds a finished
// game, a game whose first moves predate history recording (with notes and a bookmark), and an archived
// game. For manual/browser checks only:  node test/history-harness.mjs [port]
import express from 'express';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {FakeDb} from './history-fake-db.mjs';
import {HistoryService,historyRoutes} from '../lib/game-history.mjs';
import {renderHistory} from '../lib/history-page.mjs';
import {GameStore} from '../lib/game-store.mjs';
import {gameRoutes} from '../lib/game-routes.mjs';
import {renderGame} from '../lib/game-page.mjs';
import {createMatch,legalActions} from '../game/rules.mjs';
const A='11111111-1111-4111-8111-111111111111',db=new FakeDb(),store=new GameStore(db);
process.env.SITE_URL||='http://127.0.0.1';
async function game(title,seed,names=['You','Ada','Brook','Cass']){const id=randomUUID();await db.from('catan_games').insert({id,owner_id:A,title,state:createMatch({id,names,seed})}).select('*').single();return id;}
function choose(s){
 const owe=Object.entries(s.pendingDiscards||{}).filter(([,n])=>n>0).map(([k])=>+k);
 if(s.turnPhase==='discard'&&owe.length){const seat=owe[0],c=legalActions(s,seat).choices.discard,r={};let k=c.count;for(const res of Object.keys(c.hand)){const t=Math.min(c.hand[res],k);if(t){r[res]=t;k-=t;}}return [seat,{type:'discard',resources:r}];}
 const L=legalActions(s,s.current).actions,roads=Object.values(s.roads).filter(o=>o===s.current).length;
 for(const t of ['roll','build_city','build_settlement','move_robber','buy_dev_card',roads<2+2*s.turn/8?'build_road':null,'end_road_building','end_turn']){const a=L.find(x=>x.type===t);if(a)return [s.current,a];}
 return [s.current,L[0]];
}
async function play(id,n){for(let i=0;i<n;i++){const row=await store.owned(id,A);if(row.state.phase==='finished')return;const [seat,a]=choose(row.state);await store.act(row,seat,row.revision,a);}}
const finished=await game('Friday table',4);await play(finished,3000);
db.recording=false;const legacy=await game('Board practice <b>',12,['You','Opus A','Opus B','Opus C']);await play(legacy,25);db.recording=true;await play(legacy,40);
const svc=new HistoryService({userId:A,db});
await svc.createNote(legacy,{revision:30,kind:'prediction',body:'Opus B goes for ore next.\n<img src=x onerror=alert(1)>'});
await svc.createNote(legacy,{revision:30,kind:'note',body:'Should have taken the 3:1 harbor.'});
await svc.createNote(legacy,{revision:40,kind:'bookmark'});
const old=await game('Tuesday warmup',2);await play(old,20);db.tables.catan_games.find(r=>r.id===old).archived_at=new Date().toISOString();
const app=express();app.use(express.json());
app.use((req,res,next)=>{req.user={id:A,email:'harness@example.com'};next();});
app.use('/dashboard-assets',express.static(fileURLToPath(new URL('../public',import.meta.url))));
historyRoutes(app,{makeService:userId=>new HistoryService({userId,db})});
gameRoutes(app,()=>new GameStore(db));
app.get(['/history','/history/:id'],renderHistory);
app.get(['/game','/game/:id'],renderGame);
const port=Number(process.argv[2]||8793);
app.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/history`,finished,legacy,old})));
