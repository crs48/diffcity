import type { GuideAnnotation, GuideSection, Hunk } from "./api";

export function orderedAnnotations(section: GuideSection, hunks: Hunk[]) {
  return (section.annotations ?? [])
    .flatMap((note) => {
      const hunk = hunks.find(
        (h) => h.id === note.anchor.hunkId && h.path === note.anchor.path,
      );
      const index =
        hunk?.lines.findIndex(
          (line) =>
            (note.anchor.side === "LEFT" ? line.old : line.new) ===
            note.anchor.startLine,
        ) ?? -1;
      return hunk && index >= 0 && section.hunkIds.includes(hunk.id)
        ? [{ note, index, hunkOrder: section.hunkIds.indexOf(hunk.id) }]
        : [];
    })
    .sort((a, b) => a.hunkOrder - b.hunkOrder || a.index - b.index)
    .map(({ note }) => note);
}

export function annotationLine(
  note: GuideAnnotation,
  old = "Old",
  next = "New",
) {
  const a = note.anchor;
  return `${a.side === "LEFT" ? old : next} ${a.startLine === a.line ? a.line : `${a.startLine}–${a.line}`}`;
}

/** Only boundary changes enter React; the push motion uses a DOM transform. */
export function annotationPosition(
  tops: number[],
  readingY: number,
  height: number,
) {
  const active = tops.reduce(
    (found, top, index) => (top <= readingY ? index : found),
    -1,
  );
  const distance = tops[active + 1] - readingY;
  const push =
    active < 0 || !Number.isFinite(distance)
      ? 0
      : Math.max(0, Math.min(height, height - distance));
  return { active, push };
}
