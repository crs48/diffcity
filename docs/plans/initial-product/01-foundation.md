# 01 — Foundation and feasibility

## Objective and dependencies

Establish a small desktop foundation, prove the two external integrations, and make the primary guided flow tangible with fixtures. Read the [product spec](product-spec.md), [guided review design](guided-review.md), and [architecture](architecture.md). No application code exists yet.

## Proposed touchpoints

`apps/desktop/src/{app,features,lib}`, `apps/desktop/src-tauri/src/{commands,domain,contracts,storage,codex}`, Tauri capabilities/permissions/configuration, `packages/contracts`, Cargo/pnpm workspace manifests, and `.github/workflows/ci.yml`.

## Implementation

Start with Tauri 2, a React/TypeScript/Vite UI in a pnpm workspace, and a Rust core in a Cargo workspace. This stack is selected by the user. Pin compatible stable versions and the Rust toolchain at implementation time; commit both lockfiles. Use functional components, pure Rust domain transformations, and small adapters for IO. Do not scaffold future website or cloud packages until needed.

Build a shell with project rail, inbox pane, Guide as the default review workspace, and optional discussion drawer using synthetic fixtures. The first fixture places a migration and its attention callout first, shows related implementation/tests together, and folds routine documentation/localization into expandable summaries. Include next/previous steps, section index, inline note selection, and separate code-reviewed/summary-acknowledged controls. Fixture assessments are explicitly illustrative; live AI classification arrives in step 04. Add keyboard navigation, pane resizing, and light/dark tokens. Defer inbox polish while validating the guide interaction.

Add Rust-owned SQLite migrations and repositories for accounts, projects, PRs, snapshots, notes, and operations. Demonstrate a draft surviving both a normal restart and a forced process exit. Store runtime data outside the checkout. Define serializable Rust contracts and generate TypeScript types/JSON schemas; validate requests/responses and expose named Tauri commands with scoped capabilities and explicit custom-command permissions. Database, filesystem, credentials, and subprocess handles remain in Rust.

Run a packaged macOS spike with three checks:

1. Authenticate to GitHub through the existing CLI session and fetch metadata plus a diff for a chosen PR.
2. Locate a verified OpenAI Codex runtime, manage its stdio protocol from Rust, complete initialization, start a harmless supplied-context turn, stream an answer to the webview, cancel a second turn, and reconnect.
3. Render the fixture guide and a large synthetic diff in macOS WKWebView using a candidate existing component. Map inline selections back to Rust-owned canonical old/new lines, including after expanding a folded group or moving between steps.

Evaluate `@pierre/diffs` as a renderer candidate against its [upstream source and releases](https://github.com/pierrecomputer/pierre). Verify the exact package license, annotation support, deletion/range selection, virtualization, keyboard access, and custom styling before adoption. Do not select it solely from a demo. A thin custom renderer over the same canonical diff model is the fallback; avoid turning this into an editor project.

Record idle memory, startup time, packaged size, and large-diff interaction results on the intended minimum and current supported macOS versions. Validate selection, scrolling, virtualization, and highlighting in the packaged WKWebView. Tauri is the implementation choice; this spike validates and tunes that implementation.

The local `codex` executable discovered during planning is not a validated runtime. Do not install over or alter it implicitly. Version/capability checks, a configurable explicit executable path, and actionable setup errors belong in the spike.

## Validation and edge cases

Use Rust domain/integration tests, frontend component tests, generated-contract checks, a real SQLite restart test, and a packaged-app smoke test. Assert the webview cannot access credentials or arbitrary IPC methods. Exercise unavailable GitHub auth, missing Codex, malformed RPC, cancelled subprocess, and invalid model output. A dev-mode browser run alone is insufficient evidence for a desktop release.

Evaluate WebdriverIO's Tauri service with its embedded driver for macOS app automation, as described in [Tauri's testing guidance](https://v2.tauri.app/develop/tests/webdriver/). Keep driver/backend-access plugins behind a test-only build feature and verify their absence from distribution builds. Supplement automation with native keyboard/accessibility and minimum-OS checks. If the harness is not working yet, record a manual packaged-app smoke test instead of treating a mocked browser test as desktop coverage.

## Checklist and exit criteria

- [x] Scaffold strict workspace, formatting, linting, typechecking, and test commands.
- [x] Select Tauri 2 with a React/TypeScript UI and Rust core.
- [x] Implement minimal Tauri command/event boundaries, capabilities, and sample navigation.
- [x] Demonstrate a migration-first fixture guide with routine folds, inline notes, and explicit progress actions.
- [x] Generate wire types and validate Rust/TypeScript contract compatibility.
- [x] Add migrations and durable note recovery.
- [x] Prove GitHub access and Codex handshake in a packaged app.
- [x] Validate a diff rendering component against canonical line maps.
- [ ] Record WebKit benchmarks and supported Codex/runtime compatibility assumptions.
- [x] Add CI for TypeScript checks, Rust formatting/linting/tests, contract generation, and an unsigned Tauri build.

**Exit:** launch the packaged app, navigate the fixture guide from migration to folded routine changes, restore a saved inline note, fetch one real PR, and display a streamed Codex answer. No GitHub writes or application launch to the public are required here.
