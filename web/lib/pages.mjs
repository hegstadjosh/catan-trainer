import {guidePage,flashPage,accountClient} from './generated-pages.mjs';
import {loadState} from './state.mjs';
import {siteHeader} from './site-nav.mjs';
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
export async function renderPage(req,res){
 const flash=req.path.includes('flashcards'),{state,revision}=flash?{state:null,revision:0}:await loadState(req.supabase);
 const bar=siteHeader({active:flash?'train':'analyze',email:req.user.email,saveStatus:!flash});
 const css='<link rel="stylesheet" href="/dashboard-assets/site-nav.css">';
 const sectionNav=flash?'':`<script>function syncSiteArea(){const train=/^#practice(?:-|$)/.test(location.hash)||location.hash==='#opponents-forecast';document.querySelectorAll('.site-primary a').forEach(a=>{if(a.textContent===(train?'Train':'Analyze'))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});const title=document.querySelector('#catan-lab .cl-header h1'),context=document.querySelector('#catan-lab .cl-status');if(title)title.textContent=train?'Train':'Analyze';if(context)context.textContent=train?'Practice a decision. Check the assumptions.':'Plan a move. Understand the odds.'}addEventListener('hashchange',syncSiteArea);addEventListener('DOMContentLoaded',syncSiteArea);syncSiteArea()</script>`;
 const boot=flash?'':`<script>window.CATAN_ACCOUNT_STATE=${scriptJSON(state)};window.CATAN_ACCOUNT_REVISION=${revision};${accountClient}</script>`;
 const html=(flash?flashPage:guidePage).replace('<body>','<body>'+bar+css+sectionNav+boot);
 res.type('html').send(html);
}
