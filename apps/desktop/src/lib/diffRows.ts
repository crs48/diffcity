import type { Anchor, Hunk, Note, RemoteComment } from "./api";
import { rangeAnchor, sameAnchor } from "./selection";

export type InlineThread = {
  anchor: Anchor;
  notes: Note[];
  remote: RemoteComment[];
};
export type DiffRow =
  | { key: string; kind: "code"; codeIndex: number }
  | { key: string; kind: "thread"; thread: InlineThread };
export const anchorKey = (a: Anchor) =>
  `${a.hunkId}/${a.side}/${a.startLine}/${a.line}${a.textSelection ? `/text/${a.textSelection.snapshotId}/${a.textSelection.startColumn}/${a.textSelection.endColumn}` : ""}`;

export function diffRows(
  hunk: Hunk,
  notes: Note[],
  comments: RemoteComment[],
  editing: Anchor | null,
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
      remote: anchor.textSelection
        ? []
        : remote.filter(
            (c) =>
              c.line === anchor.line &&
              c.side === anchor.side &&
              anchor.startLine === anchor.line,
          ),
    },
  });
  const rows = hunk.lines.flatMap((line, codeIndex): DiffRow[] => [
    { key: `code-${codeIndex}`, kind: "code", codeIndex },
    ...unique
      .filter((a) => (a.side === "LEFT" ? line.old : line.new) === a.line)
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
