// SSR shell for /dashboard and /dashboard/:id. All data loads client-side from /api/dashboard/*.
// Boot data sits in a non-executed JSON script tag, escaped so text can never close the tag.
import {siteHeader} from './site-nav.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

function siteUrl(req){
 const configured=(process.env.SITE_URL||'').replace(/\/+$/,'');
 if(configured)return configured;
 return `${req.protocol}://${req.get('host')}`;
}

export function renderDashboard(req,res){
 const raw=req.params?.id??(req.path.match(/^\/dashboard\/([^/]+)$/)||[])[1]??null;
 const pageId=raw&&UUID.test(raw)?raw.toLowerCase():null;
 const boot={pageId,badPath:Boolean(raw&&!pageId),email:req.user?.email||'',mcpUrl:siteUrl(req)+'/mcp'};
 res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard · Catan field guide</title><link rel="stylesheet" href="/dashboard-assets/dashboard.css"><link rel="stylesheet" href="/dashboard-assets/site-nav.css"><script id="dashboard-boot" type="application/json">${scriptJSON(boot)}</script><script defer src="/dashboard-assets/d3.min.js"></script><script defer src="/dashboard-assets/math.js"></script><script defer src="/dashboard-assets/models.js"></script><script defer src="/dashboard-assets/dashboard-inputs.js"></script><script defer src="/dashboard-assets/dashboard-charts.js"></script><script defer src="/dashboard-assets/dashboard-vega.js"></script><script defer src="/dashboard-assets/dashboard.js"></script></head>
<body><div id="catan-dash" class="dash">
${siteHeader({active:'dashboard',email:boot.email})}
<div class="dash-shell">
<aside class="dash-side" id="dash-side" aria-label="Dashboard pages"></aside>
<main class="dash-main" id="dash-main" tabindex="-1"><p class="dash-loading" role="status">Loading your dashboard…</p></main>
</div>
<div class="dash-toast-wrap" id="dash-toasts" aria-live="polite"></div>
<div class="dash-sr" id="dash-announce" aria-live="assertive"></div>
<noscript><p class="dash-noscript">The dashboard needs JavaScript.</p></noscript>
</div></body></html>`);
}
