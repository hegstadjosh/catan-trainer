// Bearer auth for /mcp using Supabase's built-in OAuth 2.1 server.
// The access token is a real Supabase user JWT, so the same publishable-key client that verifies it
// also carries it to PostgREST: RLS applies natively. No secret keys, no token tables.
import {createClient} from '@supabase/supabase-js';

const JWT=/^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,1024}$/;
export const resourceMetadataUrl=()=>(process.env.SITE_URL||'')+'/.well-known/oauth-protected-resource';

export function bearerToken(req){
 const header=req.get?.('authorization')??req.headers?.authorization;
 const match=typeof header==='string'&&/^Bearer ([^\s]+)$/.exec(header);
 return match&&JWT.test(match[1])?match[1]:null;
}
export function userClient(token,env=process.env){
 return createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
// → {user, supabase} or null. Only the Authorization header is read (never cookies, query or body).
export async function resolveMcpPrincipal(req,{makeClient=userClient}={}){
 const token=bearerToken(req);
 if(!token||!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)return null;
 const supabase=makeClient(token);
 const {data,error}=await supabase.auth.getUser(token);
 const user=!error&&data?.user;
 if(!user?.id||!user.email_confirmed_at)return null;
 return {user,supabase};
}
// Browsers must come from the site itself; coding agents send no Origin.
export function originAllowed(req){
 const origin=req.get?.('origin')??req.headers?.origin;
 return origin===undefined||origin===process.env.SITE_URL;
}
export function unauthorized(req,res){
 const presented=Boolean(req.get?.('authorization')??req.headers?.authorization);
 res.status(401).set('WWW-Authenticate',`Bearer resource_metadata="${resourceMetadataUrl()}"`+(presented?', error="invalid_token", error_description="Sign in again to reconnect this agent."':''))
  .json({jsonrpc:'2.0',error:{code:-32001,message:presented?'Invalid or expired access token. Reconnect the agent to refresh it.':'Authorization required. Connect this MCP server with OAuth.'},id:null});
}
