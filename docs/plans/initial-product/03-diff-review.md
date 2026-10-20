# 03 — Revision snapshots, diff reading, and notes

## Objective and dependencies

Provide a useful non-AI review surface with trustworthy source positions and durable annotations. Depends on the GitHub metadata and storage from steps 01–02.

## Proposed touchpoints

`packages/diff`, `packages/domain/{snapshots,anchors,progress}`, `packages/storage`, and renderer features for PR overview, files, diffs, and local threads.

## Implementation

Construct a revision snapshot from base/head identity, paginated file records, canonical patches, and required immutable content. Fetch metadata again after collection to reject mixed revisions. Preserve base tip separately from merge base; use the actual PR comparison semantics. Never derive the review from whichever branch happens to be checked out locally.

Basic browsing should use GitHub data without a clone. When complete source or missing patches are required, use a bounded, app-managed bare Git cache after validating repository and commit identities. Read blobs without running hooks, filters, submodules, or repository programs. Do not alter an existing checkout, stash, or index. If the source cannot be retrieved safely, show an incomplete snapshot.

Parse changes into typed files, hunks, and old/new line positions. Give every hunk a snapshot-scoped ID and content fingerprint. Keep line mappings independent of unified/split mode, syntax highlighting, wrapping, and collapsed context. A rename records both names; a deleted file still has a readable old side.

Build the overview, full file tree, split/unified diff toggle, file search, context expansion, viewed controls, and line/range selection. Support private notes and local discussion histories. Every new note carries the immutable anchor and a saved context excerpt so it remains intelligible if the source is later unavailable.

Represent binaries, generated files, lockfiles, submodules, LFS pointers, oversized patches, and unavailable content explicitly. Collapsing generated content is presentation, not evidence of review. Highlight partial capture and keep coverage separate from UI visibility.

Autosave note edits with a bounded debounce and flush on composer close, PR switch, and app shutdown. Store drafts before starting an external operation. Restore scroll and selected section/file per PR without confusing them with reviewed progress.

## Validation and edge cases

Create synthetic fixtures with additions, deletions, renames, mixed old/new sides, blank lines, CRLF, Unicode paths, unusual filename quoting, no final newline, multiple hunks, and large unchanged gaps. Verify round-trip line selection → stored anchor → diff rendering. Validate raw source positions after changing display options.

Use a fixture larger than one file-list page and an incomplete response to confirm coverage detection. Test repeated head changes during capture, missing fork content, binary-only PRs, and cancellation. A snapshot must be internally consistent or explicitly incomplete.

## Checklist and exit criteria

- [ ] Implement stable snapshot capture with race detection.
- [ ] Parse canonical hunks and source coordinates.
- [ ] Add file tree, diff modes, navigation, and progress.
- [ ] Save and restore line/range notes and reading state.
- [ ] Surface large/unavailable/generated content accurately.
- [ ] Add safe immutable-object fallback where necessary.
- [ ] Benchmark normal and stress fixtures from the product spec.

**Exit:** review a real PR entirely in Files, save notes on both an addition and a deletion, restart, and recover the same anchors and text without changing a working checkout.
