// Authenticated browser REST API. Mount after the session middleware (req.user, req.supabase, sameOrigin).
import {DashboardStore,DashboardError} from './dashboard-store.mjs';
import {componentCatalog} from './dashboard-catalog.mjs';

const STATUS={invalid:400,not_found:404,conflict:409,limit:409,unavailable:503};
const route=fn=>async(req,res)=>{
 try{
  const store=new DashboardStore({db:req.supabase,userId:req.user.id,actor:'user'});
  const {status=200,body}=await fn(store,req);
  res.status(status).json(body);
 }catch(e){
  if(e instanceof DashboardError)return res.status(STATUS[e.code]||503).json({error:e.message,code:e.code,...e.extra});
  res.status(503).json({error:'The dashboard is temporarily unavailable. Please retry.',code:'unavailable'});
 }
};
const body=req=>req.body&&typeof req.body==='object'&&!Array.isArray(req.body)?req.body:{};
const idx=v=>v===undefined?undefined:Number.isInteger(v)?v:NaN;

export function dashboardRoutes(app){
 const P='/api/dashboard/pages';
 app.get(P,route(async(s,req)=>({body:{pages:await s.listPages({archived:req.query.archived==='1'})}})));
 app.post(P,route(async(s,req)=>({status:201,body:{page:await s.createPage(body(req))}})));
 app.post(P+'/starter',route(async s=>({status:201,body:{page:await s.createStarterPage()}})));
 app.post(P+'/examples/:name',route(async(s,req)=>({status:201,body:{page:await s.createExamplePage(req.params.name)}})));
 app.get(P+'/:id',route(async(s,req)=>({body:{page:await s.getPage(req.params.id)}})));
 app.put(P+'/:id',route(async(s,req)=>({body:{page:await s.updatePage(req.params.id,body(req))}})));
 app.delete(P+'/:id',route(async(s,req)=>({body:await s.deletePage(req.params.id,{expectedRevision:body(req).expectedRevision})})));
 app.post(P+'/:id/restore',route(async(s,req)=>({body:{page:await s.restorePage(req.params.id)}})));
 app.post(P+'/:id/components',route(async(s,req)=>{const b=body(req);return {status:201,body:await s.addComponent(req.params.id,{...b,index:idx(b.index)})};}));
 app.patch(P+'/:id/components/:cid',route(async(s,req)=>{const b=body(req);return {body:await s.updateComponent(req.params.id,{expectedRevision:b.expectedRevision,componentId:req.params.cid,changes:b.changes})};}));
 app.post(P+'/:id/components/:cid/move',route(async(s,req)=>{const b=body(req);return {body:{page:await s.moveComponent(req.params.id,{expectedRevision:b.expectedRevision,componentId:req.params.cid,index:b.index})}};}));
 app.post(P+'/:id/components/:cid/duplicate',route(async(s,req)=>{const b=body(req);return {status:201,body:await s.duplicateComponent(req.params.id,{expectedRevision:b.expectedRevision,componentId:req.params.cid,index:idx(b.index)})};}));
 app.get(P+'/:id/inputs',route(async(s,req)=>({body:await s.getInputs(req.params.id)})));
 app.patch(P+'/:id/inputs',route(async(s,req)=>{const b=body(req);return {body:await s.setInputValues(req.params.id,{expectedRevision:b.expectedRevision,values:b.values})};}));
 app.delete(P+'/:id/components/:cid',route(async(s,req)=>({body:{page:await s.removeComponent(req.params.id,{expectedRevision:body(req).expectedRevision,componentId:req.params.cid})}})));
 app.get('/api/dashboard/view',route(async s=>({body:await s.view()})));
 app.post('/api/dashboard/view',route(async(s,req)=>{const b=body(req);return {body:await s.show(b.pageId,b.componentId)};}));
 app.get('/api/dashboard/catalog',route(async()=>({body:componentCatalog()})));
 app.get('/api/dashboard/models',route(async s=>({body:{models:s.catalog()}})));
 app.post('/api/dashboard/compute',route(async(s,req)=>{const b=body(req);return {body:s.compute(b.model,b.params)};}));
 app.post('/api/dashboard/preview',route(async(s,req)=>{const b=body(req);return {body:{component:await s.preview(b.component,{pageId:b.pageId})}};}));
}
