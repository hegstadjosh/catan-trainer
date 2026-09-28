import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {forecastCreate,forecastResolve,loadState} from '../lib/state.mjs';
import {DashboardStore} from '../lib/dashboard-store.mjs';
import {buildServer} from '../lib/mcp.mjs';

test('hosted forecast originals survive ordinary saves and reject direct authenticated tampering',{skip:!process.env.TEST_SUPABASE_SECRET_KEY},async()=>{
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 const admin=createClient(url,process.env.TEST_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const users=[];
 async function account(suffix){
  const email=`catan-forecast-qa-${Date.now()}-${suffix}@example.com`;
  const created=await admin.auth.admin.createUser({email,email_confirm:true});assert.ifError(created.error);users.push(created.data.user.id);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email});assert.ifError(link.error);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await client.auth.verifyOtp({email,token:link.data.properties.email_otp,type:'email'});assert.ifError(signed.error);
  return {id:created.data.user.id,client};
 }
 try{
  const a=await account('a'),b=await account('b');
  const input={opp:'Red',event:'City',turns:2,rolls:8,pAfford:.01,pChoose:.01,evidence:'Disposable verification'};
  const created=await forecastCreate({authDb:a.client,serviceDb:admin,userId:a.id,expectedRevision:0},input);
  assert.equal(created.revision,1);assert.equal(created.forecast.p,.0001);
  const original=structuredClone(created.forecast);
  const base=(await loadState(a.client)).state;
  const ordinary=await a.client.rpc('save_guide_state',{p_expected_revision:1,p_state:{...base,note:'ordinary edit'}});
  assert.ifError(ordinary.error);assert.equal(ordinary.data,2);
  assert.deepEqual((await loadState(a.client)).state.opponents.forecasts,[original]);
  const changed=structuredClone((await loadState(a.client)).state);changed.opponents.forecasts[0].p=1;
  assert.ok((await a.client.rpc('save_guide_state',{p_expected_revision:2,p_state:changed})).error,'authenticated RPC must reject original changes');
  assert.ok((await a.client.from('guide_state').update({state:changed}).eq('user_id',a.id)).error,'direct update must reject original changes');
  assert.ok((await a.client.from('guide_state').delete().eq('user_id',a.id)).error,'delete/reinsert must be unavailable to authenticated clients');
  const afterTamper=await loadState(a.client);assert.equal(afterTamper.revision,2);assert.deepEqual(afterTamper.state.opponents.forecasts,[original]);
  const foreign=await b.client.from('guide_state').select('state').eq('user_id',a.id);assert.ifError(foreign.error);assert.equal(foreign.data.length,0);
  const resolved=await forecastResolve({authDb:a.client,serviceDb:admin,userId:a.id,expectedRevision:2},original.id,{outcome:'no',afford:'no',note:'Verified test'});
  assert.equal(resolved.revision,3);assert.equal(resolved.forecast.fp,original.fp);assert.equal(resolved.forecast.res.history.length,1);
  assert.ok((await a.client.rpc('save_guide_state',{p_expected_revision:3,p_state:{...afterTamper.state,note:'stale forecast'}})).error,'old snapshot cannot erase resolution');
  async function connect(account){const server=buildServer(new DashboardStore({db:account.client,userId:account.id}),{userId:account.id});const [left,right]=InMemoryTransport.createLinkedPair();await server.connect(left);const client=new Client({name:'forecast-live-test',version:'1'});await client.connect(right);return {server,client};}
  const owner=await connect(a),other=await connect(b);
  const call=async(c,name,args)=>{const r=await c.callTool({name,arguments:args});return {error:!!r.isError,data:JSON.parse(r.content[0].text)};};
  try{
   const names=(await owner.client.listTools()).tools.map(t=>t.name);
   for(const name of ['opponent_hand_range','opponent_capability','forecast_list','forecast_create','forecast_resolve','odds_drill'])assert.ok(names.includes(name),name);
   const range=await call(owner.client,'opponent_hand_range',{known:[0,0,0,0,0],total:2,recipe:'Road'});assert.equal(range.error,false);assert.equal(range.data.range.count,15);
   const cap=await call(owner.client,'opponent_capability',{known:[0,0,0,0,0],total:0,recipe:'Road',production:['6','8','','',''],rolls:5});assert.equal(cap.error,false);assert.equal(cap.data.cdf.length,6);
   const tooLarge=await call(owner.client,'opponent_capability',{known:[0,0,0,0,0],total:13,recipe:'Road',production:['6','8','','',''],rolls:40});assert.equal(tooLarge.error,true);assert.equal(tooLarge.data.code,'invalid');
   const hidden=await call(owner.client,'odds_drill',{type:'timing',seed:4});assert.equal('correct' in hidden.data,false);assert.equal('explanation' in hidden.data,false);
   const revealed=await call(owner.client,'odds_drill',{type:'timing',seed:4,reveal:true});assert.equal(revealed.data.correct,'chance');
   const ownerList=await call(owner.client,'forecast_list',{}),otherList=await call(other.client,'forecast_list',{});
   assert.equal(ownerList.data.forecasts.length,1);assert.equal(otherList.data.forecasts.length,0);
   const next=await call(owner.client,'forecast_create',{expectedRevision:3,input:{...input,opp:'Blue'}});assert.equal(next.error,false);assert.equal(next.data.revision,4);
   const stale=await call(owner.client,'forecast_create',{expectedRevision:3,input:{...input,opp:'Green'}});assert.equal(stale.error,true);assert.equal(stale.data.code,'conflict');
   const done=await call(owner.client,'forecast_resolve',{expectedRevision:4,id:next.data.forecast.id,outcome:'yes',afford:'yes',note:'MCP correction'});
   assert.equal(done.error,false);assert.equal(done.data.revision,5);assert.equal(done.data.forecast.res.history.length,1);
   assert.equal((await call(owner.client,'forecast_list',{opponent:'Blue',outcome:'yes'})).data.forecasts.length,1);
  }finally{await owner.client.close();await owner.server.close();await other.client.close();await other.server.close();}
 }finally{for(const id of users)assert.ifError((await admin.auth.admin.deleteUser(id)).error);}
});
