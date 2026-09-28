// Discoverable component catalog for agents (MCP list_component_kinds, GET /api/dashboard/catalog)
// plus ready-made example pages. Every example here must pass the same validation as agent input.
import {LIMITS} from './dashboard-schema.mjs';

const RES=['wood','brick','sheep','wheat','ore'],LABEL={wood:'Wood',brick:'Brick',sheep:'Sheep',wheat:'Wheat',ore:'Ore'};
const COLORS=['#51735b','#b86643','#939d52','#bd9438','#727c91'];
const handFields=values=>RES.map((r,i)=>({key:r,label:LABEL[r],type:'number',value:values[i],min:0,max:19,step:1,integer:true,unit:'cards'}));

// Cards still missing for each build, recomputed from the hand inputs by Vega-Lite params.
const missingChart={
 $schema:'https://vega.github.io/schema/vega-lite/v6.json',
 params:RES.map((r,i)=>({name:r,value:[1,1,0,1,0][i]})),
 data:{values:[
  {build:'Road',resource:'Wood',cost:1},{build:'Road',resource:'Brick',cost:1},
  {build:'Settlement',resource:'Wood',cost:1},{build:'Settlement',resource:'Brick',cost:1},{build:'Settlement',resource:'Sheep',cost:1},{build:'Settlement',resource:'Wheat',cost:1},
  {build:'City',resource:'Wheat',cost:2},{build:'City',resource:'Ore',cost:3},
  {build:'Dev card',resource:'Sheep',cost:1},{build:'Dev card',resource:'Wheat',cost:1},{build:'Dev card',resource:'Ore',cost:1}]},
 transform:[
  {calculate:"datum.resource==='Wood'?wood:datum.resource==='Brick'?brick:datum.resource==='Sheep'?sheep:datum.resource==='Wheat'?wheat:ore",as:'have'},
  {calculate:'max(0,datum.cost-datum.have)',as:'missing'}],
 mark:{type:'bar'},
 encoding:{
  y:{field:'build',type:'nominal',sort:['Road','Settlement','City','Dev card'],title:null},
  x:{aggregate:'sum',field:'missing',type:'quantitative',title:'Cards still missing',axis:{tickMinStep:1}},
  color:{field:'resource',type:'nominal',scale:{domain:RES.map(r=>LABEL[r]),range:COLORS},legend:{orient:'bottom',title:null}},
  tooltip:[{field:'build',type:'nominal'},{field:'resource',type:'nominal'},{field:'missing',type:'quantitative',title:'missing'}]}
};
// Chance of rolling a chosen total at least once within n rolls; optional comparison with every total.
const hitChart={
 $schema:'https://vega.github.io/schema/vega-lite/v6.json',
 params:[{name:'target',value:8},{name:'rolls',value:20},{name:'compare',value:false}],
 data:{values:[2,3,4,5,6,8,9,10,11,12].map(total=>({total}))},
 transform:[
  {filter:'compare || datum.total===target'},
  {calculate:'(6-abs(datum.total-7))/36',as:'p'},
  {calculate:'sequence(1,rolls+1)',as:'n'},{flatten:['n']},
  {calculate:'1-pow(1-datum.p,datum.n)',as:'chance'}],
 mark:{type:'line',point:{size:18}},
 encoding:{
  x:{field:'n',type:'quantitative',title:'Rolls (all players)'},
  y:{field:'chance',type:'quantitative',title:'Chance of at least one hit',axis:{format:'.0%'},scale:{domain:[0,1]}},
  color:{field:'total',type:'nominal',title:'Total',legend:{orient:'right'}},
  strokeWidth:{condition:{test:'datum.total===target',value:3},value:1},
  tooltip:[{field:'total',type:'nominal'},{field:'n',type:'quantitative',title:'rolls'},{field:'chance',type:'quantitative',format:'.1%'}]}
};
const waysChart={
 $schema:'https://vega.github.io/schema/vega-lite/v6.json',
 params:[{name:'target',value:8}],
 data:{values:[2,3,4,5,6,7,8,9,10,11,12].map(total=>({total,ways:6-Math.abs(total-7)}))},
 mark:{type:'bar'},
 encoding:{
  x:{field:'total',type:'ordinal',title:'Dice total',axis:{labelAngle:0}},
  y:{field:'ways',type:'quantitative',title:'Ways out of 36'},
  color:{condition:{test:'datum.total===target',value:'#292925'},value:'#c9c6bc'},
  tooltip:[{field:'total',type:'ordinal'},{field:'ways',type:'quantitative'}]}
};

export const EXAMPLES={
 live_hand:{title:'Live game: my hand',description:'Five hand counters and production pips that drive a bound build-progress model and a Vega-Lite "cards still missing" chart.',components:[
  {id:'hand',kind:'input',title:'My hand',size:'third',caption:'Tap − / + as cards come and go.',spec:{fields:handFields([1,1,0,1,0])}},
  {id:'production',kind:'input',title:'My production',size:'third',spec:{fields:[...RES.map((r,i)=>({key:r+'Pips',label:LABEL[r]+' pips',type:'number',value:[5,3,4,6,2][i],min:0,max:80,step:1,integer:true})),{key:'port3',label:'3:1 port',type:'toggle',value:false}]}},
  {id:'build',kind:'model',title:'Build progress',size:'third',spec:{model:'build_eta',params:{hand:RES.map(r=>({input:r})),pips:RES.map(r=>({input:r+'Pips'})),genericPort:{input:'port3'}}}},
  {id:'missing',kind:'vega',title:'Cards still missing',size:'half',spec:{definition:missingChart},source:{label:'Build costs; hand from “My hand”'}},
  {id:'income',kind:'model',title:'Income over 12 rolls',size:'half',spec:{model:'resource_income',params:{pips:RES.map(r=>({input:r+'Pips'})),rolls:12}}}]},
 custom_graph:{title:'Custom graph: hitting a number',description:'A select, a number and a toggle driving two Vega-Lite charts through params.',components:[
  {id:'controls',kind:'input',title:'Controls',size:'third',spec:{fields:[
   {key:'target',label:'Dice total',type:'select',value:8,options:[2,3,4,5,6,8,9,10,11,12].map(n=>({label:String(n),value:n}))},
   {key:'rolls',label:'Rolls',type:'number',value:20,min:1,max:60,step:1,integer:true,unit:'rolls'},
   {key:'compare',label:'Compare every total',type:'toggle',value:false}]}},
  {id:'hit',kind:'vega',title:'Chance to hit at least once',size:'full',caption:'Counts every player’s roll; ignores the robber.',spec:{definition:hitChart},source:{label:'Two fair dice: ways out of 36'}},
  {id:'ways',kind:'vega',title:'Ways to roll each total',size:'half',spec:{definition:waysChart},source:{label:'Two fair dice: ways out of 36'}}]}
};

const GRAMMAR={
 language:'Vega-Lite v6 JSON (https://vega.github.io/vega-lite/docs/), rendered with the official Vega 6.4.0 / Vega-Lite 6.4.3 libraries and the Vega expression interpreter.',
 marks:['arc','area','bar','boxplot','circle','errorband','errorbar','line','point','rect','rule','square','text','tick','trail'],
 composition:['layer','facet','repeat','concat','hconcat','vconcat'],
 transforms:['aggregate','bin','calculate','density','extent','filter','flatten','fold','impute','joinaggregate','loess','lookup (inline data only)','pivot','quantile','regression','sample','stack','timeUnit','window'],
 data:'Inline only: data.values, datasets, or generators (sequence ≤ 10000 rows). data.url and any external resource are rejected.',
 params:'Top-level params with a value (no expr/select) whose name equals an input key on the page receive that input\'s current value every time it changes. Use them in calculate/filter/test expressions or as encoding values ({"expr":"rolls"}). Selection params may bind only "scales" or "legend".',
 expressions:'Vega expression language (datum.x, abs, pow, sequence, if, format, …) evaluated by an interpreter; no JavaScript.',
 sizing:'Single views fill the tile width and the tile height unless width/height are given. Facets and concatenations keep their own sizes and scroll sideways if wide.',
 rejected:['data.url / any url, href or $ref key','image marks','HTML or url() in strings','bind widgets or element selectors (use an input tile)','plain Vega (non-lite) specs','numbers that are not finite','specs over 64 KB, nesting deeper than 32'],
 honesty:'Anything expressible in this Vega-Lite subset with inline data can be drawn; there is no promise of arbitrary charts or custom code.'
};

export function componentCatalog(){
 const envelope='Every component: {id?, kind, title (≤80), caption? (≤280), size? third|half|full, spec, source?}. source={label (required for chart/stat/table/vega), detail?, asOf? YYYY-MM-DD}.';
 return {
  envelope,
  limits:{pagesPerAccount:LIMITS.pages,componentsPerPage:LIMITS.components,componentKB:LIMITS.componentBytes/1024,vegaComponentKB:LIMITS.vegaComponentBytes/1024,pageKB:LIMITS.pageBytes/1024,inputFieldsPerTile:LIMITS.inputFields},
  kinds:[
   {kind:'model',use:'Catan probabilities computed by the app. Preferred for any built-in Catan math.',spec:'{model, params}; see list_models. Any param (or array item) may be a binding {"input":"<key>"} that reads a page input.',needsSource:false,
    example:{kind:'model',title:'Build progress',spec:{model:'build_eta',params:{hand:[{input:'wood'},{input:'brick'},{input:'sheep'},{input:'wheat'},{input:'ore'}]}}}},
   {kind:'input',use:'Values people adjust during a live game (counters, choices, switches). Persisted on the page; set_input_values changes them atomically.',
    spec:'{fields:[{key, label, type:"number"|"text"|"select"|"toggle", value, min?, max?, step?, integer?, unit?, options?:[{label,value}], help?}]} — ≤24 fields; keys unique on the page (case-insensitive), letters/digits/_ starting with a letter, not reserved (width, height, data, datum, constructor, __proto__, …).',needsSource:false,
    example:{kind:'input',title:'My hand',size:'third',spec:{fields:handFields([1,1,0,1,0])}}},
   {kind:'vega',use:'General charts: lines, bars, areas, scatter, heatmaps, histograms, boxplots, facets, layered annotations.',spec:'{definition:<inline Vega-Lite JSON>}',needsSource:true,grammar:GRAMMAR,
    example:{kind:'vega',title:'Ways to roll each total',size:'half',spec:{definition:waysChart},source:{label:'Two fair dice'}}},
   {kind:'chart',use:'Simple line/bar chart from agent data.',spec:'{type:"line"|"bar", x:[…], series:[{name, values, tone?}], xLabel?, yLabel?, unit?, stacked?, yMin?, yMax?, highlightX?}',needsSource:true,
    example:{kind:'chart',title:'Cards collected',spec:{type:'bar',x:['Wood','Brick'],series:[{name:'Me',values:[4,2]}]},source:{label:'Game log'}}},
   {kind:'stat',use:'Up to four headline numbers.',spec:'{items:[{label, value, unit?, note?}]}',needsSource:true,example:{kind:'stat',title:'Score',spec:{items:[{label:'Victory points',value:7,unit:'VP'}]},source:{label:'Board'}}},
   {kind:'table',use:'Small table (≤8 columns, ≤50 rows).',spec:'{columns:[…], rows:[[…]], align?}',needsSource:true,example:{kind:'table',title:'Players',spec:{columns:['Player','VP'],rows:[['Red',7]]},source:{label:'Board'}}},
   {kind:'note',use:'Plain text; a blank line starts a paragraph.',spec:'{text}',needsSource:false,example:{kind:'note',title:'Plan',spec:{text:'Go for Largest Army.'}}}
  ],
  bindings:{
   model:'Write {"input":"wood"} wherever a model param value (or an item of an array param) goes. The binding is stored as written; the app resolves it from the page inputs before computing, on the server, over MCP and in the browser alike. A binding to a key that is not on the page is rejected.',
   vega:'Name a top-level Vega-Lite param exactly like an input key; its value is replaced by the input value whenever the input changes. Unmatched params keep their own value.',
   cycles:'Input values are plain values; they cannot contain bindings, so bindings never chain or cycle.'
  },
  examples:Object.fromEntries(Object.entries(EXAMPLES).map(([k,v])=>[k,{title:v.title,description:v.description}])),
  workflow:'list_component_kinds → create_page / add_component (or create_example_page) → get_inputs / set_input_values during play → show_dashboard.'
 };
}
