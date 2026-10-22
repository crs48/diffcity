import type { ChangedFile, Hunk } from "./api";

export type ContextGap = {
  above?: Hunk;
  below?: Hunk;
  hidden: number | null;
};

// Match Git's zero-length ranges: their start is the boundary, not a source line.
export function hunkSpan(hunk: Hunk) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunk.header);
  if (!match) return null;
  const oldCount = Number(match[2] ?? 1);
  const newCount = Number(match[4] ?? 1);
  const old = Math.max(0, Number(match[1]) - Number(oldCount > 0));
  const next = Math.max(0, Number(match[3]) - Number(newCount > 0));
  return { old, new: next, oldEnd: old + oldCount, newEnd: next + newCount };
}

const between = (above: Hunk | undefined, below: Hunk): number | null => {
  const start = above ? hunkSpan(above) : { oldEnd: 0, newEnd: 0 };
  const end = hunkSpan(below);
  return start && end
    ? Math.max(0, Math.min(end.old - start.oldEnd, end.new - start.newEnd))
    : null;
};

export function contextBefore(
  hunk: Hunk,
  file?: Pick<ChangedFile, "hunks" | "status">,
): ContextGap {
  const index = file?.hunks.findIndex((h) => h.id === hunk.id) ?? -1;
  return {
    below: hunk,
    hidden: between(index > 0 ? file!.hunks[index - 1] : undefined, hunk),
  };
}

export function contextAfter(
  hunk: Hunk,
  file?: Pick<ChangedFile, "hunks" | "status">,
): ContextGap {
  const index = file?.hunks.findIndex((h) => h.id === hunk.id) ?? -1;
  const next = index >= 0 ? file?.hunks[index + 1] : undefined;
  return {
    above: hunk,
    hidden: next
      ? between(hunk, next)
      : file?.status === "added" || file?.status === "removed"
        ? 0
        : null,
  };
}

/** Only join neighbors in source order. Guides can skip or reorder hunks. */
export function sharedContext(
  above: Hunk | undefined,
  below: Hunk | undefined,
  file: ChangedFile,
): ContextGap | null {
  if (!above || !below) return null;
  const index = file.hunks.findIndex((h) => h.id === above.id);
  return index >= 0 && file.hunks[index + 1]?.id === below.id
    ? { above, below, hidden: between(above, below) }
    : null;
}
