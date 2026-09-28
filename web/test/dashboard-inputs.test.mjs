// Input tiles, {input:'key'} bindings, Vega-Lite tiles, set_input_values CAS and MCP parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {componentInput} from '../lib/dashboard-schema.mjs';
import {DashboardStore,Inputs,defaultModels} from '../lib/dashboard-store.mjs';
import {EXAMPLES,componentCatalog} from '../lib/dashboard-catalog.mjs';
import {dashboardRoutes} from '../lib/dashboard-routes.mjs';
import {mcpRoutes} from '../lib/mcp.mjs';
import {fakeDb} from './dashboard-fake-db.mjs';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const storeFor=(db,uid,actor='user')=>new DashboardStore({db:db.client(uid),userId:uid,actor,siteUrl:'https://catan.test'});
const num=(key,value,extra={})=>({key,label:key,type:'number',value,min:0,max:19,step:1,integer:true,...extra});
const inputTile=(fields,id)=>({...(id?{id}:{}),kind:'input',title:'Hand',spec:{fields}});
const HAND=['wood','brick','sheep','wheat','ore'];
const boundBuild={id:'b',kind:'model',title:'Build',spec:{model:'build_eta',params:{hand:HAND.map(k=>({input:k}))}}};
const vega=(definition,extra={})=>({kind:'vega',title:'V',spec:{definition},source:{label:'test'},...extra});
const bar={data:{values:[{a:'x',b:1}]},mark:'bar',encoding:{x:{field:'a',type:'nominal'},y:{field:'b',type:'quantitative'}}};
const code=async p=>(await p.catch(e=>e)).code;

test('input fields: keys, reserved names, bounds, options and duplicate keys',()=>{
 const ok=componentInput.safeParse(inputTile([num('wood',2,{unit:'cards'}),{key:'mode',label:'Mode',type:'select',value:'b',options:[{label:'A',value:'a'},{label:'B',value:'b'}]},{key:'note',label:'Note',type:'text',value:'hi'},{key:'port',label:'Port',type:'toggle',value:true}]));
 assert.ok(ok.success,JSON.stringify(ok.error?.issues));
 const bad=[
  [num('1wood',1)],[num('wood-x',1)],[num('__proto__',1)],[num('constructor',1)],[num('Width',1)],[num('datum',1)],[num('a'.repeat(33),1)],
  [num('wood',1),num('WOOD',2)],                                  // duplicate in one tile (case-insensitive)
  [num('wood',20)],[num('wood',1.5)],[num('wood',1,{min:5,max:5})],[num('wood',1,{step:0})],
  [{key:'m',label:'M',type:'select',value:'z',options:[{label:'A',value:'a'}]}],
  [{key:'m',label:'M',type:'select',value:'a',options:[{label:'A',value:'a'},{label:'A2',value:'a'}]}],
  [{key:'t',label:'T',type:'text',value:'x'.repeat(201)}],[{key:'t',label:'T',type:'text',value:'a',min:1}],
  [{key:'t',label:'T',type:'toggle',value:'yes'}],[{key:'t',label:'T',type:'color',value:1}],
  [{key:'t',label:'<b>T\u0007',type:'toggle',value:true}],
  [{key:'c',label:'C',type:'number',value:{input:'d'}}],             // values cannot be bindings, so bindings never chain or cycle
  Array.from({length:25},(_,i)=>num('k'+i,0))
 ];
 for(const fields of bad)assert.equal(componentInput.safeParse(inputTile(fields)).success,false,JSON.stringify(fields).slice(0,120));
 const {errors}=Inputs.collectInputs([inputTile([num('wood',1)]),inputTile([num('Wood',1)])]);
 assert.match(errors[0],/unique on a page/);
});

test('bindings: malformed, nested and missing references are rejected; stored refs are kept',async()=>{
 assert.deepEqual(Inputs.refsIn({hand:[{input:'wood'},1,{input:'ore'}],x:{input:'port'}}).keys,['wood','ore','port']);
 assert.match(Inputs.refsIn({hand:[{input:'wood',extra:1}]}).errors[0],/exactly/);
 assert.match(Inputs.refsIn({hand:{input:{input:'wood'}}}).errors[0],/cannot nest/);
 assert.match(Inputs.refsIn({hand:{input:'__proto__'}}).errors[0],/reserved|must start/);
 assert.deepEqual(Inputs.resolveRefs({a:[{input:'x'},{input:'y'}]},{x:1}),{value:{a:[1,{input:'y'}]},missing:['y']});
 const db=fakeDb(),s=storeFor(db,A,'agent');
 // missing input on the page
 assert.match((await s.createPage({title:'x',components:[boundBuild]}).catch(e=>e)).message,/missing input "wood"/);
 // duplicate keys across tiles
 assert.equal(await code(s.createPage({title:'x',components:[inputTile([num('wood',1)]),inputTile([num('wood',2)])]})),'invalid');
 // wrong type for the model param (toggle where a count is expected)
 assert.match((await s.createPage({title:'x',components:[inputTile([...HAND.slice(1).map(k=>num(k,1)),{key:'wood',label:'W',type:'toggle',value:true}]),boundBuild]}).catch(e=>e)).message,/hand\[0\] must be a number/);
 const p=await s.createPage({title:'Live',components:[inputTile(HAND.map(k=>num(k,1)),'hand'),boundBuild]});
 assert.deepEqual(db.tables.dashboard_pages[0].components[1].spec.params.hand,HAND.map(k=>({input:k})),'stored bindings are not replaced by values');
 assert.deepEqual(p.components[1].spec.params.hand,HAND.map(k=>({input:k})));
 assert.deepEqual(p.components[1].computed.inputs,HAND);
 // removing or renaming an input that a model uses is refused
 assert.match((await s.removeComponent(p.id,{expectedRevision:1,componentId:'hand'}).catch(e=>e)).message,/"Build" uses wood, brick, sheep, wheat, ore/);
 assert.equal(await code(s.updateComponent(p.id,{expectedRevision:1,componentId:'hand',changes:{spec:{fields:[num('lumber',1),...HAND.slice(1).map(k=>num(k,1))]}}})),'invalid');
 // corrupt stored data: dangling binding renders an error but keeps the spec intact
 db.tables.dashboard_pages[0].components.splice(0,1);
 const read=await s.getPage(p.id);
 assert.equal(read.components[0].kind,'model');assert.equal(read.components[0].computed,null);assert.match(read.components[0].error,/missing input "wood"/);
 assert.deepEqual(read.components[0].spec.params.hand[0],{input:'wood'});
});

test('bound models recompute from inputs identically on the server and in the browser bundle',async()=>{
 const db=fakeDb(),s=storeFor(db,A,'agent');
 const p=await s.createExamplePage('live_hand');
 const direct=p2=>defaultModels().compute('build_eta',p2).takeaway;
 const build=pg=>pg.components.find(c=>c.id==='build');
 assert.equal(build(p).computed.takeaway,direct({hand:[1,1,0,1,0],pips:[5,3,4,6,2],genericPort:false}));
 const {page,values}=await s.setInputValues(p.id,{expectedRevision:1,values:{wood:3,ore:4,port3:true}});
 assert.deepEqual(values,{wood:3,ore:4,port3:true});assert.equal(page.revision,2);
 assert.equal(build(page).computed.takeaway,direct({hand:[3,1,0,1,4],pips:[5,3,4,6,2],genericPort:true}));
 assert.equal(build(page).updatedAt,build(p).updatedAt,'value changes do not restamp bound tiles');
 // persisted: a fresh store (new session) reads the same values
 assert.deepEqual((await storeFor(db,A).getInputs(p.id)).values,{wood:3,brick:1,sheep:0,wheat:1,ore:4,woodPips:5,brickPips:3,sheepPips:4,wheatPips:6,orePips:2,port3:true});
 // browser: the copied public bundle computes the same result from the same stored page
 const pub=f=>fs.readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
 assert.equal(pub('dashboard-inputs.js'),fs.readFileSync(new URL('../lib/dashboard-inputs.cjs',import.meta.url),'utf8'),'run node build.mjs');
 const win={};win.window=win;const ctx=vm.createContext(win);
 for(const f of ['math.js','models.js','dashboard-inputs.js'])vm.runInContext(pub(f),ctx);
 if(!win.CatanMath&&win.CatanModel)win.CatanMath=win.CatanModel;
 const stored=db.tables.dashboard_pages.find(r=>r.id===p.id).components;
 const browser=win.DashboardInputs.computeModel(win.DashboardModels,stored.find(c=>c.id==='build').spec,win.DashboardInputs.valuesOf(stored));
 assert.deepEqual(JSON.parse(JSON.stringify(browser.computed)),JSON.parse(JSON.stringify(build(page).computed)));
 // invalid values: outside bounds, unknown keys, and values a bound model rejects are all refused atomically
 assert.match((await s.setInputValues(p.id,{expectedRevision:2,values:{wood:2,ore:99}}).catch(e=>e)).message,/at most 19/);
 assert.match((await s.setInputValues(p.id,{expectedRevision:2,values:{gold:1}}).catch(e=>e)).message,/unknown input "gold"/);
 assert.equal(await code(s.setInputValues(p.id,{expectedRevision:2,values:{}})),'invalid');
 assert.equal((await s.getInputs(p.id)).values.wood,3);
});

test('set_input_values: compare-and-swap, field merge helper, and account isolation',async()=>{
 const db=fakeDb(),a=storeFor(db,A,'agent'),human=storeFor(db,A,'user'),b=storeFor(db,B,'agent');
 const p=await a.createExamplePage('live_hand');
 const both=await Promise.allSettled([a.setInputValues(p.id,{expectedRevision:1,values:{wood:5}}),human.setInputValues(p.id,{expectedRevision:1,values:{ore:2}})]);
 assert.equal(both.filter(r=>r.status==='fulfilled').length,1);
 const conflict=both.find(r=>r.status==='rejected').reason;
 assert.equal(conflict.code,'conflict');assert.equal(conflict.extra.currentRevision,2);
 // the browser's merge: re-apply only fields this screen changed; a field the other writer changed is a conflict
 const theirs=Inputs.valuesOf(conflict.extra.page.components);
 const winner=theirs.wood===5?'agent':'human';
 const mine=winner==='agent'?{ore:2}:{wood:5},base={wood:1,ore:0};
 const merged=Inputs.mergeValues(base,mine,theirs);
 assert.deepEqual(merged,{apply:mine,conflicts:[]});
 assert.deepEqual(Inputs.mergeValues({wood:1},{wood:4},{wood:3}).conflicts,[{key:'wood',theirs:3,mine:4}]);
 assert.deepEqual(Inputs.mergeValues({wood:1},{wood:4},{}).conflicts,[{key:'wood',missing:true,mine:4}]);
 await (winner==='agent'?human:a).setInputValues(p.id,{expectedRevision:2,values:merged.apply});
 const now=(await a.getInputs(p.id)).values;assert.equal(now.wood,5);assert.equal(now.ore,2);
 // other accounts cannot read or write, and A's values do not change
 assert.equal(await code(b.getInputs(p.id)),'not_found');
 assert.equal(await code(b.setInputValues(p.id,{expectedRevision:3,values:{wood:0}})),'not_found');
 assert.equal((await a.getInputs(p.id)).values.wood,5);
 assert.equal(await code(a.setInputValues(p.id,{expectedRevision:0,values:{wood:1}})),'invalid');
});

test('vega: safe inline Vega-Lite compiles; urls, links, images, HTML and widgets are rejected',async()=>{
 assert.ok(componentInput.safeParse(vega(bar)).success);
 assert.equal(componentInput.safeParse({...vega(bar),source:undefined}).success,false,'vega needs source.label');
 const evil=[
  {...bar,data:{url:'https://evil.test/data.json'}},
  {...bar,data:{url:'data/cars.json'}},
  {...bar,transform:[{lookup:'a',from:{data:{url:'//evil.test/x.csv'},key:'a',fields:['b']}}]},
  {...bar,encoding:{...bar.encoding,href:{field:'a'}}},
  {...bar,mark:{type:'bar',href:'javascript:alert(1)'}},
  {...bar,mark:'image'},{...bar,mark:{type:'image'}},
  {...bar,title:'<img src=x onerror=alert(1)>'},{...bar,description:'<script>alert(1)</script>'},
  {...bar,title:'javascript:alert(1)'},{...bar,config:{background:'url(https://evil.test/x.png)'}},
  {...bar,usermeta:{embedOptions:{loader:{baseURL:'https://evil.test'}}}},
  {...bar,params:[{name:'n',value:1,bind:{input:'range',element:'#dash-main'}}]},
  {...bar,params:[{name:'n',value:1,bind:{input:'range'}}]},
  {...bar,params:[{name:'width',value:1}]},
  {$schema:'https://vega.github.io/schema/vega/v6.json',signals:[],marks:[]},
  {...bar,$schema:'https://evil.test/schema.json'},
  {...bar,data:{sequence:{start:0,stop:1e7}}},
  {...bar,encoding:{x:{field:'b',bin:{maxbins:1e6}}}},
  {data:{values:[]}},
 ];
 for(const d of evil)assert.equal(componentInput.safeParse(vega(d)).success,false,JSON.stringify(d).slice(0,140));
 // a JSON "__proto__" key is refused by the checker; zod drops it before storage, so nothing is polluted either way
 const proto=JSON.parse('{"mark":"bar","__proto__":{"polluted":1}}');
 assert.match(Inputs.vegaErrors(proto).join(),/reserved property/);
 const parsed=componentInput.parse(vega(proto));
 assert.equal(Object.getPrototypeOf(parsed.spec.definition),Object.prototype);assert.equal({}.polluted,undefined);
 // expressions may use comparisons; they are not HTML
 assert.ok(componentInput.safeParse(vega({...bar,params:[{name:'cut',value:2}],transform:[{filter:'datum.b<cut && datum.b>0'}]})).success);
 const db=fakeDb(),s=storeFor(db,A,'agent');
 assert.match((await s.createPage({title:'x',components:[vega({...bar,mark:'pie'})]}).catch(e=>e)).message,/could not compile/);
 assert.match((await s.createPage({title:'x',components:[vega({...bar,transform:[{calculate:'alert(1)',as:'z'}]})]}).catch(e=>e)).message,/could not compile/);
 // size bounds: vega tiles may be up to 68 KB, other kinds keep 32 KB
 const rows=Array.from({length:1500},(_,i)=>({a:'row'+i,b:i}));
 const big=await s.createPage({title:'Big',components:[vega({...bar,data:{values:rows}})]});
 assert.equal(big.components[0].kind,'vega');
 assert.equal(await code(s.createPage({title:'x',components:[vega({...bar,data:{values:rows.concat(rows)}})]})),'invalid');
 // params named like inputs are injected without changing the stored spec
 const def={...bar,params:[{name:'rolls',value:1},{name:'pick',select:'point'},{name:'derived',expr:'rolls*2'}]};
 const injected=Inputs.injectParams(def,{rolls:9,pick:3,derived:4});
 assert.deepEqual(injected.params,[{name:'rolls',value:9},{name:'pick',select:'point'},{name:'derived',expr:'rolls*2'}]);
 assert.equal(def.params[0].value,1);assert.deepEqual(Inputs.vegaParamNames(def),['rolls']);
 const preview=await s.preview(vega(def));assert.equal(preview.kind,'vega');
});

test('catalog examples validate, create pages, and never alter the original starter',async()=>{
 const cat=componentCatalog();
 assert.deepEqual(cat.kinds.map(k=>k.kind).sort(),['chart','input','model','note','stat','table','vega']);
 for(const k of cat.kinds)assert.ok(componentInput.safeParse(k.example).success,k.kind);
 assert.match(cat.kinds.find(k=>k.kind==='vega').grammar.honesty,/no promise/);
 const db=fakeDb(),s=storeFor(db,A,'agent');
 for(const name of Object.keys(EXAMPLES)){
  const p=await s.createExamplePage(name);
  assert.ok(p.components.every(c=>!c.invalid&&!c.error),name);
 }
 const starter=await s.createStarterPage();
 assert.deepEqual(starter.components.map(c=>c.kind),['model','model','model','model','model']);
 assert.ok(starter.components.every(c=>!Inputs.refsIn(c.spec.params).keys.length));
 assert.equal(await code(s.createExamplePage('nope')),'invalid');
 // duplicating an input tile gives fresh keys so the page stays valid
 const live=(await s.listPages()).find(p=>p.title===EXAMPLES.live_hand.title);
 const dup=await s.duplicateComponent(live.id,{expectedRevision:1,componentId:'hand'});
 assert.deepEqual(dup.component.spec.fields.map(f=>f.key),HAND.map(k=>k+'_2'));
 assert.equal(dup.page.components.findIndex(c=>c.id===dup.component.id),1);
});

test('human editing helpers: steppers, typed drafts and duplicate key renaming',()=>{
 const f=num('wood',3,{max:5});
 assert.equal(Inputs.stepValue(f,3,1),4);assert.equal(Inputs.stepValue(f,5,1),5);assert.equal(Inputs.stepValue(f,0,-1),0);
 assert.equal(Inputs.stepValue({key:'x',type:'number',step:0.1,min:0},0.2,1),0.3);
 assert.deepEqual(Inputs.parseDraft(f,' 4 '),{value:4});
 assert.ok(Inputs.parseDraft(f,'').error);assert.ok(Inputs.parseDraft(f,'abc').error);
 assert.match(Inputs.parseDraft(f,'9').error,/at most 5/);assert.match(Inputs.parseDraft(f,'1.5').error,/whole/);
 assert.deepEqual(Inputs.renameKeys(inputTile([num('wood',1)]),['wood','wood_2']).spec.fields[0].key,'wood_3');
});

test('REST and MCP expose inputs, catalog, examples and full authoring for new kinds',async()=>{
 const db=fakeDb(),app=express();app.use(express.json());
 app.use('/api',(req,res,next)=>{req.user={id:req.get('x-test-user')};req.supabase=db.client(req.user.id);next();});
 dashboardRoutes(app);
 mcpRoutes(app,{resolvePrincipal:async req=>{const uid={'tok-a':A,'tok-b':B}[req.get('authorization')?.slice(7)];return uid&&{user:{id:uid},supabase:db.client(uid)};},
  createStore:({user,supabase})=>new DashboardStore({db:supabase,userId:user.id,actor:'agent',siteUrl:'https://catan.test'})});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(uid,method,path,body)=>fetch(base+'/api/dashboard'+path,{method,headers:{'content-type':'application/json','x-test-user':uid},body:body&&JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json()}));
 const connect=async tok=>{const c=new Client({name:'t',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tok}}}));return c;};
 const data=r=>JSON.parse(r.content[0].text);
 try{
  // REST (browser)
  assert.equal((await call(A,'GET','/catalog')).body.kinds.length,7);
  const ex=await call(A,'POST','/pages/examples/custom_graph');assert.equal(ex.status,201);
  const id=ex.body.page.id;
  assert.deepEqual((await call(A,'GET',`/pages/${id}/inputs`)).body.values,{target:8,rolls:20,compare:false});
  const set=await call(A,'PATCH',`/pages/${id}/inputs`,{expectedRevision:1,values:{target:6,rolls:30}});
  assert.equal(set.status,200);assert.equal(set.body.page.revision,2);
  const stale=await call(A,'PATCH',`/pages/${id}/inputs`,{expectedRevision:1,values:{compare:true}});
  assert.equal(stale.status,409);assert.equal(stale.body.currentRevision,2);
  assert.equal((await call(A,'PATCH',`/pages/${id}/inputs`,{expectedRevision:2,values:{rolls:0}})).status,400);
  assert.equal((await call(B,'PATCH',`/pages/${id}/inputs`,{expectedRevision:2,values:{rolls:5}})).status,404);
  assert.equal((await call(A,'POST',`/pages/${id}/components/controls/duplicate`,{expectedRevision:2})).status,201);
  const pv=await call(A,'POST','/preview',{pageId:id,component:{kind:'model',title:'x',spec:{model:'dice_odds',params:{highlight:[{input:'target'}]}}}});
  assert.match(pv.body.component.computed.takeaway,/6/);

  // MCP (agent)
  const a=await connect('tok-a'),b=await connect('tok-b');
  const names=(await a.listTools()).tools.map(t=>t.name);
  for(const t of ['list_component_kinds','get_inputs','set_input_values','preview_component','create_example_page'])assert.ok(names.includes(t),t);
  assert.equal(data(await a.callTool({name:'list_component_kinds',arguments:{}})).kinds.find(k=>k.kind==='vega').needsSource,true);
  const live=data(await a.callTool({name:'create_example_page',arguments:{example:'live_hand'}})).page;
  let inputs=data(await a.callTool({name:'get_inputs',arguments:{pageId:live.id}}));
  assert.equal(inputs.revision,1);assert.deepEqual(inputs.inputs.find(f=>f.key==='wood').usedBy.map(u=>u.id).sort(),['build','missing']);
  const r=data(await a.callTool({name:'set_input_values',arguments:{pageId:live.id,expectedRevision:1,values:{wood:0,brick:0}}}));
  assert.equal(r.page.revision,2);assert.match(r.page.components.find(c=>c.id==='build').computed.takeaway,/Road/);
  const clash=await a.callTool({name:'set_input_values',arguments:{pageId:live.id,expectedRevision:1,values:{wood:1}}});
  assert.equal(clash.isError,true);assert.equal(data(clash).code,'conflict');
  assert.equal(data(await b.callTool({name:'get_inputs',arguments:{pageId:live.id}})).code,'not_found');
  // full authoring for the new kinds with the existing tools
  const added=data(await a.callTool({name:'add_component',arguments:{pageId:live.id,expectedRevision:2,index:0,component:{kind:'input',title:'Score',spec:{fields:[{key:'vp',label:'Victory points',type:'number',value:2,min:0,max:10,unit:'VP'}]}}}}));
  const vid=added.component.id;assert.equal(added.page.components[0].id,vid);assert.equal(added.component.size,'third');
  const chart=data(await a.callTool({name:'add_component',arguments:{pageId:live.id,expectedRevision:3,component:{kind:'vega',title:'VP',spec:{definition:{params:[{name:'vp',value:0}],data:{values:[{x:'VP',v:1}]},transform:[{calculate:'vp',as:'v'}],mark:'bar',encoding:{x:{field:'x',type:'nominal'},y:{field:'v',type:'quantitative'}}}},source:{label:'Score input'}}}}));
  const cid=chart.component.id;
  const upd=data(await a.callTool({name:'update_component',arguments:{pageId:live.id,expectedRevision:4,componentId:cid,changes:{size:'full',spec:{definition:{...chart.component.spec.definition,mark:'area'}}}}}));
  assert.equal(upd.component.size,'full');assert.equal(upd.component.spec.definition.mark,'area');
  const badUpd=await a.callTool({name:'update_component',arguments:{pageId:live.id,expectedRevision:5,componentId:cid,changes:{spec:{definition:{...bar,data:{url:'https://x.test'}}}}}});
  assert.equal(badUpd.isError,true);assert.match(data(badUpd).message,/remote data is not allowed/);
  assert.equal(data(await a.callTool({name:'move_component',arguments:{pageId:live.id,expectedRevision:5,componentId:cid,index:0}})).page.components[0].id,cid);
  const dup=data(await a.callTool({name:'duplicate_component',arguments:{pageId:live.id,expectedRevision:6,componentId:vid}}));
  assert.equal(dup.component.spec.fields[0].key,'vp_2');
  assert.equal(data(await a.callTool({name:'remove_component',arguments:{pageId:live.id,expectedRevision:7,componentId:dup.component.id}})).page.revision,8);
  const pr=data(await a.callTool({name:'preview_component',arguments:{pageId:live.id,component:{kind:'model',title:'x',spec:{model:'seven_risk',params:{handSize:{input:'vp'}}}}}}));
  assert.equal(pr.component.computed.keyNumbers.handSize,2);
  assert.equal(pr.component.computed.keyNumbers.discardIfSeven,0);
  const dupPage=data(await a.callTool({name:'duplicate_page',arguments:{pageId:live.id}})).page;
  assert.ok(dupPage.components.every(c=>!c.error&&!c.invalid));
  await a.close();await b.close();
 }finally{server.close();}
});
