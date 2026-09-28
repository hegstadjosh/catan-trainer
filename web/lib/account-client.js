(function(){
 let revision=window.CATAN_ACCOUNT_REVISION,pending=null,timer=null,saving=false,failed=false,chain=Promise.resolve();
 let committedForecasts=structuredClone(window.CATAN_ACCOUNT_STATE?.opponents?.forecasts||[]);
 function withCommittedForecasts(state){const next=structuredClone(state);next.opponents={...(next.opponents||{}),forecasts:structuredClone(committedForecasts)};return next;}
 const status=()=>document.getElementById('account-save-status');
 const show=text=>{if(status())status().textContent=text;};
 function queue(fn){const next=chain.then(fn);chain=next.catch(()=>{});return next;}
 async function flush(){
  clearTimeout(timer);
  if(!pending||failed)return chain;
  const state=pending;pending=null;
  return queue(async()=>{saving=true;show('Saving…');try{
   // Rebase at send time: this save may have queued while a forecast POST was in flight.
   const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:withCommittedForecasts(state),revision}),keepalive:true});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Save failed. Reload before editing further.');
   revision=data.revision;show('Saved to your account');
  }catch(e){failed=true;pending=pending||state;show(e.message);throw e;}
  finally{saving=false;if(pending&&!failed)flush();}});
 }
 async function forecast(path,body){
  await flush();if(failed)throw Error('Guide changes are not saved. Reload before editing forecasts.');
  return queue(async()=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,expectedRevision:revision})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Forecast save failed. Reload before retrying.');
   revision=data.revision;
   const at=committedForecasts.findIndex(f=>f.id===data.forecast.id);
   if(at<0)committedForecasts.push(data.forecast);else committedForecasts[at]=data.forecast;
   show('Forecast saved to your account');return data.forecast;});
 }
 window.CatanAccount={save(state){pending=structuredClone(state);show(failed?'Not saved. Reload before editing further.':'Unsaved changes');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),350);},
  createForecast(input){return forecast('/api/forecasts',{input});},
  resolveForecast(id,resolution){return forecast('/api/forecasts/'+encodeURIComponent(id)+'/resolve',resolution);},
  revision(){return revision;}};
 addEventListener('beforeunload',e=>{if(pending||saving){e.preventDefault();e.returnValue='';}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)flush().catch(()=>{});});
})();
