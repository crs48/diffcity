import { expect, it } from "vitest";
import { mergeEnrichment, enrichmentRemaining } from "./enrichment";
import type { Guide, GuideAnnotation } from "./api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

it("applies notes only to their guide and revision, preserving chapter objects and existing notes", () => {
  const guide = { ...structuredClone(fixture.guide), id: "guide" } as Guide;
  const note: GuideAnnotation = {
    id: "note",
    title: "Check scope",
    body: "Check this invariant.",
    details: "- More detail",
    anchor: {
      hunkId: guide.sections[0].hunkIds[0],
      path: fixture.snapshot.files[0].path,
      side: "RIGHT",
      startLine: 1,
      line: 1,
    },
  };
  const update = {
    ...guide,
    sections: guide.sections.map((s, i) =>
      i === 0 ? { ...s, annotations: [note] } : s,
    ),
  };
  const merged = mergeEnrichment(guide, update);
  expect(merged.sections[0].annotations).toEqual([note]);
  expect(merged.sections[1]).toBe(guide.sections[1]);
  expect(mergeEnrichment(merged, update).sections).toBe(merged.sections);
  expect(mergeEnrichment(guide, { ...update, id: "other" })).toBe(guide);
  expect(
    mergeEnrichment(guide, { ...update, snapshotId: "old-revision" }),
  ).toBe(guide);
  // UI compaction can change section ids, but never the exact hunk anchors.
  expect(
    mergeEnrichment(
      { ...guide, sections: [{ ...guide.sections[0], id: "compacted" }] },
      update,
    ).sections[0].annotations,
  ).toEqual([note]);
});
it("only unfinished or explicitly retryable files are eligible", () => {
  expect(
    enrichmentRemaining({
      path: "a",
      tier: "priority",
      status: "complete",
      detail: null,
    }),
  ).toBe(false);
  expect(
    enrichmentRemaining({
      path: "a",
      tier: "priority",
      status: "failed",
      detail: null,
    }),
  ).toBe(true);
});
