// SSR shell for /history (match library) and /history/:id (replay). All data loads client-side from
// /api/history/* (session + same-origin checked). Boot data sits in a non-executed JSON script tag.
import {siteHeader} from './site-nav.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

export function renderHistory(req,res){
 const raw=req.params?.id??null;
 const gameId=raw&&UUID.test(raw)?raw.toLowerCase():null;
 const rev=typeof req.query?.revision==='string'&&/^\d{1,9}$/.test(req.query.revision)?Number(req.query.revision):null;
 const boot={gameId,badPath:Boolean(raw&&!gameId),revision:rev,email:req.user?.email||''};
 res.set('Cache-Control','private, no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${gameId?'Replay':'Match history'} · Catan field guide</title><link rel="stylesheet" href="/dashboard-assets/history.css"><link rel="stylesheet" href="/dashboard-assets/site-nav.css"><script id="history-boot" type="application/json">${scriptJSON(boot)}</script><script defer src="/dashboard-assets/history-board.js"></script><script defer src="/dashboard-assets/history.js"></script></head>
<body><div id="catan-history" class="hs">
${siteHeader({active:'review',email:boot.email})}
<main class="hs-main" id="hs-main" tabindex="-1"><p class="hs-muted" role="status">Loading…</p></main>
<footer class="hs-foot"><p>Replays show what you could see at each move unless you turn on full information. Moves from before history recording began keep only your hand, the dice and the move text. Snapshots and notes are kept while the game exists in your account. <a href="/privacy">Privacy policy</a>.</p></footer>
<div class="hs-toasts" id="hs-toasts" aria-live="polite"></div>
<noscript><p class="hs-noscript">Match history needs JavaScript.</p></noscript>
</div></body></html>`);
}
