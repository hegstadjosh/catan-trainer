import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../server.mjs';

test('Google sign-in uses PKCE, rejects cross-site starts, and handles cancellation',async()=>{
 const previous={...process.env};
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 Object.assign(process.env,{SITE_URL:base,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',GOOGLE_ENABLED:'true'});
 const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
 try{
  const page=await (await request('/signin')).text();
  assert.match(page,/Continue with Google/);
  assert.match(page,/Any Google account can sign in/);
  assert.doesNotMatch(page,/approved accounts|Email me a sign-in link|type="email"/);
  assert.equal((await request('/auth/start',{method:'POST'})).status,410);
  assert.equal((await request('/auth/google',{method:'POST',headers:{origin:'https://untrusted.example'}})).status,403);
  const started=await request('/auth/google',{method:'POST',headers:{origin:base}});
  assert.equal(started.status,303);
  const destination=new URL(started.headers.get('location'));
  assert.equal(destination.origin,'https://example.supabase.co');
  assert.equal(destination.searchParams.get('provider'),'google');
  assert.equal(destination.searchParams.get('redirect_to'),base+'/auth/callback');
  assert.equal(destination.searchParams.get('code_challenge_method'),'s256');
  assert(destination.searchParams.get('code_challenge'));
  const cookie=started.headers.get('set-cookie');
  assert.match(cookie,/code-verifier/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Lax/i);
  const cancelled=await request('/auth/callback?error=access_denied');
  assert.equal(cancelled.status,400);assert.match(await cancelled.text(),/not completed/);
  assert.equal((await request('/auth/callback')).status,400);
  process.env.GOOGLE_ENABLED='false';
  assert.equal((await request('/auth/google',{method:'POST',headers:{origin:base}})).status,503);
 }finally{
  for(const key of ['SITE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','GOOGLE_ENABLED']){
   if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
  await new Promise(resolve=>server.close(resolve));
 }
});
