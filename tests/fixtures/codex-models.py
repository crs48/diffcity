#!/usr/bin/python3
"""Offline protocol fixture: model pagination and actual turn parameter capture."""
import json
import sys

if "--version" in sys.argv:
    print("codex-cli fixture")
    sys.exit(0)


def send(value):
    print(json.dumps(value), flush=True)


for line in sys.stdin:
    request = json.loads(line)
    with open("requests.jsonl", "a") as log:
        log.write(json.dumps(request) + "\n")
    if "id" not in request:
        continue
    method, params = request["method"], request.get("params", {})
    result = {}
    if method == "account/read":
        result = {"account": {"email": "fixture"}}
    elif method == "model/list":
        later = params.get("cursor") == "next"
        model = "gpt-6-luna" if later else "gpt-6-astra"
        efforts = ["low", "medium"] if later else ["medium", "xhigh"]
        result = {
            "data": [{"model": model, "displayName": model, "defaultReasoningEffort": "medium",
                      "supportedReasoningEfforts": [{"reasoningEffort": e, "description": e} for e in efforts]}],
            "nextCursor": None if later else "next",
        }
    elif method == "config/read":
        result = {"config": {}}
    elif method == "thread/start":
        result = {"thread": {"id": "fixture-thread"}, "model": params["model"]}
    send({"id": request["id"], "result": result})
    if method == "turn/start":
        send({"method": "item/completed", "params": {"item": {"type": "agentMessage", "text": "Fixture answer"}}})
        send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
