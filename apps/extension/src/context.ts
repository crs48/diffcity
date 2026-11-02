import type { Anchor, ReviewWorkspace } from "../../desktop/src/lib/api";
import type { PullContext } from "./protocol";

/** DOM text is only a hint. Anchors must resolve to the captured PR code. */
export function selectionAnchor(
  workspace: ReviewWorkspace,
  selection: NonNullable<PullContext["selection"]>,
): Anchor | null {
  const candidates: Anchor[] = [];
  for (const file of workspace.snapshot.files) {
    if (selection.path && file.path !== selection.path) continue;
    for (const hunk of file.hunks)
      for (const side of selection.side
        ? [selection.side]
        : (["RIGHT", "LEFT"] as const)) {
        const lines = hunk.lines.filter(
          (l) => (side === "RIGHT" ? l.new : l.old) !== null,
        );
        const text = lines.map((l) => l.text).join("\n");
        let index = text.indexOf(selection.text);
        while (index >= 0) {
          const before = text.slice(0, index).split("\n");
          const start = before.length - 1;
          const count = selection.text.split("\n").length;
          const end = start + count - 1;
          const startLine =
            side === "RIGHT" ? lines[start].new! : lines[start].old!;
          const line = side === "RIGHT" ? lines[end].new! : lines[end].old!;
          // Some GitHub layouts don't expose line numbers; do not guess if ambiguous.
          if (
            (!selection.line || selection.line === startLine) &&
            line - startLine === end - start
          ) {
            candidates.push({
              hunkId: hunk.id,
              path: file.path,
              side,
              startLine,
              line,
              textSelection: {
                snapshotId: workspace.snapshot.id,
                startColumn: before.at(-1)!.length,
                endColumn:
                  count === 1
                    ? before.at(-1)!.length + selection.text.length
                    : selection.text.split("\n").at(-1)!.length,
                text: selection.text,
              },
            });
          }
          index = text.indexOf(selection.text, index + 1);
        }
      }
  }
  // Context lines appear on both sides. Prefer the current version of identical code.
  const preferred = candidates.filter((c) => c.side === "RIGHT");
  const matches = preferred.length ? preferred : candidates;
  return matches.length === 1 ? matches[0] : null;
}
export function commentAnchor(
  workspace: ReviewWorkspace,
  url: string,
): Anchor | null {
  const comment = workspace.comments.find((c) => c.url === url);
  if (
    !comment?.path ||
    !comment.line ||
    !comment.side ||
    comment.commit !== workspace.snapshot.pull.head
  )
    return null;
  const hunk = workspace.snapshot.files
    .find((f) => f.path === comment.path)
    ?.hunks.find((h) =>
      h.lines.some(
        (l) => (comment.side === "RIGHT" ? l.new : l.old) === comment.line,
      ),
    );
  return hunk
    ? {
        hunkId: hunk.id,
        path: comment.path,
        side: comment.side,
        line: comment.line,
        startLine: comment.line,
      }
    : null;
}
