import { indexedWorkspace } from "./guideIndex.fixture";
import { expect, it } from "vitest";
import { newNote } from "./review";
import { buildGuideIndex, packIndex, threadTarget } from "./guideIndex";

it("retains the actual group position even when its icon is clamped at a rail edge", () => {
  const entries = buildGuideIndex(indexedWorkspace()).filter(
    (e) => e.kind === "note" || e.kind === "naming",
  );
  const [group] = packIndex(
    entries.map((entry, index) => ({ entry, position: index * 0.01 })),
    1000,
  );
  expect(group.items).toHaveLength(2);
  expect(group.top).toBe(0);
  expect(group.position).toBe(0.005);
});

it("centers isolated markers on exact positions instead of rounding to a rail slot", () => {
  const entries = buildGuideIndex(indexedWorkspace()).filter(
    (e) => e.kind === "note" || e.kind === "naming",
  );
  const groups = packIndex(
    entries.map((entry, index) => ({ entry, position: index ? 0.734 : 0.263 })),
    1000,
  );
  expect(groups.map((g) => g.top + 14)).toEqual([263, 734]);
});

it("marks only fully code-reviewed sections, not partial, acknowledged, deferred or empty sections", () => {
  const w = indexedWorkspace();
  const first = w.guide.sections[0];
  first.hunkIds = ["first", "second"];
  w.guide.sections[1].hunkIds = [];
  w.progress = {
    ...w.progress,
    reviewed: ["first"],
    acknowledged: ["second"],
    deferred: ["second"],
  };
  expect(buildGuideIndex(w).find((e) => e.id === first.id)?.reviewed).toBe(
    false,
  );
  w.progress.reviewed.push("second");
  const entries = buildGuideIndex(w);
  expect(entries.filter((e) => e.reviewed).map((e) => e.id)).toEqual([
    first.id,
  ]);
  w.progress.reviewed = [];
  expect(buildGuideIndex(w).some((e) => e.reviewed)).toBe(false);
});

it("indexes every destination once and keeps replies together without depending on feed order", () => {
  const w = indexedWorkspace();
  const entries = buildGuideIndex(w);
  expect(entries.filter((e) => e.kind === "section")).toHaveLength(
    w.guide.sections.length,
  );
  expect(new Set(entries.map((e) => e.kind))).toEqual(
    new Set([
      "overview",
      "section",
      "conversation",
      "comment",
      "naming",
      "note",
      "finding",
    ]),
  );
  const comments = entries.filter((e) => e.kind === "comment");
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({
    count: 2,
    body: "reviewer: Please add smoke coverage.",
    target: threadTarget(w.notes[0].anchor!),
  });
  expect(comments[0].chat).toBeUndefined();
  const conversations = entries.filter((e) => e.kind === "conversation");
  expect(conversations).toHaveLength(2);
  expect(conversations[0]).toMatchObject({
    title: "Invitation migration rollout",
    count: 1,
    body: "What about existing invitations?",
  });
  expect(conversations[1].chat).toEqual({ local: "pr-question" });
  expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
});

it("ignores empty drafts and other revisions and sends off-guide comments to PR chat", () => {
  const w = indexedWorkspace();
  w.notes.push(
    newNote(w.snapshot.id, null, "  "),
    newNote("older", null, "Old question"),
  );
  w.comments = [{ ...w.comments[1], commit: "older-head" }];
  const entries = buildGuideIndex(w);
  expect(entries.filter((e) => e.kind === "conversation")).toHaveLength(2);
  expect(entries.find((e) => e.kind === "comment")?.chat).toEqual({
    remote: "root",
  });
  w.notes = [
    {
      ...w.notes[0],
      anchor: { ...w.notes[0].anchor!, hunkId: "no-longer-in-guide" },
    },
  ];
  expect(
    buildGuideIndex(w).find((e) => e.kind === "conversation")?.chat,
  ).toEqual({ local: "question" });
});

it("clusters thousands of nearby destinations without dropping any or overlapping markers", () => {
  const entries = buildGuideIndex(indexedWorkspace());
  const positioned = Array.from({ length: 3000 }, (_, i) => ({
    entry: { ...entries[i % entries.length], id: String(i) },
    position: i / 2999,
  }));
  const groups = packIndex(positioned, 720);
  expect(groups.length).toBeLessThanOrEqual(48);
  expect(groups.flatMap((g) => g.items)).toHaveLength(3000);
  for (const lane of ["sections", "activity"]) {
    const markers = groups.filter((g) => g.lane === lane);
    for (let i = 1; i < markers.length; i++)
      expect(markers[i].top - markers[i - 1].top).toBeGreaterThanOrEqual(30);
    expect(markers.at(-1)!.top + 28).toBeLessThanOrEqual(720);
  }
});
