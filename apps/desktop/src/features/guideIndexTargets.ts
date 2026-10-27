import { noteTarget } from "../lib/guideIndex";

/** Use the same document destinations for rail markers and explicit jumps.
 * A note's non-sticky slot is its reading position; the expanded detail copy
 * near the chapter heading is only a fallback when margin notes are hidden. */
export function guideIndexTargets(root: HTMLElement) {
  const targets = new Map(
    [...root.querySelectorAll<HTMLElement>("[data-guide-index-target]")].map(
      (element) => [element.dataset.guideIndexTarget!, element],
    ),
  );
  for (const slot of root.querySelectorAll<HTMLElement>(
    ".guide-margin [data-note-id]",
  )) {
    const section = slot.closest<HTMLElement>("[data-guide-section]");
    if (!slot.hidden && section?.dataset.guideSection)
      targets.set(
        noteTarget(section.dataset.guideSection, slot.dataset.noteId!),
        slot,
      );
  }
  return targets;
}
