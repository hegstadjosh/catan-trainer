import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import {isAuthApiError,isAuthSessionMissingError} from '@supabase/supabase-js';

export function sessionClient(req,res){
 const cookies=new Map(parseCookieHeader(req.headers.cookie||'').map(c=>[c.name,c.value]));
 return createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{
  cookieOptions:{httpOnly:true,secure:process.env.SITE_URL?.startsWith('https:'),sameSite:'lax',path:'/'},
  cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll(values){
   const existing=res.getHeader('Set-Cookie');const headers=Array.isArray(existing)?existing:existing?[existing]:[];
   values.forEach(({name,value,options})=>{cookies.set(name,value);headers.push(serializeCookieHeader(name,value,options));});
   res.setHeader('Set-Cookie',headers);
  }}
 });
}
export function sameOrigin(req){return req.get('origin')===process.env.SITE_URL;}
export function safeNext(value){
 if(['/','/guide','/dashboard','/game','/game-tools','/history','/train','/flashcards','/flashcards.html','/index.html'].includes(value))return value;
 if(typeof value==='string'&&/^\/(dashboard|game|history)\/[0-9a-f-]{36}$/i.test(value))return value;
 // Replay positions and the game-tools selection keep their one known query parameter; nothing else passes.
 if(typeof value==='string'&&/^\/history\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?revision=\d{1,12}$/i.test(value))return value;
 if(typeof value==='string'&&/^\/practice\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\?revision=\d{1,12}(?:&attempt=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)?$/i.test(value))return value;
 if(typeof value==='string'&&/^\/game-tools\?game=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return value;
 if(typeof value==='string'&&/^\/oauth\/consent\?authorization_id=[a-zA-Z0-9_-]{1,200}$/.test(value))return value;
 return '/';
}
export async function identity(req,res,makeClient=sessionClient){
 const supabase=makeClient(req,res);
 let data,error;
 try{({data,error}=await supabase.auth.getUser());}
 catch{throw authUnavailable();}
 if(error&&authFailureStatus(error)!==401)throw authUnavailable();
 return {supabase,user:!error&&data?.user?.email_confirmed_at?data.user:null};
}
// A failed Auth service lookup must not be presented as a signed-out user. Only
// missing/revoked/invalid credentials receive 401; other failures fail closed as 503.
export function authFailureStatus(error){
 if(isAuthSessionMissingError(error)||error?.name==='AuthInvalidJwtError')return 401;
 if(isAuthApiError(error)&&[400,401,403,404].includes(error.status))return 401;
 return 503;
}
function authUnavailable(){const error=new Error('Sign-in verification is temporarily unavailable. Please try again.');error.status=503;return error;}
