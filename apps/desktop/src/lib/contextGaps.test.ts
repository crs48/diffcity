import { expect, it } from "vitest";
import type { ChangedFile, Hunk } from "./api";
import {
  contextAfter,
  contextBefore,
  hunkSpan,
  sharedContext,
} from "./contextGaps";

const hunk = (header: string, id = header): Hunk => ({
  id,
  header,
  fingerprint: id,
  path: "review.ts",
  lines: [],
});
const file = (hunks: Hunk[]): ChangedFile => ({
  path: "review.ts",
  previousPath: null,
  status: "modified",
  additions: 0,
  deletions: 0,
  unavailable: null,
  hunks,
});

it("counts only omitted context and respects zero-length insertion and deletion boundaries", () => {
  const insertion = hunk("@@ -10,0 +11,2 @@");
  const next = hunk("@@ -15,2 +17,2 @@");
  const changed = file([insertion, next]);
  expect(contextBefore(insertion, changed).hidden).toBe(10);
  expect(sharedContext(insertion, next, changed)?.hidden).toBe(4);
  expect(contextBefore(next, changed).hidden).toBe(4);
  expect(contextAfter(insertion, changed).hidden).toBe(4);
  expect(contextAfter(next, changed).hidden).toBeNull();
  const deletion = hunk("@@ -11,2 +10,0 @@");
  expect(contextBefore(deletion).hidden).toBe(10);
  expect(hunkSpan(hunk("@@ -2 +5 @@ function name"))).toEqual({
    old: 1,
    new: 4,
    oldEnd: 2,
    newEnd: 5,
  });
});

it("never joins skipped or reordered hunks, or invents an end-of-file count", () => {
  const hunks = [1, 15, 30].map((line) => hunk(`@@ -${line},2 +${line},2 @@`));
  const changed = file(hunks);
  expect(sharedContext(hunks[0], hunks[2], changed)).toBeNull();
  expect(sharedContext(hunks[1], hunks[0], changed)).toBeNull();
  expect(contextAfter(hunks[2], changed).hidden).toBeNull();
  expect(contextAfter(hunks[2], { ...changed, status: "added" }).hidden).toBe(
    0,
  );
  expect(contextAfter(hunks[2], { ...changed, status: "removed" }).hidden).toBe(
    0,
  );
  expect(contextBefore(hunk("unavailable")).hidden).toBeNull();
});
