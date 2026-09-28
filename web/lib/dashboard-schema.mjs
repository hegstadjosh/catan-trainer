// Dashboard component and page contracts (UX spec §5 envelope, decision.md limits).
// Shared by the REST routes, the MCP tools and the read path. All text is plain text.
import {z} from 'zod';
import {createRequire} from 'node:module';
const Inputs=createRequire(import.meta.url)('./dashboard-inputs.cjs');

// vegaComponentBytes: a Vega-Lite tile may carry up to 64 KB of inline data; the page total stays 256 KB (DB check).
export const LIMITS={pages:20,components:24,pageTitle:80,componentBytes:32768,vegaComponentBytes:69632,pageBytes:262144,inputFields:Inputs.LIMITS.fields};
export const MODEL_NAMES=['dice_odds','resource_income','build_eta','dev_card_odds','seven_risk','win_routes','deadline_odds','goal_values','trade_check','trajectory'];

const control=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const lineBreak=/[\r\n\t]/;
const line=(min,max,what)=>z.string().trim().min(min).max(max).refine(s=>!control.test(s)&&!lineBreak.test(s),`${what} must be plain single-line text`);
const text=(max,what)=>z.string().trim().max(max).refine(s=>!control.test(s),`${what} must be plain text`);
const num=z.number().min(-1e12).max(1e12);
export const pageId=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'pageId must be a page id from list_pages');
export const componentId=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/,'componentId must be 1–40 letters, digits, _ or -');
export const revision=z.number().int().min(1).describe('The page revision you last read; writes fail with a conflict if the page changed since.');
export const pageTitle=line(1,LIMITS.pageTitle,'title');
export const size=z.enum(['third','half','full']);

export const source=z.object({
 label:line(1,120,'source.label').describe('Where the numbers came from, shown verbatim, e.g. "Sept 20 game log, turns 1–30".'),
 detail:text(280,'source.detail').optional(),
 asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'asOf must be YYYY-MM-DD').optional()
}).strict();

const chartSpec=z.object({
 type:z.enum(['line','bar']),
 x:z.array(z.union([num,line(1,40,'x value')])).min(1).max(200).describe('Category or x values; ≤200 for line, ≤40 for bar.'),
 series:z.array(z.object({
  name:line(1,40,'series name'),
  values:z.array(num.nullable()).describe('One value per x; null draws a gap.'),
  tone:z.enum(['wood','brick','sheep','wheat','ore']).optional()
 }).strict()).min(1).max(6),
 xLabel:line(0,40,'xLabel').optional(),
 yLabel:line(0,40,'yLabel').optional(),
 unit:z.enum(['','%','cards','rolls','VP']).optional(),
 stacked:z.boolean().optional(),
 yMin:num.optional(),yMax:num.optional(),
 highlightX:z.union([num,line(1,40,'highlightX')]).optional()
}).strict().superRefine((s,ctx)=>{
 if(s.type==='bar'&&s.x.length>40)ctx.addIssue({code:'custom',path:['x'],message:'bar charts allow at most 40 x values'});
 s.series.forEach((series,i)=>{if(series.values.length!==s.x.length)ctx.addIssue({code:'custom',path:['series',i,'values'],message:`series "${series.name}" has ${series.values.length} values but x has ${s.x.length}`});});
 if(s.yMin!==undefined&&s.yMax!==undefined&&s.yMin>=s.yMax)ctx.addIssue({code:'custom',path:['yMax'],message:'yMax must be greater than yMin'});
});
const statSpec=z.object({items:z.array(z.object({label:line(1,40,'stat label'),value:num,unit:line(0,12,'stat unit').optional(),note:line(0,80,'stat note').optional()}).strict()).min(1).max(4)}).strict();
const tableSpec=z.object({
 columns:z.array(line(1,40,'column')).min(1).max(8),
 rows:z.array(z.array(z.union([num,text(60,'cell'),z.null()]))).max(50),
 align:z.array(z.enum(['left','right'])).optional()
}).strict().superRefine((s,ctx)=>{
 s.rows.forEach((row,i)=>{if(row.length!==s.columns.length)ctx.addIssue({code:'custom',path:['rows',i],message:`row ${i} has ${row.length} cells but there are ${s.columns.length} columns`});});
 if(s.align&&s.align.length!==s.columns.length)ctx.addIssue({code:'custom',path:['align'],message:'align needs one entry per column'});
});
const noteSpec=z.object({text:text(2000,'note text').refine(s=>s.length>0,'note text is required')}).strict();
export const modelSpec=z.object({
 model:z.enum(MODEL_NAMES).describe('Model name from list_models.'),
 params:z.record(z.string(),z.unknown()).default({}).describe('Model parameters from list_models; omitted params use defaults. Validated by the model module.')
}).strict();

const plainValue=z.union([z.string().max(Inputs.LIMITS.text),num]);
const inputField=z.object({
 key:z.string().describe('Unique on the page. Letters, digits, _; starts with a letter; ≤32 chars. Model params bind to it with {"input":"<key>"}; Vega-Lite params with the same name receive its value.'),
 label:line(1,Inputs.LIMITS.label,'field label'),
 type:z.enum(Inputs.TYPES),
 value:z.union([z.boolean(),plainValue]).describe('Current value: number, text, one of options[].value, or true/false.'),
 min:num.optional(),max:num.optional(),step:z.number().positive().max(1e6).optional(),integer:z.boolean().optional().describe('number only: require whole numbers.'),
 options:z.array(z.object({label:line(1,Inputs.LIMITS.label,'option label'),value:plainValue}).strict()).min(1).max(Inputs.LIMITS.options).optional().describe('select only.'),
 unit:line(1,Inputs.LIMITS.unit,'unit').optional().describe('number only, e.g. "cards".'),
 help:line(1,120,'help').optional()
}).strict();
export const inputSpec=z.object({fields:z.array(inputField).min(1).max(Inputs.LIMITS.fields)}).strict().superRefine((s,ctx)=>{
 for(const e of Inputs.fieldErrors(s.fields))ctx.addIssue({code:'custom',path:['fields'],message:e});
});
export const vegaSpec=z.object({
 definition:z.record(z.string(),z.unknown()).describe('Inline Vega-Lite v6 JSON (data.values inline; no url/href/image). Top-level params named like an input key receive that input\'s value.')
}).strict().superRefine((s,ctx)=>{
 for(const e of Inputs.vegaErrors(s.definition))ctx.addIssue({code:'custom',path:['definition'],message:e});
});

const base={id:componentId.optional().describe('Omit to let the server assign one.'),title:line(1,80,'title'),caption:text(280,'caption').refine(s=>!lineBreak.test(s),'caption must be one paragraph').optional(),size:size.optional()};
export const componentInput=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('model'),spec:modelSpec}).strict().describe('Computed by the app from Catan math. Preferred for any Catan probability.'),
 z.object({...base,kind:z.literal('chart'),spec:chartSpec,source}).strict().describe('Agent-supplied chart; source.label is required.'),
 z.object({...base,kind:z.literal('stat'),spec:statSpec,source}).strict().describe('Agent-supplied numbers; source.label is required.'),
 z.object({...base,kind:z.literal('table'),spec:tableSpec,source}).strict().describe('Agent-supplied table; source.label is required.'),
 z.object({...base,kind:z.literal('note'),spec:noteSpec,source:source.optional()}).strict().describe('Plain-text note; blank line starts a paragraph.'),
 z.object({...base,kind:z.literal('input'),spec:inputSpec,source:source.optional()}).strict().describe('Editable named fields (number/text/select/toggle) that people adjust during a game; model params and Vega-Lite params bind to them by key.'),
 z.object({...base,kind:z.literal('vega'),spec:vegaSpec,source}).strict().describe('General chart from an inline Vega-Lite spec (line, bar, area, point, heatmap, histogram, boxplot, facets…); source.label is required.')
]);
export const componentChanges=z.object({
 title:base.title.optional(),caption:base.caption,size:size.optional(),
 spec:z.record(z.string(),z.unknown()).optional().describe('Full replacement spec for the component kind (not merged).'),
 source:source.optional()
}).strict();

// Server-owned read fields that clients may echo back; never trusted, always dropped.
const SERVER_FIELDS=['createdBy','updatedAt','computed','invalid','error'];
export function stripServerFields(c){
 if(!c||typeof c!=='object'||Array.isArray(c))return c;
 const out={...c};for(const k of SERVER_FIELDS)delete out[k];return out;
}
export function describeIssues(error){
 return (error.issues||[]).slice(0,8).map(i=>(i.path?.length?i.path.join('.')+': ':'')+i.message).join('; ')||'Invalid input.';
}
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
export const byteSize=bytes;
export function componentByteLimit(kind){return kind==='vega'?LIMITS.vegaComponentBytes:LIMITS.componentBytes;}
export function randomComponentId(){return 'c_'+[...crypto.getRandomValues(new Uint8Array(10))].map(b=>(b%36).toString(36)).join('');}
