import type { PullContext } from "./protocol";

export const codeCellSelector =
  ".blob-code, [data-testid='diff-line-content'], [data-testid='code-cell']";
const fileSelector = "[data-path], [data-tagsearch-path], [data-file-path]";
export type DiffPlacement =
  | { kind: "comment"; url: string }
  | {
      kind: "code";
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
      text: string;
    };

export function codeLocation(element: Element, side?: "LEFT" | "RIGHT") {
  const code =
    element.closest(codeCellSelector) ?? element.closest("[data-code-marker]");
  const row = code?.closest("tr, [role='row'], [data-testid='diff-line']");
  const file = code?.closest<HTMLElement>(fileSelector);
  const path =
    file?.dataset.path ?? file?.dataset.tagsearchPath ?? file?.dataset.filePath;
  if (!code || !row || !path) return null;
  const ownSide =
    code.matches(".blob-code-deletion") ||
    code.getAttribute("data-code-marker") === "-"
      ? "LEFT"
      : "RIGHT";
  const resolvedSide = side ?? ownSide;
  const numbers = row.querySelectorAll<HTMLElement>("[data-line-number]");
  // Split diffs have a separate pair of cells for each side.
  const split = row instanceof HTMLTableRowElement && row.cells.length >= 4;
  const cellIndex = code.closest("td")?.cellIndex;
  if (
    split &&
    cellIndex !== undefined &&
    (cellIndex < 2 ? "LEFT" : "RIGHT") !== resolvedSide
  )
    return null;
  const number = numbers[resolvedSide === "LEFT" ? 0 : numbers.length - 1];
  const line = Number(number?.dataset.lineNumber);
  if (!line) return null;
  const text =
    (code.querySelector(".blob-code-inner") ?? code).textContent ?? "";
  return { row, code, path, side: resolvedSide, line, text };
}
export function capturePlacement(
  context: PullContext,
  target: Element,
): DiffPlacement | null {
  if (context.commentUrl) return { kind: "comment", url: context.commentUrl };
  const location = codeLocation(
    target,
    context.selection?.side ?? context.line?.side,
  );
  return location
    ? {
        kind: "code",
        path: location.path,
        side: location.side,
        line: location.line,
        text: location.text,
      }
    : null;
}

/** Never trust a retained row: GitHub may recycle it for a different file/line. */
export function findPlacement(
  placement: DiffPlacement,
  root: ParentNode = document,
): Element | null {
  if (placement.kind === "comment") {
    const matches = Array.from(
      root.querySelectorAll<HTMLAnchorElement>("a[href*='#discussion_r']"),
    )
      .filter((link) => link.href === placement.url)
      .map((link) =>
        link.closest(
          ".review-comment, [data-testid='review-thread'], .timeline-comment",
        ),
      )
      .filter((node): node is Element => !!node);
    const unique = [...new Set(matches)];
    return unique.length === 1 ? (unique[0].closest("tr") ?? unique[0]) : null;
  }
  const matches = new Set<Element>();
  // Query only numbered rows in the required file, not every code token.
  const files =
    root instanceof Element && root.matches(fileSelector)
      ? [root as HTMLElement]
      : root.querySelectorAll<HTMLElement>(fileSelector);
  for (const file of files) {
    if (
      (file.dataset.path ??
        file.dataset.tagsearchPath ??
        file.dataset.filePath) !== placement.path
    )
      continue;
    for (const number of file.querySelectorAll<HTMLElement>(
      `[data-line-number="${placement.line}"]`,
    )) {
      const row = number.closest("tr, [role='row'], [data-testid='diff-line']");
      for (const code of row?.querySelectorAll(codeCellSelector) ?? []) {
        const location = codeLocation(code, placement.side);
        if (
          location?.path === placement.path &&
          location.line === placement.line &&
          location.text === placement.text
        )
          matches.add(location.row);
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}
