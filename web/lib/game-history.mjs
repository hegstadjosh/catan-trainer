// Owner-only match history: library, chronological replay, notes/bookmarks/predictions per position,
// postgame summary and "practice from here" branches. Scoped to one verified account id; no caller can
// name another owner. Uses the service-role game DB, so never mount it on seat or sidekick token endpoints.
//
// Data contract (see supabase/migrations/*_catan_history.sql):
// - catan_game_events (revision ≥ 2): action type, actor seat, public text, dice, phase, seat 0's own hand
//   and seat 0's log lines. No board coordinates and no opponent hands were ever stored there.
// - catan_game_snapshots: the complete engine state per revision (minus the rolling log; log_added holds
//   the new lines), captured by a trigger from the history migration onward.
// - catan_games.state: the complete latest position, always available.
// Revisions without a snapshot are reported as "unrecorded": the board is not shown and never guessed.
// The default perspective is the human seat. Full information is explicit and, for an unfinished game,
// needs a second confirmation (revealUnfinished).
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual as isDeepEqual} from 'node:util';
import * as E from '../game/engine.mjs';
import {viewMatch,applyAction,RESOURCES,SEATS} from '../game/rules.mjs';
import {GameStoreError,gameFailure,gameDb} from './game-store.mjs';
import {practiceOptions,evaluate as evaluateDecision} from './decision-practice.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_LIMIT=20,LOG_KEEP=200,BODY_MAX=4000,NOTES_PER_GAME=500,PAGE=1000,LIBRARY_MAX=100;
export const NOTE_KINDS=['note','bookmark','prediction'];
const COST={road:{brick:1,lumber:1},settlement:{brick:1,lumber:1,wool:1,grain:1},city:{grain:2,ore:3},devCard:{wool:1,grain:1,ore:1}};
const BUILD={build_road:'road',build_settlement:'settlement',build_city:'city',buy_dev_card:'devCard'};
const FREE_PHASES=new Set(['setupSettlement','setupRoad','roadBuilding']);
// Practice branches and director clones copy the exact state on purpose, so they carry the source's
// hidden information. Say so wherever one is made; never reshuffle silently.
export const EXACT_COPY_NOTICE='Exact copy: the practice game keeps every hidden hand, the development-card deck in its stored order and, for a seeded game, the dice sequence. Playing it forward (buying cards, rolling) can reveal what comes next in the source game. Do not use it to inform play in an unfinished game you or your agents are still playing.';
export const UNRECORDED_NOTE='This move was played before match history recording began. Only your own hand, the dice and the move text were saved for it; the board and other players’ counts were not recorded.';

export class HistoryError extends GameStoreError{constructor(message,status=400,extra={}){super(message,status);this.extra=extra;}}
export function historyFailure(e){
 if(e instanceof HistoryError)return {status:e.status,error:e.message,...e.extra};
 return gameFailure(e);
}
function check(r){if(r.error)throw new GameStoreError('Game storage is temporarily unavailable.',503);return r.data;}
// A service-role client created on first use, so registering MCP tools never needs the secret up front.
export function lazyGameDb(){let c;const db=()=>c??=gameDb();return {from:(...a)=>db().from(...a),rpc:(...a)=>db().rpc(...a)};}

const isPlain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const site=()=>process.env.SITE_URL||'';
const statusOf=s=>s.phase==='finished'?'finished':s.phase==='setup'?'setup':'playing';
const zero=()=>Object.fromEntries(RESOURCES.map(r=>[r,0]));
const cleanText=v=>v.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const moveOf=revision=>revision-1; // revision 1 is the starting position; revision n follows move n-1

function revisionArg(value,row){
 const r=typeof value==='string'&&/^\d{1,12}$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(r)||r<1)throw new HistoryError('Use a revision of 1 or more.');
 if(r>row.revision)throw new HistoryError(`This game has revisions 1–${row.revision}.`,404);
 return r;
}
function perspectiveArg(value,row,reveal){
 const p=value??'human';
 if(p!=='human'&&p!=='full')throw new HistoryError('perspective must be "human" or "full".');
 if(p==='full'&&row.state.phase!=='finished'&&reveal!==true)throw new HistoryError('This game is not finished. Full information reveals every hand and the deck order; confirm with revealUnfinished to see it.',403,{code:'reveal_required'});
 return p;
}
function noteOut(n){return {id:n.id,gameId:n.game_id,revision:n.revision,move:moveOf(n.revision),kind:n.kind,body:n.body,version:n.version,createdAt:n.created_at,updatedAt:n.updated_at};}
function noteFields(input,{partial=false}={}){
 if(!isPlain(input))throw new HistoryError('Send a JSON object.');
 const out={};
 if(input.kind!==undefined||!partial){const kind=input.kind??'note';if(!NOTE_KINDS.includes(kind))throw new HistoryError('kind must be note, bookmark or prediction.');out.kind=kind;}
 if(input.body!==undefined||!partial){const body=input.body??'';if(typeof body!=='string')throw new HistoryError('body must be text.');const b=cleanText(body).trim();if(b.length>BODY_MAX)throw new HistoryError(`Keep notes to ${BODY_MAX} characters.`);out.body=b;}
 return out;
}
const players=s=>s.players.map((p,seat)=>({seat,name:p.name,color:p.color,kind:p.kind}));
function seatCounts(s){
 return s.players.map((p,seat)=>({seat,resourceCount:E.handSize(p.resources),devCardCount:p.devCards.length,knightsPlayed:p.knights,publicVP:E.publicVP(s,seat),roadLength:p.roadLength,longestRoad:s.awards.longestRoad===seat,largestArmy:s.awards.largestArmy===seat}));
}
function fullSeats(s){
 return s.players.map((p,seat)=>({seat,name:p.name,resources:{...p.resources},devCards:p.devCards.map(c=>({type:c.type,boughtTurn:c.bought})),knightsPlayed:p.knights,totalVP:E.totalVP(s,seat)}));
}

export class HistoryService{
 constructor({userId,db}={}){
  if(typeof userId!=='string'||!UUID.test(userId))throw new HistoryError('Match history needs a verified account.',401);
  this.userId=userId;this.db=db??lazyGameDb();
 }
 async game(id){
  if(typeof id!=='string'||!UUID.test(id))throw new HistoryError('Game not found.',404);
  const row=check(await this.db.from('catan_games').select('*').eq('id',id).eq('owner_id',this.userId).maybeSingle());
  if(!row)throw new HistoryError('Game not found.',404);
  return row;
 }
 // Reads every row after a revision cursor, 1000 at a time.
 async pages(table,gameId,columns,{upTo}={}){
  const out=[];let after=0;
  for(;;){
   let q=this.db.from(table).select(columns).eq('game_id',gameId).gt('revision',after);
   if(upTo!=null)q=q.lte('revision',upTo);
   const rows=check(await q.order('revision').limit(PAGE));
   out.push(...rows);if(rows.length<PAGE)return out;after=rows.at(-1).revision;
  }
 }
 async snapshot(row,revision){
  if(revision===row.revision)return {state:row.state,source:'current'};
  const snap=check(await this.db.from('catan_game_snapshots').select('revision,state').eq('game_id',row.id).eq('revision',revision).maybeSingle());
  if(!snap)return null;
  return {state:{...snap.state,log:await this.logAt(row.id,revision)},source:'snapshot'};
 }
 // A revision's log: log_added concatenated from the last full-log reset at or before it (a director
 // rewrite or the first recorded revision stores the whole log), trimmed to the engine's window.
 async logAt(gameId,revision){
  const logs=await this.pages('catan_game_snapshots',gameId,'revision,log_added,log_reset',{upTo:revision});
  let from=0;logs.forEach((l,i)=>{if(l.log_reset)from=i;});
  return logs.slice(from).flatMap(l=>l.log_added||[]).slice(-LOG_KEEP);
 }

 async list(){
  const rows=check(await this.db.from('catan_games').select('*').eq('owner_id',this.userId).order('updated_at',{ascending:false}).limit(LIBRARY_MAX));
  const notes=check(await this.db.from('catan_game_notes').select('game_id,kind').eq('owner_id',this.userId));
  return rows.map(r=>{
   const s=r.state,status=statusOf(s),active=!r.archived_at;
   return {id:r.id,title:r.title,status,archived:!active,revision:r.revision,moves:moveOf(r.revision),turn:s.turn,createdAt:r.created_at??null,updatedAt:r.updated_at,
    players:s.players.map((p,seat)=>({seat,name:p.name,color:p.color,kind:p.kind,publicVP:E.publicVP(s,seat)})),
    yourVP:E.totalVP(s,0),currentSeat:status==='playing'||status==='setup'?s.current:null,winner:s.winner??null,
    notes:notes.filter(n=>n.game_id===r.id&&n.kind!=='bookmark').length,bookmarks:notes.filter(n=>n.game_id===r.id&&n.kind==='bookmark').length,
    branchedFrom:r.branched_from?{id:r.branched_from,revision:r.branched_from_revision,move:moveOf(r.branched_from_revision)}:null,
    replayUrl:site()+'/history/'+r.id,resumeUrl:active&&status!=='finished'?site()+'/game/'+r.id:null};
  });
 }

 async match(id,{perspective,revealUnfinished}={}){
  const row=await this.game(id),view=perspectiveArg(perspective,row,revealUnfinished);
  const [events,snaps,notes]=await Promise.all([
   this.pages('catan_game_events',row.id,'revision,payload,created_at'),
   this.pages('catan_game_snapshots',row.id,'revision,state,created_at',{upTo:row.revision}),
   this.notes(row)]);
  const ev=new Map(events.map(e=>[e.revision,e])),st=new Map(snaps.map(s=>[s.revision,s.state]));
  st.set(row.revision,row.state);
  const recorded=[...st.keys()].sort((a,b)=>a-b);
  const firstRecorded=snaps.length?Math.min(...snaps.map(s=>s.revision)):row.revision;
  const timeline=[];
  for(let r=1;r<=row.revision;r++){
   const e=ev.get(r)?.payload,s=st.get(r);
   const lines=e?(e.log?.length?e.log:e.result?.events||[]).map(l=>l.text):r===1?['Game created.']:[];
   const entry={revision:r,move:moveOf(r),at:ev.get(r)?.created_at??(r===1?row.created_at??null:null),type:r===1?'created':e?.type??null,actorSeat:e?.actorSeat??null,
    lines,dice:e?e.dice??null:s?.dice??null,phase:e?.phase??s?.phase??null,turnPhase:e?.turnPhase??s?.turnPhase??null,currentSeat:e?.currentSeat??s?.current??null,
    turn:s?s.turn:null,yourHand:e?.ownHand?{...e.ownHand}:s?{...s.players[0].resources}:null,board:s?'recorded':'unrecorded',seats:s?seatCounts(s):null};
   if(view==='full'&&s)entry.hands=s.players.map(p=>({...p.resources}));
   timeline.push(entry);
  }
  return {game:{id:row.id,title:row.title,status:statusOf(row.state),archived:!!row.archived_at,revision:row.revision,moves:moveOf(row.revision),createdAt:row.created_at??null,updatedAt:row.updated_at,
    branchedFrom:row.branched_from?{id:row.branched_from,revision:row.branched_from_revision,move:moveOf(row.branched_from_revision)}:null,
    resumeUrl:!row.archived_at&&row.state.phase!=='finished'?site()+'/game/'+row.id:null,winner:row.state.winner??null},
   perspective:view,players:players(row.state),
   coverage:{recordedFrom:firstRecorded,recordedRevisions:recorded.length,unrecordedRevisions:timeline.filter(t=>t.board==='unrecorded').length,
    note:firstRecorded>1?`Revisions 1–${firstRecorded-1} were played before match history recording began. For them only your hand, the dice and the move text exist; the board is not shown.`:null},
   timeline,summary:summarize(row,timeline,st,ev),notes};
 }

 async position(id,revision,{perspective,revealUnfinished}={}){
  const row=await this.game(id),r=revisionArg(revision,row),view=perspectiveArg(perspective,row,revealUnfinished);
  const [snap,eventRow,notes]=await Promise.all([this.snapshot(row,r),
   r>1?this.db.from('catan_game_events').select('revision,payload,created_at').eq('game_id',row.id).eq('revision',r).maybeSingle().then(check):null,
   this.notes(row,r)]);
  const e=eventRow?.payload;
  const event=e?{type:e.type,actorSeat:e.actorSeat,lines:(e.log?.length?e.log:e.result?.events||[]).map(l=>l.text),dice:e.dice??null,at:eventRow.created_at}:r===1?{type:'created',actorSeat:null,lines:['Game created.'],dice:null,at:row.created_at??null}:null;
  const out={gameId:row.id,revision:r,move:moveOf(r),latestRevision:row.revision,perspective:view,event,notes,players:players(row.state)};
  if(!snap){
   Object.assign(out,{board:'unrecorded',note:UNRECORDED_NOTE,view:null,
    yourHand:e?.ownHand?{...e.ownHand}:null,phase:e?.phase??null,turnPhase:e?.turnPhase??null,currentSeat:e?.currentSeat??null,winner:e?.winner??null,canBranch:false});
   if(view==='full')out.full={available:false,reason:'No complete state was recorded for this revision.'};
   return out;
  }
  const v=viewMatch(snap.state,0);
  Object.assign(out,{board:'recorded',source:snap.source,view:v,canBranch:true});
  if(view==='full')out.full={available:true,label:'Full information: every hand, development card and the deck order at this position.',seats:fullSeats(snap.state),bank:{...snap.state.bank},devDeck:snap.state.devDeck.map(c=>typeof c==='string'?c:c.type),pendingDiscards:{...snap.state.pendingDiscards}};
  return out;
 }

 async notes(row,revision){
  let q=this.db.from('catan_game_notes').select('*').eq('game_id',row.id).eq('owner_id',this.userId);
  if(revision!=null)q=q.eq('revision',revision);
  return check(await q.order('revision').limit(NOTES_PER_GAME)).map(noteOut);
 }
 async listNotes(id,{revision}={}){const row=await this.game(id);return {notes:await this.notes(row,revision==null?undefined:revisionArg(revision,row))};}
 async createNote(id,input={}){
  const row=await this.game(id),fields=noteFields(input);
  const revision=revisionArg(input.revision,row);
  if(fields.kind!=='bookmark'&&!fields.body)throw new HistoryError('Write something in the note first.');
  if((await this.notes(row)).length>=NOTES_PER_GAME)throw new HistoryError(`A game can hold ${NOTES_PER_GAME} notes. Delete one first.`,409);
  if(fields.kind==='bookmark'){const dup=(await this.notes(row,revision)).find(n=>n.kind==='bookmark');if(dup)return {note:dup,existing:true};}
  return {note:noteOut(check(await this.db.from('catan_game_notes').insert({game_id:row.id,owner_id:this.userId,revision,...fields}).select('*').single()))};
 }
 async noteRow(row,noteId){
  if(typeof noteId!=='string'||!UUID.test(noteId))throw new HistoryError('Note not found.',404);
  const n=check(await this.db.from('catan_game_notes').select('*').eq('id',noteId).eq('game_id',row.id).eq('owner_id',this.userId).maybeSingle());
  if(!n)throw new HistoryError('Note not found.',404);
  return n;
 }
 async updateNote(id,noteId,input={}){
  const row=await this.game(id),fields=noteFields(input,{partial:true}),expected=input.expectedVersion;
  if(input.revision!==undefined)fields.revision=revisionArg(input.revision,row);
  if(!Number.isSafeInteger(expected)||expected<1)throw new HistoryError('Send expectedVersion from your latest read of the note.');
  const current=await this.noteRow(row,noteId);
  if(current.version!==expected)throw new HistoryError('This note changed since you read it. Review the latest text and reapply your edit.',409,{code:'version_conflict',note:noteOut(current)});
  if((fields.kind??current.kind)!=='bookmark'&&(fields.body??current.body)==='')throw new HistoryError('A note or prediction needs text. Delete it instead.');
  const updated=check(await this.db.from('catan_game_notes').update({...fields,version:expected+1,updated_at:new Date().toISOString()}).eq('id',current.id).eq('owner_id',this.userId).eq('version',expected).select('*').maybeSingle());
  if(!updated)throw new HistoryError('This note changed since you read it. Review the latest text and reapply your edit.',409,{code:'version_conflict',note:noteOut(await this.noteRow(row,noteId))});
  return {note:noteOut(updated)};
 }
 async deleteNote(id,noteId,{expectedVersion}={}){
  const row=await this.game(id);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new HistoryError('Send expectedVersion from your latest read of the note.');
  const current=await this.noteRow(row,noteId);
  if(current.version!==expectedVersion)throw new HistoryError('This note changed since you read it.',409,{code:'version_conflict',note:noteOut(current)});
  const gone=check(await this.db.from('catan_game_notes').delete().eq('id',current.id).eq('owner_id',this.userId).eq('version',expectedVersion).select('id').maybeSingle());
  if(!gone)throw new HistoryError('This note changed since you read it.',409,{code:'version_conflict',note:noteOut(await this.noteRow(row,noteId))});
  return {deleted:true,id:current.id};
 }

 // New practice game from an exact recorded position. The original game is never written; seat and
 // sidekick grants are not copied (the new game has none until the owner issues them).
 async branch(id,{revision,title}={}){
  const row=await this.game(id),r=revisionArg(revision,row);
  if(title!=null&&(typeof title!=='string'||!title.trim()||title.trim().length>80))throw new HistoryError('Use a title of 1–80 characters.');
  const snap=await this.snapshot(row,r);
  if(!snap)throw new HistoryError('No complete state was recorded for this revision, so it cannot become a practice game. Choose a revision with a recorded board.',409,{code:'snapshot_unavailable'});
  const active=check(await this.db.from('catan_games').select('id').eq('owner_id',this.userId).is('archived_at',null)).length;
  if(active>=ROOM_LIMIT)throw new HistoryError(`You have ${ROOM_LIMIT} active games. Archive one first.`,409);
  const state=structuredClone(snap.state),newId=randomUUID();
  state.id=newId;
  state.log=[...(state.log||[]),{seq:state.seq,seat:null,text:`Practice branch of “${row.title}” from move ${moveOf(r)}.`}].slice(-LOG_KEEP);
  for(let s=0;s<SEATS;s++)viewMatch(state,s); // engine smoke test before saving
  const name=title?.trim()||`${row.title.slice(0,56)} · practice from move ${moveOf(r)}`.slice(0,80);
  const created=check(await this.db.from('catan_games').insert({id:newId,owner_id:this.userId,title:name,state,branched_from:row.id,branched_from_revision:r}).select('*').single());
  return {game:{id:created.id,title:created.title,revision:created.revision,url:site()+'/game/'+created.id,replayUrl:site()+'/history/'+created.id},
   branchedFrom:{id:row.id,revision:r,move:moveOf(r)},note:'The original game is unchanged. Agent seat and sidekick connections are not copied; connect agents from the new game page.',
   exactCopy:{sourceFinished:row.state.phase==='finished',seededDice:state.rng!=null,notice:EXACT_COPY_NOTICE}};
 }

 async practicePositions(id){
  const row=await this.game(id);
  const snaps=await this.pages('catan_game_snapshots',row.id,'revision,state',{upTo:row.revision});
  const states=new Map(snaps.map(s=>[s.revision,s.state]));states.set(row.revision,row.state);
  return {gameId:id,title:row.title,positions:[...states].filter(([,s])=>s.phase==='play'&&s.current===0&&s.turnPhase==='main').map(([revision])=>({revision,move:moveOf(revision)})).sort((a,b)=>a.revision-b.revision)};
 }
 async practicePosition(id,revision){
  const row=await this.game(id),r=revisionArg(revision,row),snap=await this.snapshot(row,r);
  if(!snap)throw new HistoryError('This board was not recorded.',409,{code:'snapshot_unavailable'});
  const s=snap.state;
  if(s.phase!=='play'||s.current!==0||s.turnPhase!=='main')throw new HistoryError('Choose a recorded position after your roll, during your main phase.',409,{code:'not_practice_position'});
  return {gameId:id,revision:r,move:moveOf(r),view:viewMatch(s,0),options:practiceOptions(s).map(({id,label,actions})=>({id,label,
   displayLabel:label.replace(/ at v\d+$/, ' at the highlighted site').replace(/ at e\d+$/, ' along the highlighted road'),
   targets:actions.flatMap(a=>a.vertex?[{kind:'site',id:a.vertex}]:a.edge?[{kind:'road',id:a.edge}]:[])})),
   prompt:'Choose a plan, explain why, and estimate the chance you gain at least one victory point by the end of your chosen future turn. Commit before seeing any later move or comparison.',
   distinction:'This practice samples plausible hidden hands and futures. Exact-copy branches use the actual hidden cards and deck.'};
 }
 async practiceCommit(id,revision,input={}){
  const position=await this.practicePosition(id,revision),option=position.options.find(o=>o.id===input.optionId);
  if(!option)throw new HistoryError('Choose one of the options shown for this position.');
  const reason=typeof input.reason==='string'?cleanText(input.reason).trim():'';
  if(!reason||reason.length>2000)throw new HistoryError('Write a reason of 1–2000 characters.');
  const probability=Number(input.probability),horizon=Number(input.horizon);
  if(typeof input.probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)throw new HistoryError('Probability must be a number from 0 to 1.');
  if(!Number.isInteger(horizon)||horizon<1||horizon>6)throw new HistoryError('Choose 1–6 future turns.');
  const seed=randomBytes(4).readUInt32BE(0)||1;
  const attempt=check(await this.db.from('catan_decision_attempts').insert({game_id:id,owner_id:this.userId,revision:position.revision,
   option_id:option.id,reason,probability,horizon,seed}).select('*').single());
  return {attempt:attemptOut(attempt)};
 }
 async attemptRow(id){
  if(typeof id!=='string'||!UUID.test(id))throw new HistoryError('Attempt not found.',404);
  const row=check(await this.db.from('catan_decision_attempts').select('*').eq('id',id).eq('owner_id',this.userId).maybeSingle());
  if(!row)throw new HistoryError('Attempt not found.',404);
  await this.game(row.game_id);
  return row;
 }
 async practiceReveal(id){
  const attempt=await this.attemptRow(id);
  if(attempt.revealed_at)return {attempt:await this.freshAttempt(attempt)};
  const game=await this.game(attempt.game_id),snap=await this.snapshot(game,attempt.revision);
  if(!snap)throw new HistoryError('The recorded position is unavailable.',409);
  // The model sees only the chosen historical snapshot. Later events are read after evaluation.
  const evaluation=evaluateDecision(snap.state,{optionId:attempt.option_id,horizon:attempt.horizon,seed:Number(attempt.seed)});
  evaluation.realized=await this.realized(game,attempt,snap.state);
  const updated=check(await this.db.from('catan_decision_attempts').update({evaluation,revealed_at:new Date().toISOString()})
   .eq('id',id).eq('owner_id',this.userId).is('revealed_at',null).select('*').maybeSingle());
  return {attempt:await this.freshAttempt(updated||await this.attemptRow(id))};
 }
 async freshAttempt(attempt){
  const out=attemptOut(attempt);
  if(!out.evaluation||out.evaluation.realized?.resolution!=='pending')return out;
  const game=await this.game(attempt.game_id),snap=await this.snapshot(game,attempt.revision);
  if(snap)out.evaluation={...out.evaluation,realized:await this.realized(game,attempt,snap.state)};
  return out;
 }
 async realized(game,attempt,start){
  const events=(await this.pages('catan_game_events',game.id,'revision,payload',{upTo:game.revision})).filter(e=>e.revision>attempt.revision);
  const first=events[0]?.payload;
  const option=practiceOptions(start).find(o=>o.id===attempt.option_id);
  const planned=option?.actions.flatMap(a=>a.type==='play_knight'?[a,{type:'move_robber'}]:[a])||[];
  planned.push({type:'end_turn'});
  const closing=events.findIndex(e=>e.payload?.type==='end_turn'&&e.payload?.actorSeat===0);
  const turn=closing<0?[]:events.slice(0,closing+1);
  let factualMatch=!!option&&turn.length===planned.length&&turn.every((e,i)=>e.revision===attempt.revision+i+1&&e.payload?.actorSeat===0&&e.payload?.type===planned[i].type);
  // The event stream records action types but not build sites or trade resources. Verify each
  // parameterized action against its adjacent immutable snapshots before assigning a score.
  if(factualMatch)for(let i=0;i<planned.length-1;i++){
   const action=planned[i];if(action.type==='move_robber')continue;
   const before=i?await this.snapshot(game,turn[i-1].revision):{state:start},after=await this.snapshot(game,turn[i].revision);
   if(!before||!after){factualMatch=false;break;}
   let modeled;try{modeled=applyAction(before.state,0,action).state;}catch{factualMatch=false;break;}
   const publicEffect=s=>({bank:s.bank,buildings:s.buildings,roads:s.roads,hand:s.players[0].resources,
    cards:s.players[0].devCards,knights:s.players[0].knights,deckLength:s.devDeck.length,phase:s.phase,turnPhase:s.turnPhase,current:s.current});
   if(!isDeepEqual(publicEffect(modeled),publicEffect(after.state))){factualMatch=false;break;}
  }
  const ended=events.filter(e=>e.payload?.type==='end_turn'&&e.payload?.actorSeat===0);
  // The first end_turn closes the decision turn; horizon counts later human turns.
  const target=ended[attempt.horizon]?.revision??(game.state.phase==='finished'?game.revision:null);
  const snap=target?await this.snapshot(game,target):null;
  const gain=snap?E.totalVP(snap.state,0)-E.totalVP(start,0):null;
  return {firstRecordedAction:first?.type??null,factualMatch:factualMatch?'verified':'unverified',
   resolution:gain==null?'pending':factualMatch?'scored':'counterfactual_or_unverified',
   vpGain:gain,outcome:gain==null?null:gain>=1,
   brierScore:gain==null||!factualMatch?null:(Number(attempt.probability)-(gain>=1?1:0))**2,
   note:factualMatch?'The full recorded decision turn matches this committed plan.':'The event record does not prove this full plan matched your actual decision turn; no probability score is assigned.'};
 }
 async practiceAttempts({gameId,summaryOnly=false}={}){
  if(gameId)await this.game(gameId);
  let q=this.db.from('catan_decision_attempts').select('*').eq('owner_id',this.userId);
  if(gameId)q=q.eq('game_id',gameId);
  const rows=check(await q.order('created_at',{ascending:false}).limit(200));
  const attempts=summaryOnly?rows.map(a=>({id:a.id,gameId:a.game_id,revision:a.revision,optionId:a.option_id,createdAt:a.created_at,revealedAt:a.revealed_at})):await Promise.all(rows.map(a=>this.freshAttempt(a)));
  if(summaryOnly)return {attempts};
  const scored=attempts.filter(a=>a.evaluation?.realized?.brierScore!=null);
  return {attempts,calibration:{scored:scored.length,meanBrier:scored.length?scored.reduce((n,a)=>n+a.evaluation.realized.brierScore,0)/scored.length:null,
   note:scored.length<20?'Too few scored decisions for a calibration claim. Pending and counterfactual attempts are excluded.':'Brier score is a descriptive average; it does not establish forecasting skill.'}};
 }
}

function attemptOut(a){return {id:a.id,gameId:a.game_id,revision:a.revision,optionId:a.option_id,reason:a.reason,
 probability:Number(a.probability),horizon:a.horizon,createdAt:a.created_at,revealedAt:a.revealed_at,evaluation:a.evaluation??null};}

// Postgame summary from what the human seat could see: dice, public builds and bank trades, production
// (public at the table) where both sides of a roll were recorded, and the human's own production from
// their hand, which every event recorded. Steals and discards of other players stay hidden.
function summarize(row,timeline,st,ev){
 const n=row.state.players.length,dice={};for(let t=2;t<=12;t++)dice[t]=0;
 const seats=Array.from({length:n},(_,seat)=>({seat,produced:zero(),productionRolls:0,built:{road:0,settlement:0,city:0,devCard:0},spent:zero(),bankTrades:0,tradeOffers:0,knightsPlayed:row.state.players[seat].knights}));
 let rolls=0,countedRolls=0;
 const humanProduced=zero();let humanRolls=0;
 for(const t of timeline){
  const e=ev.get(t.revision)?.payload;if(!e)continue;
  const before=timeline[t.revision-2],seat=e.actorSeat;
  if(e.type==='roll'&&e.dice){
   rolls++;dice[e.dice.total]=(dice[e.dice.total]||0)+1;
   if(e.dice.total!==7){
    const a=st.get(t.revision-1),b=st.get(t.revision);
    if(a&&b){countedRolls++;b.players.forEach((p,s)=>{for(const r of RESOURCES){const d=p.resources[r]-a.players[s].resources[r];if(d>0){seats[s].produced[r]+=d;}}});}
    if(before?.yourHand&&t.yourHand){humanRolls++;for(const r of RESOURCES){const d=t.yourHand[r]-before.yourHand[r];if(d>0)humanProduced[r]+=d;}}
   }
  }
  const kind=BUILD[e.type];
  if(kind&&Number.isInteger(seat)&&seats[seat]){
   seats[seat].built[kind]++;
   if(!FREE_PHASES.has(before?.turnPhase))for(const [r,c] of Object.entries(COST[kind]))seats[seat].spent[r]+=c;
  }
  if(e.type==='bank_trade'&&seats[seat])seats[seat].bankTrades++;
  if(e.type==='offer_trade'&&seats[seat])seats[seat].tradeOffers++;
 }
 const s=row.state,over=s.phase==='finished';
 seats.forEach(x=>{x.publicVP=E.publicVP(s,x.seat);if(over||x.seat===0)x.totalVP=E.totalVP(s,x.seat);});
 return {rolls,dice,production:{countedRolls,note:countedRolls<rolls-dice[7]?`Production by player counts ${countedRolls} of ${rolls-dice[7]} producing rolls: the rest were played before history recording began.`:null},
  you:{produced:humanProduced,countedRolls:humanRolls},seats,
  hidden:'Steals, discards and unplayed development cards of other players are hidden in this view.'};
}

// ---------------------------------------------------------------------------
// MCP: register on the authenticated OAuth /mcp server only, with the verified account id.
// ---------------------------------------------------------------------------
const READ={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const WRITE={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
const DESTRUCTIVE={...WRITE,destructiveHint:true};
export const HISTORY_INSTRUCTIONS='Match history tools read the owner’s own games chronologically. history_list_matches → history_get_match (timeline of every revision with dice, move text, your hand and, where recorded, public counts; plus a postgame summary) → history_get_position for one revision. The default perspective is the human seat; perspective "full" reveals every hand and the deck and, for an unfinished game, also needs revealUnfinished: true. Say which perspective you used. Revisions marked board:"unrecorded" were played before history recording began; do not guess their board. Notes, bookmarks and predictions attach to a revision (history_add_note/update/delete with expectedVersion). history_branch copies a recorded position into a new practice game; the original never changes and agent connections are not copied. The copy is exact: it keeps hidden hands, the deck order and any dice seed, so playing it forward can reveal the source game’s upcoming cards. Fair decision practice instead uses practice_list_positions → practice_get_position → practice_commit → practice_reveal, with no future or hidden information before commitment. Never use a branch or clone of the owner’s live game to inform play in it.';

export function registerHistoryTools(server,{userId,db}={}){
 const service=new HistoryService({userId,db}); // throws unless userId is a verified account uuid
 const tool=(name,title,description,inputSchema,annotations,run)=>server.registerTool(name,{title,description,inputSchema,annotations:{title,...annotations}},async args=>{
  try{const data=await run(args||{});return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
  catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify(historyFailure(e))}]};}
 });
 const gameId=z.string().describe('Game id from history_list_matches.');
 const revision=z.number().int().min(1).describe('Game revision: 1 is the starting position; revision n follows move n−1.');
 const perspective=z.enum(['human','full']).optional().describe('human (default): what seat 0 could see. full: every hand and the deck.');
 const revealUnfinished=z.boolean().optional().describe('Required with perspective "full" while the game is unfinished.');
 const noteId=z.string().describe('Note id.');
 const expectedVersion=z.number().int().min(1).describe('version from your latest read of the note.');
 const kind=z.enum(NOTE_KINDS);
 const body=z.string().max(BODY_MAX);
 tool('history_list_matches','List matches','Match library: every game (active, finished, archived) with status, players, public VP, move count, notes and resume/replay links.',{},READ,async()=>({matches:await service.list()}));
 tool('history_get_match','Get match history','Chronological timeline of every revision (dice, move text, your hand, recorded public counts), coverage of recorded boards, postgame summary and notes.',{gameId,perspective,revealUnfinished},READ,a=>service.match(a.gameId,a));
 tool('history_get_position','Get position','One revision: the board and view as the human saw it (or full information when requested), the move that produced it and its notes.',{gameId,revision,perspective,revealUnfinished},READ,a=>service.position(a.gameId,a.revision,a));
 tool('history_list_notes','List notes','Notes, bookmarks and predictions for a game, optionally for one revision.',{gameId,revision:revision.optional()},READ,a=>service.listNotes(a.gameId,a));
 tool('history_add_note','Add note','Attach a note, bookmark or prediction to a revision. A second bookmark at the same revision returns the existing one.',{gameId,revision,kind:kind.default('note'),body:body.optional()},WRITE,a=>service.createNote(a.gameId,a));
 tool('history_update_note','Update note','Change a note’s text, kind or revision. Needs expectedVersion; a conflict returns the current note.',{gameId,noteId,expectedVersion,body:body.optional(),kind:kind.optional(),revision:revision.optional()},WRITE,a=>service.updateNote(a.gameId,a.noteId,a));
 tool('history_delete_note','Delete note','Delete a note, bookmark or prediction. Needs expectedVersion.',{gameId,noteId,expectedVersion},DESTRUCTIVE,a=>service.deleteNote(a.gameId,a.noteId,a));
 tool('history_branch','Practice from position','Copy a recorded revision into a new practice game (counts toward the 20 active games). The original is unchanged; agent connections are not copied. Exact copy: hidden hands, deck order and any dice seed are kept, so playing the branch forward can reveal the source game’s upcoming cards; the result includes exactCopy.notice.',{gameId,revision,title:z.string().max(80).optional()},WRITE,a=>service.branch(a.gameId,a));
 tool('practice_list_positions','List fair-practice positions','Recorded revisions when you could make a decision after rolling. Returns neutral revision labels only; no future moves.',{gameId},READ,a=>service.practicePositions(a.gameId));
 tool('practice_get_position','Get fair-practice position','Only what seat 0 could see at a recorded decision, plus feasible plans. No future moves, hidden hands, deck order or true RNG.',{gameId,revision},READ,a=>service.practicePosition(a.gameId,a.revision));
 tool('practice_commit','Commit a decision','Durably lock a plan, reason and numerical probability before reveal.',{gameId,revision,optionId:z.string().min(1).max(500),reason:z.string().min(1).max(2000),probability:z.number().min(0).max(1),horizon:z.number().int().min(1).max(6)},WRITE,a=>service.practiceCommit(a.gameId,a.revision,a));
 tool('practice_reveal','Reveal model comparison','Compare the committed plan with other feasible plans across paired plausible futures; only after the commitment exists.',{attemptId:z.string()},WRITE,a=>service.practiceReveal(a.attemptId));
 tool('practice_list_attempts','List practice attempts','List your committed attempts and descriptive calibration, optionally for one game.',{gameId:gameId.optional()},READ,a=>service.practiceAttempts(a));
 return service;
}

// ---------------------------------------------------------------------------
// Browser routes: mount after session identity and same-origin (CSRF) checks. req.user.id is the owner.
// ---------------------------------------------------------------------------
export function historyRoutes(app,{makeService=userId=>new HistoryService({userId})}={}){
 const handler=fn=>async(req,res)=>{
  try{const body=req.body??{};if(!['GET','HEAD'].includes(req.method)&&!isPlain(body))throw new HistoryError('Send a JSON object.');res.json(await fn(makeService(req.user?.id),req.params,body,req.query||{}));}
  catch(e){const f=historyFailure(e);res.status(f.status).json(f);}
 };
 const opts=q=>({perspective:q.perspective,revealUnfinished:q.reveal==='1'});
 app.get('/api/history',handler(async s=>({matches:await s.list()})));
 app.get('/api/history/:id',handler((s,p,b,q)=>s.match(p.id,opts(q))));
 app.get('/api/history/:id/positions/:revision',handler((s,p,b,q)=>s.position(p.id,p.revision,opts(q))));
 app.get('/api/history/:id/notes',handler((s,p,b,q)=>s.listNotes(p.id,{revision:q.revision})));
 app.post('/api/history/:id/notes',handler((s,p,b)=>s.createNote(p.id,b)));
 app.patch('/api/history/:id/notes/:noteId',handler((s,p,b)=>s.updateNote(p.id,p.noteId,b)));
 app.delete('/api/history/:id/notes/:noteId',handler((s,p,b,q)=>s.deleteNote(p.id,p.noteId,{expectedVersion:b.expectedVersion??(/^\d{1,9}$/.test(q.expectedVersion||'')?Number(q.expectedVersion):undefined)})));
 app.post('/api/history/:id/branch',handler((s,p,b)=>s.branch(p.id,b)));
 app.get('/api/history/:id/practice',handler((s,p)=>s.practicePositions(p.id)));
 app.get('/api/history/:id/practice/:revision',handler((s,p)=>s.practicePosition(p.id,p.revision)));
 app.post('/api/history/:id/practice/:revision/attempts',handler((s,p,b)=>s.practiceCommit(p.id,p.revision,b)));
 app.post('/api/practice/attempts/:attemptId/reveal',handler((s,p)=>s.practiceReveal(p.attemptId)));
 app.get('/api/practice/attempts/:attemptId',handler(async(s,p)=>({attempt:await s.freshAttempt(await s.attemptRow(p.attemptId))})));
 app.get('/api/practice/attempts',handler((s,p,b,q)=>s.practiceAttempts({gameId:q.gameId,summaryOnly:true})));
}
