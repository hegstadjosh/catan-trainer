import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../game/rules.mjs';
import * as E from '../game/engine.mjs';

const {GEO, RESOURCES} = E;
const NAMES = ['Human', 'Agent A', 'Agent B', 'Agent C'];
const clone = s => structuredClone(s);

function expectRule(fn, pattern) {
  assert.throws(fn, err => err instanceof R.GameRuleError && err.name === 'GameRuleError' && (!pattern || pattern.test(err.message)));
}
/** Apply and assert the input state was not mutated. */
function act(state, seat, action) {
  const before = JSON.stringify(state);
  const out = R.applyAction(state, seat, action);
  assert.equal(JSON.stringify(state), before, 'applyAction must not mutate its input');
  return out.state;
}
function reject(state, seat, action, pattern) {
  const before = JSON.stringify(state);
  expectRule(() => R.applyAction(state, seat, action), pattern);
  assert.equal(JSON.stringify(state), before, 'invalid action must leave state unchanged');
}
function assertBank(state) {
  for (const r of RESOURCES) {
    const total = state.bank[r] + state.players.reduce((s, p) => s + p.resources[r], 0);
    assert.equal(total, 19, `bank conservation for ${r}`);
    assert.ok(state.bank[r] >= 0 && state.players.every(p => p.resources[r] >= 0 && Number.isInteger(p.resources[r])));
  }
  const dev = state.devDeck.length + state.players.reduce((s, p) => s + p.devCards.length, 0);
  assert.ok(dev <= 25);
}
/** Run setup by taking the first legal action. */
function setupDone(seed = 1) {
  let s = R.createMatch({id: 'g', names: NAMES, seed});
  while (s.phase === 'setup') s = act(s, s.current, R.legalActions(s, s.current).actions[0]);
  return s;
}
/** Empty board in main phase for crafted scenarios. */
function blank(seed = 3) {
  const s = R.createMatch({id: 'g', names: NAMES, seed});
  Object.assign(s, {phase: 'play', turn: 5, current: 0, turnPhase: 'main', buildings: {}, roads: {}, setup: {index: 8, anchor: null}});
  s.turnState.rolled = true;
  return s;
}
function give(s, seat, vec) {
  for (const [r, n] of Object.entries(vec)) { s.bank[r] -= n; s.players[seat].resources[r] += n; }
  assertBank(s);
}
function giveDev(s, seat, type, bought = 0) {
  const i = s.devDeck.indexOf(type);
  assert.ok(i >= 0);
  s.devDeck.splice(i, 1);
  s.players[seat].devCards.push({type, bought});
}
/** Simple path of n edges starting at vertex v0 avoiding a vertex set. */
function path(v0, n, avoid = new Set()) {
  const seen = new Set([v0]);
  function go(v, left) {
    if (!left) return [];
    for (const e of GEO.vertices[v].edges) {
      const [a, b] = GEO.edges[e].v, nx = a === v ? b : a;
      if (seen.has(nx) || avoid.has(nx)) continue;
      seen.add(nx);
      const rest = go(nx, left - 1);
      if (rest) return [{e, from: v, to: nx}, ...rest];
      seen.delete(nx);
    }
    return null;
  }
  return go(v0, n);
}
/** Find an rng seed whose next roll totals `total`, keep everything else. */
function withRoll(s, total) {
  for (let k = 0; k < 10000; k++) {
    const t = clone(s);
    t.rng = {s: k};
    const d1 = E.rand(t, 6) + 1, d2 = E.rand(t, 6) + 1;
    if (d1 + d2 === total) { s.rng = {s: k}; return s; }
  }
  throw new Error('no seed');
}

// ---------------------------------------------------------------------------

test('geometry: unique canonical vertices/edges, pointy-top, adjacency, ports', () => {
  const s = R.createMatch({id: 'g', names: NAMES, seed: 11});
  const g = R.getBoardGeometry(s);
  assert.equal(g.hexes.length, 19);
  assert.equal(g.vertices.length, 54);
  assert.equal(g.edges.length, 72);
  assert.equal(g.ports.length, 9);
  assert.equal(new Set(g.vertices.map(v => v.id)).size, 54);
  assert.equal(new Set(g.vertices.map(v => `${v.x},${v.y}`)).size, 54, 'no duplicate vertex positions');
  assert.equal(new Set(g.edges.map(e => [e.x1, e.y1, e.x2, e.y2].join())).size, 72);
  const byId = new Map(g.vertices.map(v => [v.id, v]));
  for (const v of g.vertices) {
    assert.ok(v.adjacentVertices.length >= 2 && v.adjacentVertices.length <= 3);
    for (const a of v.adjacentVertices) {
      assert.ok(byId.get(a).adjacentVertices.includes(v.id), 'symmetric adjacency');
      assert.ok(Math.abs(Math.hypot(byId.get(a).x - v.x, byId.get(a).y - v.y) - 1) < 1e-3, 'unit edge length');
    }
  }
  for (const e of g.edges) assert.ok(Math.abs(Math.hypot(e.x2 - e.x1, e.y2 - e.y1) - 1) < 1e-3);
  // Pointy-top: centre hex has a vertex directly above its centre at distance 1.
  const centre = g.hexes.find(h => h.q === 0 && h.r === 0);
  assert.ok(g.vertices.some(v => Math.abs(v.x - centre.x) < 1e-3 && Math.abs(v.y - (centre.y - 1)) < 1e-3));
  for (const h of g.hexes) assert.equal(g.vertices.filter(v => v.hexes.includes(h.id)).length, 6);
  const portVs = g.ports.flatMap(p => p.vertices);
  assert.equal(new Set(portVs).size, 18);
  for (const p of g.ports) {
    const [a, b] = p.vertices.map(id => byId.get(id));
    assert.ok(a.adjacentVertices.includes(b.id), 'port spans one edge');
    assert.ok(a.hexes.length < 3 && b.hexes.length < 3, 'port on the coast');
    assert.ok(Math.hypot(p.x, p.y) > Math.hypot(a.x, a.y), 'port drawn outside');
  }
  assert.deepEqual(g.ports.map(p => p.type).sort(), ['brick', 'generic', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool']);
});

test('createMatch: stable seats, randomized order, fair board, serializable', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const s = R.createMatch({id: 'm' + seed, names: NAMES, seed});
    assert.deepEqual(s.players.map(p => p.id), ['seat-0', 'seat-1', 'seat-2', 'seat-3']);
    assert.deepEqual(s.players.map(p => p.kind), ['human', 'agent', 'agent', 'agent']);
    assert.deepEqual([...s.order].sort(), [0, 1, 2, 3]);
    orders.add(s.order.join());
    assert.equal(s.phase, 'setup');
    assert.equal(s.current, s.order[0]);
    assert.equal(s.hexes[s.robber].terrain, 'desert');
    assert.deepEqual(s.hexes.map(h => h.number).filter(Boolean).sort((a, b) => a - b), [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    s.hexes.forEach((h, i) => {
      if (h.number === 6 || h.number === 8)
        for (const j of GEO.hexNeighbors[i]) assert.ok(![6, 8].includes(s.hexes[j].number), 'red numbers not adjacent');
    });
    assert.equal(s.devDeck.length, 25);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  }
  assert.ok(orders.size > 5, 'turn order varies');
  assert.throws(() => R.createMatch({names: ['a', 'b', 'c']}));
  const unseeded = R.createMatch({id: 'x', names: NAMES});
  assert.equal(unseeded.rng, null);
});

test('setup sweep: snake order, distance rule, anchored roads, second-settlement resources', () => {
  let s = R.createMatch({id: 'g', names: NAMES, seed: 5});
  const expected = [...s.order, ...[...s.order].reverse()];
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const seat = s.current;
    seen.push(seat);
    const other = (seat + 1) % 4;
    reject(s, other, R.legalActions(s, seat).actions[0], /turn/);
    reject(s, seat, {type: 'roll'}, /setup/i);
    reject(s, seat, {type: 'build_road', edge: 'e0'}, /settlement/i);
    // Distance rule: every neighbour of an existing building is illegal.
    for (const [v] of Object.entries(s.buildings))
      for (const a of GEO.vertices[v].adj) reject(s, seat, {type: 'build_settlement', vertex: 'v' + a}, /close|taken/);
    const legal = R.legalActions(s, seat).actions;
    assert.ok(legal.every(a => a.type === 'build_settlement'));
    const pick = legal[(i * 7) % legal.length];
    const handBefore = {...s.players[seat].resources};
    s = act(s, seat, pick);
    const v = E.parseId(pick.vertex, 'v', 54);
    const gained = RESOURCES.reduce((n, r) => n + s.players[seat].resources[r] - handBefore[r], 0);
    const producing = GEO.vertices[v].hexes.filter(h => s.hexes[h].resource).length;
    assert.equal(gained, i >= 4 ? producing : 0, 'only second settlement pays');
    assert.equal(s.turnPhase, 'setupRoad');
    reject(s, seat, {type: 'build_settlement', vertex: legal.find(a => a !== pick).vertex}, /road/i);
    const roads = R.legalActions(s, seat).actions;
    assert.ok(roads.length >= 2 && roads.every(a => GEO.edges[E.parseId(a.edge, 'e', 72)].v.includes(v)));
    const far = GEO.edges.findIndex(e => !e.v.includes(v) && !s.roads[GEO.edges.indexOf(e)]);
    reject(s, seat, {type: 'build_road', edge: 'e' + far}, /touch/);
    s = act(s, seat, roads[0]);
    assertBank(s);
  }
  assert.deepEqual(seen, expected);
  assert.equal(s.phase, 'play');
  assert.equal(s.turnPhase, 'roll');
  assert.equal(s.current, s.order[0]);
  assert.deepEqual(R.legalActions(s, s.current).actions, [{type: 'roll'}]);
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(E.piecesLeft(s, seat).settlements, 3);
    assert.equal(E.piecesLeft(s, seat).roads, 13);
    assert.equal(E.publicVP(s, seat), 2);
  }
});

test('action strictness: unknown types/keys, bad ids, bad vectors, bad seats', () => {
  const s = setupDone(2), cur = s.current;
  reject(s, cur, {type: 'roll', extra: 1}, /Unexpected/);
  reject(s, cur, {type: 'nope'}, /Unknown action/);
  reject(s, cur, {type: 'constructor'}, /Unknown action/);
  reject(s, cur, {type: '__proto__'}, /Unknown action/);
  reject(s, cur, null);
  reject(s, cur, [], /type/);
  reject(s, 4, {type: 'roll'}, /seat/);
  reject(s, -1, {type: 'roll'}, /seat/);
  reject(s, '0', {type: 'roll'}, /seat/);
  const m = blank();
  give(m, 0, {brick: 4, lumber: 4});
  for (const bad of ['v54', 'v-1', 'v01', 'x3', 3, null, 'e3'])
    reject(m, 0, {type: 'build_city', vertex: bad}, /intersection/);
  reject(m, 0, {type: 'build_road', edge: 'e72'}, /road spot/);
  const vectors = [{brick: -1, lumber: 1}, {brick: 1.5}, {gold: 1}, {brick: '1'}, [1, 2], 'brick', {brick: NaN}, {brick: Infinity}];
  for (const give of vectors) reject(m, 0, {type: 'offer_trade', give, get: {wool: 1}}, /give/);
  reject(m, 0, {type: 'offer_trade', give: {brick: 1}, get: {brick: 1}}, /same resource/);
  reject(m, 0, {type: 'offer_trade', give: {brick: 1}, get: {}}, /at least one/);
  reject(m, 0, {type: 'offer_trade', give: {brick: 9}, get: {ore: 1}}, /do not have/);
  reject(m, 0, {type: 'offer_trade', give: {brick: 1}, get: {ore: 1}, to: [0]}, /other seat/);
  reject(m, 0, {type: 'bank_trade', give: 'gold', get: 'ore'}, /give/);
});

test('out-of-turn and phase guards on every action', () => {
  let s = setupDone(3);
  const cur = s.current, other = s.order[1];
  for (const a of [{type: 'roll'}, {type: 'end_turn'}, {type: 'buy_dev_card'}, {type: 'play_knight'}, {type: 'bank_trade', give: 'ore', get: 'wool'}])
    reject(s, other, a, /turn|Knight|development/);
  reject(s, cur, {type: 'end_turn'}, /Roll/);
  reject(s, cur, {type: 'buy_dev_card'}, /Roll/);
  reject(s, cur, {type: 'bank_trade', give: 'ore', get: 'wool'}, /Roll/);
  reject(s, cur, {type: 'move_robber', hex: 'h0', victim: null}, /Roll/);
  reject(s, cur, {type: 'discard', resources: {}}, /discard/);
  reject(s, cur, {type: 'end_road_building'}, /Roll/);
  reject(s, cur, {type: 'cancel_trade'}, /offer/);
  s = act(withRoll(s, 6), cur, {type: 'roll'});
  assert.equal(s.turnPhase, 'main');
  reject(s, cur, {type: 'roll'}, /already rolled/);
  reject(s, other, {type: 'end_turn'}, /turn/);
  s = act(s, cur, {type: 'end_turn'});
  assert.equal(s.current, other);
  assert.equal(s.turnPhase, 'roll');
  assert.equal(s.turn, 2);
  for (let seat = 0; seat < 4; seat++) {
    const L = R.legalActions(s, seat);
    if (seat !== other) { assert.deepEqual(L.actions, []); assert.match(L.instruction, /Waiting/); }
  }
});

test('building rules: connection, costs, piece caps, city upgrade, road blocked by opponent', () => {
  const s = blank();
  const p = path(0, 4);
  s.buildings[p[0].from] = {type: 'settlement', owner: 0};
  give(s, 0, {brick: 10, lumber: 10, wool: 5, grain: 9, ore: 9});
  let t = act(s, 0, {type: 'build_road', edge: 'e' + p[0].e});
  assert.equal(t.players[0].resources.brick, 9);
  assertBank(t);
  // Not connected.
  const far = GEO.edges.findIndex(e => e.v.every(v => GEO.vertices[v].x > 2));
  reject(t, 0, {type: 'build_road', edge: 'e' + far}, /connected/);
  reject(t, 0, {type: 'build_settlement', vertex: 'v' + p[0].to}, /settlement needs/); // distance
  t = act(t, 0, {type: 'build_road', edge: 'e' + p[1].e});
  t = act(t, 0, {type: 'build_settlement', vertex: 'v' + p[1].to});
  assert.equal(E.publicVP(t, 0), 2);
  t = act(t, 0, {type: 'build_city', vertex: 'v' + p[1].to});
  assert.equal(E.publicVP(t, 0), 3);
  assert.deepEqual(E.piecesLeft(t, 0), {settlements: 4, cities: 3, roads: 13});
  reject(t, 0, {type: 'build_city', vertex: 'v' + p[1].to}, /replace/);
  reject(t, 1, {type: 'build_city', vertex: 'v' + p[0].from}, /turn/);
  assertBank(t);
  // Opponent settlement blocks extending through it.
  const u = blank();
  u.buildings[p[0].from] = {type: 'settlement', owner: 0};
  u.roads[p[0].e] = 0;
  u.buildings[p[0].to] = {type: 'settlement', owner: 1};
  give(u, 0, {brick: 2, lumber: 2});
  reject(u, 0, {type: 'build_road', edge: 'e' + p[1].e}, /connected/);
  // Caps: 15 roads.
  const w = blank();
  let n = 0;
  for (let e = 0; e < 72 && n < 15; e++) { w.roads[e] = 0; n++; }
  give(w, 0, {brick: 1, lumber: 1});
  assert.equal(E.piecesLeft(w, 0).roads, 0);
  assert.ok(!R.legalActions(w, 0).actions.some(a => a.type === 'build_road'));
  reject(w, 0, {type: 'build_road', edge: 'e71'}, /no roads/);
  // Caps: 5 settlements.
  const x = blank();
  const spots = [];
  for (let v = 0; v < 54 && spots.length < 6; v++) if (E.distanceOk(x, v)) { x.buildings[v] = {type: 'settlement', owner: 0}; spots.push(v); }
  delete x.buildings[spots[5]];
  x.roads[GEO.vertices[spots[5]].edges[0]] = 0;
  give(x, 0, {brick: 1, lumber: 1, wool: 1, grain: 1});
  reject(x, 0, {type: 'build_settlement', vertex: 'v' + spots[5]}, /no settlements/);
  // Not enough resources.
  const y = blank();
  y.buildings[p[0].from] = {type: 'settlement', owner: 0};
  reject(y, 0, {type: 'build_road', edge: 'e' + p[0].e}, /need/);
  reject(y, 0, {type: 'buy_dev_card'}, /need/);
});

test('finite bank: production shortage, single-claimant remainder, robber blocks', () => {
  const s = blank();
  const h = s.hexes.findIndex(x => x.resource === 'ore');
  const num = s.hexes[h].number;
  const [a, , c] = GEO.hexes[h].vertices; // non-adjacent corners 0 and 2
  s.buildings[a] = {type: 'city', owner: 0};
  s.buildings[c] = {type: 'settlement', owner: 1};
  // Clear other hexes with the same number so only this one produces.
  s.hexes.forEach((x, i) => { if (i !== h && x.number === num) x.number = null; });
  give(s, 2, {ore: 17}); // bank ore 2, owed 3 across two players -> nobody
  let t = clone(s);
  let r = E.produce(t, num);
  assert.deepEqual(r.shortages, ['ore']);
  assert.equal(t.players[0].resources.ore + t.players[1].resources.ore, 0);
  assertBank(t);
  // Single claimant owed 2 with 1 in bank gets 1.
  t = clone(s);
  delete t.buildings[c];
  give(t, 2, {ore: 1});
  r = E.produce(t, num);
  assert.equal(t.players[0].resources.ore, 1);
  assert.equal(t.bank.ore, 0);
  assertBank(t);
  // Enough in bank: both paid.
  t = blank();
  Object.assign(t, {hexes: s.hexes, buildings: s.buildings});
  E.produce(t, num);
  assert.equal(t.players[0].resources.ore, 2);
  assert.equal(t.players[1].resources.ore, 1);
  // Robber blocks.
  t = blank();
  Object.assign(t, {hexes: s.hexes, buildings: s.buildings, robber: h});
  E.produce(t, num);
  assert.equal(t.players[0].resources.ore, 0);
  // Via a real roll.
  t = blank();
  Object.assign(t, {hexes: s.hexes, buildings: s.buildings, turnPhase: 'roll'});
  t.turnState.rolled = false;
  t = act(withRoll(t, num), 0, {type: 'roll'});
  assert.equal(t.players[0].resources.ore, 2);
  assertBank(t);
});

test('bank trades: ratios 4/3/2, bank availability, unlimited per turn', () => {
  const s = blank();
  give(s, 0, {wool: 8});
  let t = act(s, 0, {type: 'bank_trade', give: 'wool', get: 'ore'});
  assert.equal(t.players[0].resources.wool, 4);
  t = act(t, 0, {type: 'bank_trade', give: 'wool', get: 'ore'});
  assert.equal(t.players[0].resources.ore, 2);
  reject(t, 0, {type: 'bank_trade', give: 'wool', get: 'ore'}, /need 4/);
  reject(t, 0, {type: 'bank_trade', give: 'ore', get: 'ore'}, /different/);
  assertBank(t);
  const generic = GEO.ports.find(p => p.type === 'generic'), wool = GEO.ports.find(p => p.type === 'wool');
  const u = blank();
  u.buildings[generic.vertices[0]] = {type: 'settlement', owner: 0};
  give(u, 0, {wool: 3, brick: 3});
  assert.equal(E.tradeRatio(u, 0, 'brick'), 3);
  u.buildings[wool.vertices[1]] = {type: 'settlement', owner: 0};
  assert.equal(E.tradeRatio(u, 0, 'wool'), 2);
  assert.equal(R.viewMatch(u, 0).me.tradeRatios.wool, 2);
  const v = act(u, 0, {type: 'bank_trade', give: 'wool', get: 'grain'});
  assert.equal(v.players[0].resources.wool, 1);
  // Bank out of grain.
  const w = clone(u);
  give(w, 1, {grain: 19});
  reject(w, 0, {type: 'bank_trade', give: 'wool', get: 'grain'}, /no grain/);
  assert.ok(!R.legalActions(w, 0).actions.some(a => a.type === 'bank_trade' && a.get === 'grain'));
  assert.ok(R.legalActions(w, 0).actions.some(a => a.type === 'bank_trade' && a.get === 'ore'));
});

test('player trades execute once, respect targets, and go stale', () => {
  const s = blank();
  give(s, 0, {brick: 2});
  give(s, 1, {ore: 1});
  give(s, 2, {ore: 1});
  let t = act(s, 0, {type: 'offer_trade', give: {brick: 1}, get: {ore: 1}, to: [1, 2]});
  const id = t.offer.id;
  reject(t, 0, {type: 'offer_trade', give: {brick: 1}, get: {ore: 1}}, /open offer/);
  reject(t, 3, {type: 'respond_trade', offerId: id, accept: true}, /not open to you/);
  reject(t, 1, {type: 'respond_trade', offerId: id + 1, accept: true}, /no longer open/);
  reject(t, 1, {type: 'respond_trade', offerId: id, accept: 'yes'}, /true or false/);
  assert.deepEqual(R.legalActions(t, 1).actions, [
    {type: 'respond_trade', offerId: id, accept: true}, {type: 'respond_trade', offerId: id, accept: false}]);
  assert.deepEqual(R.legalActions(t, 3).actions, []);
  const accepted = act(t, 1, {type: 'respond_trade', offerId: id, accept: true});
  assert.equal(accepted.offer, null);
  assert.equal(accepted.players[1].resources.brick, 1);
  assert.equal(accepted.players[0].resources.ore, 1);
  reject(accepted, 2, {type: 'respond_trade', offerId: id, accept: true}, /no longer open/);
  assertBank(accepted);
  // Declines by everyone close it; responder lacking cards cannot accept.
  let d = act(t, 1, {type: 'respond_trade', offerId: id, accept: false});
  reject(d, 1, {type: 'respond_trade', offerId: id, accept: true}, /not open/);
  d = act(d, 2, {type: 'respond_trade', offerId: id, accept: false});
  assert.equal(d.offer, null);
  const poor = act(s, 0, {type: 'offer_trade', give: {brick: 1}, get: {wool: 1}});
  reject(poor, 3, {type: 'respond_trade', offerId: poor.offer.id, accept: true}, /do not have/);
  assert.deepEqual(R.legalActions(poor, 3).actions, [{type: 'respond_trade', offerId: poor.offer.id, accept: false}]);
  // Offer cleared at end of turn.
  const ended = act(t, 0, {type: 'end_turn'});
  assert.equal(ended.offer, null);
  // Cancel.
  assert.equal(act(t, 0, {type: 'cancel_trade'}).offer, null);
  reject(t, 1, {type: 'cancel_trade'}, /no open offer/);
});

test('seven: discard half, robber move, private steal, views do not leak', () => {
  let s = blank();
  Object.assign(s, {turnPhase: 'roll'});
  s.turnState.rolled = false;
  give(s, 1, {brick: 5, ore: 4}); // 9 -> discard 4
  give(s, 2, {wool: 7}); // 7 -> none
  give(s, 3, {grain: 8}); // 8 -> discard 4
  const h = s.hexes.findIndex((x, i) => i !== s.robber && x.resource);
  const [a, , c] = GEO.hexes[h].vertices;
  s.buildings[a] = {type: 'settlement', owner: 1};
  s.buildings[c] = {type: 'settlement', owner: 2};
  s = act(withRoll(s, 7), 0, {type: 'roll'});
  assert.equal(s.turnPhase, 'discard');
  assert.deepEqual(s.pendingDiscards, {1: 4, 3: 4});
  assert.deepEqual(R.legalActions(s, 1).choices.discard, {count: 4, hand: {brick: 5, lumber: 0, wool: 0, grain: 0, ore: 4}});
  assert.deepEqual(R.legalActions(s, 2).actions, []);
  reject(s, 2, {type: 'discard', resources: {wool: 3}}, /do not need/);
  reject(s, 1, {type: 'discard', resources: {brick: 3}}, /exactly 4/);
  reject(s, 1, {type: 'discard', resources: {wool: 4}}, /do not have/);
  reject(s, 1, {type: 'discard', resources: {brick: 4, extra: 0}}, /unknown/);
  reject(s, 0, {type: 'move_robber', hex: 'h' + h, victim: 1}, /discard/);
  s = act(s, 3, {type: 'discard', resources: {grain: 4}});
  assert.equal(s.turnPhase, 'discard');
  s = act(s, 1, {type: 'discard', resources: {brick: 2, ore: 2}});
  assert.equal(s.turnPhase, 'robber');
  assertBank(s);
  reject(s, 0, {type: 'move_robber', hex: 'h' + s.robber, victim: null}, /different/);
  reject(s, 0, {type: 'move_robber', hex: 'h' + h, victim: null}, /Choose a player/);
  reject(s, 0, {type: 'move_robber', hex: 'h' + h, victim: 3}, /Choose a player/);
  reject(s, 0, {type: 'move_robber', hex: 'h' + h, victim: 0}, /Choose a player/);
  const legal = R.legalActions(s, 0).actions;
  assert.ok(legal.some(x => x.hex === 'h' + h && x.victim === 1) && legal.some(x => x.hex === 'h' + h && x.victim === 2));
  assert.ok(legal.every(x => x.type === 'move_robber' && x.hex !== 'h' + s.robber));
  const before = s.players[2].resources.wool;
  s = act(s, 0, {type: 'move_robber', hex: 'h' + h, victim: 2});
  assert.equal(s.players[2].resources.wool, before - 1);
  assert.equal(s.players[0].resources.wool, 1);
  assert.equal(s.turnPhase, 'main');
  assertBank(s);
  const last = seat => R.viewMatch(s, seat).log.at(-1).text;
  assert.match(last(0), /1 wool/);
  assert.match(last(2), /1 wool/);
  assert.doesNotMatch(last(1), /wool/);
  assert.doesNotMatch(last(3), /wool/);
  for (let seat = 0; seat < 4; seat++) {
    const v = R.viewMatch(s, seat), json = JSON.stringify(v);
    assert.equal(v.mySeat, seat);
    assert.equal(v.myIndex, seat);
    assert.equal(v.myPlayerId, 'seat-' + seat);
    for (const leak of ['devDeck"', '"rng"', '"resources":{', 'bought', '"private"']) {
      if (leak === '"resources":{') assert.equal(json.split(leak).length - 1, 1, 'only my own hand');
      else assert.ok(!json.includes(leak), `view leaks ${leak}`);
    }
    v.players.forEach((p, i) => { if (i !== seat) { assert.equal(p.vpCards, undefined); assert.equal(p.totalVP, undefined); } });
    assert.deepEqual(v.me.resources, s.players[seat].resources);
  }
});

test('knight before roll returns to roll; one dev card per turn; new cards wait', () => {
  let s = blank();
  Object.assign(s, {turnPhase: 'roll'});
  s.turnState.rolled = false;
  giveDev(s, 0, 'knight', 1);
  giveDev(s, 0, 'monopoly', 1);
  giveDev(s, 0, 'knight', 5); // bought this turn
  const L = R.legalActions(s, 0);
  assert.ok(L.actions.some(a => a.type === 'play_knight'));
  assert.ok(L.actions.some(a => a.type === 'roll'));
  s = act(s, 0, {type: 'play_knight'});
  assert.equal(s.turnPhase, 'robber');
  assert.equal(s.players[0].knights, 1);
  s = act(s, 0, R.legalActions(s, 0).actions[0]);
  assert.equal(s.turnPhase, 'roll');
  reject(s, 0, {type: 'play_monopoly', resource: 'ore'}, /one development card/);
  reject(s, 0, {type: 'play_knight'}, /one development card/);
  assert.ok(!R.legalActions(s, 0).actions.some(a => a.type.startsWith('play_')));
  s = act(withRoll(s, 5), 0, {type: 'roll'});
  assert.equal(s.turnPhase, 'main');
  // New card: not playable on its turn.
  let t = blank();
  giveDev(t, 0, 'knight', 5);
  reject(t, 0, {type: 'play_knight'}, /bought it/);
  assert.equal(R.viewMatch(t, 0).me.devCards[0].playable, false);
  // Bought card via buy_dev_card is unplayable until the next own turn.
  let b = blank();
  give(b, 0, {ore: 1, grain: 1, wool: 1});
  b.devDeck.push('knight');
  b = act(b, 0, {type: 'buy_dev_card'});
  assert.deepEqual(b.players[0].devCards, [{type: 'knight', bought: 5}]);
  assert.match(R.viewMatch(b, 0).log.at(-1).text, /You bought a Knight/);
  assert.doesNotMatch(R.viewMatch(b, 1).log.at(-1).text, /Knight/);
  reject(b, 0, {type: 'play_knight'}, /bought it/);
  for (let i = 0; i < 4; i++) {
    const cur = b.current;
    b.turnPhase = 'main';
    b = act(b, cur, {type: 'end_turn'});
  }
  assert.equal(b.current, 0);
  assert.ok(R.legalActions(b, 0).actions.some(a => a.type === 'play_knight'));
  // Empty-deck buy.
  const e = blank();
  give(e, 0, {ore: 1, grain: 1, wool: 1});
  e.devDeck = [];
  reject(e, 0, {type: 'buy_dev_card'}, /empty/);
});

test('monopoly and year of plenty with finite bank', () => {
  let s = blank();
  giveDev(s, 0, 'monopoly');
  give(s, 1, {ore: 3});
  give(s, 3, {ore: 2, wool: 1});
  assert.equal(R.legalActions(s, 0).actions.filter(a => a.type === 'play_monopoly').length, 5);
  reject(s, 0, {type: 'play_monopoly', resource: 'gold'}, /resource/);
  s = act(s, 0, {type: 'play_monopoly', resource: 'ore'});
  assert.equal(s.players[0].resources.ore, 5);
  assert.equal(s.players[1].resources.ore + s.players[3].resources.ore, 0);
  assertBank(s);
  let y = blank();
  giveDev(y, 0, 'yearOfPlenty');
  assert.deepEqual(R.legalActions(y, 0).choices.play_year_of_plenty.count, 2);
  reject(y, 0, {type: 'play_year_of_plenty', resources: {ore: 1}}, /exactly 2/);
  reject(y, 0, {type: 'play_year_of_plenty', resources: {ore: 3}}, /exactly 2/);
  reject(y, 0, {type: 'play_year_of_plenty', resources: {ore: -1, wool: 3}}, /non-negative/);
  const yy = act(y, 0, {type: 'play_year_of_plenty', resources: {ore: 2}});
  assert.equal(yy.players[0].resources.ore, 2);
  assertBank(yy);
  // Bank has 1 ore only.
  give(y, 1, {ore: 18});
  reject(y, 0, {type: 'play_year_of_plenty', resources: {ore: 2}}, /bank does not/);
  assert.equal(act(y, 0, {type: 'play_year_of_plenty', resources: {ore: 1, wool: 1}}).players[0].resources.ore, 1);
  // Bank with a single card left: count drops to 1.
  const z = blank();
  giveDev(z, 0, 'yearOfPlenty');
  give(z, 1, {brick: 19, lumber: 19, wool: 19, grain: 19, ore: 18});
  assert.equal(R.legalActions(z, 0).choices.play_year_of_plenty.count, 1);
  assert.equal(act(z, 0, {type: 'play_year_of_plenty', resources: {ore: 1}}).bank.ore, 0);
  give(z, 1, {ore: 1});
  assert.equal(R.legalActions(z, 0).choices.play_year_of_plenty, undefined);
  reject(z, 0, {type: 'play_year_of_plenty', resources: {}}, /bank is empty/);
});

test('road building: two free roads, 1 piece, no spot, cannot strand the phase', () => {
  const p = path(0, 6);
  let s = blank();
  s.buildings[p[0].from] = {type: 'settlement', owner: 0};
  giveDev(s, 0, 'roadBuilding');
  s = act(s, 0, {type: 'play_road_building'});
  assert.equal(s.turnPhase, 'roadBuilding');
  assert.equal(R.viewMatch(s, 0).freeRoads, 2);
  reject(s, 0, {type: 'end_turn'}, /free roads/);
  reject(s, 0, {type: 'buy_dev_card'}, /free roads/);
  s = act(s, 0, {type: 'build_road', edge: 'e' + p[0].e});
  s = act(s, 0, {type: 'build_road', edge: 'e' + p[1].e});
  assert.equal(s.turnPhase, 'main');
  assert.equal(E.handSize(s.players[0].resources), 0, 'roads were free');
  assertBank(s);
  // Only one road piece left.
  let one = blank();
  one.buildings[p[0].from] = {type: 'settlement', owner: 0};
  let k = 0;
  for (let e = 71; k < 14; e--) if (!GEO.edges[e].v.includes(p[0].from)) { one.roads[e] = 0; k++; }
  giveDev(one, 0, 'roadBuilding');
  one = act(one, 0, {type: 'play_road_building'});
  assert.equal(one.turnState.freeRoads, 1);
  one = act(one, 0, {type: 'build_road', edge: 'e' + p[0].e});
  assert.equal(one.turnPhase, 'main');
  // No legal spot: not offered and rejected.
  let none = blank();
  giveDev(none, 0, 'roadBuilding');
  assert.ok(!R.legalActions(none, 0).actions.some(a => a.type === 'play_road_building'));
  reject(none, 0, {type: 'play_road_building'}, /no road/);
  // First road leaves no further spot: auto-exits.
  let trap = blank();
  const v = GEO.vertices.findIndex(x => x.adj.length === 2);
  trap.buildings[v] = {type: 'settlement', owner: 0};
  const [e1, e2] = GEO.vertices[v].edges;
  const far1 = GEO.edges[e1].v.find(x => x !== v), far2 = GEO.edges[e2].v.find(x => x !== v);
  trap.roads[e2] = 1;
  trap.buildings[far1] = {type: 'settlement', owner: 1};
  trap.buildings[far2] = {type: 'settlement', owner: 2};
  giveDev(trap, 0, 'roadBuilding');
  trap = act(trap, 0, {type: 'play_road_building'});
  trap = act(trap, 0, {type: 'build_road', edge: 'e' + e1});
  assert.equal(trap.turnPhase, 'main', 'auto-exit when no road can be placed');
  // Pre-roll road building returns to roll; end_road_building forfeits.
  let pre = blank();
  Object.assign(pre, {turnPhase: 'roll'});
  pre.turnState.rolled = false;
  pre.buildings[p[0].from] = {type: 'settlement', owner: 0};
  giveDev(pre, 0, 'roadBuilding');
  pre = act(pre, 0, {type: 'play_road_building'});
  pre = act(pre, 0, {type: 'build_road', edge: 'e' + p[0].e});
  pre = act(pre, 0, {type: 'end_road_building'});
  assert.equal(pre.turnPhase, 'roll');
});

test('longest road: threshold 5, incumbent keeps ties, settlement split, tie leaves it unheld', () => {
  const p = path(0, 8);
  let s = blank();
  s.buildings[p[0].from] = {type: 'settlement', owner: 0};
  give(s, 0, {brick: 10, lumber: 10});
  for (let i = 0; i < 4; i++) s = act(s, 0, {type: 'build_road', edge: 'e' + p[i].e});
  assert.equal(s.awards.longestRoad, null);
  s = act(s, 0, {type: 'build_road', edge: 'e' + p[4].e});
  assert.equal(s.awards.longestRoad, 0);
  assert.equal(E.publicVP(s, 0), 3);
  assert.deepEqual(R.viewMatch(s, 2).awards.longestRoad, {seat: 0, length: 5});
  // Opponent 1 builds an equal 5-road elsewhere: incumbent keeps.
  const used = new Set(p.flatMap(x => [x.from, x.to]));
  for (const x of p) for (const a of GEO.vertices[x.to].adj) used.add(a);
  const start = GEO.vertices.findIndex((_, v) => !used.has(v) && GEO.vertices[v].adj.every(a => !used.has(a)));
  const q = path(start, 6, used);
  q.slice(0, 5).forEach(x => { s.roads[x.e] = 1; });
  E.updateLongestRoad(s);
  assert.equal(s.awards.longestRoad, 0, 'tie keeps incumbent');
  s.roads[q[5].e] = 1;
  E.updateLongestRoad(s);
  assert.equal(s.awards.longestRoad, 1, 'strictly longer takes it');
  // Split player 1's 6-road with player 2's settlement in the middle (via action on their turn).
  s.current = 2;
  give(s, 2, {brick: 1, lumber: 1, wool: 1, grain: 1});
  const mid = q[2].to; // splits into 3 + 3
  s.roads[GEO.vertices[mid].edges.find(e => s.roads[e] === undefined)] = 2;
  s = act(s, 2, {type: 'build_settlement', vertex: 'v' + mid});
  assert.equal(s.players[1].roadLength, 3);
  assert.equal(s.awards.longestRoad, 0, 'broken holder loses to unique leader');
  // Longest-road trail search: a Y shape counts its longest branch pair, not all edges.
  const y = blank();
  const center = GEO.vertices.findIndex(v => v.adj.length === 3);
  GEO.vertices[center].edges.forEach(e => { y.roads[e] = 0; });
  assert.equal(E.longestRoad(y, 0), 2);
  // Loop of 6 around a hex counts 6.
  const ring = blank();
  const hv = GEO.hexes[9].vertices;
  for (let i = 0; i < 6; i++) ring.roads[GEO.edgeBetween.get([hv[i], hv[(i + 1) % 6]].sort((a, b) => a - b).join('-'))] = 0;
  assert.equal(E.longestRoad(ring, 0), 6);
  // Tie among challengers after the holder breaks: nobody holds it.
  const t = blank();
  t.awards.longestRoad = 3;
  t.players[3].roadLength = 5;
  q.slice(0, 5).forEach(x => { t.roads[x.e] = 1; });
  p.slice(0, 5).forEach(x => { t.roads[x.e] = 2; });
  E.updateLongestRoad(t);
  assert.equal(t.awards.longestRoad, null);
});

test('largest army: 3 knights, strictly more to take it', () => {
  const s = blank();
  s.players[1].knights = 2;
  E.updateLargestArmy(s);
  assert.equal(s.awards.largestArmy, null);
  s.players[1].knights = 3;
  E.updateLargestArmy(s);
  assert.equal(s.awards.largestArmy, 1);
  s.players[0].knights = 3;
  E.updateLargestArmy(s);
  assert.equal(s.awards.largestArmy, 1, 'tie keeps holder');
  let t = clone(s);
  giveDev(t, 0, 'knight');
  t = act(t, 0, {type: 'play_knight'});
  assert.equal(t.awards.largestArmy, 0);
  assert.equal(E.publicVP(t, 0), 2);
});

test('winner only on own turn; hidden VP cards count; view reveals at end', () => {
  let s = blank();
  // Seat 0 (current) has 8 VP of cities; buying into 10 wins on their turn.
  const spots = [];
  for (let v = 0; v < 54 && spots.length < 4; v++) if (E.distanceOk(s, v)) { s.buildings[v] = {type: 'city', owner: 0}; spots.push(v); }
  giveDev(s, 0, 'victoryPoint');
  assert.equal(E.totalVP(s, 0), 9);
  assert.equal(R.viewMatch(s, 1).players[0].publicVP, 8);
  assert.equal(R.viewMatch(s, 1).players[0].totalVP, undefined);
  // Seat 1 reaches 10 while it is seat 0's turn: no win yet.
  const other = [];
  for (let v = 0; v < 54 && other.length < 4; v++) if (E.distanceOk(s, v)) { s.buildings[v] = {type: 'city', owner: 1}; other.push(v); }
  s.awards.largestArmy = 1;
  s.players[1].knights = 3;
  give(s, 0, {brick: 1, lumber: 1});
  s = act(s, 0, R.legalActions(s, 0).actions.find(a => a.type === 'build_road') || {type: 'end_turn'});
  assert.equal(E.totalVP(s, 1), 10);
  assert.equal(s.phase, 'play', 'no win off-turn');
  // Pass turns until seat 1 is current; they win at the start of their turn.
  while (s.current !== 1 && s.phase === 'play') {
    s.turnPhase = 'main';
    s = act(s, s.current, {type: 'end_turn'});
  }
  assert.equal(s.phase, 'finished');
  assert.equal(s.winner, 1);
  reject(s, 1, {type: 'roll'}, /over/);
  const v = R.viewMatch(s, 2);
  assert.equal(v.players[0].vpCards, 1);
  assert.equal(v.players[0].totalVP, 9);
  assert.match(v.legalActions.instruction, /won/);
  // Current player winning via a VP card buy.
  let w = blank();
  for (let v2 = 0, n = 0; v2 < 54 && n < 4; v2++) if (E.distanceOk(w, v2)) { w.buildings[v2] = {type: 'city', owner: 0}; n++; }
  giveDev(w, 0, 'victoryPoint');
  give(w, 0, {ore: 1, grain: 1, wool: 1});
  w.devDeck.push('victoryPoint');
  w = act(w, 0, {type: 'buy_dev_card'});
  assert.equal(w.winner, 0);
  assert.equal(w.phase, 'finished');
});

test('full seeded autoplay games reach a winner with invariants intact', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    let s = R.createMatch({id: 'auto' + seed, names: NAMES, seed});
    let x = seed * 7919, steps = 0;
    const pick = arr => arr[(x = (x * 1103515245 + 12345) % 2147483648) % arr.length];
    while (s.phase !== 'finished') {
      assert.ok(++steps < 30000, 'game should finish');
      let moved = false;
      for (let seat = 0; seat < 4 && !moved; seat++) {
        const L = R.legalActions(s, seat);
        let acts = L.actions.filter(a => a.type !== 'respond_trade' || a.accept === false || x % 2);
        if (L.choices.discard) {
          const res = {}; let n = L.choices.discard.count;
          for (const r of RESOURCES) { const k = Math.min(n, L.choices.discard.hand[r]); if (k) res[r] = k; n -= k; }
          acts = [{type: 'discard', resources: res}];
        }
        if (L.choices.play_year_of_plenty && x % 5 === 0) {
          const {count, bank} = L.choices.play_year_of_plenty;
          const res = {}; let n = count;
          for (const r of RESOURCES) { const k = Math.min(n, bank[r]); if (k) res[r] = k; n -= k; }
          acts = [{type: 'play_year_of_plenty', resources: res}];
        }
        if (L.choices.offer_trade && x % 11 === 0 && !s.offer) {
          const r = RESOURCES.find(q => L.choices.offer_trade.hand[q] > 0);
          acts = [{type: 'offer_trade', give: {[r]: 1}, get: {[RESOURCES.find(q => q !== r)]: 1}}];
        }
        if (!acts.length) continue;
        const good = acts.filter(a => /^(build|buy|play)/.test(a.type));
        const a = good.length && x % 4 ? pick(good) : pick(acts);
        s = R.applyAction(s, seat, a).state;
        moved = true;
      }
      assert.ok(moved, 'someone always has a legal action');
      assertBank(s);
    }
    assert.ok(E.totalVP(s, s.winner) >= 10);
    const json = JSON.stringify(R.viewMatch(s, 0));
    assert.ok(!json.includes('"rng"') && !json.includes('devDeck"'));
  }
});

test('every enumerated legal action applies cleanly (sampled game)', () => {
  let s = R.createMatch({id: 'all', names: NAMES, seed: 42});
  let x = 99;
  for (let step = 0; step < 400 && s.phase !== 'finished'; step++) {
    for (let seat = 0; seat < 4; seat++)
      for (const a of R.legalActions(s, seat).actions) R.applyAction(s, seat, a); // must not throw
    const seat = [0, 1, 2, 3].find(k => R.legalActions(s, k).actions.length || R.legalActions(s, k).choices.discard);
    const L = R.legalActions(s, seat);
    let a;
    if (L.choices.discard) {
      const res = {}; let n = L.choices.discard.count;
      for (const r of RESOURCES) { const k = Math.min(n, L.choices.discard.hand[r]); if (k) res[r] = k; n -= k; }
      a = {type: 'discard', resources: res};
    } else a = L.actions[(x = (x * 48271) % 2147483647) % L.actions.length];
    s = R.applyAction(s, seat, a).state;
  }
});
