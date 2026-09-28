// In-memory PostgREST fake shared by the dashboard tests: mimics RLS (rows visible only to the client's uid),
// the revision/limit trigger and dashboard_show. Not a test file itself (no .test. in the name).
export function fakeDb(){
 const tables={dashboard_pages:[],dashboard_view:[]};let clock=0;
 const stamp=()=>new Date(Date.UTC(2026,8,22,0,0,clock++)).toISOString();
 function client(uid){
  const visible=t=>tables[t].filter(r=>r.user_id===uid);
  function query(table){
   const filters=[];let op={type:'select'},order,cols;
   const q={
    select(c){cols=c;return q;},insert(v){op={type:'insert',v};return q;},update(v){op={type:'update',v};return q;},
    eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},
    not(k,o,v){filters.push(r=>(r[k]??null)!==v);return q;},order(k,{ascending}){order=[k,ascending];return q;},limit(){return q;},
    maybeSingle(){return run(true);},single(){return run(true,true);},then(res,rej){return run(false).then(res,rej);}
   };
   const project=r=>cols?Object.fromEntries(cols.split(',').map(k=>[k,k==='component_count'?r.components.length:structuredClone(r[k]??null)])):r;
   async function run(one,required){
    if(op.type==='insert'){
     const active=visible(table).filter(r=>!r.deleted_at).length;
     if(active>=20)return {data:null,error:{code:'CT429',message:'Page limit reached: at most 20 pages. Delete one first.'}};
     const row={id:crypto.randomUUID(),user_id:uid,revision:1,created_at:stamp(),updated_at:stamp(),deleted_at:null,...structuredClone(op.v)};
     tables[table].push(row);return {data:project(row),error:null};
    }
    let rows=visible(table).filter(r=>filters.every(f=>f(r)));
    if(op.type==='update'){rows.forEach(r=>Object.assign(r,structuredClone(op.v),{revision:r.revision+1,updated_at:stamp()}));}
    if(order)rows=[...rows].sort((a,b)=>(a[order[0]]<b[order[0]]?-1:1)*(order[1]?1:-1));
    if(one){if(rows.length>1)return {data:null,error:{code:'PGRST116'}};if(required&&!rows.length)return {data:null,error:{code:'PGRST116'}};return {data:rows[0]?project(rows[0]):null,error:null};}
    return {data:rows.map(project),error:null};
   }
   return q;
  }
  return {from:query,async rpc(name,{p_page_id,p_component_id,p_actor}){
   const page=visible('dashboard_pages').find(p=>p.id===p_page_id&&!p.deleted_at);
   if(!page||(p_component_id&&!page.components.some(c=>c.id===p_component_id)))return {data:null,error:{code:'CT404'}};
   let v=tables.dashboard_view.find(r=>r.user_id===uid);
   if(!v)tables.dashboard_view.push(v={user_id:uid,seq:0});
   Object.assign(v,{page_id:p_page_id,component_id:p_component_id,actor:p_actor,seq:v.seq+1,issued_at:stamp()});
   return {data:{seq:v.seq,issuedAt:v.issued_at},error:null};
  }};
 }
 return {tables,client};
}
