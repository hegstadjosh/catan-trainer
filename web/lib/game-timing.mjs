export async function timedGameIdentity(req,res,verify){
 const gameRead=req.method==='GET'&&/^\/api\/games\/[^/]+$/.test(req.path);
 const gameAction=req.method==='POST'&&/^\/api\/games\/[^/]+\/actions$/.test(req.path);
 if(!gameRead&&!gameAction)return verify(req,res);
 const start=performance.now();
 try{return await verify(req,res);}
 finally{res.append('Server-Timing',`auth;dur=${(performance.now()-start).toFixed(1)}`);}
}
