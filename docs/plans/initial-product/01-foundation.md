# 01 — Foundation and feasibility

## Objective and dependencies

Establish a small desktop foundation and prove the two external integrations before committing to the full UI. Read the [product spec](product-spec.md) and [architecture](architecture.md). No application code exists yet.

## Proposed touchpoints

`apps/desktop/src/{main,preload,renderer}`, `packages/{domain,contracts,storage,codex}`, workspace manifests, and `.github/workflows/ci.yml`.

## Implementation

Start with Electron, React, TypeScript, and Vite in a pnpm workspace. Pin compatible stable versions at implementation time. Use functional components, pure domain transformations, and small adapters for IO. Do not scaffold future website or cloud packages until needed.

Build a shell with project rail, inbox pane, review workspace, and optional discussion drawer using synthetic fixtures. Add keyboard navigation, pane resizing, and light/dark tokens. Keep visual polish modest until the diff renderer is proven.

Add SQLite migrations and repositories for accounts, projects, PRs, snapshots, notes, and operations. Demonstrate a draft surviving both a normal restart and a forced process exit. Store runtime data outside the checkout. Define an IPC schema, validate requests/responses, and expose named actions rather than arbitrary filesystem/process access.

Run a packaged macOS spike with three checks:

1. Authenticate to GitHub through the existing CLI session and fetch metadata plus a diff for a chosen PR.
2. Locate a verified OpenAI Codex runtime, complete its supported app-server initialization, start a harmless supplied-context turn, stream an answer, cancel a second turn, and reconnect.
3. Render a large synthetic diff using a candidate existing component and map clicks back to canonical old/new lines.

Evaluate `@pierre/diffs` as a renderer candidate against its [upstream source and releases](https://github.com/pierrecomputer/pierre). Verify the exact package license, annotation support, deletion/range selection, virtualization, keyboard access, and custom styling before adoption. Do not select it solely from a demo. A thin custom renderer over the same canonical diff model is the fallback; avoid turning this into an editor project.

Record idle memory, startup time, packaged size, and large-diff interaction results. Confirm Electron if acceptable; otherwise compare Tauri against the same fixture before more product code accumulates. The architecture's domain contracts should survive this choice.

The local `codex` executable discovered during planning is not a validated runtime. Do not install over or alter it implicitly. Version/capability checks, a configurable explicit executable path, and actionable setup errors belong in the spike.

## Validation and edge cases

Use focused pure-domain tests, a real SQLite restart test, and one packaged-app smoke test. Assert the renderer cannot access credentials or arbitrary IPC methods. Exercise unavailable GitHub auth, missing Codex, malformed RPC, cancelled subprocess, and invalid model output. A dev-mode browser run alone is insufficient evidence for a desktop release.

## Checklist and exit criteria

- [ ] Scaffold strict workspace, formatting, linting, typechecking, and test commands.
- [ ] Implement minimal window/preload boundaries and sample navigation.
- [ ] Add migrations and durable note recovery.
- [ ] Prove GitHub access and Codex handshake in a packaged app.
- [ ] Validate a diff rendering component against canonical line maps.
- [ ] Record shell decision and runtime compatibility assumptions.
- [ ] Add CI for typecheck, focused tests, and unsigned build.

**Exit:** launch the packaged app, restore a saved sample note, fetch one real PR, and display a streamed Codex answer. No GitHub writes or application launch to the public are required here.
