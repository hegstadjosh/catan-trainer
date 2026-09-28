import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createMatch,viewMatch,applyAction} from '../game/rules.mjs';
export class GameStoreError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=t=>createHash('sha256').update(t).digest('hex');
const CONFLICT=new Set(['not_your_turn','wrong_phase','game_over','stale_offer','offer_open']);
// Store errors and engine rule errors carry user-facing text. Anything else is a server bug: log it and return a generic 500.
export function gameFailure(e){if(e instanceof GameStoreError)return {status:e.status,error:e.message};if(e?.name==='GameRuleError')return {status:CONFLICT.has(e.code)?409:400,error:e.message,code:e.code};console.error('Unexpected Catan game error:',e?.stack||e);return {status:500,error:'This game request could not be completed.'};}
export function bearerToken(req){return /^Bearer +([A-Za-z0-9_-]+) *$/i.exec(req.headers.authorization||'')?.[1]??null;}
export const eventCursor=value=>value==null||value===''?0:typeof value==='string'&&/^\d{1,15}$/.test(value)?Number(value):null;
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function publicRollDice(value){
 const d=value?.dice??value;
 const d1=d?.d1,d2=d?.d2,total=d?.total;
 return Number.isInteger(d1)&&d1>=1&&d1<=6&&Number.isInteger(d2)&&d2>=1&&d2<=6&&total===d1+d2
  ?{dice:[d1,d2],total}:null;
}
function check(r){if(r.error)throw new GameStoreError('Game storage is temporarily unavailable.',503);return r.data;}
export function gameDb(){if(!process.env.SUPABASE_SECRET_KEY)throw new GameStoreError('Game storage is not configured.',503);return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
export class GameStore {
 constructor(db=gameDb()){this.db=db;}
 async owned(id,owner){if(!uuid.test(id))throw new GameStoreError('Game not found.',404);const row=check(await this.db.from('catan_games').select('*').eq('id',id).eq('owner_id',owner).is('archived_at',null).maybeSingle());if(!row)throw new GameStoreError('Game not found.',404);return row;}
 async list(owner){return check(await this.db.from('catan_games').select('id,title,revision,updated_at').eq('owner_id',owner).is('archived_at',null).order('updated_at',{ascending:false}).limit(20)).map(r=>({id:r.id,title:r.title,revision:r.revision,updatedAt:r.updated_at}));}
 async create(owner,input={}){input??={};if(!isObject(input)||input.title!=null&&typeof input.title!=='string')throw new GameStoreError('Use a title of 1–80 characters.');if((await this.list(owner)).length>=20)throw new GameStoreError('Archive a game before creating another.',409);const title=(input.title||'New game').trim();if(!title||title.length>80)throw new GameStoreError('Use a title of 1–80 characters.');const names=input.names??['You','Agent 1','Agent 2','Agent 3'];if(!Array.isArray(names)||names.length!==4||names.some(n=>typeof n!=='string'||!n.trim()||n.length>40))throw new GameStoreError('Use four names of 1–40 characters.');const id=randomUUID();return check(await this.db.from('catan_games').insert({id,owner_id:owner,title,state:createMatch({id,names:names.map(n=>n.trim())})}).select('*').single());}
 async present(row,seat=0,owner=false){const view=viewMatch(row.state,seat);
  // Earlier rooms did not persist dice past end_turn. Recover only an actual public roll
  // event for the already-authorized room; a pre-roll room or missing history stays blank.
  if(!view.lastDice&&!Object.hasOwn(row.state,'lastDice')){
   const events=check(await this.db.from('catan_game_events').select('payload').eq('game_id',row.id).eq('payload->>type','roll').order('revision',{ascending:false}).limit(1));
   view.lastDice=publicRollDice(events[0]?.payload?.dice??events[0]?.payload?.result?.dice);
  }
  const out={id:row.id,title:row.title,revision:row.revision,updatedAt:row.updated_at,view,geometry:view.board,url:process.env.SITE_URL+'/game/'+row.id};if(owner){
   const [seatResult,observerResult]=await Promise.all([
    this.db.from('catan_game_seats').select('seat,expires_at,revoked_at,last_seen_at').eq('game_id',row.id),
    this.db.from('catan_game_observers').select('expires_at,revoked_at').eq('game_id',row.id).maybeSingle()
   ]);
   const seats=check(seatResult),observer=check(observerResult);
   out.sidekick={connected:!!observer&&!observer.revoked_at&&Date.parse(observer.expires_at)>Date.now(),expiresAt:observer?.expires_at??null};
   out.seats=[1,2,3].map(seat=>{const s=seats.find(s=>s.seat===seat);return {seat,name:view.players.find(p=>p.seat===seat)?.name,connected:!!s&&!s.revoked_at&&Date.parse(s.expires_at)>Date.now(),lastSeenAt:s?.last_seen_at??null,expiresAt:s?.expires_at??null};});
  }return out;}
 async act(row,seat,expectedRevision,action){if(!isObject(action))throw new GameStoreError('Send an action object with a "type".');if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==row.revision)throw new GameStoreError('The game changed. Refresh before making your move.',409);const next=applyAction(row.state,seat,action);const humanView=viewMatch(next.state,0);const event={type:action.type,actorSeat:seat,result:next.result,phase:humanView.phase,turnPhase:humanView.turnPhase,currentSeat:humanView.currentSeat,dice:humanView.dice,winner:humanView.winner,ownHand:humanView.me.resources,log:humanView.log.filter(e=>e.seq>row.state.seq)};const updated=check(await this.db.rpc('catan_commit_move',{p_game_id:row.id,p_expected_revision:row.revision,p_state:next.state,p_event:event}).maybeSingle());if(!updated)throw new GameStoreError('Another move arrived first. Refresh the game.',409);return {row:updated,result:next.result};}
 async archive(row){check(await this.db.from('catan_games').update({archived_at:new Date().toISOString()}).eq('id',row.id));}
 async connection(row,seat){if(![1,2,3].includes(seat))throw new GameStoreError('Choose an agent seat.');const token='catan_seat_'+randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+90*86400000).toISOString();check(await this.db.from('catan_game_seats').upsert({game_id:row.id,seat,token_hash:hash(token),expires_at:expiresAt,revoked_at:null,last_seen_at:null}));return {token,endpoint:process.env.SITE_URL+'/game-mcp',seat,name:row.state.players[seat].name,expiresAt};}
 async revoke(row,seat){if(![1,2,3].includes(seat))throw new GameStoreError('Choose an agent seat.');check(await this.db.from('catan_game_seats').update({revoked_at:new Date().toISOString()}).eq('game_id',row.id).eq('seat',seat));}
 async authenticate(token){if(!/^catan_seat_[A-Za-z0-9_-]{43}$/.test(token||''))return null;const grant=check(await this.db.from('catan_game_seats').select('game_id,seat,expires_at,revoked_at,last_seen_at').eq('token_hash',hash(token)).maybeSingle());if(!grant||grant.revoked_at||Date.parse(grant.expires_at)<=Date.now())return null;const row=check(await this.db.from('catan_games').select('*').eq('id',grant.game_id).is('archived_at',null).maybeSingle());if(!row)return null;if(!(Date.parse(grant.last_seen_at)>Date.now()-60000))await this.db.from('catan_game_seats').update({last_seen_at:new Date().toISOString()}).eq('game_id',grant.game_id).eq('seat',grant.seat).eq('token_hash',hash(token));return {row,seat:grant.seat};}
 async observerConnection(row){const token='catan_observer_'+randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+90*86400000).toISOString();check(await this.db.from('catan_game_observers').upsert({game_id:row.id,token_hash:hash(token),expires_at:expiresAt,revoked_at:null}));return {token,endpoint:process.env.SITE_URL+'/game-info-mcp',eventsUrl:process.env.SITE_URL+'/api/game-events',expiresAt};}
 async revokeObserver(row){check(await this.db.from('catan_game_observers').update({revoked_at:new Date().toISOString()}).eq('game_id',row.id));}
 async authenticateObserver(token){if(!/^catan_observer_[A-Za-z0-9_-]{43}$/.test(token||''))return null;const grant=check(await this.db.from('catan_game_observers').select('game_id,expires_at,revoked_at').eq('token_hash',hash(token)).maybeSingle());if(!grant||grant.revoked_at||Date.parse(grant.expires_at)<=Date.now())return null;const row=check(await this.db.from('catan_games').select('*').eq('id',grant.game_id).is('archived_at',null).maybeSingle());return row?{row,seat:0}:null;}
 async events(row,after=0){if(!Number.isSafeInteger(after)||after<0)throw new GameStoreError('Use a non-negative event cursor.');const rows=check(await this.db.from('catan_game_events').select('revision,payload,created_at').eq('game_id',row.id).gt('revision',after).order('revision').limit(100));return {events:rows.map(e=>({id:e.revision,at:e.created_at,...e.payload})),cursor:rows.at(-1)?.revision??after,currentRevision:row.revision,hasMore:rows.length===100};}

}
