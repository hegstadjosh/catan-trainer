import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {GameStore} from '../lib/game-store.mjs';
import {gameMcpRoutes} from '../lib/game-mcp.mjs';
import {gameObserverRoutes} from '../lib/game-observer.mjs';
test('four seats plus readonly MCP and resumable SSE',{skip:!process.env.TEST_SUPABASE_SECRET_KEY},async()=>{
 process.env.SUPABASE_SECRET_KEY=process.env.TEST_SUPABASE_SECRET_KEY;
 const db=createClient(process.env.SUPABASE_URL,process.env.TEST_SUPABASE_SECRET_KEY,{auth:{persistSession:false}}),store=new GameStore(db),app=express();app.use(express.json());gameMcpRoutes(app);gameObserverRoutes(app);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;process.env.SITE_URL=base;let uid;const clients=[];
 const data=r=>{assert(!r.isError,JSON.stringify(r));return r.structuredContent??JSON.parse(r.content[0].text);};
 async function connect(path,token){const c=new Client({name:'test-seat',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(base+path),{requestInit:{headers:{Authorization:'Bearer '+token}}}));clients.push(c);return c;}
 try{const u=await db.auth.admin.createUser({email:`catan-mcp-test-${Date.now()}@example.com`,email_confirm:true});assert.ifError(u.error);uid=u.data.user.id;let row=await store.create(uid);const seats={};for(const seat of [1,2,3]){const grant=await store.connection(row,seat);seats[seat]=await connect('/game-mcp',grant.token);const state=data(await seats[seat].callTool({name:'game_state',arguments:{}}));assert.equal(state.game.view.mySeat,seat);}
 const grant=await store.observerConnection(row),observer=await connect('/game-info-mcp',grant.token);assert.deepEqual((await observer.listTools()).tools.map(t=>t.name).sort(),['event_stream_info','game_events','game_info']);assert.equal((await fetch(base+'/game-mcp',{headers:{Authorization:'Bearer '+grant.token}})).status,401);
 for(let i=0;i<16;i++){const seat=row.state.current;if(seat===0){const view=await store.present(row,0),action=view.view.legalActions.actions[0];row=(await store.act(row,0,row.revision,action)).row;}else{const options=data(await seats[seat].callTool({name:'game_legal_actions',arguments:{}}));const moved=data(await seats[seat].callTool({name:'game_act',arguments:{expectedRevision:options.revision,action:options.actions[0]}}));assert.equal(moved.game.view.mySeat,seat);row=await store.owned(row.id,uid);}}
 assert.equal(row.state.phase,'play');const replay=data(await observer.callTool({name:'game_events',arguments:{after:0}}));assert.equal(replay.events.length,16);assert.equal(replay.cursor,row.revision);
 const abort=new AbortController();const response=await fetch(base+'/api/game-events',{headers:{Authorization:'Bearer '+grant.token,'Last-Event-ID':String(row.revision-1)},signal:abort.signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);const reader=response.body.getReader();let text='';while(!text.includes('event: game_event'))text+=new TextDecoder().decode((await reader.read()).value);assert(text.includes('id: '+row.revision));abort.abort();await reader.cancel().catch(()=>{});
 await store.revokeObserver(row);await assert.rejects(()=>observer.callTool({name:'game_info',arguments:{}}),e=>e.code===401);console.log('All three independent agent MCP seats completed setup, read-only tools and SSE resume verified.');
 }finally{for(const c of clients)await c.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(uid)assert.ifError((await db.auth.admin.deleteUser(uid)).error);}
});
