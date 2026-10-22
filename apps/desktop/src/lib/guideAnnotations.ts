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

/** Each passage gets at least its full reading height, even when its anchor is
 * close to another note or at the very end of a short file. The final passage
 * extends the chapter when necessary; it never depends on that chapter's height. */
export function annotationLayout(
  passages: readonly { anchor: number; height: number }[],
  codeHeight: number,
) {
  const tops = passages.reduce<number[]>((positions, passage, index) => {
    const previousEnd = index
      ? positions[index - 1] + passages[index - 1].height
      : 0;
    return [...positions, Math.max(previousEnd, passage.anchor)];
  }, []);
  return passages.map((passage, index) => ({
    top: tops[index],
    height: Math.max(
      passage.height,
      (tops[index + 1] ?? codeHeight) - tops[index],
    ),
  }));
}
