import type { Anchor, Snapshot } from "./api";

// The right side has the same immutable HEAD in both views. The left sides have
// different baselines, so their line numbers must never be sent to GitHub as-is.
export function fullReviewAnchor(
  anchor: Anchor,
  full: Snapshot,
): Anchor | null {
  if (anchor.side !== "RIGHT") return null;
  const hunk = full.files
    .find((file) => file.path === anchor.path)
    ?.hunks.find((h) => {
      const lines = new Set(
        h.lines.flatMap((line) => (line.new === null ? [] : [line.new])),
      );
      for (let line = anchor.startLine; line <= anchor.line; line++) {
        if (!lines.has(line)) return false;
      }
      return true;
    });
  return hunk ? { ...anchor, hunkId: hunk.id } : null;
}
