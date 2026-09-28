// Test-only wake hook: get fresh seat tools and submit one exact legal action.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const event=JSON.parse(await new Promise(resolve=>{let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>body+=chunk);process.stdin.on('end',()=>resolve(body));}));
if(!Number.isInteger(event.revision))throw new Error('Missing event revision');
const client=new Client({name:'synthetic-seat-hook',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.TEST_MCP_URL),{requestInit:{headers:{Authorization:'Bearer '+process.env.CATAN_SEAT_TOKEN}}}));
try{
 const state=JSON.parse((await client.callTool({name:'game_state',arguments:{}})).content[0].text);
 const legal=JSON.parse((await client.callTool({name:'game_legal_actions',arguments:{}})).content[0].text);
 if(state.game.view.mySeat!==event.seat)throw new Error('Seat mismatch');
 let action=legal.actions[0];
 if(!action&&legal.choices?.discard){
  const resources={};let remaining=legal.choices.discard.count;
  for(const [name,have] of Object.entries(legal.choices.discard.hand)){
   const amount=Math.min(remaining,have);if(amount)resources[name]=amount;remaining-=amount;
  }
  if(remaining)throw new Error('Discard hand cannot satisfy required count');
  action={type:'discard',resources};
 }
 if(action){
  const result=await client.callTool({name:'game_act',arguments:{expectedRevision:legal.revision,action}});
  if(result.isError)throw new Error('Move rejected');
 }
}finally{await client.close();}
