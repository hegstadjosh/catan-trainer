const assert=require('node:assert/strict');
const D=require('../src/uncertainty-drills.js');
for(const type of D.TYPES){
 const a=D.generate(type,42),b=D.generate(type,42);
 assert.deepEqual(a,b,'seeded exercise should be reproducible');
 assert(a.options.some(([key])=>key===a.correct),'answer must be among visible options');
 assert(a.prompt.length>50&&a.explanation.length>40,'question and reasoning must be substantive');
}
const c=D.generate('correlation',42);
assert.match(c.explanation,/joint payout/);
assert.match(c.prompt,/no trades/);
const f=D.generate('forecast',42);
assert.match(f.prompt,/GIVEN/);
assert.match(f.explanation,/conditional/);
console.log('uncertainty drills passed');
