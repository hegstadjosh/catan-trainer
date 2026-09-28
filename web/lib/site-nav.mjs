import {escape} from './login.mjs';

const areas=[
 ['play','Play','/game'],
 ['analyze','Analyze','/#play'],
 ['train','Train','/train'],
 ['review','Review','/history'],
 ['dashboard','Dashboard','/dashboard']
];

// One site-level navigation on every authenticated surface. Page-specific controls
// stay below it; this header never reads or changes a game or guide record.
export function siteHeader({active,email='',saveStatus=false,context=null}={}){
 if(!areas.some(([id])=>id===active))throw new Error('Unknown site area');
 const links=areas.map(([id,label,url])=>`<a href="${url}"${id===active?' aria-current="page"':''}>${label}</a>`).join('');
 const contextLink=context?`<a class="site-context" href="${escape(context.href)}">${escape(context.label)}</a>`:'';
 return `<header class="site-header"><div class="site-header-inner"><a class="site-brand" href="/game" aria-label="Catan home: Play">CATAN <span>field guide</span></a><nav class="site-primary" aria-label="Main navigation">${links}</nav><details class="site-account"><summary aria-label="Account and more options">Account</summary><div class="site-account-panel"><span class="site-account-email">${escape(email)}</span><a href="/game-tools">Game tools <small>Advanced</small></a><form method="post" action="/auth/signout"><button type="submit">Sign out</button></form></div></details></div>${saveStatus?'<span id="account-save-status" class="site-save-status" role="status">Saved to your account</span>':''}${contextLink}</header>`;
}
