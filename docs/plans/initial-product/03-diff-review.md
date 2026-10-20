# 03 — Revision snapshots, diff reading, and notes

## Objective and dependencies

Provide trustworthy source positions, durable annotations, and reusable diff components inside the primary Guide and the alternate Files view. Depends on the GitHub metadata and storage from steps 01–02. The guide works provisionally without AI; step 04 adds semantic assessment and ordering.

## Proposed touchpoints

Rust modules under `apps/desktop/src-tauri/src/{diff,domain,storage}`, generated types in `packages/contracts`, and React features under `apps/desktop/src/features` for Guide, PR overview, files, diffs, and local threads. Rust owns canonical snapshots/anchors; the webview renders their typed projections.

## Implementation

Construct a revision snapshot from base/head identity, paginated file records, canonical patches, and required immutable content. Fetch metadata again after collection to reject mixed revisions. Preserve base tip separately from merge base; use the actual PR comparison semantics. Never derive the review from whichever branch happens to be checked out locally.

Basic browsing should use GitHub data without a clone. When complete source or missing patches are required, use a bounded, app-managed bare Git cache after validating repository and commit identities. Read blobs without running hooks, filters, submodules, or repository programs. Do not alter an existing checkout, stash, or index. If the source cannot be retrieved safely, show an incomplete snapshot.

Parse changes into typed files, hunks, and old/new line positions. Give every hunk a snapshot-scoped ID and content fingerprint. Keep line mappings independent of unified/split mode, syntax highlighting, wrapping, and collapsed context. A rename records both names; a deleted file still has a readable old side.

Build one canonical diff surface used inside guide steps and Files, with split/unified mode, context expansion, and line/range selection. Guide can place related hunks from multiple files together without losing paths or source coordinates. Add a full file tree/search as an alternate view and an overview for metadata. Support inline private notes and local discussion histories directly in Guide. Every new note carries the immutable anchor and a saved context excerpt so it remains intelligible if the source is later unavailable.

Use deterministic signals for the provisional guide, with high-attention signals called out and remaining content marked Needs assessment. Do not pretend a file-category heuristic is completed AI review. Fixture-driven semantic groups can exercise the intended UI before step 04. Store explicit code-reviewed, summary-acknowledged, and deferred actions independently of presentation and reading position. Never mark a hunk reviewed merely because its group was folded or scrolled past.

Represent binaries, generated files, lockfiles, submodules, LFS pointers, oversized patches, and unavailable content explicitly. Apply the [guide folding rules](guided-review.md): unassessed/unavailable content stays visible and expanded, while supported content is an automatic fold candidate only after routine assessment. Manual collapse remains available with status badges. Searching, following a comment, or selecting an anchor expands its enclosing group. Highlight partial capture and keep coverage separate from UI visibility.

Autosave note edits with a bounded debounce and flush on composer close, PR switch, and app shutdown. Store drafts before starting an external operation. Restore scroll and selected section/file per PR without confusing them with reviewed progress.

## Validation and edge cases

Create synthetic fixtures with additions, deletions, renames, mixed old/new sides, blank lines, CRLF, Unicode paths, unusual filename quoting, no final newline, multiple hunks, and large unchanged gaps. Verify round-trip line selection → stored anchor → diff rendering in both Guide and Files. Validate raw source positions after changing display options, reordering sections, expanding a group, and rendering a secondary cross-reference.

Use a fixture larger than one file-list page and an incomplete response to confirm coverage detection. Test repeated head changes during capture, missing fork content, binary-only PRs, and cancellation. A snapshot must be internally consistent or explicitly incomplete.

## Checklist and exit criteria

- [ ] Implement stable snapshot capture with race detection.
- [ ] Parse canonical hunks and source coordinates.
- [ ] Share canonical diff components between Guide and Files, with navigation and distinct progress states.
- [ ] Add provisional attention signals and explicit unassessed groups.
- [ ] Save and restore line/range notes and reading state.
- [ ] Surface large/unavailable/generated content accurately.
- [ ] Add safe immutable-object fallback where necessary.
- [ ] Benchmark normal and stress fixtures from the product spec.

**Exit:** read a real PR in the provisional Guide, save notes on both an addition and a deletion without leaving it, restart, and recover the same anchors and text. Confirm Files displays those same notes at the same source positions without changing a working checkout.
