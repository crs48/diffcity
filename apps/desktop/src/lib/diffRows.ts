import type { Anchor, Hunk, Note, RemoteComment } from "./api";
import { rangeAnchor, sameAnchor } from "./selection";
import { commentsForAnchor } from "./commentContext";

export type InlineThread = {
  anchor: Anchor;
  notes: Note[];
  remote: RemoteComment[];
};
export type DiffRow =
  | {
      key: string;
      kind: "code";
      codeIndex: number;
      indices: number[];
      mapIndex: number;
    }
  | { key: string; kind: "thread"; thread: InlineThread };
export const anchorKey = (a: Anchor) =>
  `${a.hunkId}/${a.side}/${a.startLine}/${a.line}${a.textSelection ? `/text/${a.textSelection.snapshotId}/${a.textSelection.startColumn}/${a.textSelection.endColumn}` : ""}`;

export function diffRows(
  hunk: Hunk,
  notes: Note[],
  comments: RemoteComment[],
  editing: Anchor | null,
  split = false,
): DiffRow[] {
  const anchors = notes.flatMap((n) =>
    n.anchor?.hunkId === hunk.id ? [n.anchor] : [],
  );
  const remote = comments.filter(
    (c) => c.path === hunk.path && c.line && c.side,
  );
  anchors.push(
    ...remote.map((c) => rangeAnchor(hunk, c.side!, c.line!, c.line!)),
  );
  if (editing?.hunkId === hunk.id) anchors.push(editing);
  const unique = [...new Map(anchors.map((a) => [anchorKey(a), a])).values()];
  const threadRow = (anchor: Anchor): DiffRow => ({
    key: anchorKey(anchor),
    kind: "thread",
    thread: {
      anchor,
      notes: notes.filter((n) => sameAnchor(n.anchor, anchor)),
      remote: commentsForAnchor(comments, anchor),
    },
  });
  const code = splitCodeRows(hunk, split);
  const rows = code.flatMap((indices, mapIndex): DiffRow[] => [
    {
      key: `code-${indices.join("-")}`,
      kind: "code",
      codeIndex: indices[0],
      indices,
      mapIndex,
    },
    ...unique
      .filter((a) =>
        indices.some(
          (index) =>
            (a.side === "LEFT"
              ? hunk.lines[index].old
              : hunk.lines[index].new) === a.line,
        ),
      )
      .map(threadRow),
  ]);
  // Expanded-context selections still keep their private conversation with this hunk.
  return [
    ...rows,
    ...unique
      .filter(
        (a) =>
          a.textSelection &&
          !hunk.lines.some(
            (l) => (a.side === "LEFT" ? l.old : l.new) === a.line,
          ),
      )
      .map(threadRow),
  ];
}

/** Pair replacement runs by position; excess lines retain an empty opposite cell. */
export function splitCodeRows(hunk: Hunk, split: boolean): number[][] {
  if (!split) return hunk.lines.map((_, i) => [i]);
  const rows: number[][] = [];
  for (let i = 0; i < hunk.lines.length;) {
    if (hunk.lines[i].kind === "context") {
      rows.push([i++]);
      continue;
    }
    const removed: number[] = [],
      added: number[] = [];
    while (i < hunk.lines.length && hunk.lines[i].kind !== "context") {
      (hunk.lines[i].kind === "deletion" ? removed : added).push(i++);
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      rows.push(
        [removed[j], added[j]].filter(
          (index): index is number => index !== undefined,
        ),
      );
  }
  return rows;
}
