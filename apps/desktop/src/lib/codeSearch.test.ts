import { expect, it } from "vitest";
import { findCode } from "./codeSearch";
import type { ChangedFile } from "./api";

const files: ChangedFile[] = [
  {
    path: "src/review.ts",
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    unavailable: null,
    hunks: [
      {
        id: "hunk",
        fingerprint: "fingerprint",
        path: "src/review.ts",
        header: "@@ -20,2 +30,2 @@",
        lines: [
          {
            kind: "deletion",
            old: 20,
            new: null,
            text: "const oldSetting = false;",
          },
          {
            kind: "addition",
            old: null,
            new: 30,
            text: "const newSetting = true;",
          },
          { kind: "context", old: 21, new: 31, text: "return newSetting;" },
        ],
      },
    ],
  },
];

it("searches captured code case-insensitively with original old/new anchors", () => {
  expect(
    findCode(files, " Setting ").map(({ anchor, codeIndex }) => ({
      side: anchor.side,
      line: anchor.line,
      codeIndex,
    })),
  ).toEqual([
    { side: "LEFT", line: 20, codeIndex: 0 },
    { side: "RIGHT", line: 30, codeIndex: 1 },
    { side: "RIGHT", line: 31, codeIndex: 2 },
  ]);
  expect(findCode(files, "")).toEqual([]);
  expect(findCode(files, "missing")).toEqual([]);
  expect(findCode(files, ".*")).toEqual([]); // Search text is literal, never executable syntax.
});
