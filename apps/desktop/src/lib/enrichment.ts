import type { EnrichmentFile, Guide } from "./api";

export const enrichmentRemaining = (file: EnrichmentFile) =>
  ["pending", "failed", "interrupted"].includes(file.status);

/** Keep the reader's chapter structure and unchanged code memoized as notes arrive. */
export function mergeEnrichment(current: Guide, update: Guide): Guide {
  if (current.id !== update.id || current.snapshotId !== update.snapshotId)
    return current;
  const notes = update.sections.flatMap((section) => section.annotations ?? []);
  let changed = false;
  const sections = current.sections.map((section) => {
    const additions = notes.filter(
      (note) =>
        section.hunkIds.includes(note.anchor.hunkId) &&
        !(section.annotations ?? []).some(
          (existing) => existing.id === note.id,
        ),
    );
    if (!additions.length) return section;
    changed = true;
    return {
      ...section,
      annotations: [...(section.annotations ?? []), ...additions],
    };
  });
  return {
    ...current,
    enrichment: update.enrichment,
    sections: changed ? sections : current.sections,
  };
}
