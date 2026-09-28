// Offline tests for dashboard schema, store, REST routes and MCP. A small in-memory PostgREST fake
// mimics RLS (rows visible only to the client's uid), the revision/limit trigger and dashboard_show.
// Live RLS against Supabase is covered by the parent's live harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {componentInput,MODEL_NAMES} from '../lib/dashboard-schema.mjs';
import {defaultModels} from '../lib/dashboard-store.mjs';
import {DashboardStore} from '../lib/dashboard-store.mjs';
import {dashboardRoutes} from '../lib/dashboard-routes.mjs';
import {mcpRoutes} from '../lib/mcp.mjs';
import {resolveMcpPrincipal} from '../lib/mcp-auth.mjs';
import {fakeDb} from './dashboard-fake-db.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const source={label:'Sept 20 game log'};
const chart={kind:'chart',title:'Income',spec:{type:'bar',x:['Wood','Ore'],series:[{name:'Me',values:[3,null]}]},source};

const siteUrl='https://catan.test';
const storeFor=(db,uid,actor='user')=>new DashboardStore({db:db.client(uid),userId:uid,actor,siteUrl});

test('component schema enforces the UX envelope, provenance and limits',()=>{
 assert.ok(componentInput.safeParse(chart).success);
 const bad=[
  {...chart,source:undefined},                                                       // agent data needs a source
  {...chart,spec:{...chart.spec,series:[{name:'Me',values:[1]}]}},                 // length mismatch
  {...chart,spec:{...chart.spec,series:Array.from({length:7},(_,i)=>({name:'s'+i,values:[1,2]}))}},
  {...chart,spec:{...chart.spec,x:Array.from({length:41},(_,i)=>i),series:[{name:'a',values:Array(41).fill(1)}]}}, // >40 bars
  {...chart,title:'bad\u0007title'},{...chart,extra:1},{...chart,spec:{...chart.spec,color:'red'}},
  {...chart,spec:{...chart.spec,series:[{name:'Me',values:[Infinity,1]}]}},
  {kind:'stat',title:'Big',spec:{items:[{label:'x',value:2e12}]},source},
  {kind:'table',title:'T',spec:{columns:['a','b'],rows:[[1]]},source},
  {kind:'model',title:'M',spec:{model:'nope',params:{}}},
  {kind:'html',title:'X',spec:{}}
 ];
 for(const c of bad)assert.equal(componentInput.safeParse(c).success,false,JSON.stringify(c));
 const note=componentInput.parse({kind:'note',title:'  Plan  ',spec:{text:'<script>alert(1)</script>\n\nplain text'}});
 assert.equal(note.title,'Plan');assert.match(note.spec.text,/<script>/);
});

test('store: create, resolve models, stamp provenance, full-replace keeps createdBy',async()=>{
 const db=fakeDb(),agent=storeFor(db,A,'agent'),user=storeFor(db,A,'user');
 const page=await agent.createPage({title:'Odds',components:[{kind:'model',title:'Dice',spec:{model:'dice_odds',params:{highlight:[6,8,9]}}},chart]});
 assert.equal(page.revision,1);assert.equal(page.url,siteUrl+'/dashboard/'+page.id);
 const [dice,income]=page.components;
 assert.match(dice.computed.takeaway,/39%/);assert.equal(dice.computed.view.kind,'chart');assert.equal(dice.size,'half');
 assert.equal(dice.createdBy,'agent');assert.match(income.id,/^c_[a-z0-9]{10}$/);
 assert.equal((await agent.createPage({title:'x',components:[{...chart,id:'a'},{...chart,id:'a'}]}).catch(e=>e)).code,'invalid');
 assert.match((await agent.createPage({title:'x',components:[{kind:'model',title:'D',spec:{model:'dice_odds',params:{highlight:[1]}}}]}).catch(e=>e)).message,/highlight\[0\] must be 2–12/);
 // UI echoes resolved components (with server fields) and renames one: createdBy stays agent.
 const edited=await user.updatePage(page.id,{expectedRevision:1,components:[{...income,title:'Income v2'},dice]});
 assert.equal(edited.revision,2);assert.deepEqual(edited.components.map(c=>c.id),[income.id,dice.id]);
 assert.equal(edited.components[0].createdBy,'agent');assert.equal(edited.components[1].updatedAt,dice.updatedAt);
 const added=await user.addComponent(page.id,{expectedRevision:2,component:{kind:'note',title:'Mine',spec:{text:'hi'}},index:0});
 assert.equal(added.page.components[0].createdBy,'user');assert.equal(added.component.title,'Mine');
 const moved=await user.moveComponent(page.id,{expectedRevision:3,componentId:added.component.id,index:9});
 assert.equal(moved.components.at(-1).id,added.component.id);
 const upd=await agent.updateComponent(page.id,{expectedRevision:4,componentId:dice.id,changes:{spec:{model:'dice_odds',params:{highlight:[5]}},size:'full'}});
 assert.equal(upd.component.size,'full');assert.match(upd.component.computed.takeaway,/11%|4 of 36/);
 assert.equal((await agent.updateComponent(page.id,{expectedRevision:5,componentId:dice.id,changes:{kind:'note'}}).catch(e=>e)).code,'invalid');
 const removed=await agent.removeComponent(page.id,{expectedRevision:5,componentId:income.id});
 assert.equal(removed.components.length,2);
 const starter=await user.createStarterPage();
 assert.equal(starter.components.length,5);assert.ok(starter.components.every(c=>c.computed&&!c.invalid));
});

test('store: compare-and-swap conflicts return the current page',async()=>{
 const db=fakeDb(),s=storeFor(db,A);
 const p=await s.createPage({title:'CAS'});
 const results=await Promise.allSettled([s.updatePage(p.id,{expectedRevision:1,title:'one'}),s.updatePage(p.id,{expectedRevision:1,title:'two'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const conflict=results.find(r=>r.status==='rejected').reason;
 assert.equal(conflict.code,'conflict');assert.equal(conflict.extra.currentRevision,2);assert.equal(conflict.extra.page.revision,2);
 assert.equal((await s.addComponent(p.id,{expectedRevision:1,component:chart}).catch(e=>e)).code,'conflict');
 assert.equal((await s.updatePage(p.id,{expectedRevision:0,title:'x'}).catch(e=>e)).code,'invalid');
});

test('store: isolation, malformed ids and archived pages all read as not_found',async()=>{
 const db=fakeDb(),a=storeFor(db,A,'agent'),b=storeFor(db,B,'agent');
 const p=await a.createPage({title:'Private',components:[{...chart,id:'c1'}]});
 const nf=async fn=>assert.equal((await fn().catch(e=>e)).code,'not_found');
 for(const id of [p.id,'not-a-uuid','',"1' or 1=1",undefined]){
  await nf(()=>b.getPage(id));await nf(()=>b.updatePage(id,{expectedRevision:1,title:'x'}));
  await nf(()=>b.addComponent(id,{expectedRevision:1,component:chart}));await nf(()=>b.removeComponent(id,{expectedRevision:1,componentId:'c1'}));
  await nf(()=>b.deletePage(id,{expectedRevision:1}));await nf(()=>b.show(id));
 }
 assert.deepEqual(await b.listPages(),[]);
 await nf(()=>a.show(p.id,'missing'));await nf(()=>a.removeComponent(p.id,{expectedRevision:1,componentId:'missing'}));
 assert.equal((await a.getPage(p.id)).revision,1);
 assert.throws(()=>new DashboardStore({db:db.client(A),userId:'x'}));
 // soft archive → hidden, recoverable
 assert.deepEqual(await a.deletePage(p.id,{expectedRevision:1}),{deleted:true,pageId:p.id,restorable:true});
 await nf(()=>a.getPage(p.id));assert.equal((await a.listPages()).length,0);
 assert.equal((await a.listPages({archived:true}))[0].id,p.id);
 await nf(()=>b.restorePage(p.id));
 assert.equal((await a.restorePage(p.id)).components[0].id,'c1');
});

test('store: view/show, limits and read-time validation fail closed',async()=>{
 const db=fakeDb(),agent=storeFor(db,A,'agent'),user=storeFor(db,A,'user');
 const p=await agent.createPage({title:'Show',components:[{...chart,id:'c1'}]});
 assert.equal((await agent.show(p.id,'c1')).seq,1);
 let v=await user.view();assert.deepEqual([v.seq,v.pageId,v.componentId,v.actor],[1,p.id,'c1','agent']);
 assert.equal((await user.show(p.id)).actor,'user');assert.equal((await user.view()).seq,2);
 await agent.deletePage(p.id,{});v=await user.view();assert.equal(v.pageId,null);
 for(let i=0;i<19;i++)await user.createPage({title:'P'+i});
 await user.createPage({title:'P19'});
 assert.equal((await user.createPage({title:'one too many'}).catch(e=>e)).code,'limit');
 assert.equal((await user.createPage({title:'x',components:Array(25).fill({kind:'note',title:'n',spec:{text:'t'}})}).catch(e=>e)).code,'invalid');
 // corrupt stored JSON (e.g. written directly via PostgREST) renders as an invalid note
 const row=db.tables.dashboard_pages.find(r=>r.title==='P0');
 row.components=[{id:'x1',kind:'chart',title:'<b>',spec:{type:'pie'}},{id:'x2',kind:'model',title:'m',spec:{model:'dice_odds',params:{highlight:[99]}}},'junk',{...chart,id:'ok'}];
 const page=await user.getPage(row.id);
 assert.deepEqual(page.components.map(c=>c.invalid===true),[true,true,true,false]);
 assert.equal(page.components[0].id,'x1');assert.equal(page.components[0].kind,'note');
});

test('REST routes map store errors and never accept a caller user id',async()=>{
 const db=fakeDb(),app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:req.get('x-test-user')};req.supabase=db.client(req.user.id);next();});
 dashboardRoutes(app);
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/dashboard';
 const call=(uid,method,path,body)=>fetch(base+path,{method,headers:{'content-type':'application/json','x-test-user':uid},body:body&&JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json()}));
 try{
  const created=await call(A,'POST','/pages',{title:'Mine',user_id:B,components:[chart]});
  assert.equal(created.status,201);const id=created.body.page.id;
  assert.equal(db.tables.dashboard_pages[0].user_id,A);
  assert.equal((await call(B,'GET','/pages/'+id)).status,404);
  assert.equal((await call(A,'GET','/pages/nope')).status,404);
  assert.equal((await call(A,'POST','/pages',{title:''})).status,400);
  const stale=await call(A,'PUT','/pages/'+id,{expectedRevision:1,title:'a'});assert.equal(stale.status,200);
  const conflict=await call(A,'PUT','/pages/'+id,{expectedRevision:1,title:'b'});
  assert.equal(conflict.status,409);assert.equal(conflict.body.currentRevision,2);assert.equal(conflict.body.page.title,'a');
  assert.equal((await call(A,'POST','/view',{pageId:id})).body.actor,'user');
  assert.deepEqual((await call(A,'GET','/models')).body.models.map(m=>m.name),MODEL_NAMES);
  assert.equal((await call(A,'POST','/preview',{component:{kind:'model',title:'D',spec:{model:'seven_risk',params:{}}}})).body.component.computed.view.kind,'stat');
  assert.deepEqual((await call(A,'DELETE','/pages/'+id,{expectedRevision:2})).body.deleted,true);
  assert.equal((await call(A,'POST','/pages/'+id+'/restore')).status,200);
 }finally{server.close();}
});

test('MCP: unauthenticated and cross-origin requests fail closed with OAuth discovery',async()=>{
 const saved={...process.env};
 Object.assign(process.env,{SITE_URL:siteUrl,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'pk'});
 const app=express();app.use(express.json());mcpRoutes(app);
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/mcp';
 const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}};
 const post=headers=>fetch(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(init)});
 try{
  const none=await post({});assert.equal(none.status,401);
  assert.equal(none.headers.get('www-authenticate'),`Bearer resource_metadata="${siteUrl}/.well-known/oauth-protected-resource"`);
  assert.equal((await none.json()).error.code,-32001);
  const bad=await post({authorization:'Bearer not-a-jwt'});assert.equal(bad.status,401);assert.match(bad.headers.get('www-authenticate'),/invalid_token/);
  assert.equal((await post({authorization:'Basic abc'})).status,401);
  assert.equal((await post({origin:'https://evil.test'})).status,403);
  assert.equal((await fetch(url+'?access_token=x')).status,401);
  // a well-formed token that Supabase rejects never becomes a principal
  const req={headers:{authorization:'Bearer aaaaaaaaaa.bbbbbbbbbb.cccccccccc'}};
  assert.equal(await resolveMcpPrincipal(req,{makeClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{message:'bad jwt'}})}})}),null);
  const ok=await resolveMcpPrincipal(req,{makeClient:()=>({auth:{getUser:async t=>({data:{user:{id:A,email_confirmed_at:'x',token:t}},error:null})}})});
  assert.equal(ok.user.id,A);
 }finally{server.close();process.env=saved;}
});

test('MCP: tools share store rules end to end over Streamable HTTP',async()=>{
 const db=fakeDb(),app=express();app.use(express.json());
 mcpRoutes(app,{resolvePrincipal:async req=>{const uid={'tok-a':A,'tok-b':B}[req.get('authorization')?.slice(7)];return uid&&{user:{id:uid},supabase:db.client(uid)};},
  createStore:({user,supabase})=>new DashboardStore({db:supabase,userId:user.id,actor:'agent',siteUrl})});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const url=new URL('http://127.0.0.1:'+server.address().port+'/mcp');
 const connect=async tok=>{const c=new Client({name:'test',version:'1'});await c.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+tok}}}));return c;};
 const data=r=>JSON.parse(r.content[0].text);
 try{
  const a=await connect('tok-a'),b=await connect('tok-b');
  const {tools}=await a.listTools();
  assert.deepEqual(tools.map(t=>t.name).sort(),['add_component','compute_model','create_example_page','create_page','create_starter_page','delete_page','duplicate_component','duplicate_page','get_inputs','get_page','list_component_kinds','list_models','list_pages','move_component','preview_component','remove_component','restore_page','set_input_values','show_dashboard','update_component','update_page',
   // owner game tools registered for the verified OAuth account (director + match history)
   'director_apply_action','director_archive_game','director_clone_game','director_connections','director_create_game','director_export_state','director_game_events','director_get_state','director_issue_connection','director_list_games','director_patch_state','director_rename_game','director_replace_state','director_reset_game','director_restore_game','director_revoke_connection','director_validate_state','director_view_as_seat','get_game_schema',
   'history_add_note','history_branch','history_delete_note','history_get_match','history_get_position','history_list_matches','history_list_notes','history_update_note',
   'practice_commit','practice_get_position','practice_list_attempts','practice_list_positions','practice_reveal',
   'opponent_hand_range','opponent_capability','forecast_list','forecast_create','forecast_resolve','odds_drill'].sort());
  const add=tools.find(t=>t.name==='add_component');
  assert.equal(add.annotations.readOnlyHint,false);assert.deepEqual(add._meta.securitySchemes,[{type:'oauth2',scopes:['openid']}]);
  assert.ok(JSON.stringify(add.inputSchema).includes('"chart"'),'component union is described in JSON schema');
  assert.equal(tools.find(t=>t.name==='remove_component').annotations.destructiveHint,true);
  assert.equal(tools.find(t=>t.name==='get_page').annotations.readOnlyHint,true);
  assert.deepEqual(data(await a.callTool({name:'list_models',arguments:{}})).models.map(m=>m.name),MODEL_NAMES);
  assert.match(data(await a.callTool({name:'compute_model',arguments:{model:'dice_odds',params:{highlight:[6,8,9]}}})).takeaway,/39%/);
  const created=await a.callTool({name:'create_page',arguments:{title:'Agent page',components:[{kind:'model',title:'Dice',spec:{model:'dice_odds',params:{}}}]}});
  const page=created.structuredContent.page;assert.equal(page.components[0].createdBy,'agent');
  const added=await a.callTool({name:'add_component',arguments:{pageId:page.id,expectedRevision:1,component:chart}});
  assert.equal(added.structuredContent.page.revision,2);
  const conflict=await a.callTool({name:'add_component',arguments:{pageId:page.id,expectedRevision:1,component:chart}});
  assert.equal(conflict.isError,true);assert.equal(data(conflict).code,'conflict');assert.equal(data(conflict).currentRevision,2);
  const noSource=await a.callTool({name:'add_component',arguments:{pageId:page.id,expectedRevision:2,component:{...chart,source:undefined}}});
  assert.equal(noSource.isError,true);
  const shown=data(await a.callTool({name:'show_dashboard',arguments:{pageId:page.id,componentId:page.components[0].id}}));
  assert.equal(shown.seq,1);assert.equal(shown.actor,'agent');assert.equal(shown.url,siteUrl+'/dashboard/'+page.id);
  // account B cannot see or touch A's page
  assert.equal(data(await b.callTool({name:'get_page',arguments:{pageId:page.id}})).code,'not_found');
  assert.equal(data(await b.callTool({name:'show_dashboard',arguments:{pageId:page.id}})).code,'not_found');
  assert.equal(data(await b.callTool({name:'delete_page',arguments:{pageId:page.id,expectedRevision:2}})).code,'not_found');
  assert.deepEqual(data(await b.callTool({name:'list_pages',arguments:{}})).pages,[]);
  assert.equal(data(await a.callTool({name:'delete_page',arguments:{pageId:page.id,expectedRevision:2}})).deleted,true);
  assert.equal(data(await a.callTool({name:'restore_page',arguments:{pageId:page.id}})).page.id,page.id);
  assert.equal(data(await a.callTool({name:'create_starter_page',arguments:{}})).page.components.length,5);
  await a.close();await b.close();
  const get=await fetch(url,{headers:{authorization:'Bearer tok-a'}});assert.equal(get.status,405);
 }finally{server.close();}
});

test('schema model enum matches the model module catalog',()=>{
 assert.deepEqual(defaultModels().catalog.map(m=>m.name),MODEL_NAMES);
});

test('owned modules never use secret keys or admin clients',()=>{
 for(const f of ['dashboard-schema','dashboard-store','dashboard-routes','dashboard-catalog','mcp','mcp-auth']){
  const src=fs.readFileSync(new URL(`../lib/${f}.mjs`,import.meta.url),'utf8');
  assert.doesNotMatch(src,/SECRET|SERVICE_ROLE|service_role|auth\.admin|console\.log/,f);
 }
 const sql=fs.readFileSync(new URL('../../supabase/migrations/20260923005135_dashboard_mcp.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/security definer|service_role|p_user_id/i);
 assert.match(sql,/enable row level security/);
});
