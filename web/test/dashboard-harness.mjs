// Local UI harness: the real dashboard page, routes and assets over the in-memory fake DB, signed in
// as one fake user. For manual/browser checks only:  node test/dashboard-harness.mjs [port]
import express from 'express';
import {fileURLToPath} from 'node:url';
import {fakeDb} from './dashboard-fake-db.mjs';
import {dashboardRoutes} from '../lib/dashboard-routes.mjs';
import {renderDashboard} from '../lib/dashboard-page.mjs';
import {DashboardStore} from '../lib/dashboard-store.mjs';
const A='11111111-1111-4111-8111-111111111111',db=fakeDb(),app=express();
app.use(express.json());
app.use((req,res,next)=>{req.user={id:A,email:'harness@example.com'};req.supabase=db.client(A);next();});
app.use('/dashboard-assets',express.static(fileURLToPath(new URL('../public',import.meta.url))));
app.get('/api/agent-connections',(req,res)=>res.json({connections:[]}));
dashboardRoutes(app);
// Agent side-channel for tests: POST /harness/agent/inputs {pageId,values} sets values as the agent would via MCP.
app.post('/harness/agent/inputs',async(req,res)=>{try{const s=new DashboardStore({db:db.client(A),userId:A,actor:'agent'});const p=await s.getPage(req.body.pageId);res.json(await s.setInputValues(p.id,{expectedRevision:p.revision,values:req.body.values}));}catch(e){res.status(400).json({error:e.message});}});
app.get(['/dashboard','/dashboard/:id'],renderDashboard);
const port=Number(process.argv[2]||8791);
app.listen(port,'127.0.0.1',()=>console.log('dashboard harness on http://127.0.0.1:'+port+'/dashboard'));
