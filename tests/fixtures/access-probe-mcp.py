#!/usr/bin/env python3
"""A local-only MCP service for access-mode integration checks. No network."""
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
for line in sys.stdin:
    msg = json.loads(line)
    if 'id' not in msg:
        continue
    method = msg.get('method')
    result = {}
    if method == 'initialize':
        result = {'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'diffcity-probe','version':'1.0.0'}}
    elif method == 'tools/list':
        result = {'tools':[
            {'name':'read_marker','description':'Read a random local test marker. No side effects.','inputSchema':{'type':'object','properties':{}},'annotations':{'readOnlyHint':True,'destructiveHint':False,'openWorldHint':False}},
            {'name':'write_marker','description':'Write the local test marker to action.txt in this temporary test directory. No external effects.','inputSchema':{'type':'object','properties':{}},'annotations':{'readOnlyHint':False,'destructiveHint':False,'openWorldHint':False}},
        ]}
    elif method == 'tools/call':
        name = msg['params']['name']
        marker = (root/'marker.txt').read_text()
        if name == 'write_marker':
            (root/'action.txt').write_text(marker)
        result = {'content':[{'type':'text','text':marker if name=='read_marker' else 'Wrote the local test marker.'}]}
        with (root/'calls.jsonl').open('a') as f:
            f.write(json.dumps({'tool':name})+'\n')
    print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':result}), flush=True)
