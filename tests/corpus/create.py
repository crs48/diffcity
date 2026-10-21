#!/usr/bin/env python3
"""Build local, deliberately unmergeable review fixtures without touching the checkout.

Usage: python3 tests/corpus/create.py --base HEAD --prefix fixtures/2026-10
No network calls, checkouts, pushes, or PR creation. Existing refs are never replaced.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def git(*args, data=None, env=None):
    return subprocess.check_output(["git", *args], input=data, env=env).decode().strip()


def source(base, path):
    return git("show", f"{base}:{path}") + "\n"


def catalog(locale, count, changed=False):
    return json.dumps({
        f"review.section.{i:04}": (
            f"{locale}: Inspect change {i} for {{{{repository}}}} — revision {{{{revision}}}}"
            if changed else f"{locale}: Review item {i} in {{{{repository}}}}"
        ) for i in range(count)
    }, ensure_ascii=False, indent=2) + "\n"


def policies(module, count, changed=False):
    entries = ["// Synthetic review stress fixture. DO NOT MERGE.", "export const rules = ["]
    for i in range(count):
        entries.extend([
            f'  // Rule {module}.{i}: repository scope and expiry',
            "  {",
            f'    id: "{module}-{i}",',
            f'    tenantId: "tenant-{i % 19}",',
            f'    permission: "{"write" if changed else "read"}",',
            f'    expiresAfterSeconds: {0 if changed else 3600 + i},',
            "  },",
        ])
    return "\n".join([*entries, "] as const;", ""])


def commit(parent, changes, message):
    with tempfile.TemporaryDirectory(prefix="diffcity-corpus-") as directory:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(directory) / "index")}
        git("read-tree", parent, env=env)
        for path, entry in changes.items():
            if entry is None:
                git("update-index", "--force-remove", "--", path, env=env)
                continue
            mode, content = entry if isinstance(entry, tuple) else ("100644", entry)
            content = content.encode() if isinstance(content, str) else content
            blob = git("hash-object", "-w", "--stdin", data=content)
            git("update-index", "--add", "--cacheinfo", f"{mode},{blob},{path}", env=env)
        tree = git("write-tree", env=env)
        return git("commit-tree", tree, "-p", parent, data=message.encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="HEAD")
    parser.add_argument("--prefix", required=True)
    args = parser.parse_args()
    base = git("rev-parse", "--verify", f"{args.base}^{{commit}}")
    names = [f"{args.prefix}/{name}" for name in ["baseline", "mixed", "migration", "localization", "closed-history"]]
    for name in names:
        git("check-ref-format", f"refs/heads/{name}")
        if subprocess.run(["git", "show-ref", "--verify", "--quiet", f"refs/heads/{name}"]).returncode == 0:
            raise SystemExit(f"Ref already exists: {name}; use a new prefix")
    root = "tests/corpus/data"
    storage = "apps/desktop/src-tauri/src/storage.rs"
    guide = "apps/desktop/src/features/Guide.tsx"
    baseline_files = {
        **{f"{root}/auth/policies-{i}.ts": policies(i, 100) for i in range(6)},
        **{f"{root}/locales/{locale}.json": catalog(locale, 900) for locale in ["en", "es", "fr"]},
        f"{root}/legacy-storage.rs": source(base, storage),
        f"{root}/old-guide.tsx": source(base, guide),
        f"{root}/retired-cache.ts": policies("retired", 90),
        f"{root}/docs/rollout.md": "# Legacy rollout\n\n" + "\n".join(f"- Step {i}: retain the old cache." for i in range(250)) + "\n",
        f"{root}/scripts/inspect.sh": "#!/bin/sh\n# Fixture only\nprintf '%s\\n' 'Inspect the immutable snapshot'\n",
        f"{root}/newline.txt": "last line has no newline",
        f"{root}/windows.txt": "old heading\r\nunchanged body\r\n",
        f"{root}/assets/cache.bin": bytes(range(256)) * 16,
        f"{root}/generated/records.jsonl": "".join(json.dumps({"id": i, "cache": "legacy", "value": i}) + "\n" for i in range(3500)),
    }
    baseline = commit(base, baseline_files, "test(corpus): seed realistic large review baseline\n\n- Keep bulk fixtures off the implementation branch\n- Provide original content for deletion, rename, and replacement coverage\n")
    mixed_files = {
        **{f"{root}/auth/policies-{i}.ts": policies(i, 105, True) for i in range(6)},
        **{f"{root}/locales/{locale}.json": catalog(locale, 950, True) for locale in ["en", "es", "fr"]},
        f"{root}/legacy-storage.rs": None,
        f"{root}/persistence/store.rs": source(base, storage),
        f"{root}/old-guide.tsx": None,
        f"{root}/review/guide.tsx": source(base, guide).replace('setSplit(!split)', 'setSplit((previous) => !previous)'),
        f"{root}/retired-cache.ts": None,
        f"{root}/docs/rollout.md": "# Review workspace rollout\n\n" + "\n".join(f"- Step {i}: validate snapshot {i}, migrate notes, and verify restart." for i in range(300)) + "\n",
        f"{root}/scripts/inspect.sh": ("100755", baseline_files[f"{root}/scripts/inspect.sh"]),
        f"{root}/newline.txt": "new last line still has no newline",
        f"{root}/windows.txt": "new heading\r\nunchanged body\r\n",
        f"{root}/assets/cache.bin": bytes(reversed(range(256))) * 16,
        f"{root}/generated/records.jsonl": "".join(json.dumps({"id": i, "cache": "snapshot", "value": i * 2}) + "\n" for i in range(4000)),
        f"{root}/migrations/004_workspace_scope.sql": "-- Intentional fixture defects: required column without backfill; destructive cleanup.\nALTER TABLE documents ADD COLUMN workspace_id TEXT NOT NULL;\nDELETE FROM documents WHERE kind = 'note';\nCREATE INDEX documents_workspace ON documents(workspace_id);\n",
        f"{root}/api/openapi.yaml": "openapi: 3.1.0\ninfo:\n  title: Synthetic review API\n  version: 2.0.0\npaths:\n  /reviews/{id}:\n    delete:\n      summary: Delete a review without an ownership check\n      responses:\n        '204':\n          description: Deleted\n",
    }
    mixed = commit(baseline, mixed_files, "test(corpus): exercise thousands of mixed additions and deletions\n\n- Include access changes, destructive schema edits, locale contracts, and API changes\n- Cover rename-only and edited renames, deletion, binary files, CRLF, missing newline, and executable mode\n- Deliberate review defects; never merge this fixture\n")
    migration_path = "apps/desktop/src-tauri/migrations/004_workspace_scope.sql"
    migration_source = source(base, "apps/desktop/src-tauri/src/migrations.rs").replace(
        "];\npub const VERSION", '    Migration { name: "workspace_scope", sql: include_str!("../migrations/004_workspace_scope.sql") },\n];\npub const VERSION', 1)
    migration = commit(base, {
        migration_path: mixed_files[f"{root}/migrations/004_workspace_scope.sql"],
        "apps/desktop/src-tauri/src/migrations.rs": migration_source,
        storage: source(base, storage).replace('if version > 0 && version < crate::migrations::VERSION {', 'if version > 0 && version + 1 < crate::migrations::VERSION {'),
    }, "test(corpus): propose unsafe workspace migration\n\n- Introduce an unbackfilled required column and destructive private-note cleanup\n- Deliberately skip the backup on a one-version upgrade\n- Review fixture only; never merge\n")
    es_path = "apps/desktop/src/locales/es.json"
    es = json.loads(source(base, es_path))
    es.pop("Finish review", None)
    for key in list(es):
        if "{{count}}" in key:
            es[key] = es[key].replace("{{count}}", "{{total}}")
    localization = commit(base, {
        es_path: json.dumps(es, ensure_ascii=False, indent=2) + "\n",
        "apps/desktop/src/locales/fr.json": catalog("fr", 1000),
        "apps/desktop/src/locales/ar.json": catalog("ar العربية", 1000),
        "docs/localization-fixture.md": "# Test-only locale rollout\n\nThe new catalogs are intentionally unregistered. Spanish removes a caller's key and changes its count placeholder. Review contract changes before folding copy-only work.\n",
    }, "test(corpus): add locale volume and intentional translation regressions\n\n- Remove a required Spanish key and break plural interpolation\n- Add large French and Arabic catalogs for routine-folding and Unicode checks\n- Review fixture only; never merge\n")
    readme = source(base, "README.md")
    history = commit(base, {
        "README.md": readme.replace("diffcity", "Diff City", 4) + "\n## Historical review experiment\n\nClosed pull requests remain useful review material. This abandoned proposal is a history-view fixture and should not merge.\n",
        "docs/archive/review-experiment.md": "# Abandoned review experiment\n\n" + "\n".join(f"- Scenario {i}: inspect additions, removals, and saved private notes after closure." for i in range(80)) + "\n",
    }, "test(corpus): create abandoned proposal for closed PR history\n\n- Edit real README content and add an archived experiment\n- Close the PR without merging to exercise historical review\n")
    shas = [baseline, mixed, migration, localization, history]
    # Atomic ref creation: a concurrent creator cannot be overwritten.
    git("update-ref", "--stdin", data=("start\n" + "".join(f"create refs/heads/{name} {sha}\n" for name, sha in zip(names, shas)) + "prepare\ncommit\n").encode())
    print(json.dumps({"base": base, "branches": dict(zip(names, shas))}, indent=2))


if __name__ == "__main__":
    main()
