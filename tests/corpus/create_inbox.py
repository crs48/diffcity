#!/usr/bin/env python3
"""Create nine local inbox UX fixture branches without changing the checkout.

Push and open PRs separately. All fixture changes are isolated under tests/corpus/inbox.
"""
import argparse
import json
import subprocess
from create import commit, git

SCENARIOS = [
    ("keyboard-navigation", "Keep keyboard focus on the active guide step", False, False,
     "navigation.ts", "export const nextStep = (index: number, count: number) => Math.min(index + 1, count - 1);\nexport const previousStep = (index: number) => Math.max(0, index - 1);\n"),
    ("notification-batching", "Batch updates to the PR inbox", False, False,
     "notifications.ts", "export const batchUpdates = <T extends { id: string }>(updates: T[]) =>\n  [...new Map(updates.map(update => [update.id, update])).values()];\n"),
    ("schema-backfill", "Backfill review ownership before adding an index", False, False,
     "006_review_owner.sql", "ALTER TABLE documents ADD COLUMN owner_login TEXT;\nUPDATE documents SET owner_login = 'fixture-owner' WHERE owner_login IS NULL;\nCREATE INDEX documents_owner ON documents(owner_login);\n"),
    ("api-pagination", "Describe paginated review history in the API", False, False,
     "api.yaml", "openapi: 3.1.0\ninfo:\n  title: Inbox history fixture\n  version: 0.0.0\npaths:\n  /reviews:\n    get:\n      responses:\n        '200':\n          description: A page of historical reviews\n"),
    ("compact-layout", "Explore a compact pull request list", True, False,
     "density.css", ".inbox-compact { --row-gap: 4px; --row-padding: 8px; }\n.inbox-comfortable { --row-gap: 8px; --row-padding: 14px; }\n"),
    ("french-catalog", "Start a French catalog for inbox states", True, False,
     "locales/fr.json", json.dumps({"Inbox":"Boîte de réception","Drafts":"Brouillons","Needs your review":"À examiner","Recently completed":"Terminées récemment"}, ensure_ascii=False, indent=2)+"\n"),
    ("incremental-cache", "Prototype review cache invalidation", True, False,
     "cache.ts", "export const cacheKey = (repo: string, number: number, head: string) =>\n  `${repo}#${number}@${head}`;\nexport const changedRevision = (before: string, after: string) => before !== after;\n"),
    ("abandoned-grouping", "Retire an experiment grouping PRs by branch", False, True,
     "proposal.md", "# Branch-based grouping experiment\n\nThis synthetic proposal is intentionally closed without merging.\n\nPriority by ownership and review request is easier to scan than branch prefixes.\n"),
    ("abandoned-alerts", "Close an experiment with per-file desktop alerts", True, True,
     "proposal.md", "# Per-file notification experiment\n\nThis synthetic draft is intentionally closed without merging.\n\nPrefer one summarized update per pull request to a notification for each file.\n"),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="HEAD")
    parser.add_argument("--prefix", required=True)
    args = parser.parse_args()
    base = git("rev-parse", "--verify", f"{args.base}^{{commit}}")
    for slug, *_ in SCENARIOS:
        ref = f"refs/heads/{args.prefix}/{slug}"
        git("check-ref-format", ref)
        if subprocess.run(["git", "show-ref", "--verify", "--quiet", ref]).returncode == 0:
            raise SystemExit(f"Ref already exists: {ref}; choose a new prefix")
    entries = []
    for slug, title, draft, close, filename, code in SCENARIOS:
        root = f"tests/corpus/inbox/{slug}"
        sha = commit(base, {
            f"{root}/{filename}": code,
            f"{root}/README.md": f"# Inbox UX fixture: {title}\n\nTEST ONLY — DO NOT MERGE.\n\nThis isolated proposal exercises {'draft' if draft else 'ready'} owned PRs{' and recent completion' if close else ''}.\nThe implementation is illustrative and is not production code.\n",
        }, f"test(inbox): add {slug} proposal\n\n- Exercise an owned {'draft' if draft else 'ready'} pull request in Diffcity.\n- Keep illustrative changes isolated from application code.\n")
        entries.append({"head":f"{args.prefix}/{slug}", "sha":sha, "title":title, "draft":draft, "close":close})
    transaction = "start\n" + "".join(f"create refs/heads/{e['head']} {e['sha']}\n" for e in entries) + "prepare\ncommit\n"
    git("update-ref", "--stdin", data=transaction.encode())
    print(json.dumps(entries, indent=2))

if __name__ == "__main__":
    main()
