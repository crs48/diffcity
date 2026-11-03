import { describe, expect, it } from "vitest";
import {
  countProgress,
  parsePullUrl,
  sectionDefaultsCollapsed,
} from "./review";
import type { ReviewWorkspace } from "./api";
describe("review navigation", () => {
  it("opens only recognized GitHub pull request URLs", () => {
    expect(
      parsePullUrl("https://github.com/crs48/diffcity/pull/1/files"),
    ).toEqual({ repository: "crs48/diffcity", number: 1 });
    expect(parsePullUrl("https://github.com.evil.test/a/b/pull/1")).toBeNull();
    expect(parsePullUrl("javascript:alert(1)")).toBeNull();
  });
  it("never counts folded summaries or deferral as code review", () => {
    const w = {
      snapshot: { files: [{ hunks: [{ id: "one" }, { id: "two" }] }] },
      guide: {
        sections: [
          {
            attention: "high",
            assessed: true,
            hunkIds: ["one"],
            unavailablePaths: [],
          },
        ],
      },
      progress: { reviewed: [], acknowledged: ["one"], deferred: ["two"] },
    } as unknown as ReviewWorkspace;
    expect(countProgress(w)).toMatchObject({
      total: 2,
      reviewed: 0,
      acknowledged: 1,
      deferred: 1,
      highRemaining: 1,
    });
  });
});

import fixture from "../../../../tests/fixtures/review-workspace.json";
it.each([
  "finding",
  "name",
  "annotation",
  "discussion",
  "outdated",
  "unassessed",
  "high",
])("keeps routine content with %s context open by default", (reason) => {
  const w = structuredClone(fixture) as ReviewWorkspace;
  const s = w.guide.sections[4];
  expect(sectionDefaultsCollapsed(s, w)).toBe(true);
  const hunk = w.snapshot.files
    .flatMap((f) => f.hunks)
    .find((h) => s.hunkIds.includes(h.id))!;
  const anchor = {
    hunkId: hunk.id,
    path: hunk.path,
    side: "RIGHT" as const,
    startLine: 1,
    line: 1,
  };
  if (reason === "finding")
    s.findings = [
      { title: "Check", body: "Verify", severity: "warning", anchor },
    ];
  if (reason === "name")
    s.namingDecisions = [
      {
        name: "label",
        previousName: null,
        kind: "domain",
        reason: "Public term",
        question: "Confirm?",
        anchor,
      },
    ];
  if (reason === "annotation")
    s.annotations = [{ id: "note", title: "Check", body: "Verify", anchor }];
  if (reason === "discussion")
    w.notes = [
      {
        id: "note",
        snapshotId: w.snapshot.id,
        role: "user",
        body: "Question",
        anchor,
        parentId: null,
        githubDraft: false,
        publishedUrl: null,
        createdAt: "",
      },
    ];
  if (reason === "outdated")
    w.guide.previousRevision = {
      snapshotId: "old",
      head: "old",
      outdatedSections: [s.id],
      unassessedHunks: 0,
    };
  if (reason === "unassessed") s.assessed = false;
  if (reason === "high") s.attention = "high";
  expect(sectionDefaultsCollapsed(s, w)).toBe(false);
});
