/**
 * Strict rules adapter over ./engine.mjs (adapted from Viral-Doshi/catan, MIT).
 * Stable interface: createMatch, viewMatch, applyAction, legalActions,
 * getBoardGeometry, GameRuleError. See get_game_schema for runtime details.
 *
 * Every export is pure over plain JSON. applyAction clones before mutating, so
 * a thrown GameRuleError leaves the caller's state untouched.
 */
import * as E from './engine.mjs';

const {RESOURCES, COSTS, GEO} = E;
export {RESOURCES};
export const SEATS = 4;
const LOG_KEEP = 200, LOG_VIEW = 60;
const DEV_NAMES = {
  knight: 'Knight', victoryPoint: 'Victory Point', roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly'
};

export class GameRuleError extends Error {
  constructor(message, code = 'illegal_action') {
    super(message);
    this.name = 'GameRuleError';
    this.code = code;
  }
}
const fail = (message, code) => { throw new GameRuleError(message, code); };

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createMatch({id, names, seed} = {}) {
  if (!Array.isArray(names) || names.length !== SEATS || !names.every(n => typeof n === 'string' && n.trim()))
    throw new TypeError('createMatch needs exactly four non-empty names');
  if (seed !== undefined && !Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  const state = {
    version: 1,
    id: String(id ?? ''),
    seq: 0,
    rng: seed === undefined ? null : {s: seed >>> 0},
    players: names.map((name, seat) => ({
      id: 'seat-' + seat, seat, name: name.trim().slice(0, 40), kind: seat === 0 ? 'human' : 'agent',
      color: E.PLAYER_COLORS[seat], resources: E.emptyHand(), devCards: [], knights: 0, roadLength: 0
    })),
    order: [],
    phase: 'setup',
    turnPhase: 'setupSettlement',
    current: 0,
    turn: 0,
    setup: {index: 0, anchor: null},
    hexes: [], robber: 0,
    ports: GEO.ports.map(p=>({type:p.type,vertices:[...p.vertices]})),
    buildings: {}, roads: {},
    bank: Object.fromEntries(RESOURCES.map(r => [r, E.BANK_PER_RESOURCE])),
    devDeck: [],
    dice: null,
    lastDice: null,
    pendingDiscards: {},
    turnState: {rolled: false, devPlayed: false, freeRoads: 0, returnPhase: null},
    offer: null, offerSeq: 0,
    awards: {longestRoad: null, largestArmy: null},
    winner: null,
    log: []
  };
  const board = E.generateBoard(state);
  state.hexes = board.hexes;
  state.robber = board.robber;
  state.devDeck = E.newDevDeck(state);
  state.order = E.shuffle(state, [0, 1, 2, 3]);
  state.current = state.order[0];
  log(state, null, `Turn order: ${state.order.map(s => state.players[s].name).join(', ')}. Setup begins.`);
  return state;
}

// Setup snake: order[0..3] then order[3..0].
const setupSeat = (state, i) => state.order[i < SEATS ? i : 2 * SEATS - 1 - i];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function checkKeys(action, allowed) {
  for (const k of Object.keys(action))
    if (k !== 'type' && !allowed.includes(k)) fail(`Unexpected field "${k}" for ${action.type}.`, 'bad_action');
}

function resourceName(value, field) {
  if (!RESOURCES.includes(value)) fail(`${field} must be one of ${RESOURCES.join(', ')}.`, 'bad_action');
  return value;
}

/** Strict resource vector: plain object, known keys, non-negative integers. Returns a full hand. */
export function parseVector(value, field = 'resources') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    fail(`${field} must be an object like {"brick":1}.`, 'bad_action');
  const out = E.emptyHand();
  for (const [k, n] of Object.entries(value)) {
    if (!RESOURCES.includes(k)) fail(`${field} has unknown resource "${k}".`, 'bad_action');
    if (!Number.isSafeInteger(n) || n < 0) fail(`${field}.${k} must be a non-negative whole number.`, 'bad_action');
    out[k] = n;
  }
  return out;
}

const vecText = v => RESOURCES.filter(r => v[r]).map(r => `${v[r]} ${r}`).join(', ') || 'nothing';
const fits = (vec, hand) => RESOURCES.every(r => vec[r] <= hand[r]);

function vertexArg(action) {
  const v = E.parseId(action.vertex, 'v', E.VERTEX_COUNT);
  if (v < 0) fail('That is not a valid intersection.', 'bad_action');
  return v;
}
function edgeArg(action) {
  const e = E.parseId(action.edge, 'e', E.EDGE_COUNT);
  if (e < 0) fail('That is not a valid road spot.', 'bad_action');
  return e;
}

function log(state, seat, text, priv) {
  const entry = {seq: state.seq, seat, text};
  if (priv) entry.private = priv; // {seats:[...], text}
  state.log.push(entry);
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
  return entry;
}
const nameOf = (state, seat) => state.players[seat].name;

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyAction(state, seat, action) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) fail('Unknown seat.', 'bad_seat');
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string')
    fail('An action must be an object with a "type".', 'bad_action');
  const handler = Object.hasOwn(HANDLERS, action.type) ? HANDLERS[action.type] : null;
  if (!handler) fail(`Unknown action "${action.type}".`, 'bad_action');
  if (state.phase === 'finished') fail('The game is over.', 'game_over');
  const next = structuredClone(state);
  next.seq = state.seq + 1;
  const extra = handler(next, seat, action) || {};
  checkWinner(next);
  const events = next.log.filter(e => e.seq === next.seq).map(({seq, seat: s, text}) => ({seq, seat: s, text}));
  return {state: next, result: {action: action.type, seat, events, ...extra}};
}

function requireTurn(state, seat, phases) {
  if (state.phase === 'setup' && !phases.some(p => p.startsWith('setup'))) fail('Finish setup first.', 'wrong_phase');
  if (state.current !== seat) fail(`It is ${nameOf(state, state.current)}'s turn.`, 'not_your_turn');
  if (!phases.includes(state.turnPhase)) fail(PHASE_HINT[state.turnPhase] || 'You cannot do that now.', 'wrong_phase');
}

const PHASE_HINT = {
  setupSettlement: 'Place a setup settlement first.',
  setupRoad: 'Place the road next to your new settlement first.',
  roll: 'Roll the dice first.',
  discard: 'Waiting for players to discard.',
  robber: 'Move the robber first.',
  roadBuilding: 'Place your free roads first (or end Road Building).',
  main: 'You have already rolled.'
};

function pay(state, seat, cost, what) {
  const hand = state.players[seat].resources;
  if (!E.canAfford(hand, cost)) fail(`You need ${vecText({...E.emptyHand(), ...cost})} to ${what}.`, 'cannot_afford');
  E.transfer(hand, state.bank, cost);
}

const HANDLERS = {
  build_settlement(state, seat, action) {
    checkKeys(action, ['vertex']);
    const v = vertexArg(action);
    if (state.phase === 'setup') {
      requireTurn(state, seat, ['setupSettlement']);
      if (!E.distanceOk(state, v)) fail('Too close to another building, or already taken.', 'illegal_spot');
      state.buildings[v] = {type: 'settlement', owner: seat};
      state.setup.anchor = v;
      state.turnPhase = 'setupRoad';
      const second = state.setup.index >= SEATS;
      let got = null;
      if (second) got = E.initialResources(state, seat, v);
      log(state, seat, `${nameOf(state, seat)} placed a settlement` + (got ? ` and took ${vecText(got)}.` : '.'));
      E.updateLongestRoad(state);
      return;
    }
    requireTurn(state, seat, ['main']);
    if (E.piecesLeft(state, seat).settlements <= 0) fail('You have no settlements left. Upgrade one to a city first.', 'no_pieces');
    if (!E.canBuildSettlementAt(state, seat, v, false))
      fail('A settlement needs an empty spot, two roads from any building, and your road touching it.', 'illegal_spot');
    pay(state, seat, COSTS.settlement, 'build a settlement');
    state.buildings[v] = {type: 'settlement', owner: seat};
    log(state, seat, `${nameOf(state, seat)} built a settlement.`);
    E.updateLongestRoad(state);
  },

  build_road(state, seat, action) {
    checkKeys(action, ['edge']);
    const e = edgeArg(action);
    if (state.phase === 'setup') {
      requireTurn(state, seat, ['setupRoad']);
      if (!E.canBuildRoadAt(state, seat, e, state.setup.anchor)) fail('The setup road must touch the settlement you just placed.', 'illegal_spot');
      state.roads[e] = seat;
      log(state, seat, `${nameOf(state, seat)} placed a road.`);
      E.updateLongestRoad(state);
      advanceSetup(state);
      return;
    }
    requireTurn(state, seat, ['main', 'roadBuilding']);
    if (E.piecesLeft(state, seat).roads <= 0) fail('You have no roads left.', 'no_pieces');
    if (!E.canBuildRoadAt(state, seat, e)) fail('A road must be on an empty edge connected to your road or building.', 'illegal_spot');
    const free = state.turnPhase === 'roadBuilding';
    if (!free) pay(state, seat, COSTS.road, 'build a road');
    state.roads[e] = seat;
    log(state, seat, `${nameOf(state, seat)} built a ${free ? 'free ' : ''}road.`);
    E.updateLongestRoad(state);
    if (free) {
      state.turnState.freeRoads--;
      if (state.turnState.freeRoads <= 0 || !canPlaceAnyRoad(state, seat)) finishRoadBuilding(state);
    }
  },

  build_city(state, seat, action) {
    checkKeys(action, ['vertex']);
    const v = vertexArg(action);
    requireTurn(state, seat, ['main']);
    const b = E.buildingAt(state, v);
    if (!b || b.type !== 'settlement' || b.owner !== seat) fail('A city must replace one of your settlements.', 'illegal_spot');
    if (E.piecesLeft(state, seat).cities <= 0) fail('You have no cities left.', 'no_pieces');
    pay(state, seat, COSTS.city, 'build a city');
    state.buildings[v] = {type: 'city', owner: seat};
    log(state, seat, `${nameOf(state, seat)} built a city.`);
  },

  buy_dev_card(state, seat, action) {
    checkKeys(action, []);
    requireTurn(state, seat, ['main']);
    if (!state.devDeck.length) fail('The development card deck is empty.', 'deck_empty');
    pay(state, seat, COSTS.devCard, 'buy a development card');
    const type = state.devDeck.pop();
    state.players[seat].devCards.push({type, bought: state.turn});
    log(state, seat, `${nameOf(state, seat)} bought a development card.`,
      {seats: [seat], text: `You bought a ${DEV_NAMES[type]} card.`});
  },

  roll(state, seat, action) {
    checkKeys(action, []);
    requireTurn(state, seat, ['roll']);
    const d1 = E.rand(state, 6) + 1, d2 = E.rand(state, 6) + 1, total = d1 + d2;
    state.dice = {d1, d2, total};
    state.lastDice = {d1, d2, total};
    state.turnState.rolled = true;
    if (total === 7) {
      log(state, seat, `${nameOf(state, seat)} rolled 7.`);
      state.pendingDiscards = {};
      state.players.forEach((p, s) => {
        const n = E.handSize(p.resources);
        if (n > 7) state.pendingDiscards[s] = Math.floor(n / 2);
      });
      state.turnState.returnPhase = 'main';
      state.turnPhase = Object.keys(state.pendingDiscards).length ? 'discard' : 'robber';
      if (state.turnPhase === 'discard')
        log(state, null, `Discarding: ${Object.entries(state.pendingDiscards).map(([s, n]) => `${nameOf(state, +s)} ${n}`).join(', ')}.`);
      return {dice: state.dice};
    }
    const {gains, shortages} = E.produce(state, total);
    const parts = Object.entries(gains).map(([s, g]) => `${nameOf(state, +s)} got ${vecText(g)}`);
    log(state, seat, `${nameOf(state, seat)} rolled ${total}. ` + (parts.length ? parts.join('; ') + '.' : 'No production.') +
      (shortages.length ? ` Bank short of ${shortages.join(', ')}.` : ''));
    state.turnPhase = 'main';
    return {dice: state.dice};
  },

  discard(state, seat, action) {
    checkKeys(action, ['resources']);
    if (state.phase !== 'play' || state.turnPhase !== 'discard') fail('No one needs to discard now.', 'wrong_phase');
    const owe = state.pendingDiscards[seat];
    if (!owe) fail('You do not need to discard.', 'wrong_phase');
    const vec = parseVector(action.resources);
    if (E.handSize(vec) !== owe) fail(`Discard exactly ${owe} cards.`, 'bad_amount');
    if (!fits(vec, state.players[seat].resources)) fail('You do not have those cards.', 'cannot_afford');
    E.transfer(state.players[seat].resources, state.bank, vec);
    delete state.pendingDiscards[seat];
    log(state, seat, `${nameOf(state, seat)} discarded ${owe} cards.`, {seats:[seat],text:`You discarded ${vecText(vec)}.`});
    if (!Object.keys(state.pendingDiscards).length) state.turnPhase = 'robber';
  },

  move_robber(state, seat, action) {
    checkKeys(action, ['hex', 'victim']);
    requireTurn(state, seat, ['robber']);
    const h = E.parseId(action.hex, 'h', E.HEX_COUNT);
    if (h < 0) fail('That is not a valid hex.', 'bad_action');
    if (h === state.robber) fail('Move the robber to a different hex.', 'illegal_spot');
    const victims = robberVictims(state, seat, h);
    const victim = action.victim ?? null;
    if (victims.length) {
      if (!victims.includes(victim)) fail(`Choose a player to rob: ${victims.map(s => `${s} (${nameOf(state, s)})`).join(', ')}.`, 'bad_victim');
    } else if (victim !== null) fail('No one on that hex can be robbed.', 'bad_victim');
    state.robber = h;
    if (victim !== null) {
      const hand = state.players[victim].resources;
      let pick = E.rand(state, E.handSize(hand)), res;
      for (const r of RESOURCES) { if (pick < hand[r]) { res = r; break; } pick -= hand[r]; }
      hand[res]--; state.players[seat].resources[res]++;
      log(state, seat, `${nameOf(state, seat)} moved the robber and stole a card from ${nameOf(state, victim)}.`,
        {seats: [seat, victim], text: `${nameOf(state, seat)} stole 1 ${res} from ${nameOf(state, victim)}.`});
    } else log(state, seat, `${nameOf(state, seat)} moved the robber.`);
    state.turnPhase = state.turnState.returnPhase || 'main';
    state.turnState.returnPhase = null;
  },

  end_turn(state, seat, action) {
    checkKeys(action, []);
    requireTurn(state, seat, ['main']);
    log(state, seat, `${nameOf(state, seat)} ended the turn.`);
    const i = state.order.indexOf(seat);
    state.current = state.order[(i + 1) % SEATS];
    state.turn++;
    state.turnPhase = 'roll';
    state.dice = null;
    state.offer = null;
    state.turnState = {rolled: false, devPlayed: false, freeRoads: 0, returnPhase: null};
  },

  play_knight(state, seat, action) {
    checkKeys(action, []);
    useDevCard(state, seat, 'knight');
    state.players[seat].knights++;
    E.updateLargestArmy(state);
    state.turnState.returnPhase = state.turnPhase;
    state.turnPhase = 'robber';
    log(state, seat, `${nameOf(state, seat)} played a Knight.`);
  },

  play_road_building(state, seat, action) {
    checkKeys(action, []);
    if (state.current === seat && ['roll', 'main'].includes(state.turnPhase) && !canPlaceAnyRoad(state, seat))
      fail('You have no road you could place, so Road Building would do nothing.', 'no_effect');
    useDevCard(state, seat, 'roadBuilding');
    state.turnState.freeRoads = Math.min(2, E.piecesLeft(state, seat).roads);
    state.turnState.returnPhase = state.turnPhase;
    state.turnPhase = 'roadBuilding';
    log(state, seat, `${nameOf(state, seat)} played Road Building.`);
  },

  end_road_building(state, seat, action) {
    checkKeys(action, []);
    requireTurn(state, seat, ['roadBuilding']);
    finishRoadBuilding(state);
    log(state, seat, `${nameOf(state, seat)} ended Road Building.`);
  },

  play_year_of_plenty(state, seat, action) {
    checkKeys(action, ['resources']);
    const vec = parseVector(action.resources);
    const want = Math.min(2, E.handSize(state.bank));
    if (state.current === seat && ['roll', 'main'].includes(state.turnPhase)) {
      if (want === 0) fail('The bank is empty.', 'bank_empty');
      if (E.handSize(vec) !== want) fail(`Choose exactly ${want} resource${want > 1 ? 's' : ''}.`, 'bad_amount');
      if (!fits(vec, state.bank)) fail('The bank does not have those resources.', 'bank_empty');
    }
    useDevCard(state, seat, 'yearOfPlenty');
    E.transfer(state.bank, state.players[seat].resources, vec);
    log(state, seat, `${nameOf(state, seat)} played Year of Plenty for ${vecText(vec)}.`);
  },

  play_monopoly(state, seat, action) {
    checkKeys(action, ['resource']);
    const res = resourceName(action.resource, 'resource');
    useDevCard(state, seat, 'monopoly');
    let n = 0;
    state.players.forEach((p, s) => {
      if (s !== seat) { n += p.resources[res]; p.resources[res] = 0; }
    });
    state.players[seat].resources[res] += n;
    log(state, seat, `${nameOf(state, seat)} played Monopoly on ${res} and took ${n}.`);
  },

  bank_trade(state, seat, action) {
    checkKeys(action, ['give', 'get']);
    requireTurn(state, seat, ['main']);
    const give = resourceName(action.give, 'give'), get = resourceName(action.get, 'get');
    if (give === get) fail('Trade for a different resource.', 'bad_action');
    const ratio = E.tradeRatio(state, seat, give);
    if (state.players[seat].resources[give] < ratio) fail(`You need ${ratio} ${give} for this trade.`, 'cannot_afford');
    if (state.bank[get] < 1) fail(`The bank has no ${get} left.`, 'bank_empty');
    E.transfer(state.players[seat].resources, state.bank, {[give]: ratio});
    E.transfer(state.bank, state.players[seat].resources, {[get]: 1});
    log(state, seat, `${nameOf(state, seat)} traded ${ratio} ${give} to the bank for 1 ${get}.`);
  },

  offer_trade(state, seat, action) {
    checkKeys(action, ['give', 'get', 'to']);
    requireTurn(state, seat, ['main']);
    if (state.offer) fail('You already have an open offer. Cancel it first.', 'offer_open');
    const give = parseVector(action.give, 'give'), get = parseVector(action.get, 'get');
    if (!E.handSize(give) || !E.handSize(get)) fail('Both sides of a trade need at least one card.', 'bad_amount');
    if (RESOURCES.some(r => give[r] && get[r])) fail('Do not put the same resource on both sides.', 'bad_action');
    if (!fits(give, state.players[seat].resources)) fail('You do not have the cards you are offering.', 'cannot_afford');
    let to = [0, 1, 2, 3].filter(s => s !== seat);
    if (action.to !== undefined) {
      if (!Array.isArray(action.to) || !action.to.length || !action.to.every(s => to.includes(s)) || new Set(action.to).size !== action.to.length)
        fail('"to" must list other seat numbers.', 'bad_action');
      to = [...action.to].sort((a, b) => a - b);
    }
    state.offer = {id: ++state.offerSeq, from: seat, give, get, to, declined: []};
    log(state, seat, `${nameOf(state, seat)} offered ${vecText(give)} for ${vecText(get)} to ${to.map(s => nameOf(state, s)).join(', ')}.`);
  },

  respond_trade(state, seat, action) {
    checkKeys(action, ['offerId', 'accept']);
    const o = state.offer;
    if (!o || o.id !== action.offerId || state.turnPhase !== 'main') fail('That trade offer is no longer open.', 'stale_offer');
    if (typeof action.accept !== 'boolean') fail('"accept" must be true or false.', 'bad_action');
    if (!o.to.includes(seat) || o.declined.includes(seat)) fail('That offer is not open to you.', 'not_target');
    if (!action.accept) {
      o.declined.push(seat);
      log(state, seat, `${nameOf(state, seat)} declined the trade.`);
      if (o.to.every(s => o.declined.includes(s))) state.offer = null;
      return;
    }
    if (!fits(o.get, state.players[seat].resources)) fail('You do not have the cards requested.', 'cannot_afford');
    if (!fits(o.give, state.players[o.from].resources)) fail('The offering player no longer has those cards.', 'stale_offer');
    E.transfer(state.players[o.from].resources, state.players[seat].resources, o.give);
    E.transfer(state.players[seat].resources, state.players[o.from].resources, o.get);
    state.offer = null;
    log(state, seat, `${nameOf(state, seat)} accepted: ${nameOf(state, o.from)} gave ${vecText(o.give)} for ${vecText(o.get)}.`);
  },

  cancel_trade(state, seat, action) {
    checkKeys(action, []);
    if (!state.offer || state.offer.from !== seat) fail('You have no open offer.', 'wrong_phase');
    state.offer = null;
    log(state, seat, `${nameOf(state, seat)} withdrew the trade offer.`);
  }
};

function advanceSetup(state) {
  state.setup.index++;
  state.setup.anchor = null;
  if (state.setup.index >= 2 * SEATS) {
    state.phase = 'play';
    state.turn = 1;
    state.current = state.order[0];
    state.turnPhase = 'roll';
    log(state, null, `Setup complete. First roll: ${nameOf(state, state.current)}.`);
  } else {
    state.current = setupSeat(state, state.setup.index);
    state.turnPhase = 'setupSettlement';
  }
}

function playableDev(state, seat, type) {
  return state.players[seat].devCards.some(c => c.type === type && c.bought < state.turn);
}

function useDevCard(state, seat, type) {
  requireTurn(state, seat, ['roll', 'main']);
  if (state.turnState.devPlayed) fail('You can play only one development card per turn.', 'dev_limit');
  const cards = state.players[seat].devCards;
  if (!cards.some(c => c.type === type)) fail(`You do not have a ${DEV_NAMES[type]} card.`, 'no_card');
  const i = cards.findIndex(c => c.type === type && c.bought < state.turn);
  if (i < 0) fail('You cannot play a card on the turn you bought it.', 'dev_new');
  cards.splice(i, 1);
  state.turnState.devPlayed = true;
}

function canPlaceAnyRoad(state, seat) {
  return E.piecesLeft(state, seat).roads > 0 && E.legalRoadEdges(state, seat).length > 0;
}

function finishRoadBuilding(state) {
  state.turnState.freeRoads = 0;
  state.turnPhase = state.turnState.returnPhase || 'main';
  state.turnState.returnPhase = null;
}

function robberVictims(state, seat, h) {
  return E.seatsOnHex(state, h, seat).filter(s => E.handSize(state.players[s].resources) > 0);
}

/** Only the player whose turn it is can win, and only on their own turn. */
function checkWinner(state) {
  if (state.phase !== 'play') return;
  const s = state.current;
  if (E.totalVP(state, s) >= E.WIN_VP) {
    state.phase = 'finished';
    state.winner = s;
    state.turnPhase = null;
    state.offer = null;
    log(state, s, `${nameOf(state, s)} wins with ${E.totalVP(state, s)} victory points!`);
  }
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function legalActions(state, seat) {
  const actions = [], choices = {};
  const who = nameOf(state, state.current);
  const out = instruction => ({actions, choices, instruction});
  if (state.phase === 'finished') return out(`Game over. ${nameOf(state, state.winner)} won.`);
  const p = state.players[seat], hand = p.resources;

  // Out-of-turn actions.
  if (state.phase === 'play' && state.turnPhase === 'discard') {
    const owe = state.pendingDiscards[seat];
    if (owe) {
      choices.discard = {count: owe, hand: {...hand}};
      return out(`A 7 was rolled. Discard ${owe} cards: submit {"type":"discard","resources":{...}} totaling ${owe}.`);
    }
    return out(`Waiting for ${Object.keys(state.pendingDiscards).map(s => nameOf(state, +s)).join(', ')} to discard.`);
  }
  const o = state.offer;
  if (o && state.turnPhase === 'main' && o.to.includes(seat) && !o.declined.includes(seat)) {
    if (fits(o.get, hand) && fits(o.give, state.players[o.from].resources)) actions.push({type: 'respond_trade', offerId: o.id, accept: true});
    actions.push({type: 'respond_trade', offerId: o.id, accept: false});
  }
  if (state.current !== seat) {
    return out(actions.length
      ? `${who} offers ${vecText(o.give)} for your ${vecText(o.get)}. Accept or decline.`
      : `Waiting for ${who} (${state.turnPhase}).`);
  }

  const tp = state.turnPhase;
  if (tp === 'setupSettlement') {
    for (const v of E.legalSettlementVertices(state, seat, true)) actions.push({type: 'build_settlement', vertex: 'v' + v});
    return out(`Setup: place your ${state.setup.index < SEATS ? 'first' : 'second'} settlement.`);
  }
  if (tp === 'setupRoad') {
    for (const e of E.legalRoadEdges(state, seat, state.setup.anchor)) actions.push({type: 'build_road', edge: 'e' + e});
    return out('Setup: place a road touching the settlement you just placed.');
  }
  if (tp === 'robber') {
    for (let h = 0; h < E.HEX_COUNT; h++) {
      if (h === state.robber) continue;
      const vs = robberVictims(state, seat, h);
      if (!vs.length) actions.push({type: 'move_robber', hex: 'h' + h, victim: null});
      for (const v of vs) actions.push({type: 'move_robber', hex: 'h' + h, victim: v});
    }
    return out('Move the robber to a new hex and pick a player there to rob.');
  }
  if (tp === 'roadBuilding') {
    for (const e of E.legalRoadEdges(state, seat)) actions.push({type: 'build_road', edge: 'e' + e});
    actions.push({type: 'end_road_building'});
    return out(`Road Building: place ${state.turnState.freeRoads} more free road${state.turnState.freeRoads > 1 ? 's' : ''}.`);
  }
  if (tp === 'roll') actions.push({type: 'roll'});
  devActions(state, seat, actions, choices);
  if (tp === 'roll') return out('Roll the dice' + (actions.length > 1 ? ', or play a development card first.' : '.'));

  // Main phase.
  const pieces = E.piecesLeft(state, seat);
  if (pieces.settlements > 0 && E.canAfford(hand, COSTS.settlement))
    for (const v of E.legalSettlementVertices(state, seat, false)) actions.push({type: 'build_settlement', vertex: 'v' + v});
  if (pieces.cities > 0 && E.canAfford(hand, COSTS.city))
    for (const [v, b] of Object.entries(state.buildings))
      if (b.owner === seat && b.type === 'settlement') actions.push({type: 'build_city', vertex: 'v' + v});
  if (pieces.roads > 0 && E.canAfford(hand, COSTS.road))
    for (const e of E.legalRoadEdges(state, seat)) actions.push({type: 'build_road', edge: 'e' + e});
  if (state.devDeck.length && E.canAfford(hand, COSTS.devCard)) actions.push({type: 'buy_dev_card'});
  for (const give of RESOURCES) {
    if (hand[give] < E.tradeRatio(state, seat, give)) continue;
    for (const get of RESOURCES) if (get !== give && state.bank[get] > 0) actions.push({type: 'bank_trade', give, get});
  }
  if (o && o.from === seat) actions.push({type: 'cancel_trade'});
  else if (E.handSize(hand) > 0) choices.offer_trade = {hand: {...hand}, seats: [0, 1, 2, 3].filter(s => s !== seat)};
  actions.push({type: 'end_turn'});
  return out('Build, trade, or play a card, then end your turn.');
}

function devActions(state, seat, actions, choices) {
  if (state.turnState.devPlayed) return;
  if (playableDev(state, seat, 'knight')) actions.push({type: 'play_knight'});
  if (playableDev(state, seat, 'roadBuilding') && canPlaceAnyRoad(state, seat)) actions.push({type: 'play_road_building'});
  if (playableDev(state, seat, 'monopoly')) for (const resource of RESOURCES) actions.push({type: 'play_monopoly', resource});
  const bankTotal = E.handSize(state.bank);
  if (playableDev(state, seat, 'yearOfPlenty') && bankTotal > 0)
    choices.play_year_of_plenty = {count: Math.min(2, bankTotal), bank: {...state.bank}};
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const getBoardGeometry = state => E.boardGeometry(state);

export function viewMatch(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) throw new GameRuleError('Unknown seat.', 'bad_seat');
  const over = state.phase === 'finished';
  const me = state.players[seat];
  const latestDice = state.lastDice ?? state.dice;
  const award = (holder, key) => holder === null ? null : {seat: holder, [key === 'length' ? 'length' : 'size']:
    key === 'length' ? state.players[holder].roadLength : state.players[holder].knights};
  return {
    id: state.id, seq: state.seq,
    mySeat: seat, myPlayerId: me.id, myIndex: seat,
    phase: state.phase, turnPhase: state.turnPhase,
    currentSeat: state.current, currentPlayerId: state.players[state.current].id, turn: state.turn,
    order: [...state.order],
    dice: state.dice ? {...state.dice} : null,
    lastDice: latestDice ? {dice: [latestDice.d1, latestDice.d2], total: latestDice.total} : null,
    board: E.boardGeometry(state),
    robberHex: 'h' + state.robber,
    bank: {...state.bank},
    devDeckCount: state.devDeck.length,
    players: state.players.map((p, s) => {
      const pieces = E.piecesLeft(state, s);
      const v = {
        seat: s, id: p.id, name: p.name, kind: p.kind, color: p.color,
        resourceCount: E.handSize(p.resources), devCardCount: p.devCards.length,
        knightsPlayed: p.knights, publicVP: E.publicVP(state, s), roadLength: p.roadLength,
        longestRoad: state.awards.longestRoad === s, largestArmy: state.awards.largestArmy === s,
        pieces, pendingDiscard: state.pendingDiscards[s] || 0
      };
      if (over || s === seat) { v.vpCards = E.vpCards(state, s); v.totalVP = E.totalVP(state, s); }
      return v;
    }),
    me: {
      resources: {...me.resources},
      devCards: me.devCards.map(c => ({type: c.type, playable: c.type !== 'victoryPoint' && c.bought < state.turn})),
      vpCards: E.vpCards(state, seat), totalVP: E.totalVP(state, seat),
      tradeRatios: Object.fromEntries(RESOURCES.map(r => [r, E.tradeRatio(state, seat, r)])),
      ports: E.portsOf(state, seat)
    },
    awards: {
      longestRoad: award(state.awards.longestRoad, 'length'),
      largestArmy: award(state.awards.largestArmy, 'size')
    },
    pendingDiscards: {...state.pendingDiscards},
    tradeOffer: state.offer ? structuredClone(state.offer) : null,
    freeRoads: state.turnState.freeRoads,
    winner: state.winner,
    log: state.log.slice(-LOG_VIEW).map(e => ({
      seq: e.seq, seat: e.seat, text: e.private && e.private.seats.includes(seat) ? e.private.text : e.text
    })),
    legalActions: legalActions(state, seat)
  };
}
