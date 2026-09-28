import test from 'node:test';
import assert from 'node:assert/strict';
import {GameStore} from '../lib/game-store.mjs';
import {createMatch} from '../game/rules.mjs';

const row={id:'synthetic',title:'Fixture',revision:1,updated_at:'2026-01-01T00:00:00Z',state:createMatch({id:'synthetic',names:['Human','A','B','C'],seed:3})};

function delayedDb({failure}={}){
 const calls=[],active=new Set(),starts=[];
 const data={catan_game_seats:[{seat:1,expires_at:'2099-01-01T00:00:00Z',revoked_at:null,last_seen_at:null}],catan_game_observers:[{expires_at:'2099-01-01T00:00:00Z',revoked_at:null}]};
 return {calls,starts,active,from(table){
  assert.ok(table in data,`unexpected ${table} query`);
  const query={select(){return this;},eq(){return this;},maybeSingle(){return this;},then(resolve){
   calls.push(table);active.add(table);starts.push({table,overlap:active.size});
   return new Promise(done=>setTimeout(()=>{
    active.delete(table);done(table===failure?{data:null,error:{message:'unavailable'}}:{data:table==='catan_game_observers'?data[table][0]:data[table],error:null});
   },40)).then(resolve);
  }};
  return query;
 }};
}

test('owner presentation overlaps independent connection reads and keeps their shape',async()=>{
 const db=delayedDb();
 const game=await new GameStore(db).present(row,0,true);
 assert.deepEqual(db.calls.toSorted(),['catan_game_observers','catan_game_seats']);
 assert.equal(Math.max(...db.starts.map(s=>s.overlap)),2,'connection reads must overlap');
 assert.equal(game.seats[0].connected,true);
 assert.equal(game.seats[1].connected,false);
 assert.equal(game.sidekick.connected,true);
 assert.equal(game.revision,row.revision);
});

test('seat presentation makes no owner connection reads',async()=>{
 const db=delayedDb();
 const game=await new GameStore(db).present(row,1);
 assert.deepEqual(db.calls,[]);
 assert.equal(game.view.mySeat,1);
 assert.equal('seats' in game,false);
 assert.equal('sidekick' in game,false);
});

test('a failed owner connection query still rejects with storage unavailable',async()=>{
 const db=delayedDb({failure:'catan_game_observers'});
 await assert.rejects(new GameStore(db).present(row,0,true),e=>e.status===503&&e.message==='Game storage is temporarily unavailable.');
 assert.deepEqual(db.calls.toSorted(),['catan_game_observers','catan_game_seats']);
});
