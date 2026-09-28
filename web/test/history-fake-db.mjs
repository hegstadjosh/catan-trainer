// In-memory stand-in for the supabase-js calls used by GameStore, DirectorService and HistoryService.
// Emulates the catan_commit_move RPC and the catan_capture_snapshot trigger from the history migration.
// Set db.recording=false to emulate a game played before that migration (no snapshots written).
// Not a test file itself (no .test. in the name).
import {randomUUID} from 'node:crypto';
const KEYS={catan_game_seats:['game_id','seat'],catan_game_observers:['game_id'],catan_games:['id'],catan_game_snapshots:['game_id','revision']};
const now=()=>new Date().toISOString();
class Query{
 constructor(db,table){Object.assign(this,{db,table,filters:[],op:'select',returning:false});}
 select(){if(this.op!=='select')this.returning=true;return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
 gt(k,v){this.filters.push(r=>r[k]>v);return this;}
 lte(k,v){this.filters.push(r=>r[k]<=v);return this;}
 order(k,{ascending=true}={}){this.sort=[k,ascending];return this;}
 limit(n){this.max=n;return this;}
 insert(row){this.op='insert';this.row=row;return this;}
 upsert(row){this.op='upsert';this.row=row;return this;}
 update(patch){this.op='update';this.patch=patch;return this;}
 delete(){this.op='delete';return this;}
 maybeSingle(){this.one='maybe';return this;}
 single(){this.one='single';return this;}
 run(){
  const db=this.db,rows=db.tables[this.table]??=[];
  db.calls.push({table:this.table,op:this.op});
  if(this.op==='insert'){
   const base=this.table==='catan_games'?{revision:1,created_at:now(),updated_at:now(),archived_at:null,branched_from:null,branched_from_revision:null}
    :this.table==='catan_game_notes'?{id:randomUUID(),version:1,created_at:now(),updated_at:now()}
    :this.table==='catan_decision_attempts'?{id:randomUUID(),evaluation:null,revealed_at:null,created_at:now()}:{};
   const row={...base,...structuredClone(this.row)};rows.push(row);
   if(this.table==='catan_games')db.capture(null,row);
   return {data:structuredClone(row),error:null};
  }
  if(this.op==='upsert'){const key=KEYS[this.table],i=rows.findIndex(r=>key.every(k=>r[k]===this.row[k]));if(i>=0)rows[i]={...rows[i],...this.row};else rows.push({...this.row});return {data:null,error:null};}
  let hit=rows.filter(r=>this.filters.every(f=>f(r)));
  if(this.op==='update'){
   for(const r of hit){const old=structuredClone(r);Object.assign(r,structuredClone(this.patch));if(this.table==='catan_games'&&'state' in this.patch)db.capture(old,r);}
   hit=structuredClone(hit);
   return {data:this.returning?(this.one?hit[0]??null:hit):null,error:null};
  }
  if(this.op==='delete'){
   db.tables[this.table]=rows.filter(r=>!hit.includes(r));
   return {data:this.returning?(this.one?structuredClone(hit[0]??null):structuredClone(hit)):null,error:null};
  }
  if(this.sort){const [k,asc]=this.sort;hit=hit.toSorted((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*(asc?1:-1));}
  if(this.max)hit=hit.slice(0,this.max);
  hit=structuredClone(hit);
  return {data:this.one?hit[0]??null:hit,error:null};
 }
 then(ok,bad){return Promise.resolve().then(()=>this.run()).then(ok,bad);}
}
export class FakeDb{
 tables={};calls=[];recording=true;
 from(t){return new Query(this,t);}
 // Mirrors public.catan_capture_snapshot(): state without log, plus the log entries this revision
 // appended, or the whole log with log_reset when the log was rewritten or no previous snapshot exists.
 capture(old,row){
  if(!this.recording)return;
  const {log=[],...state}=structuredClone(row.state);
  const snaps=this.tables.catan_game_snapshots??=[];
  const oldLog=old?.state?.log||[],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  let reset=true,k=0;
  if(old&&row.revision>old.revision&&snaps.some(s=>s.game_id===old.id&&s.revision===old.revision)){
   for(k=Math.min(oldLog.length,log.length);k>=0;k--)if(same(log.slice(0,k),oldLog.slice(oldLog.length-k)))break;
   reset=!(k===oldLog.length||log.length===200);
  }
  const i=snaps.findIndex(s=>s.game_id===row.id&&s.revision===row.revision);
  const snap={game_id:row.id,revision:row.revision,state,log_added:reset?log:log.slice(k),log_reset:reset,created_at:now()};
  if(i>=0)snaps[i]=snap;else snaps.push(snap);
 }
 rpc(name,a){const db=this;return {maybeSingle:()=>Promise.resolve().then(()=>{
  const g=db.tables.catan_games.find(r=>r.id===a.p_game_id&&r.revision===a.p_expected_revision&&!r.archived_at);
  if(!g)return {data:null,error:null};
  const old=structuredClone(g);
  Object.assign(g,{state:structuredClone(a.p_state),revision:g.revision+1,updated_at:now()});
  (db.tables.catan_game_events??=[]).push({game_id:g.id,revision:g.revision,payload:structuredClone(a.p_event),created_at:g.updated_at});
  db.capture(old,g);
  return {data:structuredClone(g),error:null};})};}
}
