#!/usr/bin/env python3
"""Native-protocol fixture: action cannot occur before a matching allow reply."""
import json
import os
import sys
from pathlib import Path

def send(value):
    print(json.dumps(value), flush=True)

def receive():
    return json.loads(sys.stdin.readline())

provider = 'claude' if 'claude' in Path(sys.argv[0]).name else 'codex'
full = '--permission-mode' in sys.argv and sys.argv[sys.argv.index('--permission-mode') + 1] == 'bypassPermissions'
if provider == 'claude':
    assert '--safe-mode' not in sys.argv and '--strict-mcp-config' not in sys.argv
    assert '--permission-prompt-tool=stdio' in sys.argv
    assert sys.argv[sys.argv.index('--setting-sources') + 1] == 'user'
    settings = json.loads(sys.argv[sys.argv.index('--settings') + 1])
    assert settings['disableAllHooks'] is True
    if not full:
        assert settings['sandbox']['autoAllowBashIfSandboxed'] is False
    init = receive()
    assert 'appendSystemPrompt' in init['request'] and 'systemPrompt' not in init['request']
    send({'type':'control_response','response':{'subtype':'success','request_id':'initialize','response':{'models':[{'value':'claude-fable-5','supportedEffortLevels':['high']}]}}})
    user = receive()
    send({'type':'system','subtype':'init','model':'claude-fable-5','tools':['Read','Write','mcp__probe__write'],'mcp_servers':[{'name':'probe','status':'connected'}]})
    if not full:
        send({'type':'control_request','request_id':'permission-1','request':{'subtype':'can_use_tool','tool_name':'mcp__probe__write','input':{'text':'fixture change'}}})
        result = receive()
        assert result['response']['request_id'] == 'permission-1'
        allowed = result['response']['response']['behavior'] == 'allow'
    else:
        allowed = True
    if allowed:
        Path('action.txt').write_text('fixture change')
    send({'type':'result','subtype':'success','is_error':False,'modelUsage':{'claude-fable-5':{}},'result':'Allowed' if allowed else 'Declined'})
else:
    while True:
        request = receive()
        method = request.get('method')
        result = {}
        if method == 'initialized':
            continue
        if method == 'model/list':
            result = {'data':[{'model':'gpt-6-astra','supportedReasoningEfforts':[{'reasoningEffort':'medium'}]}]}
        if method == 'config/read':
            result = {'config': {'mcp_servers': {'probe': {'command':'python3'}}}}
        if method == 'thread/start':
            assert request['params']['baseInstructions'] is None
            full = request['params']['sandbox'] == 'danger-full-access'
            assert request['params']['config']['mcp_servers']['probe']['default_tools_approval_mode'] == ('approve' if full else 'prompt')
            result = {'thread':{'id':'thread'},'model':'gpt-6-astra'}
        if method == 'turn/start':
            # Exercise an approval arriving BEFORE turn/start's response.
            if not full:
                send({'method':'item/commandExecution/requestApproval','id':'permission-1','params':{'threadId':'thread','turnId':'turn','itemId':'command','command':'write fixture','cwd':os.getcwd()}})
                reply = receive()
                assert reply['id'] == 'permission-1'
                allowed = reply['result']['decision'] == 'accept'
            else:
                allowed = True
            if allowed:
                Path('action.txt').write_text('fixture change')
            send({'id':request['id'],'result':{}})
            send({'method':'item/agentMessage/delta','params':{'delta':'Allowed' if allowed else 'Declined'}})
            send({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
            break
        send({'id':request['id'],'result':result})
