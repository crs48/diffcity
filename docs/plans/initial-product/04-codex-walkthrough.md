# 04 — Codex walkthroughs and contextual discussion

## Objective and dependencies

Transform a stable PR snapshot into a useful narrative and answer questions about selected code. Depends on canonical snapshot/anchor contracts from step 03 and the verified runtime from step 01.

## Proposed touchpoints

Rust modules under `apps/desktop/src-tauri/src/{codex,contracts,domain}`, generated walkthrough types/schemas in `packages/contracts`, Rust context builders, and React features under `apps/desktop/src/features` for walkthroughs, discussion, and run activity.

## Implementation

Complete the Rust app-server adapter behind typed Tauri commands and events: account readiness, model selection from available capabilities, thread creation/resume, streamed turn lifecycle, cancellation, and crash recovery. Follow the [official app-server protocol](https://learn.chatgpt.com/docs/app-server); generated bindings and a pinned compatibility test keep provider details out of UI components. Rust owns the subprocess and forwards bounded, normalized events to the webview.

Build bounded context from immutable content. Include PR intent, hunk IDs, code excerpts, relevant tests, and clear unavailable-content markers. Large PRs use staged analysis: produce a file inventory, analyze bounded clusters, then synthesize an ordered walkthrough. The orchestrator controls budgets and context; it does not allow the model to fetch arbitrary private data or run repository instructions.

Define a structured walkthrough result in the Rust contract module and export its schema and TypeScript view. The generated UI shape should resemble:

```ts
type WalkthroughSection = Readonly<{
  id: string;
  title: string;
  purpose: string;
  primaryHunkIds: readonly string[];
  relatedHunkIds: readonly string[];
  reviewQuestions: readonly string[];
  evidence: readonly EvidenceReference[];
  testNotes: readonly TestObservation[];
}>;

type Walkthrough = Readonly<{
  schemaVersion: number;
  snapshotId: string;
  summary: string;
  sections: readonly WalkthroughSection[];
  limitations: readonly string[];
}>;
```

Rust domain validation checks snapshot identity, allowed files, real ranges, nonempty section references, duplicate primary membership, and omitted hunks before persistence or UI delivery. Add ungrouped/unavailable buckets deterministically. Invalid citations cannot be made clickable. Distinguish observed code, inferred intent, suggested risk, and unknown behavior. Never report tests passed unless their actual result is present and current.

Store prompts/schema versions, model/runtime identity, input hash, and coverage with each run. The deterministic cache key includes all those inputs. Save completed validated sections, with partial status for interrupted runs. Do not stream arbitrary JSON fragments into trusted UI state. Use ordinary progress messages until a section is valid.

The walkthrough screen supports next/previous, section index, evidence expansion, and manual viewed state. User progress persists separately from the generation output. A section may combine multiple files; repeated cross-references do not count twice toward coverage.

Add Ask Codex for a selected range, a local thread, or a user-selected set of notes. Show the attached context scope and stream the reply in that local thread. Do not send unrelated private notes. Allow explicit conversion of selected text into a GitHub draft for step 05. A new PR revision does not mutate an active discussion's context.

## Validation and edge cases

Use mocked protocol transcripts for event ordering, reconnect, cancellation, malformed output, missing model, and authentication expiry. Run a small live smoke test to verify the adapter against the supported runtime.

Create a curated synthetic PR evaluation set: a coherent feature, mixed unrelated changes, tests-only, rename-only, huge generated files, incomplete context, and adversarial instructions in PR text. Evaluate grounded citations, coverage, useful order, explicit uncertainty, and no unauthorized tools/writes. Human judgment assesses usefulness; structural tests assess reference correctness.

## Checklist and exit criteria

- [ ] Complete lifecycle and runtime compatibility handling.
- [ ] Enforce restricted context/tool access and data-flow disclosure.
- [ ] Implement structured generation, validation, caching, and partial results.
- [ ] Render topic sections with code evidence and user progress.
- [ ] Add line-scoped and selected-note conversations.
- [ ] Add cancellation, retry, budget, and unavailable-provider states.
- [ ] Evaluate the curated PR set and record failure cases.

**Exit:** a reviewer can explain a real PR through its walkthrough, inspect every cited range, ask a follow-up question, and resume later. Every changed hunk is accounted for, including unsupported content.
