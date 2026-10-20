# 04 — Guided review, attention ordering, and Codex discussion

## Objective and dependencies

Make Guide the best way to review a PR: consequential changes first, coherent explanations beside actual code, routine changes summarized and folded, and all review actions available in place. Review with Codex requests both a code review and a guided walkthrough. Depends on canonical snapshot/anchor contracts from step 03 and the verified runtime from step 01. This is the primary product-quality milestone; pass it before optional inbox polish. The [guided review specification](guided-review.md) is the source of truth for interaction and ranking rules.

## Proposed touchpoints

Rust modules under `apps/desktop/src-tauri/src/{codex,contracts,domain}`, generated walkthrough types/schemas in `packages/contracts`, Rust context builders, and React features under `apps/desktop/src/features` for walkthroughs, discussion, and run activity.

## Implementation

Complete the Rust app-server adapter behind typed Tauri commands and events: account readiness, model selection from available capabilities, thread creation/resume, streamed turn lifecycle, cancellation, and crash recovery. Follow the [official app-server protocol](https://learn.chatgpt.com/docs/app-server); generated bindings and a pinned compatibility test keep provider details out of UI components. Rust owns the subprocess and forwards bounded, normalized events to the webview.

Build bounded context from immutable content. Include PR intent, hunk IDs, code excerpts, relevant tests, deterministic attention signals, and clear unavailable-content markers. Use staged analysis:

1. Inventory every change and identify provisional signals such as migrations, authorization changes, public contracts, generated artifacts, and translation keys. Category hints alone do not establish impact.
2. Analyze bounded, related clusters for purpose, consequences, dependencies, test evidence, uncertainty, and possible defects. Assess routine-looking changes too; omitted or budget-exhausted work remains unassessed.
3. Propose coherent sections across files. Attach tests and supporting context to the behavior they validate; avoid a long file-order prelude before the important change.
4. Validate evidence and coverage in Rust, apply minimum attention rules, then order sections and calculate fold eligibility. Separate finding severity from attention required to review a change.

The orchestrator controls budgets and context; it does not allow the model to fetch arbitrary private data or run repository instructions. A migration can receive High attention without a bug finding. A dependency change, translation placeholder change, or API-contract change can elevate a group that its filename would otherwise make look routine.

Define separate structured model proposals and validated guide contracts in Rust, then export schemas and TypeScript views. The final UI shape should resemble the following; ordering, effective attention, and fold eligibility are derived by Rust rather than trusted directly from model output:

```ts
type Attention = "high" | "standard" | "routine";

type HunkAssessment = Readonly<{
  hunkId: string;
  categories: readonly ChangeCategory[];
  signals: readonly AttentionSignal[]; // evidence and rule/model provenance
}> & (
  | Readonly<{ status: "assessed"; attention: Attention; rationale: string }>
  | Readonly<{ status: "unassessed" | "unavailable"; reason: string }>
);

type WalkthroughSection = Readonly<{
  id: string;
  title: string;
  purpose: string;
  primaryHunkIds: readonly string[];
  relatedHunkIds: readonly string[];
  prerequisiteSectionIds: readonly string[];
  attention: Attention | "needs-assessment";
  attentionReason: string;
  findingIds: readonly string[]; // finding severity lives on the finding
  automaticFold: "eligible" | "ineligible";
  foldReason: string;
  reviewQuestions: readonly string[];
  evidence: readonly EvidenceReference[];
  testNotes: readonly TestObservation[];
}>;

type Walkthrough = Readonly<{
  schemaVersion: number;
  policyVersion: number;
  snapshotId: string;
  summary: string;
  assessments: readonly HunkAssessment[];
  findings: readonly Finding[];
  sections: readonly WalkthroughSection[];
  coverage: AnalysisCoverage;
  limitations: readonly string[];
}>;
```

Rust domain validation checks snapshot identity, allowed files, real ranges, nonempty section references, duplicate primary membership, omitted hunks, and valid dependency references before persistence or UI delivery. Reject cycles and fall back to explicit unassessed sections rather than generating a broken route. Add unassessed/unavailable entries deterministically. Invalid citations cannot be made clickable. Distinguish observed code, inferred intent, suggested risk, and unknown behavior. Never report tests passed unless their actual result is present and current.

Apply the guide policy as pure transformations: preserve deterministic priority floors; take a group's highest constituent attention; split exceptional hunks out of routine groups where possible; put high and unassessed work before standard/routine work; use stable tie-breaks. Permit only short, explained prerequisites before high-attention code. Assess all auto-fold conditions, including active findings, unresolved discussion, drafts, and selection. A routine-only PR still opens its primary step expanded. Keep explicit reviewer overrides separate from the original assessment.

Store prompt/schema/policy versions, model/runtime identity, input hash, and coverage with each run. Assessment caching and derived-guide caching follow the separate keys in [architecture.md](architecture.md). Save completed validated sections, with partial status for interrupted runs. Do not stream arbitrary JSON fragments into trusted UI state. Use ordinary progress messages until a section is valid. Show new attention promptly without reordering the active reading step; apply a revised route at the next navigation boundary.

The guide supports next/previous, a section index, attention rationale, inline diffs, evidence expansion, line comments, local conversations, selected GitHub drafts, and the finish-review entry point. Files is available for exploration, but none of those tasks requires switching to it. Use quiet category/attention badges and specific callouts such as a migration's backfill or rollback concern; avoid generic alarming toasts.

Persist explicit code-reviewed, summary-acknowledged, and deferred actions independently of generation output and presentation. A section may combine multiple files; repeated cross-references do not count twice toward coverage. Folded summaries show content counts and allow sampling or expansion; opening a sample cannot mark the whole group reviewed. Pinning, reordering, expanding, and changing attention are reversible reviewer choices with visible provenance.

Add Ask Codex for a selected range, a local thread, or a user-selected set of notes. Show the attached context scope and stream the reply in that local thread. Do not send unrelated private notes. Allow explicit conversion of selected text into a GitHub draft for step 05. A new PR revision does not mutate an active discussion's context.

## Validation and edge cases

Use mocked protocol transcripts for event ordering, reconnect, cancellation, malformed output, missing model, and authentication expiry. Run a small live smoke test to verify the adapter against the supported runtime.

Create the minimum 12-PR synthetic evaluation corpus in [guided-review.md](guided-review.md), including high-impact changes buried among routine files, migration/auth changes, localization/API exceptions, generated/dependency changes, partial input, and new revisions. Structural gates require complete inventory accounting, valid citations, no automatic hiding of seeded high-attention changes, and explicit uncertainty. The most consequential seeded change must appear within the first three substantive steps, with any necessary prerequisite explained. Human review assesses whether the ordering and explanation actually improve comprehension.

Run paired, counterbalanced reviews against raw file order and simple topic order. Record time to the important concern, planted-issue detection, comprehension, Files detours, overrides, and misleading summaries. Do not claim superiority from a screenshot or structural validation alone. Keep failures as regression fixtures. Confirm all ordinary review actions work within Guide and provider failure leaves a usable provisional guide.

## Checklist and exit criteria

- [ ] Complete lifecycle and runtime compatibility handling.
- [x] Enforce restricted context/tool access and data-flow disclosure.
- [x] Implement structured generation, validation, caching, and partial results.
- [x] Implement evidence-backed assessments, priority floors, coherent grouping, and stable ordering.
- [ ] Implement conservative automatic folding, exception extraction, and explicit overrides.
- [x] Render the primary Guide with inline code, attention callouts, and distinct progress states.
- [x] Add line-scoped and selected-note conversations.
- [x] Keep active reading stable during streaming, regrouping, and pending updates.
- [ ] Add cancellation, retry, budget, and unavailable-provider states.
- [ ] Pass the curated corpus gates and record baseline comparisons and failure cases.

**Exit:** a reviewer enters Guide, encounters the consequential code early with a clear reason, reads/tests their understanding, asks a line-scoped question, prepares feedback, and resumes later without a forced Files detour. Routine folds remain inspectable; every changed hunk is accounted for; the evaluation corpus catches hidden consequential changes. Final GitHub submission is completed in step 05.
