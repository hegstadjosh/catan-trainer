import {parseCookieHeader,serializeCookieHeader} from '@supabase/ssr';
import { sessionClient,sameOrigin,safeNext } from './session.mjs';
import { loginPage } from './login.mjs';
export function authRoutes(app){
 app.get('/signin',(req,res)=>res.send(loginPage({next:safeNext(req.query.next)})));
 app.post('/auth/start',(req,res)=>res.status(410).send('Email sign-in has been removed. Continue with Google at /signin.'));
 app.post('/auth/google',google);
 app.get('/auth/callback',callback);
 app.post('/auth/signout',async(req,res)=>{
  if(!sameOrigin(req))return res.sendStatus(403);
  const {error}=await sessionClient(req,res).auth.signOut({scope:'local'});
  if(error)return res.status(503).send('Could not sign out. Please retry.');
  res.redirect(303,'/signin');
 });
}
async function google(req,res){
 if(!sameOrigin(req))return res.sendStatus(403);
 if(process.env.GOOGLE_ENABLED!=='true')return res.status(503).send(loginPage({message:'Google sign-in is temporarily unavailable. Please try again shortly.'}));
 res.append('Set-Cookie',serializeCookieHeader('catan-next',safeNext(req.body?.next),{path:'/',httpOnly:true,secure:process.env.SITE_URL?.startsWith('https:'),sameSite:'lax',maxAge:600}));
 const {data,error}=await sessionClient(req,res).auth.signInWithOAuth({provider:'google',options:{redirectTo:process.env.SITE_URL+'/auth/callback',skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}});
 if(error||!data.url)return res.status(503).send(loginPage({message:'Google sign-in could not start. Please try again.'}));
 res.redirect(303,data.url);
}
async function callback(req,res){
 if(req.query.error)return res.status(400).send(loginPage({message:'Google sign-in was not completed. Please try again.'}));
 const code=String(req.query.code||'');
 if(!code)return res.status(400).send(loginPage({message:'This sign-in request is incomplete. Start again below.'}));
 const client=sessionClient(req,res),{data,error}=await client.auth.exchangeCodeForSession(code);
 if(error||!data.user?.email_confirmed_at)return res.status(400).send(loginPage({message:'This sign-in request expired or was opened in a different browser. Start again here, using this browser.'}));
 const next=safeNext(parseCookieHeader(req.headers.cookie||'').find(c=>c.name==='catan-next')?.value);
 res.append('Set-Cookie',serializeCookieHeader('catan-next','',{path:'/',httpOnly:true,secure:process.env.SITE_URL?.startsWith('https:'),sameSite:'lax',maxAge:0}));
 res.redirect(303,next);
}
