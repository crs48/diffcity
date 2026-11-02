import { expect, it } from "vitest";
import { indexedWorkspace } from "../../desktop/src/lib/guideIndex.fixture";
import { newNote } from "../../desktop/src/lib/review";
import { savedInlineThreads } from "./inlineRestore";
import { inlineAnchor } from "./context";

it("restores one location per saved conversation without exposing its messages", () => {
  const w = indexedWorkspace();
  w.notes.push({
    ...newNote(
      w.snapshot.id,
      { ...w.notes[0].anchor!, line: 2, startLine: 2 },
      "  ",
    ),
    id: "blank",
  });
  const threads = savedInlineThreads(w);
  expect(threads).toHaveLength(1);
  expect(threads[0].placement).toMatchObject({
    kind: "code",
    path: w.notes[0].anchor!.path,
    line: 1,
  });
  expect(JSON.stringify(threads)).not.toContain(
    "What about existing invitations?",
  );
  expect(JSON.stringify(threads)).not.toContain(
    "Backfill before setting NOT NULL.",
  );
  expect(inlineAnchor(w, threads[0].context, threads[0].anchor)).toEqual(
    w.notes[0].anchor,
  );
});

it("keeps exact ranges and text selections rather than turning them into single-line threads", () => {
  const w = indexedWorkspace();
  const anchor = {
    ...w.notes[0].anchor!,
    startLine: 1,
    line: 2,
    textSelection: {
      snapshotId: w.snapshot.id,
      startColumn: 4,
      endColumn: 10,
      text: "selected\ncode",
    },
  };
  w.notes = [
    { ...newNote(w.snapshot.id, anchor, "Question"), id: "selection" },
  ];
  const thread = savedInlineThreads(w)[0];
  expect(thread.placement).toMatchObject({ line: 2 });
  expect(inlineAnchor(w, thread.context, thread.anchor)).toEqual(anchor);
  expect(
    inlineAnchor({ ...w, notes: [] }, thread.context, thread.anchor),
  ).toBeNull();
});

it("never places outdated conversations at a same-numbered line in a different hunk", () => {
  const w = indexedWorkspace();
  w.notes[0].anchor!.hunkId = "outdated";
  w.notes = [w.notes[0]];
  expect(savedInlineThreads(w)).toEqual([]);
});
