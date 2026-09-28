/**
 * Catan base-game engine (four players).
 *
 * Adapted from Viral-Doshi/catan server/gameLogic.js
 * (https://github.com/Viral-Doshi/catan, commit 3a0a6b8), MIT License,
 * Copyright (c) 2024 Viral Doshi. See ./LICENSE for the full notice.
 *
 * Kept from upstream: resource/terrain/cost constants, the development-card
 * distribution, the 19-hex pointy-top axial layout, the port layout, and the
 * rule structure (distance rule, road connectivity, awards, trade ratios).
 *
 * Changed in this adaptation:
 * - One canonical vertex/edge graph (54 vertices, 72 edges) replaces the
 *   upstream alias keys, so every physical spot has exactly one id.
 * - Finite bank (19 per resource) with the official shortage rule.
 * - Longest road uses a proper trail search that respects opponent buildings.
 * - Board generation keeps red numbers (6/8) apart.
 * - Randomness comes from crypto or a serializable seeded PRNG kept in state.
 *
 * Everything here is pure data + functions over plain JSON state. Turn/phase
 * orchestration and action validation live in ./rules.mjs.
 */
import {randomInt} from 'node:crypto';

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

export const TERRAIN = {
  hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null
};

export const COSTS = {
  road: {brick: 1, lumber: 1},
  settlement: {brick: 1, lumber: 1, wool: 1, grain: 1},
  city: {ore: 3, grain: 2},
  devCard: {ore: 1, grain: 1, wool: 1}
};

export const PIECES = {settlements: 5, cities: 4, roads: 15};
export const BANK_PER_RESOURCE = 19;
export const WIN_VP = 10;

export const DEV_CARDS = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
const DEV_DECK = [
  ...Array(14).fill('knight'), ...Array(5).fill('victoryPoint'),
  ...Array(2).fill('roadBuilding'), ...Array(2).fill('yearOfPlenty'), ...Array(2).fill('monopoly')
];

export const PLAYER_COLORS = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f'];

// Upstream HEX_POSITIONS_STANDARD, in upstream order; hex id = 'h' + index.
const HEX_POSITIONS = [
  {q: 0, r: -2}, {q: 1, r: -2}, {q: 2, r: -2},
  {q: -1, r: -1}, {q: 0, r: -1}, {q: 1, r: -1}, {q: 2, r: -1},
  {q: -2, r: 0}, {q: -1, r: 0}, {q: 0, r: 0}, {q: 1, r: 0}, {q: 2, r: 0},
  {q: -2, r: 1}, {q: -1, r: 1}, {q: 0, r: 1}, {q: 1, r: 1},
  {q: -2, r: 2}, {q: -1, r: 2}, {q: 0, r: 2}
];
const TERRAIN_DECK = [
  ...Array(3).fill('hills'), ...Array(4).fill('forest'), ...Array(4).fill('pasture'),
  ...Array(4).fill('fields'), ...Array(3).fill('mountains'), 'desert'
];
const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// Upstream PORT_POSITIONS_STANDARD: [hexQ, hexR, cornerDir] pairs, cornerDir 0=top clockwise.
const PORT_LAYOUT = [
  {corners: [[0, -2, 0], [0, -2, 5]], type: 'generic'},
  {corners: [[1, -2, 0], [1, -2, 1]], type: 'grain'},
  {corners: [[2, -2, 1], [2, -2, 2]], type: 'ore'},
  {corners: [[2, -1, 2], [2, 0, 1]], type: 'generic'},
  {corners: [[2, 0, 2], [2, 0, 3]], type: 'wool'},
  {corners: [[1, 1, 2], [1, 1, 3]], type: 'generic'},
  {corners: [[0, 2, 3], [0, 2, 4]], type: 'generic'},
  {corners: [[-2, 2, 3], [-2, 2, 4]], type: 'brick'},
  {corners: [[-2, 0, 4], [-2, 0, 5]], type: 'lumber'}
];

// ---------------------------------------------------------------------------
// Geometry: pointy-top, circumradius 1, y down. Built once, shared by all games.
// ---------------------------------------------------------------------------

const SQRT3 = Math.sqrt(3);
const round = n => Math.round(n * 1e4) / 1e4;
export const hexCenter = (q, r) => ({x: round(SQRT3 * (q + r / 2)), y: round(1.5 * r)});
// Corner dir 0=top, 1=upper-right, 2=lower-right, 3=bottom, 4=lower-left, 5=upper-left.
const CORNER_ANGLES = [-90, -30, 30, 90, 150, 210];
function cornerPoint(q, r, dir) {
  const c = hexCenter(q, r), a = CORNER_ANGLES[dir] * Math.PI / 180;
  return {x: round(c.x + Math.cos(a)), y: round(c.y + Math.sin(a))};
}
const pointKey = p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

function buildGeometry() {
  const points = new Map(); // pointKey -> {x,y,hexes:Set}
  const hexCorners = HEX_POSITIONS.map(({q, r}, h) => {
    const keys = [];
    for (let d = 0; d < 6; d++) {
      const p = cornerPoint(q, r, d), k = pointKey(p);
      if (!points.has(k)) points.set(k, {x: p.x, y: p.y, hexes: new Set()});
      points.get(k).hexes.add(h);
      keys.push(k);
    }
    return keys;
  });
  const byPos = (a, b) => a.y - b.y || a.x - b.x;
  const vlist = [...points.entries()].map(([k, p]) => ({k, ...p})).sort(byPos);
  const vid = new Map(vlist.map((v, i) => [v.k, i]));
  const vertices = vlist.map((v, i) => ({
    id: 'v' + i, x: v.x, y: v.y, hexes: [...v.hexes].sort((a, b) => a - b), adj: [], edges: [], port: null
  }));
  const edgeMap = new Map();
  hexCorners.forEach(keys => {
    for (let d = 0; d < 6; d++) {
      const a = vid.get(keys[d]), b = vid.get(keys[(d + 1) % 6]);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      edgeMap.set(lo + '-' + hi, [lo, hi]);
    }
  });
  const elist = [...edgeMap.values()].map(([a, b]) => ({
    a, b, x: (vertices[a].x + vertices[b].x) / 2, y: (vertices[a].y + vertices[b].y) / 2
  })).sort(byPos);
  const edges = elist.map((e, i) => ({id: 'e' + i, v: [e.a, e.b]}));
  edges.forEach((e, i) => {
    const [a, b] = e.v;
    vertices[a].adj.push(b); vertices[b].adj.push(a);
    vertices[a].edges.push(i); vertices[b].edges.push(i);
  });
  const edgeBetween = new Map(edges.map((e, i) => [e.v.join('-'), i]));
  const hexes = HEX_POSITIONS.map(({q, r}, h) => ({
    id: 'h' + h, q, r, ...hexCenter(q, r), vertices: hexCorners[h].map(k => vid.get(k))
  }));
  const hexIndex = new Map(HEX_POSITIONS.map(({q, r}, h) => [q + ',' + r, h]));
  const hexNeighbors = hexes.map(({q, r}) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]
      .map(([dq, dr]) => hexIndex.get((q + dq) + ',' + (r + dr))).filter(n => n !== undefined));
  const ports = PORT_LAYOUT.map(({corners, type}) => {
    const vs = corners.map(([q, r, d]) => vid.get(pointKey(cornerPoint(q, r, d))));
    const mx = (vertices[vs[0]].x + vertices[vs[1]].x) / 2, my = (vertices[vs[0]].y + vertices[vs[1]].y) / 2;
    const len = Math.hypot(mx, my) || 1;
    vs.forEach(v => { vertices[v].port = type; });
    return {
      type, ratio: type === 'generic' ? 3 : 2, resource: type === 'generic' ? null : type,
      x: round(mx + 0.55 * mx / len), y: round(my + 0.55 * my / len), vertices: vs
    };
  });
  return {vertices, edges, hexes, hexNeighbors, ports, edgeBetween};
}

export const GEO = buildGeometry();
export const VERTEX_COUNT = GEO.vertices.length;
export const EDGE_COUNT = GEO.edges.length;
export const HEX_COUNT = GEO.hexes.length;

export const parseId = (id, prefix, count) => {
  if (typeof id !== 'string' || !new RegExp(`^${prefix}(0|[1-9]\\d*)$`).test(id)) return -1;
  const n = Number(id.slice(1));
  return n < count ? n : -1;
};

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** Uniform integer in [0, n). Seeded games advance state.rng (mulberry32); others use crypto. */
export function rand(state, n) {
  if (!state.rng) return randomInt(n);
  let t = (state.rng.s = (state.rng.s + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.floor(u * n);
}

export function shuffle(state, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(state, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Board generation
// ---------------------------------------------------------------------------

const isRed = n => n === 6 || n === 8;

/** Random terrain + numbers with no two 6/8 tokens on adjacent hexes. */
export function generateBoard(state) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const terrains = shuffle(state, TERRAIN_DECK), numbers = shuffle(state, NUMBER_TOKENS);
    let n = 0;
    const hexes = terrains.map(terrain => ({
      terrain, resource: TERRAIN[terrain], number: terrain === 'desert' ? null : numbers[n++]
    }));
    const ok = hexes.every((h, i) => !isRed(h.number) || GEO.hexNeighbors[i].every(j => !isRed(hexes[j].number)));
    if (ok) return {hexes, robber: hexes.findIndex(h => h.terrain === 'desert')};
  }
  throw new Error('Could not generate a fair board');
}

export const newDevDeck = state => shuffle(state, DEV_DECK);

// ---------------------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------------------

export const emptyHand = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
export const handSize = hand => RESOURCES.reduce((s, r) => s + hand[r], 0);
export const canAfford = (hand, cost) => RESOURCES.every(r => hand[r] >= (cost[r] || 0));

/** Move a resource vector between two hands (bank is a hand). Caller has validated amounts. */
export function transfer(from, to, vector) {
  for (const r of RESOURCES) {
    const n = vector[r] || 0;
    if (from[r] < n) throw new Error(`transfer underflow on ${r}`);
    from[r] -= n; to[r] += n;
  }
}

// ---------------------------------------------------------------------------
// Board queries (vertex/edge indices are integers into GEO)
// ---------------------------------------------------------------------------

export const buildingAt = (state, v) => state.buildings[v] || null; // {type, owner}
export const roadAt = (state, e) => (state.roads[e] ?? null); // owner seat | null

export function distanceOk(state, v) {
  return !buildingAt(state, v) && GEO.vertices[v].adj.every(a => !buildingAt(state, a));
}

/** Seat owns a road touching vertex v. */
const touchesOwnRoad = (state, seat, v) => GEO.vertices[v].edges.some(e => roadAt(state, e) === seat);

export function canBuildSettlementAt(state, seat, v, setup) {
  if (!distanceOk(state, v)) return false;
  return setup || touchesOwnRoad(state, seat, v);
}

/** Road connectivity: an end vertex holds our building, or is not blocked by an opponent and has our road. */
export function canBuildRoadAt(state, seat, e, setupAnchor = null) {
  if (roadAt(state, e) !== null) return false;
  const ends = GEO.edges[e].v;
  if (setupAnchor !== null) return ends.includes(setupAnchor);
  return ends.some(v => {
    const b = buildingAt(state, v);
    if (b) return b.owner === seat;
    return touchesOwnRoad(state, seat, v);
  });
}

export const legalRoadEdges = (state, seat, setupAnchor = null) => {
  const out = [];
  for (let e = 0; e < EDGE_COUNT; e++) if (canBuildRoadAt(state, seat, e, setupAnchor)) out.push(e);
  return out;
};

export const legalSettlementVertices = (state, seat, setup) => {
  const out = [];
  for (let v = 0; v < VERTEX_COUNT; v++) if (canBuildSettlementAt(state, seat, v, setup)) out.push(v);
  return out;
};

export function piecesLeft(state, seat) {
  let s = 0, c = 0, r = 0;
  for (const b of Object.values(state.buildings)) if (b.owner === seat) b.type === 'city' ? c++ : s++;
  for (const o of Object.values(state.roads)) if (o === seat) r++;
  return {settlements: PIECES.settlements - s, cities: PIECES.cities - c, roads: PIECES.roads - r};
}

// Optional owner-authored harbor layout; old games retain the standard layout.
export function gamePorts(state) {
  if (!state.ports) return GEO.ports;
  return state.ports.map(p => {
    const [a,b]=p.vertices.map(v=>GEO.vertices[v]);
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,len=Math.hypot(mx,my)||1;
    return {type:p.type,ratio:p.type==='generic'?3:2,resource:p.type==='generic'?null:p.type,
      vertices:p.vertices,x:round(mx+0.55*mx/len),y:round(my+0.55*my/len)};
  });
}

export function portsOf(state, seat) {
  return gamePorts(state).filter(p => p.vertices.some(v => buildingAt(state, v)?.owner === seat)).map(p => p.type);
}

export function tradeRatio(state, seat, resource) {
  const ports = portsOf(state, seat);
  if (ports.includes(resource)) return 2;
  if (ports.includes('generic')) return 3;
  return 4;
}

/** Seats (≠ exclude) with a building on hex h. */
export function seatsOnHex(state, h, exclude = null) {
  const seats = new Set();
  for (const v of GEO.hexes[h].vertices) {
    const b = buildingAt(state, v);
    if (b && b.owner !== exclude) seats.add(b.owner);
  }
  return [...seats].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Production with finite bank
// ---------------------------------------------------------------------------

/**
 * Pay out a roll. Per official rules: if the bank cannot cover every claim on
 * a resource, no one gets that resource, unless only one player is owed it, in
 * which case that player receives whatever the bank has left.
 * Returns {gains: {seat: vector}, shortages: [resource]}.
 */
export function produce(state, total) {
  const owed = {}; // resource -> {seat: n}
  state.hexes.forEach((hex, h) => {
    if (hex.number !== total || h === state.robber || !hex.resource) return;
    for (const v of GEO.hexes[h].vertices) {
      const b = buildingAt(state, v);
      if (!b) continue;
      const claims = (owed[hex.resource] ??= {});
      claims[b.owner] = (claims[b.owner] || 0) + (b.type === 'city' ? 2 : 1);
    }
  });
  const gains = {}, shortages = [];
  for (const [res, claims] of Object.entries(owed)) {
    const seats = Object.keys(claims).map(Number);
    const need = seats.reduce((s, k) => s + claims[k], 0);
    if (need <= state.bank[res]) {
      for (const s of seats) pay(s, res, claims[s]);
    } else {
      shortages.push(res);
      if (seats.length === 1 && state.bank[res] > 0) pay(seats[0], res, state.bank[res]);
    }
  }
  function pay(seat, res, n) {
    state.bank[res] -= n;
    state.players[seat].resources[res] += n;
    (gains[seat] ??= emptyHand())[res] += n;
  }
  return {gains, shortages};
}

/** Second setup settlement: one card per adjacent producing hex, limited by the bank. */
export function initialResources(state, seat, v) {
  const got = emptyHand();
  for (const h of GEO.vertices[v].hexes) {
    const res = state.hexes[h].resource;
    if (res && state.bank[res] > 0) {
      state.bank[res]--; state.players[seat].resources[res]++; got[res]++;
    }
  }
  return got;
}

// ---------------------------------------------------------------------------
// Longest road
// ---------------------------------------------------------------------------

/** Longest trail (no edge reused) of seat's roads; opponent buildings stop a trail from passing through. */
export function longestRoad(state, seat) {
  const mine = new Set();
  for (const [e, o] of Object.entries(state.roads)) if (o === seat) mine.add(Number(e));
  if (!mine.size) return 0;
  const blocked = v => { const b = buildingAt(state, v); return !!b && b.owner !== seat; };
  const used = new Set();
  let best = 0;
  function walk(v, len) {
    if (len > best) best = len;
    for (const e of GEO.vertices[v].edges) {
      if (!mine.has(e) || used.has(e)) continue;
      const [a, b] = GEO.edges[e].v, next = a === v ? b : a;
      used.add(e);
      if (blocked(next)) { if (len + 1 > best) best = len + 1; } else walk(next, len + 1);
      used.delete(e);
    }
  }
  const starts = new Set();
  for (const e of mine) GEO.edges[e].v.forEach(v => starts.add(v));
  for (const v of starts) walk(v, 0);
  return best;
}

/**
 * Recompute Longest Road for everyone. Holder keeps it on a tie; if the holder
 * falls behind, a unique new leader (≥5) takes it, otherwise nobody holds it.
 */
export function updateLongestRoad(state) {
  const lens = state.players.map((p, s) => (p.roadLength = longestRoad(state, s)));
  const max = Math.max(...lens), holder = state.awards.longestRoad;
  if (holder !== null && lens[holder] >= 5 && lens[holder] === max) return;
  const leaders = lens.map((l, s) => [l, s]).filter(([l]) => l === max && l >= 5).map(([, s]) => s);
  state.awards.longestRoad = leaders.length === 1 ? leaders[0] : null;
}

/** Largest Army: ≥3 knights, strictly more than the current holder to take it. */
export function updateLargestArmy(state) {
  const holder = state.awards.largestArmy;
  const knights = state.players.map(p => p.knights);
  const max = Math.max(...knights);
  if (max < 3) return;
  if (holder !== null && knights[holder] === max) return;
  const leaders = knights.map((k, s) => [k, s]).filter(([k]) => k === max).map(([, s]) => s);
  if (leaders.length === 1) state.awards.largestArmy = leaders[0];
}

// ---------------------------------------------------------------------------
// Victory points
// ---------------------------------------------------------------------------

export function publicVP(state, seat) {
  let vp = 0;
  for (const b of Object.values(state.buildings)) if (b.owner === seat) vp += b.type === 'city' ? 2 : 1;
  if (state.awards.longestRoad === seat) vp += 2;
  if (state.awards.largestArmy === seat) vp += 2;
  return vp;
}

export const vpCards = (state, seat) => state.players[seat].devCards.filter(c => c.type === 'victoryPoint').length;
export const totalVP = (state, seat) => publicVP(state, seat) + vpCards(state, seat);

// ---------------------------------------------------------------------------
// Geometry export for clients
// ---------------------------------------------------------------------------

export function boardGeometry(state) {
  const ports=gamePorts(state);
  return {
    hexes: GEO.hexes.map((g, h) => ({
      id: g.id, q: g.q, r: g.r, x: g.x, y: g.y,
      terrain: state.hexes[h].terrain, resource: state.hexes[h].resource, number: state.hexes[h].number,
      robber: state.robber === h
    })),
    vertices: GEO.vertices.map((g, v) => {
      const b = buildingAt(state, v);
      return {
        id: g.id, x: g.x, y: g.y, building: b ? b.type : null, owner: b ? b.owner : null,
        hexes: g.hexes.map(h => 'h' + h), adjacentVertices: g.adj.map(a => 'v' + a),
        edges: g.edges.map(e => 'e' + e), port: ports.find(p=>p.vertices.includes(v))?.type??null
      };
    }),
    edges: GEO.edges.map((g, e) => {
      const [a, b] = g.v.map(v => GEO.vertices[v]);
      const o = roadAt(state, e);
      return {id: g.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, road: o !== null, owner: o, vertices: g.v.map(v => 'v' + v)};
    }),
    ports: ports.map(p => ({
      type: p.type, ratio: p.ratio, ...(p.resource ? {resource: p.resource} : {}),
      x: p.x, y: p.y, vertices: p.vertices.map(v => 'v' + v)
    }))
  };
}
