import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import app from '../server.mjs';
import {safeNext} from '../lib/session.mjs';
const config={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};

test('safe destinations',()=>{
 assert.equal(safeNext('https://bad.test'),'/');assert.equal(safeNext('//bad.test'),'/');
 assert.equal(safeNext('/flashcards'),'/flashcards');
});

test('real Supabase auth, protected pages, RLS and conflict-safe saves',{skip:!process.env.TEST_SUPABASE_SECRET_KEY},async()=>{
 const admin=createClient(config.url,process.env.TEST_SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const users=[],server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;process.env.SITE_URL=base;
 const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
 async function account(suffix){
  const email=`catan-qa-${Date.now()}-${suffix}@example.com`;
  const created=await admin.auth.admin.createUser({email,email_confirm:true});assert.ifError(created.error);users.push(created.data.user.id);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email});assert.ifError(link.error);
  const jar=new Map(),client=createServerClient(config.url,config.key,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>jar.set(c.name,c.value))}});
  const signed=await client.auth.verifyOtp({email,token:link.data.properties.email_otp,type:'email'});assert.ifError(signed.error);
  return {email,id:created.data.user.id,client,cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')};
 }
 try{
  for(const path of ['/','/guide','/index.html','/flashcards','/flashcards.html']){const r=await request(path);assert.equal(r.status,303);assert.match(r.headers.get('location'),/^\/signin/);}
  assert.equal((await request('/api/reviews')).status,401);
  assert.equal((await request('/auth/google',{method:'POST',headers:{origin:'https://bad.test','content-type':'application/x-www-form-urlencoded'},body:'email=no%40example.com'})).status,403);
  const a=await account('a'),b=await account('b');
  const headers={cookie:a.cookie,origin:base,'content-type':'application/json'};
  let r=await request('/',{headers});assert.equal(r.status,200);const html=await r.text();assert(html.includes('href="/train"'));assert(html.includes('CATAN_ACCOUNT_STATE=null'));assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal((await request('/flashcards',{headers})).status,200);
  const post=(path,payload,h=headers)=>request(path,{method:'POST',headers:h,body:JSON.stringify(payload)});
  const p={id:'die-6-1-points',grade:'good',reviewId:'review-account-test-001',previousLast:0};
  r=await post('/api/reviews',p);assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.record.interval,1);
  assert.deepEqual(await (await post('/api/reviews',p)).json(),saved);
  assert.equal((await post('/api/reviews',{...p,reviewId:'review-account-test-002'})).status,409);
  const loaded=await (await request('/api/reviews',{headers})).json();assert.deepEqual(loaded.records[p.id],saved.record);
  assert.deepEqual(await (await request('/api/reviews',{headers:{cookie:b.cookie}})).json(),{records:{}});
  const theft=await b.client.from('math_reviews').insert({user_id:a.id,card_id:'stolen',record:{}});assert(theft.error);
  r=await post('/api/state',{revision:0,state:{page:'opponents',hand:[2,1,0,4,3]}});assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
  assert.equal((await post('/api/state',{revision:0,state:{page:'play'}})).status,409);
  r=await request('/',{headers});assert((await r.text()).includes('"hand":[2,1,0,4,3]'));
  const separate=await (await request('/',{headers:{cookie:b.cookie}})).text();assert(separate.includes('CATAN_ACCOUNT_STATE=null'));
  assert.equal((await post('/api/state',{revision:1,state:{}},{...headers,origin:'https://bad.test'})).status,403);
  const anon=createClient(config.url,config.key,{auth:{persistSession:false}});assert((await anon.from('guide_state').select('*')).error);
  assert.equal((await request('/auth/signout',{method:'POST',headers:{cookie:a.cookie,origin:base}})).status,303);
 }finally{
  for(const id of users){const r=await admin.auth.admin.deleteUser(id);assert.ifError(r.error);}
  await new Promise(r=>server.close(r));
 }
});
