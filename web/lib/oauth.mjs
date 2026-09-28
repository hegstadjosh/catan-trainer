import {identity,sameOrigin} from './session.mjs';
import {escape} from './login.mjs';

const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(id);
const page=body=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your agent · Catan</title><style>body{margin:60px auto;padding:0 24px;max-width:540px;background:#faf9f6;color:#252522;font:16px/1.65 system-ui}h1{line-height:1.2;letter-spacing:-.7px}button,a{color:inherit}button{font:inherit;padding:12px 20px;border:1px solid #dedcd5;border-radius:7px;background:white;cursor:pointer}button[value=approve]{background:#292925;color:white}small{color:#66645d;overflow-wrap:anywhere}form{display:flex;gap:12px;margin-top:24px}ul{padding-left:20px}li{margin:4px 0}</style><main>${body}</main></html>`;

export function oauthRoutes(app){
 app.get('/.well-known/oauth-protected-resource',metadata);
 app.get('/.well-known/oauth-protected-resource/mcp',metadata);
 app.get('/oauth/consent',async(req,res)=>{
  const id=req.query.authorization_id;
  if(!validId(id))return res.status(400).send(page('<h1>Connection expired</h1><p>Start the connection again from your AI app.</p>'));
  const {user,supabase}=await identity(req,res);
  if(!user)return res.redirect(303,'/signin?next='+encodeURIComponent('/oauth/consent?authorization_id='+id));
  const {data,error}=await supabase.auth.oauth.getAuthorizationDetails(id);
  if(error||!data)return res.status(400).send(page('<h1>Connection expired</h1><p>Start the connection again from your AI app.</p>'));
  if(data.redirect_url)return res.redirect(303,data.redirect_url);
  res.send(page(`<small>CATAN · AGENT CONNECTION</small><h1>Connect ${escape(data.client.name||'your agent')}?</h1><p>Signed in as <strong>${escape(user.email)}</strong>.</p><p>This agent will be able to:</p><ul><li>read, create and edit your dashboard pages, graphs and inputs, and choose which page is shown;</li><li>create, edit, reset, clone and archive your Catan games, including the <strong>full game state</strong>: every player's hand, development cards, the deck order and the board;</li><li>play any seat, and issue or revoke agent-seat and sidekick connections for your games;</li><li>read your match history in full, and add, change or delete your replay notes and practice games.</li></ul><p>It cannot reach other people's accounts. Your other accounts remain separate.</p><p>Only connect an app you trust. You can disconnect it later from your dashboard.</p><small>Requested identity scopes: ${escape(data.scope)}<br>Return address: ${escape(data.redirect_uri)}</small><form method="post" action="/oauth/consent"><input type="hidden" name="authorization_id" value="${escape(id)}"><button name="decision" value="deny">Cancel</button><button name="decision" value="approve">Connect agent</button></form>`));
 });
 app.post('/oauth/consent',async(req,res)=>{
  if(!sameOrigin(req))return res.sendStatus(403);
  const id=req.body.authorization_id,decision=req.body.decision;
  if(!validId(id)||!['approve','deny'].includes(decision))return res.sendStatus(400);
  const {user,supabase}=await identity(req,res);if(!user)return res.sendStatus(401);
  const {data,error}=decision==='approve'?await supabase.auth.oauth.approveAuthorization(id,{skipBrowserRedirect:true}):await supabase.auth.oauth.denyAuthorization(id,{skipBrowserRedirect:true});
  if(error||!data?.redirect_url)return res.status(400).send(page('<h1>Could not connect</h1><p>Start the connection again from your AI app.</p>'));
  res.redirect(303,data.redirect_url);
 });
}
function metadata(req,res){res.set('Access-Control-Allow-Origin','*').json({resource:process.env.SITE_URL+'/mcp',authorization_servers:[process.env.SUPABASE_URL+'/auth/v1'],scopes_supported:['openid','email','profile'],bearer_methods_supported:['header'],resource_name:'Catan dashboards'});}

export function agentConnectionRoutes(app){
 app.get('/api/agent-connections',async(req,res)=>{
  const {data,error}=await req.supabase.auth.oauth.listGrants();
  if(error)return res.status(503).json({error:'Could not load connected agents.'});
  res.json({connections:data||[]});
 });
 app.delete('/api/agent-connections/:clientId',async(req,res)=>{
  if(!validId(req.params.clientId))return res.sendStatus(400);
  const {error}=await req.supabase.auth.oauth.revokeGrant({clientId:req.params.clientId});
  if(error)return res.status(503).json({error:'Could not disconnect this agent.'});
  res.json({ok:true});
 });
}
