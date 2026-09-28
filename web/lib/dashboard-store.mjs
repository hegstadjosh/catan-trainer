// One service layer for the browser REST routes and the MCP tools.
// `db` is always a user-scoped Supabase client (session cookie or OAuth bearer), so RLS enforces
// ownership; every query also filters on the verified user id as defense in depth.
import {createRequire} from 'node:module';
import {LIMITS,componentInput,componentChanges,pageTitle,pageId as pageIdSchema,componentId as componentIdSchema,stripServerFields,describeIssues,byteSize,randomComponentId,componentByteLimit} from './dashboard-schema.mjs';
import {EXAMPLES} from './dashboard-catalog.mjs';

export class DashboardError extends Error{
 constructor(code,message,extra={}){super(message);this.code=code;Object.assign(this,{extra});}
}
const invalid=message=>new DashboardError('invalid',message);
const notFound=()=>new DashboardError('not_found','Page or component not found.');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_COLS='id,title,components,revision,created_at,updated_at';
const require=createRequire(import.meta.url);
let loadedModels;
export function defaultModels(){return loadedModels??=require('./dashboard-models.cjs');}
export const Inputs=require('./dashboard-inputs.cjs');

// Vega-Lite compile check (server-side, write time only). vega-lite uses top-level await, so it is
// imported lazily; results are cached by spec text. Compiling never fetches: urls are rejected earlier.
let vegaLibs;
const compiled=new Map();
export async function checkVega(definition){
 const key=JSON.stringify(definition);
 if(compiled.has(key))return compiled.get(key);
 vegaLibs??=Promise.all([import('vega-lite'),import('vega')]);
 const [vl,vega]=await vegaLibs,warnings=[];
 const logger={_l:0,level(l){if(l===undefined)return this._l;this._l=l;return this;},warn(...a){warnings.push(a.join(' '));return this;},info(){return this;},debug(){return this;},error(...a){throw new Error(a.join(' '));}};
 let result;
 try{
  const spec=vl.compile(structuredClone(definition),{logger}).spec;
  vega.parse(spec,null,{ast:true});
  result={ok:true,warnings:[...new Set(warnings)].slice(0,5)};
 }catch(e){result={ok:false,error:String(e?.message||e).replace(/\s+/g,' ').slice(0,300)};}
 if(compiled.size>256)compiled.delete(compiled.keys().next().value);
 compiled.set(key,result);
 return result;
}

export const STARTER=[['dice_odds','Dice odds','half'],['build_eta','Build progress','half'],['dev_card_odds','Dev card odds','third'],['seven_risk','Seven risk','third'],['resource_income','Resource income','third']];

function dbError(error){
 if(error?.code==='CT429')return new DashboardError('limit',error.message||`Limit reached: at most ${LIMITS.pages} pages.`);
 if(error?.code==='CT404'||error?.code==='22P02')return notFound();
 return new DashboardError('unavailable','Dashboard storage is temporarily unavailable. Please retry.');
}
function parse(schema,value){
 const result=schema.safeParse(value);
 if(!result.success)throw invalid(describeIssues(result.error));
 return result.data;
}

export class DashboardStore{
 constructor({db,userId,actor='user',models,siteUrl}){
  if(!db||typeof userId!=='string'||!UUID.test(userId))throw Error('DashboardStore needs a user-scoped client and a verified user id.');
  if(!['user','agent'].includes(actor))throw Error('Unknown actor.');
  Object.assign(this,{db,userId,actor,_models:models,siteUrl});
 }
 get models(){return this._models||defaultModels();}
 url(id){return (this.siteUrl??process.env.SITE_URL??'')+'/dashboard/'+id;}

 // ---------- validation ----------
 validateModel(model,params){
  const result=this.models.validate(model,params??{});
  if(!result.ok)throw invalid(`${model}: ${result.errors.join('; ')}`);
  return result.params;
 }
 normalize(input,previous){
  const env=parse(componentInput,stripServerFields(input));
  if(env.kind==='model'){
   const refs=Inputs.refsIn(env.spec.params);
   if(refs.errors.length)throw invalid(`${env.spec.model}: ${refs.errors.join('; ')}`);
   // Bound params are validated against the page's input values in checkPage; bindings are stored as written.
   env.spec={model:env.spec.model,params:refs.keys.length?Inputs.fillDefaults(this.models.catalog.find(m=>m.name===env.spec.model),env.spec.params):this.validateModel(env.spec.model,env.spec.params)};
  }
  env.size??=previous?.size??(env.kind==='model'?this.models.catalog.find(m=>m.name===env.spec.model)?.defaultSize:env.kind==='input'?'third':null)??'half';
  const max=componentByteLimit(env.kind);
  if(byteSize(env)>max)throw invalid(`Component "${env.title}" is larger than ${max/1024} KB.`);
  return env;
 }
 // Validate a full component list, keeping createdBy for unchanged ids and stamping changes.
 prepare(list,existing=[]){
  if(!Array.isArray(list))throw invalid('components must be an array.');
  if(list.length>LIMITS.components)throw invalid(`A page holds at most ${LIMITS.components} components.`);
  const old=new Map(existing.map(c=>[c.id,c])),seen=new Set(),now=new Date().toISOString();
  const out=list.map((raw,i)=>{
   let env;
   try{env=this.normalize(raw,old.get(raw?.id));}catch(e){if(e.code==='invalid')e.message=`components.${i}: ${e.message}`;throw e;}
   env.id??=randomComponentId();
   if(seen.has(env.id))throw invalid(`Duplicate component id "${env.id}".`);
   seen.add(env.id);
   const prior=old.get(env.id);
   if(prior){
    const {createdBy,updatedAt,...priorEnv}=prior;
    const same=JSON.stringify(sortKeys(priorEnv))===JSON.stringify(sortKeys(env));
    return {...env,createdBy:createdBy==='agent'?'agent':'user',updatedAt:same&&updatedAt?updatedAt:now};
   }
   return {...env,createdBy:this.actor,updatedAt:now};
  });
  if(byteSize(out)>LIMITS.pageBytes)throw invalid('This page is too large; split it across pages.');
  this.checkPage(out);
  return out;
 }
 // Page-level rules: input keys unique on the page; every model binding resolves and the model accepts the values.
 checkPage(list){
  const {errors}=Inputs.collectInputs(list);
  if(errors.length)throw invalid(errors.join('; '));
  const values=Inputs.valuesOf(list);
  list.forEach((c,i)=>{
   if(c.kind!=='model'||!Inputs.refsIn(c.spec.params).keys.length)return;
   const r=Inputs.resolveModel(this.models,c.spec,values);
   if(r.errors)throw invalid(`components.${i} ("${c.title}"): ${r.errors.join('; ')}`);
  });
 }
 async checkVegaList(list){
  for(const [i,c] of list.entries()){
   if(c.kind!=='vega')continue;
   const r=await checkVega(c.spec.definition);
   if(!r.ok)throw invalid(`components.${i} ("${c.title}"): Vega-Lite could not compile this definition: ${r.error}`);
  }
  return list;
 }

 // ---------- read path: never throws on bad stored data ----------
 resolveComponent(stored,values=Object.create(null)){
  const id=typeof stored?.id==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(stored.id)?stored.id:randomComponentId();
  try{
   const env=this.normalize(stored,stored);
   return this.computeComponent(env,{createdBy:stored.createdBy==='agent'?'agent':'user',updatedAt:typeof stored.updatedAt==='string'?stored.updatedAt:null},values);
  }catch(e){
   return {id,kind:'note',title:'Component could not be displayed',size:'half',spec:{text:'This component has invalid data'+(e.code==='invalid'?': '+e.message.slice(0,240):'.')},createdBy:'user',updatedAt:null,invalid:true};
  }
 }
 // Model tiles compute from their (resolved) params; a binding that no longer resolves keeps the stored
 // spec and reports `error` instead of replacing the tile, so echoing the page back loses nothing.
 computeComponent(env,meta,values){
  if(env.kind!=='model')return {...env,...meta};
  const r=Inputs.computeModel(this.models,env.spec,values);
  if(r.errors)return {...env,...meta,computed:null,error:r.errors.join('; ').slice(0,300)};
  return {...env,...meta,computed:r.computed};
 }
 resolvePage(row){
  const stored=Array.isArray(row.components)?row.components.slice(0,LIMITS.components):[];
  const envs=stored.map(c=>{try{return this.normalize(c,c);}catch{return null;}});
  const values=Inputs.valuesOf(envs.filter(Boolean));
  const components=stored.map(c=>this.resolveComponent(c,values));
  return {id:row.id,title:row.title,revision:Number(row.revision),createdAt:row.created_at,updatedAt:row.updated_at,url:this.url(row.id),components};
 }

 // ---------- queries ----------
 pages(){return this.db.from('dashboard_pages');}
 async row(id,{archived=false}={}){
  if(typeof id!=='string'||!UUID.test(id))throw notFound();
  let q=this.pages().select(PAGE_COLS).eq('id',id).eq('user_id',this.userId);
  q=archived?q.not('deleted_at','is',null):q.is('deleted_at',null);
  const {data,error}=await q.maybeSingle();
  if(error)throw dbError(error);
  if(!data)throw notFound();
  return data;
 }
 async listPages({archived=false}={}){
  let q=this.pages().select('id,title,revision,component_count,updated_at,deleted_at').eq('user_id',this.userId);
  q=archived?q.not('deleted_at','is',null):q.is('deleted_at',null);
  const {data,error}=await q.order('updated_at',{ascending:false}).limit(archived?50:LIMITS.pages);
  if(error)throw dbError(error);
  return data.map(p=>({id:p.id,title:p.title,revision:Number(p.revision),componentCount:p.component_count,updatedAt:p.updated_at,...(archived?{archivedAt:p.deleted_at}:{}),url:this.url(p.id)}));
 }
 async getPage(id){return this.resolvePage(await this.row(id));}
 async createPage({title,components=[]}={}){
  const clean={title:parse(pageTitle,title),components:await this.checkVegaList(this.prepare(components))};
  const {data,error}=await this.pages().insert(clean).select(PAGE_COLS).single();
  if(error)throw dbError(error);
  return this.resolvePage(data);
 }
 async createStarterPage(){
  return this.createPage({title:'Starter: my odds',components:STARTER.map(([model,title,size])=>({kind:'model',title,size,caption:'Edit the numbers to match your game.',spec:{model,params:{}}}))});
 }
 // Compare-and-swap write; the DB trigger bumps revision and updated_at.
 async write(id,expectedRevision,change){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw invalid('expectedRevision must be the page revision you last read.');
  const {data,error}=await this.pages().update(change).eq('id',id).eq('user_id',this.userId).eq('revision',expectedRevision).is('deleted_at',null).select(PAGE_COLS).maybeSingle();
  if(error)throw dbError(error);
  if(data)return data;
  const current=await this.row(id);
  const page=this.resolvePage(current);
  throw new DashboardError('conflict',`The page changed (now revision ${page.revision}). Re-read it and retry.`,{currentRevision:page.revision,page});
 }
 async edit(id,expectedRevision,fn){
  const current=await this.row(id);
  const stored=Array.isArray(current.components)?current.components:[];
  const next=fn(stored.map(c=>({...c})));
  return this.resolvePage(await this.write(id,expectedRevision,{components:await this.checkVegaList(this.prepare(next,stored))}));
 }
 async updatePage(id,{expectedRevision,title,components}={}){
  if(title===undefined&&components===undefined)throw invalid('Provide title, components, or both.');
  const current=await this.row(id),change={};
  if(title!==undefined)change.title=parse(pageTitle,title);
  if(components!==undefined)change.components=await this.checkVegaList(this.prepare(components,Array.isArray(current.components)?current.components:[]));
  return this.resolvePage(await this.write(id,expectedRevision,change));
 }
 index(list,componentId){
  const i=list.findIndex(c=>c?.id===componentId);
  if(i<0)throw notFound();
  return i;
 }
 async addComponent(id,{expectedRevision,component,index}={}){
  if(index!==undefined&&!(Number.isInteger(index)&&index>=0))throw invalid('index must be a whole number ≥ 0.');
  let added;
  const page=await this.edit(id,expectedRevision,list=>{
   if(list.length>=LIMITS.components)throw new DashboardError('limit',`A page holds at most ${LIMITS.components} components.`);
   const input=stripServerFields(component);
   if(input&&typeof input==='object'&&!input.id)input.id=randomComponentId();
   if(list.some(c=>c?.id===input?.id))throw invalid(`Component id "${input.id}" already exists on this page.`);
   added=input?.id;
   const at=index===undefined?list.length:Math.max(0,Math.min(list.length,index));
   list.splice(at,0,input);return list;
  });
  return {page,component:page.components.find(c=>c.id===added)};
 }
 async updateComponent(id,{expectedRevision,componentId,changes}={}){
  const patch=parse(componentChanges,changes??{});
  if(!Object.keys(patch).length)throw invalid('changes must include title, caption, size, spec or source.');
  let changed;
  const page=await this.edit(id,expectedRevision,list=>{
   const i=this.index(list,componentId);
   const {createdBy,updatedAt,...env}=list[i];
   list[i]={...env,...patch,id:componentId};
   if(patch.caption==='')delete list[i].caption;
   changed=componentId;return list;
  });
  return {page,component:page.components.find(c=>c.id===changed)};
 }
 async moveComponent(id,{expectedRevision,componentId,index}={}){
  if(!Number.isInteger(index)||index<0)throw invalid('index must be a whole number ≥ 0.');
  return this.edit(id,expectedRevision,list=>{
   const [c]=list.splice(this.index(list,componentId),1);
   list.splice(Math.min(index,list.length),0,c);return list;
  });
 }
 async removeComponent(id,{expectedRevision,componentId}={}){
  return this.edit(id,expectedRevision,list=>{
   const [gone]=list.splice(this.index(list,componentId),1);
   if(gone?.kind==='input'){
    const users=new Map();
    for(const f of gone.spec?.fields||[])for(const d of Inputs.dependents(list,f.key))if(d.kind==='model')users.set(d.title,[...(users.get(d.title)||[]),f.key]);
    if(users.size)throw invalid(`Model tiles still use this tile's inputs: ${[...users].map(([t,k])=>`"${t}" uses ${k.join(', ')}`).join('; ')}. Remove or rebind those tiles first.`);
   }
   return list;
  });
 }
 // Copy a component on the same page (input tiles get fresh keys: wood -> wood_2).
 async duplicateComponent(id,{expectedRevision,componentId,index}={}){
  const current=await this.getPage(id);
  const original=current.components.find(c=>c.id===componentId);
  if(!original||original.invalid)throw notFound();
  let copy=stripServerFields(original);delete copy.id;
  copy=Inputs.renameKeys(copy,Inputs.collectInputs(current.components).fields.keys());
  const at=index===undefined?current.components.findIndex(c=>c.id===componentId)+1:index;
  return this.addComponent(id,{expectedRevision,component:copy,index:at});
 }

 // ---------- inputs ----------
 async getInputs(id){
  const page=await this.getPage(id);
  const inputs=[];
  for(const c of page.components)if(c.kind==='input')for(const f of c.spec.fields)inputs.push({...f,componentId:c.id,tile:c.title,usedBy:Inputs.dependents(page.components,f.key)});
  return {pageId:page.id,revision:page.revision,values:Object.fromEntries(inputs.map(f=>[f.key,f.value])),inputs};
 }
 // Atomically set several input values (compare-and-swap on the page revision). Dependent model tiles
 // recompute on the returned page; Vega-Lite params with matching names pick the values up when drawn.
 async setInputValues(id,{expectedRevision,values}={}){
  let applied;
  const page=await this.edit(id,expectedRevision,list=>{
   const r=Inputs.applyValues(list,values);
   if(r.errors)throw invalid(r.errors.join('; '));
   applied=Object.keys(values);
   return r.components;
  });
  const now=Inputs.valuesOf(page.components);
  return {page,values:Object.fromEntries(applied.map(k=>[k,now[k]]))};
 }
 async createExamplePage(name){
  const ex=EXAMPLES[name];
  if(!ex)throw invalid(`Unknown example "${name}". Available: ${Object.keys(EXAMPLES).join(', ')}.`);
  return this.createPage({title:ex.title,components:structuredClone(ex.components)});
 }
 // Soft archive: recoverable with restorePage, hidden from normal reads.
 async deletePage(id,{expectedRevision}={}){
  const current=await this.row(id);
  await this.write(id,expectedRevision??Number(current.revision),{deleted_at:new Date().toISOString()});
  return {deleted:true,pageId:id,restorable:true};
 }
 async restorePage(id){
  const current=await this.row(id,{archived:true});
  const {data,error}=await this.pages().update({deleted_at:null}).eq('id',id).eq('user_id',this.userId).eq('revision',current.revision).not('deleted_at','is',null).select(PAGE_COLS).maybeSingle();
  if(error)throw dbError(error);
  if(!data)throw new DashboardError('conflict','The page changed while restoring. Retry.');
  return this.resolvePage(data);
 }

 // ---------- agent control ----------
 async show(id,componentId){
  if(typeof id!=='string'||!UUID.test(id))throw notFound();
  if(componentId!==undefined&&componentId!==null&&!componentIdSchema.safeParse(componentId).success)throw notFound();
  const {data,error}=await this.db.rpc('dashboard_show',{p_page_id:id,p_component_id:componentId??null,p_actor:this.actor});
  if(error)throw dbError(error);
  return {seq:Number(data.seq),pageId:id,componentId:componentId??null,actor:this.actor,issuedAt:data.issuedAt,url:this.url(id)};
 }
 async view(){
  const [{data,error},pages]=await Promise.all([this.db.from('dashboard_view').select('page_id,component_id,actor,seq,issued_at').eq('user_id',this.userId).maybeSingle(),this.listPages()]);
  if(error)throw dbError(error);
  const live=data&&pages.some(p=>p.id===data.page_id);
  return {seq:Number(data?.seq||0),pageId:live?data.page_id:null,componentId:live?data.component_id:null,actor:data?.actor||null,issuedAt:data?.issued_at||null,pages:pages.map(({id,title,revision,updatedAt})=>({id,title,revision,updatedAt}))};
 }

 // ---------- models (no writes) ----------
 catalog(){return this.models.catalog;}
 compute(model,params){
  const clean=this.validateModel(model,params);
  const r=this.models.compute(model,clean);
  return {model,params:clean,view:r.view,...(r.extraViews?{extraViews:r.extraViews}:{}),takeaway:r.takeaway,keyNumbers:r.keyNumbers,method:r.method,assumptions:r.assumptions||[]};
 }
 // Validate and compute a component without saving. With pageId, bindings resolve against that page's inputs.
 async preview(component,{pageId}={}){
  const env=this.normalize(component);env.id??='preview';
  let values=Object.create(null);
  if(pageId)values=Inputs.valuesOf((await this.getPage(pageId)).components);
  if(env.kind==='input'){const {errors}=Inputs.collectInputs([env]);if(errors.length)throw invalid(errors.join('; '));}
  let warnings;
  if(env.kind==='vega'){const r=await checkVega(env.spec.definition);if(!r.ok)throw invalid(`Vega-Lite could not compile this definition: ${r.error}`);warnings=r.warnings;}
  const out=this.computeComponent(env,{createdBy:this.actor,updatedAt:null},values);
  if(env.kind==='vega')out.boundParams=Inputs.vegaParamNames(env.spec.definition).filter(n=>Object.hasOwn(values,n));
  return warnings?.length?{...out,warnings}:out;
 }
}
function sortKeys(v){return Array.isArray(v)?v.map(sortKeys):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortKeys(v[k])])):v;}
export {pageIdSchema};
