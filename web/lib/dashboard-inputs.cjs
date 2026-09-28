// Shared dashboard input + binding + Vega-Lite safety rules. CommonJS on the server, plain script in
// the browser (window.DashboardInputs; build.mjs copies it to public/dashboard-inputs.js).
// The server is authoritative; the browser runs the same functions for instant previews and inline errors.
(function(root){
'use strict';
const LIMITS={fields:24,text:200,options:50,label:40,unit:12,vegaBytes:65536,vegaDepth:32,vegaNodes:20000,sequence:10000,maxbins:500,steps:2000,dimension:2000};
const TYPES=['number','text','select','toggle'];
const KEY=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
// Prototype names, Vega-Lite/Vega built-in signal names and expression globals cannot be input keys.
const RESERVED=new Set(['__proto__','prototype','constructor','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toString','toLocaleString','valueOf','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__',
 'width','height','padding','autosize','background','cursor','datum','item','event','parent','group','data','signal','scale','this','window','document','globalThis','undefined','null','true','false','NaN','Infinity','input']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fmtVal=v=>typeof v==='string'?JSON.stringify(v):String(v);

// ---------- fields ----------
function keyError(key){
 if(typeof key!=='string'||!KEY.test(key))return `input key "${String(key).slice(0,40)}" must start with a letter and use only letters, digits or _ (at most 32)`;
 if(RESERVED.has(key)||RESERVED.has(key.toLowerCase()))return `input key "${key}" is reserved; choose another name`;
 return null;
}
function valueError(f,v){
 const name=`input "${f.key}"`;
 if(f.type==='number'){
  if(typeof v!=='number'||!Number.isFinite(v))return `${name} must be a number`;
  if(f.min!=null&&v<f.min)return `${name} must be at least ${f.min}`;
  if(f.max!=null&&v>f.max)return `${name} must be at most ${f.max}`;
  if(f.integer&&!Number.isInteger(v))return `${name} must be a whole number`;
  return null;
 }
 if(f.type==='text'){
  if(typeof v!=='string')return `${name} must be text`;
  if(v.length>LIMITS.text)return `${name} must be at most ${LIMITS.text} characters`;
  if(/[\u0000-\u001F\u007F]/.test(v))return `${name} must be plain single-line text`;
  return null;
 }
 if(f.type==='toggle')return typeof v==='boolean'?null:`${name} must be true or false`;
 if(f.type==='select'){
  const opts=Array.isArray(f.options)?f.options:[];
  return opts.some(o=>o.value===v)?null:`${name} must be one of: ${opts.map(o=>fmtVal(o.value)).join(', ')}`;
 }
 return `${name} has unknown type "${f.type}"`;
}
// Semantic checks for one input tile (structure is checked by zod on the server).
function fieldErrors(fields){
 const errors=[];
 if(!Array.isArray(fields)||!fields.length)return ['fields must list at least one field'];
 if(fields.length>LIMITS.fields)errors.push(`an input tile holds at most ${LIMITS.fields} fields`);
 const seen=new Set();
 fields.forEach((f,i)=>{
  if(!isObj(f)){errors.push(`fields.${i} must be an object`);return;}
  const e=keyError(f.key);if(e){errors.push(e);return;}
  const low=f.key.toLowerCase();
  if(seen.has(low))errors.push(`input key "${f.key}" is used twice in this tile`);
  seen.add(low);
  if(!TYPES.includes(f.type)){errors.push(`input "${f.key}": type must be ${TYPES.join(', ')}`);return;}
  if(f.type==='number'){
   if(f.min!=null&&f.max!=null&&!(f.min<f.max))errors.push(`input "${f.key}": max must be greater than min`);
   if(f.step!=null&&!(f.step>0))errors.push(`input "${f.key}": step must be positive`);
  }else for(const k of ['min','max','step','integer'])if(f[k]!=null)errors.push(`input "${f.key}": ${k} applies only to number fields`);
  if(f.type==='select'){
   const vals=(f.options||[]).map(o=>JSON.stringify(o&&o.value));
   if(!vals.length)errors.push(`input "${f.key}": select needs options`);
   if(new Set(vals).size!==vals.length)errors.push(`input "${f.key}": option values must be unique`);
  }else if(f.options!=null)errors.push(`input "${f.key}": options apply only to select fields`);
  if(f.unit!=null&&f.type!=='number')errors.push(`input "${f.key}": unit applies only to number fields`);
  const ve=valueError(f,f.value);if(ve)errors.push(ve);
  if(isRef(f.value))errors.push(`input "${f.key}": a field value cannot be a binding`);
 });
 return errors;
}
// All input fields on a page. Keys are unique per page, case-insensitively.
function collectInputs(components){
 const fields=new Map(),errors=[],lower=new Map();
 for(const c of components||[]){
  if(!c||c.kind!=='input'||!isObj(c.spec)||!Array.isArray(c.spec.fields))continue;
  for(const f of c.spec.fields){
   if(!isObj(f)||typeof f.key!=='string')continue;
   const low=f.key.toLowerCase();
   if(lower.has(low)){errors.push(`input key "${f.key}" is used by two input tiles ("${lower.get(low)}" and "${c.title}"); keys must be unique on a page`);continue;}
   lower.set(low,c.title);fields.set(f.key,{field:f,componentId:c.id});
  }
 }
 return {fields,errors};
}
function valuesOf(components){
 const out=Object.create(null);
 for(const [k,{field}] of collectInputs(components).fields)out[k]=field.value;
 return out;
}

// ---------- bindings {input:'key'} ----------
function isRef(v){return isObj(v)&&own(v,'input')&&Object.keys(v).length===1;}
// Every binding inside a value, with malformed-binding errors (objects that mention input but are not exactly a binding).
function refsIn(value,path='params',out={keys:[],errors:[]},depth=0){
 if(depth>8){out.errors.push(`${path} is nested too deeply`);return out;}
 if(Array.isArray(value)){value.forEach((v,i)=>refsIn(v,`${path}[${i}]`,out,depth+1));return out;}
 if(!isObj(value))return out;
 if(own(value,'input')){
  if(!isRef(value))out.errors.push(`${path}: a binding must be exactly {"input":"key"}`);
  else if(typeof value.input!=='string')out.errors.push(`${path}: binding key must be a string (bindings cannot nest)`);
  else{const e=keyError(value.input);if(e)out.errors.push(`${path}: ${e}`);else out.keys.push(value.input);}
  return out;
 }
 for(const k of Object.keys(value))refsIn(value[k],`${path}.${k}`,out,depth+1);
 return out;
}
function resolveRefs(value,values){
 const missing=[];
 const walk=v=>{
  if(Array.isArray(v))return v.map(walk);
  if(isRef(v)&&typeof v.input==='string'){if(values&&own(values,v.input))return values[v.input];missing.push(v.input);return v;}
  if(isObj(v)){const o={};for(const k of Object.keys(v))o[k]=walk(v[k]);return o;}
  return v;
 };
 return {value:walk(value),missing:[...new Set(missing)]};
}
// Compute a model component's resolved params. Returns {params} or {errors}.
function resolveModel(models,spec,values){
 const refs=refsIn(spec.params||{});
 if(refs.errors.length)return {errors:refs.errors};
 const r=resolveRefs(spec.params||{},values);
 if(r.missing.length)return {errors:r.missing.map(k=>`missing input "${k}": add an input field with this key or remove the binding`),missing:r.missing};
 const v=models.validate(spec.model,r.value);
 if(!v.ok)return {errors:v.errors};
 return {params:v.params};
}
// Compute a model tile exactly as the server does (browser uses the same file).
function computeModel(models,spec,values){
 const r=resolveModel(models,spec,values);
 if(r.errors)return r;
 const out=models.compute(spec.model,r.params);
 return {params:r.params,computed:{view:out.view,...(out.extraViews?{extraViews:out.extraViews}:{}),takeaway:out.takeaway,keyNumbers:out.keyNumbers,method:out.method,assumptions:out.assumptions||[],inputs:refsIn(spec.params||{}).keys.filter((k,i,a)=>a.indexOf(k)===i)}};
}
// Model params with defaults filled but bindings kept as stored.
function fillDefaults(catalogEntry,params){
 const out={};
 for(const p of catalogEntry.params)out[p.key]=params&&params[p.key]!==undefined?params[p.key]:catalogEntry.defaults[p.key];
 for(const k of Object.keys(params||{}))if(!own(out,k))out[k]=params[k];
 return out;
}

// ---------- values ----------
// Apply {key:value} to a component list. Returns {components} or {errors}. Never mutates the input.
function applyValues(components,values){
 if(!isObj(values)||!Object.keys(values).length)return {errors:['values must be an object with at least one input key']};
 const {fields,errors}=collectInputs(components);
 if(errors.length)return {errors};
 const errs=[];
 for(const k of Object.keys(values)){
  const hit=fields.get(k);
  if(!hit){errs.push(`unknown input "${k}". Inputs on this page: ${[...fields.keys()].join(', ')||'none'}`);continue;}
  const e=valueError(hit.field,values[k]);if(e)errs.push(e);
 }
 if(errs.length)return {errors:errs};
 return {components:components.map(c=>{
  if(!c||c.kind!=='input'||!c.spec||!Array.isArray(c.spec.fields)||!c.spec.fields.some(f=>own(values,f.key)))return c;
  return {...c,spec:{...c.spec,fields:c.spec.fields.map(f=>own(values,f.key)?{...f,value:values[f.key]}:f)}};
 })};
}
// Field-scoped conflict merge. base = values when the user started, mine = the user's pending values,
// server = the latest saved values. A key the other writer also changed is a conflict, never overwritten.
function mergeValues(base,mine,server){
 const apply={},conflicts=[];
 for(const k of Object.keys(mine)){
  if(!own(server,k)){conflicts.push({key:k,missing:true,mine:mine[k]});continue;}
  if(server[k]===mine[k])continue;
  if(own(base,k)&&server[k]!==base[k]){conflicts.push({key:k,theirs:server[k],mine:mine[k]});continue;}
  apply[k]=mine[k];
 }
 return {apply,conflicts};
}
// Keys referenced by model tiles (hard bindings) and matched by Vega-Lite params (soft, by name).
function dependents(components,key){
 const out=[];
 for(const c of components||[]){
  if(!c)continue;
  if(c.kind==='model'&&refsIn(c.spec&&c.spec.params).keys.includes(key))out.push({id:c.id,title:c.title,kind:'model'});
  else if(c.kind==='vega'&&vegaParamNames(c.spec&&c.spec.definition).includes(key))out.push({id:c.id,title:c.title,kind:'vega'});
 }
 return out;
}
// Give a duplicated input tile fresh keys (wood -> wood_2).
function renameKeys(component,taken){
 if(!component||component.kind!=='input')return component;
 const used=new Set([...taken].map(k=>k.toLowerCase()));
 const fields=component.spec.fields.map(f=>{
  let n=2,base=f.key.replace(/_\d+$/,'').slice(0,28),k=`${base}_${n}`;
  while(used.has(k.toLowerCase()))k=`${base}_${++n}`;
  used.add(k.toLowerCase());return {...f,key:k};
 });
 return {...component,spec:{...component.spec,fields}};
}
// Human editing helpers.
function decimals(x){const s=String(x);return s.includes('.')?s.split('.')[1].length:0;}
function stepValue(f,current,dir){
 const step=f.step>0?f.step:1,d=Math.max(decimals(step),decimals(f.min??0));
 let v=(Number.isFinite(current)?current:(f.min??0))+dir*step;
 v=Number(v.toFixed(Math.min(10,d)));
 if(f.min!=null)v=Math.max(f.min,v);if(f.max!=null)v=Math.min(f.max,v);
 return v;
}
function parseDraft(f,text){
 if(f.type!=='number')return {value:text};
 const t=String(text).trim().replace(/,/g,'');
 if(t===''||t==='-'||t==='.')return {error:'Enter a number'};
 const v=Number(t);
 if(!Number.isFinite(v))return {error:'Enter a number'};
 const e=valueError(f,v);
 return e?{error:e.replace(/^input "[^"]+" /,'Must be ').replace(/^Must be must/,'Must')}:{value:v};
}

// ---------- Vega-Lite ----------
const SCHEMA=/^https:\/\/vega\.github\.io\/schema\/vega-lite\/v[56](\.\d+){0,2}\.json$/;
const BLOCKED_KEYS=new Set(['url','href','loader','element','$ref']);
const EXPR_KEYS=new Set(['calculate','filter','expr','test','update','signal']);
const URLISH=/^\s*(?:(?:https?|ftp|ftps|file|data|javascript|vbscript|blob|ws|wss|mailto|about|filesystem|chrome|ipfs)\s*:|\/\/|\\\\)/i; // external schemes or protocol-relative
const CSS_URL=/url\s*\(|@import|expression\s*\(/i;
const HTML=/<\s*\/?\s*[a-z!][^<>]*>/i;
function vegaErrors(def){
 const errors=[];
 if(!isObj(def))return ['definition must be a Vega-Lite JSON object'];
 let bytes=0;try{bytes=JSON.stringify(def).length;}catch{return ['definition must be plain JSON'];}
 if(bytes>LIMITS.vegaBytes)errors.push(`definition is larger than ${LIMITS.vegaBytes/1024} KB`);
 if(own(def,'$schema')&&!(typeof def.$schema==='string'&&SCHEMA.test(def.$schema)))errors.push('$schema must be a Vega-Lite v5/v6 schema URL (plain Vega specs are not accepted)');
 if(own(def,'signals')||own(def,'marks')&&Array.isArray(def.marks))errors.push('definition looks like a Vega spec; use Vega-Lite (mark/encoding/layer/…)');
 if(!['mark','layer','facet','repeat','concat','hconcat','vconcat','spec'].some(k=>own(def,k)))errors.push('definition needs a mark, layer, facet, repeat or concat');
 let nodes=0;
 const add=(path,msg)=>{if(errors.length<12)errors.push(`${path}: ${msg}`);};
 const walk=(v,path,depth,key)=>{
  if(++nodes>LIMITS.vegaNodes){if(nodes===LIMITS.vegaNodes+1)errors.push('definition has too many values');return;}
  if(depth>LIMITS.vegaDepth){add(path,'nested too deeply');return;}
  if(typeof v==='string'){
   if(path==='definition.$schema')return;
   if(URLISH.test(v))add(path,'links and external resources are not allowed');
   else if(CSS_URL.test(v))add(path,'url()/import references are not allowed');
   else if(!EXPR_KEYS.has(key)&&HTML.test(v))add(path,'HTML is not allowed; use plain text');
   return;
  }
  if(typeof v==='number'){if(!Number.isFinite(v))add(path,'numbers must be finite');return;}
  if(v===null||typeof v==='boolean')return;
  if(Array.isArray(v)){v.forEach((x,i)=>walk(x,`${path}[${i}]`,depth+1,key));return;}
  if(!isObj(v)){add(path,'unsupported value');return;}
  const proto=Object.getPrototypeOf(v);if(proto!==Object.prototype&&proto!==null){add(path,'must be plain JSON');return;}
  for(const k of Object.keys(v)){
   const p=`${path}.${k}`;
   if(k==='__proto__'||k==='constructor'||k==='prototype'){add(p,'reserved property name');continue;}
   if(BLOCKED_KEYS.has(k)){add(p,k==='url'?'remote data is not allowed; put rows in data.values':k==='href'?'links are not allowed':'not allowed');continue;}
   if(k==='bind'&&!(v[k]==='scales'||v[k]==='legend'||isObj(v[k])&&Object.keys(v[k]).every(x=>x==='legend'))){add(p,'only bind "scales" or "legend" is allowed; use an input tile for controls');continue;}
   if(k==='mark'&&(v[k]==='image'||isObj(v[k])&&v[k].type==='image')){add(p,'image marks are not allowed');continue;}
   if(k==='sequence'&&isObj(v[k])){const s=v[k],n=(s.stop-s.start)/(s.step||1);if(!(Number.isFinite(n)&&n>=0&&n<=LIMITS.sequence))add(p,`sequence may generate at most ${LIMITS.sequence} rows`);}
   if(k==='keyvals'&&isObj(v[k])){const s=v[k],n=(s.stop-s.start)/(s.step||1);if(!(Number.isFinite(n)&&n>=0&&n<=LIMITS.sequence))add(p,`keyvals may generate at most ${LIMITS.sequence} values`);}
   if(k==='maxbins'&&typeof v[k]==='number'&&v[k]>LIMITS.maxbins)add(p,`at most ${LIMITS.maxbins}`);
   if(k==='steps'&&typeof v[k]==='number'&&v[k]>LIMITS.steps)add(p,`at most ${LIMITS.steps}`);
   if((k==='width'||k==='height')&&typeof v[k]==='number'&&(v[k]<0||v[k]>LIMITS.dimension))add(p,`must be 0–${LIMITS.dimension}`);
   walk(v[k],p,depth+1,k);
  }
 };
 walk(def,'definition',0,'');
 if(Array.isArray(def.params))def.params.forEach((p,i)=>{if(isObj(p)&&typeof p.name==='string'&&p.name.length>0&&RESERVED.has(p.name))add(`definition.params[${i}].name`,`"${p.name}" is reserved`);});
 return errors;
}
// Names of top-level Vega-Lite variable params that an input can drive.
function vegaParamNames(def){
 if(!isObj(def)||!Array.isArray(def.params))return [];
 return def.params.filter(p=>isObj(p)&&typeof p.name==='string'&&!own(p,'select')&&!own(p,'expr')).map(p=>p.name);
}
// Copy of the definition with matching params set to the current input values.
function injectParams(def,values){
 const out=JSON.parse(JSON.stringify(def));
 if(Array.isArray(out.params))out.params=out.params.map(p=>isObj(p)&&typeof p.name==='string'&&!own(p,'select')&&!own(p,'expr')&&values&&own(values,p.name)?{...p,value:values[p.name]}:p);
 return out;
}

const api={LIMITS,TYPES,KEY,RESERVED,keyError,valueError,fieldErrors,collectInputs,valuesOf,isRef,refsIn,resolveRefs,resolveModel,computeModel,fillDefaults,applyValues,mergeValues,dependents,renameKeys,stepValue,parseDraft,vegaErrors,vegaParamNames,injectParams};
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.DashboardInputs=api;
})(typeof window!=='undefined'?window:globalThis);
