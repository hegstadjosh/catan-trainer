#!/usr/bin/env python3
"""Read Catan events and optionally invoke a hook, with durable replay.
Example:
  export CATAN_SIDEKICK_TOKEN='the read-only connection token'
  python3 catan-sidekick.py --hook python3 my_agent_hook.py
The hook receives one JSON event on stdin. Exit 0 acknowledges it. Hooks must
be idempotent on event.id: a crash can replay the last event (at-least-once).
No hook means print each JSON event. Keep credentials out of command history.
"""
import argparse,json,os,pathlib,subprocess,sys,time,urllib.request,urllib.error
p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('--url',required=True,help='Your deployment HTTPS /api/game-events URL')
p.add_argument('--cursor',default='.catan-sidekick-cursor')
p.add_argument('--hook',nargs=argparse.REMAINDER,help='Program and arguments; receives JSON on stdin')
a=p.parse_args();token=os.environ.get('CATAN_SIDEKICK_TOKEN')
if not token:sys.exit('Set CATAN_SIDEKICK_TOKEN to your read-only sidekick token.')
if not a.url.startswith('https://'):sys.exit('Use an HTTPS event URL.')
path=pathlib.Path(a.cursor);cursor=path.read_text().strip() if path.exists() else '0'
if not cursor.isdigit():sys.exit('Cursor file must contain an event id.')
def receive(kind,event_id,data):
 global cursor
 if kind=='revoked':sys.exit('Connection revoked. Create a new sidekick connection.')
 if kind!='game_event':return
 event=json.loads(data)
 if a.hook:subprocess.run(a.hook,input=json.dumps(event)+'\n',text=True,check=True,timeout=120)
 else:print(json.dumps(event),flush=True)
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(str(event_id));temp.chmod(0o600);temp.replace(path);cursor=str(event_id)
while True:
 try:
  request=urllib.request.Request(a.url,headers={'Authorization':'Bearer '+token,'Last-Event-ID':cursor,'Accept':'text/event-stream'})
  with urllib.request.urlopen(request,timeout=40) as response:
   kind='message';event_id=None;data=[]
   for raw in response:
    line=raw.decode().rstrip('\r\n')
    if not line:
     if data:receive(kind,event_id,'\n'.join(data))
     kind='message';event_id=None;data=[]
    elif line.startswith('event:'):kind=line[6:].strip()
    elif line.startswith('id:'):event_id=int(line[3:].strip())
    elif line.startswith('data:'):data.append(line[5:].lstrip())
 except urllib.error.HTTPError as e:
  if e.code in (401,403):sys.exit('Connection rejected. Check or replace your sidekick token.')
  print('Feed unavailable; retrying.',file=sys.stderr)
 except KeyboardInterrupt:break
 except Exception as e:print(type(e).__name__+': retrying from last acknowledged event.',file=sys.stderr)
 time.sleep(2)
