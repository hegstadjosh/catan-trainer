const assert=require('node:assert/strict');
const M=require('../src/flash-model.js'),deck=M.buildDeck();
assert.equal(new Set(deck.map(c=>c.id)).size,deck.length);
for(const n of M.numbers){let hits=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(a+b===n)hits++;assert.equal(M.pips(n),hits);}
for(const c of deck){if(!c.setup.length)continue;const expected=[0,0,0,0,0];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++){const pay=M.payout(c.setup,a+b);pay.forEach((v,i)=>expected[i]+=v);}assert.deepEqual(M.vector(c.setup),expected,c.id);assert(c.prompt&&c.answer&&c.why);}
const setup=[{units:1,hexes:[{n:6,r:0},{n:3,r:1}]},{units:2,hexes:[{n:9,r:3},{n:4,r:0}]}];
assert.deepEqual(M.vector(setup),[11,2,0,8,0]);assert.equal(M.sum(M.vector(setup)),21);assert.deepEqual(M.payout(setup,4),[2,0,0,0,0]);assert.deepEqual(M.payout(setup,7),[0,0,0,0,0]);
const now=1700000000000,day=86400000;let r=M.schedule(null,'good',now);assert.equal(r.due,now+day);assert.equal(r.ease,2.5);r=M.schedule(r,'good',now+day);assert.equal(r.interval,6);r=M.schedule(r,'good',now+7*day);assert.equal(r.interval,15);r=M.schedule(r,'again',now+22*day);assert.equal(r.reps,0);assert.equal(r.due,now+22*day+600000);for(let i=0;i<20;i++)r=M.schedule(r,'again',now);assert.equal(r.ease,1.3);assert.equal(M.schedule(r,'good',now).interval,1);
assert.equal(M.fraction(21), '7/12');assert.equal(M.fraction(84),'7/3');
const records={[deck[5].id]:{due:now-10},[deck[0].id]:{due:now+1000}};const queue=M.selectCards(deck,records,'all',now,10);assert.equal(queue.length,11);assert.equal(queue[0].id,deck[5].id);assert(!queue.some(c=>c.id===deck[0].id));assert.equal(new Set(queue.slice(1,9).map(c=>c.category)).size,8);
console.log(`PASS: ${deck.length} unique cards; production independently checked against all 36 dice outcomes; SM-2 intervals, lapse reset, ease floor, due priority and balanced new cards.`);
// Related questions, including color variants, never share a session.
let seed=123456;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(const category of ['all',...M.categories.map((_,i)=>String(i))]){
 for(let repeat=0;repeat<12;repeat++){
  const fresh=M.selectCards(deck,{},category,now,10,rng);assert.equal(new Set(fresh.map(M.family)).size,fresh.length);
  const cram=M.practiceCards(deck,category,20,rng);assert.equal(new Set(cram.map(M.family)).size,cram.length);
 }
}
const dueSiblings=Object.fromEntries(deck.filter(c=>c.id.startsWith('setup-0-')).map(c=>[c.id,{due:now-1,last:now-86400000}]));
const dueSession=M.selectCards(deck,dueSiblings,'all',now,10,rng);assert.equal(dueSession.filter(c=>c.id.startsWith('setup-0-')).length,1);assert(Object.values(dueSiblings).every(r=>r.due===now-1));
const first=M.selectCards(deck,{},'2',now,10,rng),recent=first.slice(-8).map(M.family),second=M.selectCards(deck,{},'2',now,10,rng,recent);assert(second.every(c=>!recent.includes(M.family(c))));assert.notDeepEqual(first.map(c=>c.id),second.map(c=>c.id));
assert.equal(new Set(deck.filter(c=>c.id.match(/^setup-\d+-\d+-total$/)).map(c=>M.family(c))).size,60);
assert.equal(deck.filter(c=>c.id.match(/^setup-\d+-\d+-total$/)).length,300);
console.log('PASS: randomized queues, one sibling per family, due sibling deferral without rescheduling, recent-family avoidance, and 300 four-hex layouts from 60 number patterns.');
// The picture must award exactly the same cards as the mathematical setup.
// Infer touching buildings from polygon corners, independently of setup adjacency.
for(const card of deck.filter(c=>c.setup.length)){
 const pictured=[0,0,0,0,0];
 for(const panel of M.boardLayout(card))for(const tile of panel.tiles){
  const corners=Array.from({length:6},(_,k)=>{const angle=(30+60*k)*Math.PI/180;return [tile.x+64*Math.cos(angle),tile.y+64*Math.sin(angle)];});
  for(const piece of panel.pieces)if(corners.some(([x,y])=>Math.hypot(x-piece.x,y-piece.y)<.001)&&!tile.blocked)pictured[tile.r]+=M.pips(tile.n)*piece.units;
 }
 assert.deepEqual(pictured,M.vector(card.setup),`Drawing adjacency: ${card.id}`);
}
for(const category of [1,2,3,4,5,6]){
 const pool=deck.filter(c=>M.matchesSituation(c,'three'));
 const session=M.selectCards(pool,{},String(category),now,10,rng);
 assert(session.length>0);
 assert(session.filter(c=>c.setup.length).every(c=>c.setup.length===1&&c.setup[0].hexes.length===3));
 assert.equal(new Set(session.map(M.family)).size,session.length);
}
assert(deck.some(c=>c.shared&&c.setup[0].units===1&&c.setup[1].units===2));
assert(deck.some(c=>c.setup.length===2&&c.setup.every(s=>s.hexes.length===3)));
assert(!deck.some(c=>c.prompt.includes('production points')));
const kept=deck.find(c=>c.id==='port-2-2');assert(kept.context.includes('Keep both'));assert(kept.answer.startsWith('0 resource'));
console.log('PASS: all depicted vertex adjacencies match production; three-hex curriculum spans six skills; shared hexes, multiple buildings, explicit question units, and port keep rule.');
