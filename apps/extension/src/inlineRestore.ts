import type { Anchor, ReviewWorkspace } from "../../desktop/src/lib/api";
import { anchorKey } from "../../desktop/src/lib/diffRows";
import type { DiffPlacement } from "./diffPlacement";
import type { PullContext } from "./protocol";

export type RestoredInline = {
  key: string;
  id: string;
  url: string;
  placement: DiffPlacement;
};

/** Only code coordinates leave the worker. Private messages stay in the frame. */
export function savedInlineThreads(workspace: ReviewWorkspace) {
  const anchors = new Map<string, Anchor>();
  for (const note of workspace.notes)
    if (note.anchor && note.body.trim())
      anchors.set(anchorKey(note.anchor), note.anchor);
  return [...anchors].flatMap(([key, anchor]) => {
    const hunk = workspace.snapshot.files
      .find((file) => file.path === anchor.path)
      ?.hunks.find((hunk) => hunk.id === anchor.hunkId);
    const line = hunk?.lines.find(
      (line) => (anchor.side === "LEFT" ? line.old : line.new) === anchor.line,
    );
    // Never guess a location when commits changed or the captured code is absent.
    if (!line) return [];
    const context: PullContext = {
      repository: workspace.snapshot.pull.repository,
      number: workspace.snapshot.pull.number,
      line: {
        path: anchor.path,
        side: anchor.side,
        line: anchor.line,
        text: line.text,
      },
    };
    const placement: DiffPlacement = {
      kind: "code",
      ...context.line!,
      text: line.text,
    };
    return [{ key, anchor, context, placement }];
  });
}
