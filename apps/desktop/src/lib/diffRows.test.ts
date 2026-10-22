import { expect, it } from "vitest";
import { diffRows } from "./diffRows";
import { newNote } from "./review";
import { rangeAnchor } from "./selection";
import type { Hunk } from "./api";

const hunk = {
  id: "hunk",
  path: "file.ts",
  header: "@@ -1,2 +1,2 @@",
  lines: [
    { kind: "deletion", old: 1, new: null, text: "before one" },
    { kind: "deletion", old: 2, new: null, text: "before two" },
    { kind: "addition", old: null, new: 1, text: "after one" },
    { kind: "addition", old: null, new: 2, text: "after two" },
  ],
} as Hunk;
it("places range threads after their final line on the correct diff side", () => {
  const old = rangeAnchor(hunk, "LEFT", 1, 2);
  const updated = rangeAnchor(hunk, "RIGHT", 1, 2);
  const notes = [
    newNote("s", old, "Old code"),
    newNote("s", updated, "New code"),
    { ...newNote("s", updated, "Answer"), role: "assistant" },
  ];
  const rows = diffRows(hunk, notes, [], updated);
  expect(rows.map((r) => r.kind)).toEqual([
    "code",
    "code",
    "thread",
    "code",
    "code",
    "thread",
  ]);
  expect(rows[2].kind === "thread" && rows[2].thread.notes).toHaveLength(1);
  expect(rows[5].kind === "thread" && rows[5].thread.notes).toHaveLength(2);
});
it("renders an empty editor without creating a saved message", () => {
  const rows = diffRows(hunk, [], [], rangeAnchor(hunk, "RIGHT", 1, 1));
  expect(rows[3].kind === "thread" && rows[3].thread.notes).toEqual([]);
  expect(rows[4]).toMatchObject({ kind: "code", codeIndex: 3 });
});
it("pairs replacement rows and puts both side-specific threads after their matching pair", () => {
  const old = rangeAnchor(hunk, "LEFT", 1, 2),
    next = rangeAnchor(hunk, "RIGHT", 1, 2);
  const rows = diffRows(
    hunk,
    [newNote("s", old, "Before"), newNote("s", next, "After")],
    [],
    null,
    true,
  );
  expect(rows.filter((r) => r.kind === "code").map((r) => r.indices)).toEqual([
    [0, 2],
    [1, 3],
  ]);
  expect(
    rows.slice(2).map((r) => r.kind === "thread" && r.thread.anchor.side),
  ).toEqual(["LEFT", "RIGHT"]);
});
