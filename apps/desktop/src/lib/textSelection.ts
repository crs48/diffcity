import type { Anchor, DiffLine, Side } from "./api";

export const codeTextProps = (line: DiffLine, side?: Side) => ({
  "data-code-text": true,
  "data-code-empty": !line.text || undefined,
  "data-old-line": side === "RIGHT" ? undefined : (line.old ?? undefined),
  "data-new-line": side === "LEFT" ? undefined : (line.new ?? undefined),
  "data-code-side": side,
});
const codeAt = (node: Node) =>
  (node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
  )?.closest<HTMLElement>("code[data-code-text]");
const content = (code: HTMLElement) =>
  code.dataset.codeEmpty ? "" : (code.textContent ?? "");
const columnAt = (code: HTMLElement, node: Node, offset: number) => {
  const prefix = document.createRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(node, offset);
  return Math.min(content(code).length, prefix.toString().length);
};

/** Read only source cells, never gutters, diff signs, inline messages, or both split columns. */
export function selectedCode(range: Range, root: HTMLElement): Anchor | null {
  if (range.collapsed) return null;
  const start = codeAt(range.startContainer);
  const end = codeAt(range.endContainer);
  if (!start || !end || !root.contains(start) || !root.contains(end))
    return null;
  const firstHunk = start.closest<HTMLElement>("[data-source-snapshot]");
  const lastHunk = end.closest<HTMLElement>("[data-source-snapshot]");
  if (
    !firstHunk ||
    !lastHunk ||
    firstHunk.dataset.sourcePath !== lastHunk.dataset.sourcePath ||
    firstHunk.dataset.sourceSnapshot !== lastHunk.dataset.sourceSnapshot
  )
    return null;
  if (start.dataset.codeSide !== end.dataset.codeSide) return null;
  const scope = start.closest<HTMLElement>("[data-file-path]") ?? firstHunk;
  if (!scope.contains(end)) return null;
  const cells = Array.from(
    scope.querySelectorAll<HTMLElement>("code[data-code-text]"),
  );
  const from = cells.indexOf(start);
  const to = cells.indexOf(end);
  if (from < 0 || to < from) return null;
  const selected = cells
    .slice(from, to + 1)
    .filter(
      (c) =>
        !start.dataset.codeSide ||
        c.dataset.codeSide === start.dataset.codeSide,
    );
  // Unified selections containing both deleted and added source are ambiguous.
  const hasOldOnly = selected.some(
    (c) => c.dataset.oldLine && !c.dataset.newLine,
  );
  const hasNewOnly = selected.some(
    (c) => c.dataset.newLine && !c.dataset.oldLine,
  );
  if (hasOldOnly && hasNewOnly) return null;
  const side: Side =
    start.dataset.codeSide === "LEFT" || hasOldOnly ? "LEFT" : "RIGHT";
  const lineOf = (c: HTMLElement) =>
    Number(side === "LEFT" ? c.dataset.oldLine : c.dataset.newLine);
  const lines = selected.filter((c) => lineOf(c) > 0);
  if (
    !lines.length ||
    lines.length > 200 ||
    lines[0] !== start ||
    lines.at(-1) !== end
  )
    return null;
  if (lines.some((c, i) => lineOf(c) !== lineOf(start) + i)) return null;
  const startColumn = columnAt(start, range.startContainer, range.startOffset);
  const endColumn = columnAt(end, range.endContainer, range.endOffset);
  const text = lines
    .map((c, i) =>
      content(c).slice(
        i === 0 ? startColumn : 0,
        i === lines.length - 1 ? endColumn : undefined,
      ),
    )
    .join("\n");
  if (!text.trim() || text.length > 16_000) return null;
  return {
    hunkId: lastHunk.dataset.hunkId!,
    path: lastHunk.dataset.sourcePath!,
    side,
    startLine: lineOf(start),
    line: lineOf(end),
    textSelection: {
      snapshotId: lastHunk.dataset.sourceSnapshot!,
      startColumn,
      endColumn,
      text,
    },
  };
}
