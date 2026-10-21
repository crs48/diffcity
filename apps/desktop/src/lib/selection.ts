import type { Anchor, Hunk, Side } from "./api";

export const sameAnchor = (a: Anchor | null, b: Anchor | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.hunkId === b.hunkId &&
    a.path === b.path &&
    a.side === b.side &&
    a.startLine === b.startLine &&
    a.line === b.line);

export const lineRange = (a: Anchor) =>
  a.startLine === a.line ? `line ${a.line}` : `lines ${a.startLine}–${a.line}`;

export const rangeAnchor = (
  hunk: Hunk,
  side: Side,
  origin: number,
  end: number,
): Anchor => ({
  hunkId: hunk.id,
  path: hunk.path,
  side,
  startLine: Math.min(origin, end),
  line: Math.max(origin, end),
});

export const containsLine = (
  a: Anchor | null,
  hunk: Hunk,
  side: Side,
  line: number | null,
) =>
  !!a &&
  a.hunkId === hunk.id &&
  a.side === side &&
  line !== null &&
  line >= a.startLine &&
  line <= a.line;
