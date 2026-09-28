import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
let guide=read('index.html').replace('href="flashcards.html"','href="/flashcards"');
guide=guide.replace("if(window.openai?.widgetState?.modelContent)","if(Object.hasOwn(window,'CATAN_ACCOUNT_STATE'))restore(window.CATAN_ACCOUNT_STATE);else if(window.openai?.widgetState?.modelContent)");
guide=guide.replace("function save(){try{localStorage.setItem", "function save(){if(window.CatanAccount){window.CatanAccount.save(state);return;}try{localStorage.setItem");
let flash=read('flashcards.html').replace('<script>','<script>window.CATAN_CLOUD=true;').replace('href="index.html"','href="/"');
const client=read('web/lib/account-client.js');
fs.writeFileSync(new URL('lib/generated-pages.mjs',import.meta.url),`export const guidePage=${JSON.stringify(guide)};\nexport const flashPage=${JSON.stringify(flash)};\nexport const accountClient=${JSON.stringify(client)};\n`);
fs.copyFileSync(new URL('src/flash-model.js',root),new URL('lib/flash-model.js',import.meta.url));
console.log('Built authenticated guide and flashcards.');

fs.copyFileSync(new URL('src/quant-math.js',root),new URL('lib/quant-math.cjs',import.meta.url));
fs.writeFileSync(new URL('lib/catan-math.cjs',import.meta.url),read('src/model.js').replace("require('./quant-math.js')","require('./quant-math.cjs')"));
fs.copyFileSync(new URL('src/forecast-model.js',root),new URL('lib/forecast-model.cjs',import.meta.url));
fs.writeFileSync(new URL('lib/uncertainty-drills.cjs',import.meta.url),read('src/uncertainty-drills.js').replace("require('./forecast-model.js')","require('./forecast-model.cjs')"));

fs.mkdirSync(new URL('./public',import.meta.url),{recursive:true});
fs.copyFileSync(new URL('./lib/dashboard-models.cjs',import.meta.url),new URL('./public/models.js',import.meta.url));
fs.writeFileSync(new URL('./public/math.js',import.meta.url),read('src/quant-math.js')+'\n'+read('src/model.js'));
fs.copyFileSync(new URL('./lib/site-nav.css',import.meta.url),new URL('./public/site-nav.css',import.meta.url));
fs.copyFileSync(new URL('../vendor/d3.min.js',import.meta.url),new URL('./public/d3.min.js',import.meta.url));
fs.copyFileSync(new URL('./lib/dashboard-inputs.cjs',import.meta.url),new URL('./public/dashboard-inputs.js',import.meta.url));
// Vega / Vega-Lite for vega tiles, served locally and loaded only when a page has one (see public/dashboard-vega.js).
const nm=p=>new URL('./node_modules/'+p,import.meta.url),pub=p=>new URL('./public/'+p,import.meta.url);
fs.copyFileSync(nm('vega/build/vega.min.js'),pub('vega.min.js'));
fs.copyFileSync(nm('vega-lite/build/vega-lite.min.js'),pub('vega-lite.min.js'));
// vega-interpreter ships only as an ES module importing vega-util; vega.min.js re-exports those helpers.
const interp=fs.readFileSync(nm('vega-interpreter/build/vega-interpreter.js'),'utf8');
const head="import { ascending, isString, DisallowedObjectProperties } from 'vega-util';",tail='export { expression as expressionInterpreter };';
if(!interp.includes(head)||!interp.includes(tail))throw new Error('vega-interpreter build changed; update build.mjs');
fs.writeFileSync(pub('vega-interpreter.js'),'/* vega-interpreter 2.x (BSD-3-Clause), wrapped for the browser */\n(function(){\n\'use strict\';\nconst { ascending, isString, DisallowedObjectProperties } = window.vega;\n'+interp.replace(head,'').replace(tail,'window.vegaInterpreter={expressionInterpreter:expression};')+'\n})();\n');
fs.writeFileSync(pub('vega-LICENSE.txt'),['vega','vega-lite','vega-interpreter'].map(p=>`${p}\n\n`+fs.readFileSync(nm(p+'/LICENSE'),'utf8')).join('\n\n'));

fs.copyFileSync(new URL('./game/LICENSE',import.meta.url),new URL('./public/catan-engine-LICENSE.txt',import.meta.url));
