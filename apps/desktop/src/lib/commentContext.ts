import type { Anchor, RemoteComment } from "./api";

/** Same thread selection as the agent prompt in discussion_context.rs. */
export function commentsForAnchor(
  comments: RemoteComment[],
  anchor: Anchor | null,
) {
  if (anchor?.textSelection) return [];
  const selected = new Set(
    comments
      .filter(
        (c) =>
          !anchor ||
          (anchor.startLine === anchor.line &&
            c.path === anchor.path &&
            c.line === anchor.line &&
            c.side === anchor.side),
      )
      .map((c) => c.id),
  );
  for (;;) {
    const before = selected.size;
    for (const comment of comments) {
      if (!comment.inReplyToId) continue;
      if (selected.has(comment.id)) selected.add(comment.inReplyToId);
      if (selected.has(comment.inReplyToId)) selected.add(comment.id);
    }
    if (selected.size === before) break;
  }
  return comments
    .filter((c) => selected.has(c.id))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}
