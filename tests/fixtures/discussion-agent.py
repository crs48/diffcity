#!/usr/bin/python3
"""Offline Claude/Codex protocol peer; capture exactly what Service sends."""
import json
import sys
from pathlib import Path

capture = Path(sys.argv[0]).with_suffix(".jsonl")


def send(value):
    print(json.dumps(value), flush=True)


for line in sys.stdin:
    request = json.loads(line)
    with capture.open("a") as log:
        log.write(json.dumps(request) + "\n")
    if request.get("type") == "control_request":
        send({"type": "control_response", "response": {
            "request_id": request["request_id"], "subtype": "success",
            "response": {"models": [{"value": "claude-fable-5", "displayName": "Fable 5", "supportedEffortLevels": ["high"]}]}}})
    elif request.get("type") == "user":
        send({"type": "system", "subtype": "init", "model": "claude-fable-5", "tools": [], "mcp_servers": []})
        send({"type": "result", "is_error": False, "subtype": "success", "result": "Fixture answer", "modelUsage": {"claude-fable-5": {}}})
    elif "id" in request:
        method, params = request["method"], request.get("params", {})
        result = {}
        if method == "model/list":
            result = {"data": [{"model": "gpt-6-astra", "displayName": "GPT-6 Astra", "defaultReasoningEffort": "medium",
                               "supportedReasoningEfforts": [{"reasoningEffort": "medium", "description": "Medium"}]}], "nextCursor": None}
        elif method == "config/read":
            result = {"config": {}}
        elif method == "thread/start":
            result = {"thread": {"id": "fixture-thread"}, "model": params["model"]}
        send({"id": request["id"], "result": result})
        if method == "turn/start":
            send({"method": "item/completed", "params": {"item": {"type": "agentMessage", "text": "Fixture answer"}}})
            send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
