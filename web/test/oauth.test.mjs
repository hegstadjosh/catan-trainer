import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../server.mjs';
import {safeNext} from '../lib/session.mjs';

test('OAuth discovery and sign-in continuation stay on the trusted site',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 Object.assign(process.env,{SITE_URL:base,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-key',GOOGLE_ENABLED:'true'});
 try{
  const req=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
  const discovery=await req('/.well-known/oauth-protected-resource');
  assert.equal(discovery.headers.get('access-control-allow-origin'),'*');
  const data=await discovery.json();assert.equal(data.resource,base+'/mcp');assert.deepEqual(data.authorization_servers,['https://example.supabase.co/auth/v1']);
  assert.equal((await req('/oauth/consent?authorization_id=<bad>')).status,400);
  const path='/oauth/consent?authorization_id=550e8400-e29b-41d4-a716-446655440000';
  const consent=await req(path);assert.equal(consent.status,303);assert.equal(consent.headers.get('location'),'/signin?next='+encodeURIComponent(path));
  const signin=await (await req(consent.headers.get('location'))).text();assert.match(signin,/name="next" value="\/oauth\/consent\?authorization_id=/);
  for(const target of ['https://evil.test','//evil.test','/oauth/consent?authorization_id=ok&next=https://evil.test','/oauth/consent?authorization_id=../evil'])assert.equal(safeNext(target),'/');
  assert.equal(safeNext(path),path);
  const id='0f1e2d3c-4b5a-4968-8776-655443322110';
  for(const ok of ['/history/'+id+'?revision=12','/game-tools?game='+id])assert.equal(safeNext(ok),ok);
  for(const bad of ['/history/'+id+'?revision=1&next=//evil.test','/history/'+id+'?revision=x','/game-tools?game=//evil.test','/game-tools?game='+id+'#x','/history/'+id+'?revision=1\n'])assert.equal(safeNext(bad),'/');assert.equal(safeNext('/dashboard'),'/dashboard');
  assert.equal((await req('/oauth/consent',{method:'POST',headers:{origin:'https://evil.test'}})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
