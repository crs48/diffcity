import { expect, it } from "vitest";
import fixture from "../../../../tests/fixtures/comment-context.json";
import type { Anchor, RemoteComment } from "./api";
import { commentsForAnchor } from "./commentContext";
import { diffRows } from "./diffRows";

const comments = fixture as RemoteComment[];
const anchor: Anchor = {
  hunkId: "h",
  path: "src/routes.ts",
  side: "RIGHT",
  startLine: 164,
  line: 164,
};
it("keeps the original GitHub finding and every linked reply in an inline conversation", () => {
  expect(commentsForAnchor(comments, anchor).map((c) => c.id)).toEqual([
    "root",
    "reply",
    "nested-reply",
  ]);
  const rows = diffRows(
    {
      id: "h",
      fingerprint: "f",
      path: anchor.path,
      header: "@@ -163,0 +164,1 @@",
      lines: [{ kind: "addition", old: null, new: 164, text: "route()" }],
    },
    [],
    comments,
    anchor,
  );
  expect(
    rows[1].kind === "thread" && rows[1].thread.remote.map((c) => c.id),
  ).toEqual(["root", "reply", "nested-reply"]);
});
it("isolates text selections and multi-line code conversations; PR chat sees the full PR discussion", () => {
  expect(
    commentsForAnchor(comments, {
      ...anchor,
      textSelection: {
        snapshotId: "s",
        startColumn: 0,
        endColumn: 1,
        text: "x",
      },
    }),
  ).toEqual([]);
  expect(commentsForAnchor(comments, { ...anchor, startLine: 163 })).toEqual(
    [],
  );
  expect(commentsForAnchor(comments, null)).toHaveLength(comments.length);
});
it("follows a matching reply back to an outdated parent without duplicating cyclic metadata", () => {
  const linked = comments.slice(0, 3).map((c) =>
    c.id === "root"
      ? {
          ...c,
          path: null,
          line: null,
          side: null,
          inReplyToId: "nested-reply",
        }
      : c.id === "reply"
        ? { ...c, path: anchor.path, line: 164, side: "RIGHT" as const }
        : c,
  );
  expect(commentsForAnchor(linked, anchor).map((c) => c.id)).toEqual([
    "root",
    "reply",
    "nested-reply",
  ]);
});
