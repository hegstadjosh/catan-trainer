import {siteHeader} from './site-nav.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe=v=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
export function renderPractice(req,res){
 const gameId=UUID.test(req.params.id||'')?req.params.id:null;
 const boot={gameId,email:req.user?.email||'',revision:/^\d+$/.test(req.query.revision||'')?Number(req.query.revision):null,
  attempt:UUID.test(req.query.attempt||'')?req.query.attempt:null};
 res.set('Cache-Control','private, no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Decision practice · Catan field guide</title><link rel="stylesheet" href="/dashboard-assets/history.css"><link rel="stylesheet" href="/dashboard-assets/practice.css"><link rel="stylesheet" href="/dashboard-assets/site-nav.css"><script id="practice-boot" type="application/json">${safe(boot)}</script><script defer src="/dashboard-assets/history-board.js"></script><script defer src="/dashboard-assets/practice.js"></script></head><body><div class="hs">${siteHeader({active:'review',email:boot.email})}<main class="hs-main" id="practice-main" tabindex="-1"><p role="status">Loading decision positions…</p></main><footer class="hs-foot"><p>Practice samples plausible hidden states from what was observable at the chosen move. It does not reveal the actual future until you commit. Exact-copy branches in History use the real hidden state and serve a different purpose.</p></footer></div></body></html>`);
}
