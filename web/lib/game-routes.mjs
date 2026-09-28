import {GameStore,GameStoreError,gameFailure} from './game-store.mjs';
const seatParam=v=>/^[123]$/.test(v)?Number(v):0;
const body=q=>{if(q.body!=null&&(typeof q.body!=='object'||Array.isArray(q.body)))throw new GameStoreError('Send a JSON object.');return q.body??{};};
async function timed(res,name,operation){
 const start=performance.now();
 try{return await operation();}
 finally{res.append('Server-Timing',`${name};dur=${(performance.now()-start).toFixed(1)}`);}
}
export function gameRoutes(app,makeStore=()=>new GameStore()){
 const handler=fn=>async(req,res)=>{try{await fn(req,res,makeStore());}catch(e){const f=gameFailure(e);res.status(f.status).json({error:f.error,...(f.code&&{code:f.code})});}};
 app.post('/api/games/:id/sidekick/connection',handler(async(q,r,s)=>r.json(await s.observerConnection(await s.owned(q.params.id,q.user.id)))));
 app.delete('/api/games/:id/sidekick/connection',handler(async(q,r,s)=>{await s.revokeObserver(await s.owned(q.params.id,q.user.id));r.json({revoked:true});}));
 app.get('/api/games',handler(async(q,r,s)=>r.json({games:await s.list(q.user.id)})));
 app.post('/api/games',handler(async(q,r,s)=>r.status(201).json({game:await s.present(await s.create(q.user.id,body(q)),0,true)})));
 app.get('/api/games/:id',handler(async(q,r,s)=>{
  const row=await timed(r,'game_load',()=>s.owned(q.params.id,q.user.id));
  const game=await timed(r,'game_present',()=>s.present(row,0,true));
  r.json({game});
 }));
 app.post('/api/games/:id/actions',handler(async(q,r,s)=>{
  const row=await timed(r,'game_load',()=>s.owned(q.params.id,q.user.id));
  const input=body(q);
  const a=await timed(r,'game_action',()=>s.act(row,0,input.expectedRevision,input.action));
  const game=await timed(r,'game_present',()=>s.present(a.row,0,true));
  r.json({game,result:a.result});
 }));
 app.delete('/api/games/:id',handler(async(q,r,s)=>{await s.archive(await s.owned(q.params.id,q.user.id));r.json({deleted:true});}));
 app.post('/api/games/:id/seats/:seat/connection',handler(async(q,r,s)=>r.json(await s.connection(await s.owned(q.params.id,q.user.id),seatParam(q.params.seat)))));
 app.delete('/api/games/:id/seats/:seat/connection',handler(async(q,r,s)=>{await s.revoke(await s.owned(q.params.id,q.user.id),seatParam(q.params.seat));r.json({revoked:true});}));
}
