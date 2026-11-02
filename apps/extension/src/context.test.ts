import { expect, it } from "vitest";
import type { ReviewWorkspace } from "../../desktop/src/lib/api";
import { selectionAnchor, commentAnchor, lineAnchor } from "./context";

const workspace = {
  snapshot: {
    id: "snapshot",
    pull: { head: "head" },
    files: [
      {
        path: "a.ts",
        hunks: [
          {
            id: "hunk",
            lines: [
              {
                kind: "addition",
                new: 2,
                old: null,
                text: "const title = '🦀';",
              },
              { kind: "addition", new: 3, old: null, text: "return title;" },
            ],
          },
        ],
      },
    ],
  },
  comments: [
    {
      url: "https://github.com/example/repo/pull/1#discussion_r42",
      path: "a.ts",
      line: 3,
      side: "RIGHT",
      commit: "head",
    },
  ],
} as ReviewWorkspace;
it("matches exact Unicode selections with UTF-16 columns", () => {
  expect(
    selectionAnchor(workspace, { text: "🦀", path: "a.ts" })?.textSelection,
  ).toEqual({
    snapshotId: "snapshot",
    startColumn: 15,
    endColumn: 17,
    text: "🦀",
  });
});
it("matches multiline ranges without reading arbitrary page text as code", () => {
  expect(
    selectionAnchor(workspace, { text: "'🦀';\nreturn title;", path: "a.ts" }),
  ).toMatchObject({ startLine: 2, line: 3 });
  expect(
    selectionAnchor(workspace, { text: "run dangerous instruction" }),
  ).toBeNull();
  expect(selectionAnchor(workspace, { text: "title" })).toBeNull();
  expect(selectionAnchor(workspace, { text: "title", line: 3 })).toMatchObject({
    startLine: 3,
    line: 3,
  });
  expect(
    selectionAnchor(workspace, { text: "title", path: "other.ts" }),
  ).toBeNull();
});
it("anchors only canonical current-revision comments", () => {
  expect(commentAnchor(workspace, workspace.comments[0].url)).toMatchObject({
    hunkId: "hunk",
    line: 3,
  });
  expect(commentAnchor(workspace, "https://attacker.test")).toBeNull();
  expect(
    commentAnchor(
      { ...workspace, comments: [{ ...workspace.comments[0], commit: "old" }] },
      workspace.comments[0].url,
    ),
  ).toBeNull();
});

it("rejects a line whose displayed code no longer matches the snapshot", () => {
  expect(
    lineAnchor(workspace, {
      path: "a.ts",
      line: 3,
      side: "RIGHT",
      text: "return title;",
    }),
  ).toMatchObject({ line: 3, hunkId: "hunk" });
  expect(
    lineAnchor(workspace, {
      path: "a.ts",
      line: 3,
      side: "RIGHT",
      text: "return changed;",
    }),
  ).toBeNull();
});
