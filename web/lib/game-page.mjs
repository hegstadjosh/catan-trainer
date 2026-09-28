// SSR shell for /game (game list) and /game/:id (one game). All game data loads client-side from /api/games/*.
// Boot data sits in a non-executed JSON script tag, escaped so text can never close the tag.
import {siteHeader} from './site-nav.mjs';

const GAME_ID=/^[A-Za-z0-9_-]{1,80}$/;
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

export function renderGame(req,res){
 const raw=req.params?.id??(req.path.match(/^\/game\/([^/]+)\/?$/)||[])[1]??null;
 const gameId=raw&&GAME_ID.test(raw)?raw:null;
 const boot={gameId,badPath:Boolean(raw&&!gameId),email:req.user?.email||''};
 res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${gameId?'Game':'Games'} · Catan field guide</title><link rel="stylesheet" href="/dashboard-assets/game.css"><link rel="stylesheet" href="/dashboard-assets/site-nav.css"><script id="game-boot" type="application/json">${scriptJSON(boot)}</script><script defer src="/dashboard-assets/sidekick.js"></script><script defer src="/dashboard-assets/game-tracker.js"></script><script defer src="/dashboard-assets/board-viewport.js"></script><script defer src="/dashboard-assets/game.js"></script></head>
<body${gameId?' class="gw-page"':''}><div id="catan-game" class="gm">
${siteHeader({active:'play',email:boot.email})}
<main class="gm-main" id="gm-main" tabindex="-1"><p class="gm-loading" role="status">Loading…</p></main>
<footer class="gm-foot">
<p><a href="/privacy">Privacy</a> · Rules engine adapted from <a href="https://github.com/Viral-Doshi/catan" rel="noopener noreferrer">Viral Doshi's catan</a> (<a href="/dashboard-assets/catan-engine-LICENSE.txt">MIT License</a>, © 2024 Viral Doshi). Board and pieces are original drawings. Not affiliated with Catan GmbH.</p>
</footer>
<div class="gm-toasts" id="gm-toasts" aria-live="polite"></div>
<noscript><p class="gm-noscript">The game needs JavaScript.</p></noscript>
</div></body></html>`);
}
