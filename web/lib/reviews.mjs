import './flash-model.js';
const M=globalThis.CatanFlashMath,ids=new Set(M.buildDeck().map(c=>c.id));
export async function getReviews({supabase},res){
 const rows=[];
 for(let start=0;start<=ids.size;start+=1000){
  const {data,error}=await supabase.from('math_reviews').select('card_id,record').order('card_id').range(start,start+999);
  if(error)return res.status(503).json({error:'Could not load reviews. Please retry.'});
  rows.push(...data);if(data.length<1000)break;
 }
 res.json({records:Object.fromEntries(rows.map(r=>[r.card_id,r.record]))});
}
export async function saveReview(req,res){
 const p=req.body;
 if(!p||!ids.has(p.id)||!['again','hard','good','easy'].includes(p.grade)||!/^[a-zA-Z0-9-]{10,80}$/.test(p.reviewId||'')||!Number.isFinite(p.previousLast))return res.status(400).json({error:'Invalid review.'});
 const {data,error}=await req.supabase.from('math_reviews').select('record').eq('card_id',p.id).maybeSingle();
 if(error)return res.status(503).json({error:'Could not load review.'});
 if(data?.record.reviewId===p.reviewId)return res.json({record:data.record});
 if((data?.record.last||0)!==p.previousLast)return res.status(409).json({error:'Reviewed on another device. Reload for the latest schedule.'});
 const record={...M.schedule(data?.record,p.grade),reviewId:p.reviewId};
 const result=await req.supabase.rpc('save_math_review',{p_card_id:p.id,p_previous_last:p.previousLast,p_record:record});
 if(result.error)return res.status(result.error.code==='P0001'?409:503).json({error:'Could not save. Reload if another device reviewed this card.'});
 res.json({record:result.data});
}
