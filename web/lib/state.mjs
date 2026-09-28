import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import {gameDb} from './game-store.mjs';
const require=createRequire(import.meta.url);
const F=require('./forecast-model.cjs');

export async function loadState(supabase){
 const {data,error}=await supabase.from('guide_state').select('state,revision').maybeSingle();
 if(error)throw Error('Could not load saved guide.');
 return data||{state:null,revision:0};
}
export async function saveState(req,res){
 const {state,revision}=req.body||{};
 if(!state||typeof state!=='object'||Array.isArray(state)||!Number.isSafeInteger(revision)||revision<0)return res.status(400).json({error:'Invalid saved state.'});
 const prior=await loadState(req.supabase);
 if(prior.revision!==revision)return res.status(409).json({error:'Changed on another device. Reload before saving.'});
 const before=prior.state?.opponents?.forecasts||[],after=state.opponents?.forecasts||[];
 if(!isDeepStrictEqual(before,after))return res.status(409).json({error:'Forecast commitments changed. Reload and use the forecast controls to create or resolve them.'});
 const {data,error}=await req.supabase.rpc('save_guide_state',{p_expected_revision:revision,p_state:state});
 if(error)return res.status(error.code==='P0001'?409:503).json({error:error.code==='P0001'?'Changed on another device. Reload before saving.':'Save failed. Your changes are still on this page.'});
 res.json({revision:data});
}

const revArg=v=>Number.isSafeInteger(v)&&v>=0;
const dataError=res=>res.status(503).json({error:'Forecast storage is temporarily unavailable.'});
async function updateForecast(req,res,transform){
 const expectedRevision=req.body?.expectedRevision;
 if(!revArg(expectedRevision))return res.status(400).json({error:'Send expectedRevision from your latest saved guide.'});
 try{res.json(await forecastMutation({authDb:req.supabase,serviceDb:req.forecastDb??gameDb(),userId:req.user.id,expectedRevision,transform}));}
 catch(e){return res.status(e.code==='conflict'?409:e.code==='invalid'?400:503).json({error:e.message});}
}
export async function forecastMutation({authDb,serviceDb=gameDb(),userId,expectedRevision,transform}){
 if(!revArg(expectedRevision))throw Object.assign(Error('Send expectedRevision from your latest saved guide.'),{code:'invalid'});
 const prior=await loadState(authDb);
 if(prior.revision!==expectedRevision)throw Object.assign(Error('Changed on another device. Reload before editing forecasts.'),{code:'conflict'});
 const state=structuredClone(prior.state||{}),opponents=state.opponents&&typeof state.opponents==='object'?state.opponents:{};
 const forecasts=Array.isArray(opponents.forecasts)?opponents.forecasts:[];
 let record;
 try{record=transform(forecasts);}catch(e){throw Object.assign(e,{code:'invalid'});}
 state.opponents={...opponents,forecasts};
 const result=expectedRevision===0
  ?await serviceDb.from('guide_state').insert({user_id:userId,state,revision:1}).select('revision').maybeSingle()
  :await serviceDb.from('guide_state').update({state,revision:expectedRevision+1,updated_at:new Date().toISOString()})
   .eq('user_id',userId).eq('revision',expectedRevision).select('revision').maybeSingle();
 if(result.error||!result.data)throw Object.assign(Error(result.error?.code==='23505'||!result.data?'Changed on another device. Reload before editing forecasts.':'Forecast storage is temporarily unavailable.'),{code:result.error?.code==='23505'||!result.data?'conflict':'unavailable'});
 return {revision:result.data.revision,forecast:record};
}
export const forecastCreate=(args,input)=>forecastMutation({...args,transform:forecasts=>{const {id,createdAt,fp,res,...clean}=input||{};const record=F.makeForecast(clean);if(forecasts.some(f=>f.id===record.id))throw Error('Forecast ID collision; please retry.');forecasts.push(record);return record;}});
export const forecastResolve=(args,id,resolution)=>forecastMutation({...args,transform:forecasts=>{const at=forecasts.findIndex(f=>f.id===id);if(at<0)throw Error('Forecast not found.');if(!F.intact(forecasts[at]))throw Error('Stored forecast is invalid; it was not changed.');const updated=F.resolveForecast(forecasts[at],resolution||{});forecasts[at]=updated;return updated;}});
export async function createForecast(req,res){
 return updateForecast(req,res,forecasts=>{const {id,createdAt,fp,res,...input}=req.body?.input||{};const record=F.makeForecast(input);if(forecasts.some(f=>f.id===record.id))throw Error('Forecast ID collision; please try again.');forecasts.push(record);return record;});
}
export async function resolveForecast(req,res){
 return updateForecast(req,res,forecasts=>{
  const at=forecasts.findIndex(f=>f.id===req.params.id);
  if(at<0)throw Error('Forecast not found.');
  const previous=forecasts[at];
  if(!F.intact(previous))throw Error('Stored forecast is invalid; it was not changed.');
  const updated=F.resolveForecast(previous,req.body||{});
  forecasts[at]=updated;return updated;
 });
}
export async function listForecasts(req,res){
 const {state,revision}=await loadState(req.supabase);
 let forecasts=state?.opponents?.forecasts||[];
 if(req.query.opp)forecasts=forecasts.filter(f=>f.opp===req.query.opp);
 if(req.query.outcome)forecasts=forecasts.filter(f=>f.res?.outcome===req.query.outcome);
 if(req.query.since)forecasts=forecasts.filter(f=>f.createdAt>=req.query.since);
 res.json({revision,forecasts,score:F.score(forecasts)});
}
