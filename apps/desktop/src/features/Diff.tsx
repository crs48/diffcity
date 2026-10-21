import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileCode2, MessageSquare } from "lucide-react";
import type { Anchor, Hunk, Note, RemoteComment, Side } from "../lib/api";

export function Diff({
  hunk,
  selection,
  onSelect,
  notes,
  comments,
  split,
  readingMode = false,
}: {
  hunk: Hunk;
  selection: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  notes: Note[];
  comments: RemoteComment[];
  split: boolean;
  readingMode?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: hunk.lines.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 25,
    overscan: 12,
  });
  const renderedRows = readingMode
    ? hunk.lines.map((_, index) => ({ index, key: index, start: index * 25 }))
    : rows.getVirtualItems();
  const select = (line: number | null, side: Side, shift: boolean) => {
    if (!line) return;
    const same =
      shift && selection?.hunkId === hunk.id && selection.side === side;
    onSelect({
      hunkId: hunk.id,
      path: hunk.path,
      side,
      startLine: same ? Math.min(selection.startLine, line) : line,
      line: same ? Math.max(selection.line, line) : line,
    });
  };
  return (
    <div className="diff-file">
      <div className="file-bar">
        <FileCode2 size={14} />
        <span>{hunk.path}</span>
        <span className="muted mono">
          {hunk.lines.filter((l) => l.kind === "addition").length > 0 &&
            `+${hunk.lines.filter((l) => l.kind === "addition").length}`}
        </span>
      </div>
      <div className="hunk-header">{hunk.header}</div>
      <div
        ref={scroll}
        className={`diff-scroll ${split ? "split" : ""}`}
        role="region"
        aria-label={`Code changes in ${hunk.path}. Plus marks additions; minus marks deletions. Shift-click line numbers to select a range.`}
        tabIndex={0}
        style={{ height: Math.min(hunk.lines.length * 25, 450) }}
      >
        <div
          style={{
            height: readingMode ? hunk.lines.length * 25 : rows.getTotalSize(),
            position: "relative",
            minWidth: "100%",
          }}
        >
          {renderedRows.map((row) => {
            const l = hunk.lines[row.index];
            const side: Side = l.kind === "deletion" ? "LEFT" : "RIGHT";
            const line = side === "LEFT" ? l.old : l.new;
            const chosen =
              selection?.hunkId === hunk.id &&
              (selection.side === "LEFT" ? l.old : l.new) !== null &&
              (selection.side === "LEFT" ? l.old! : l.new!) >=
                selection.startLine &&
              (selection.side === "LEFT" ? l.old! : l.new!) <= selection.line;
            const annotated =
              notes.some(
                (n) =>
                  n.anchor?.hunkId === hunk.id &&
                  n.anchor.line === line &&
                  n.anchor.side === side,
              ) ||
              comments.some(
                (c) =>
                  c.path === hunk.path && c.line === line && c.side === side,
              );
            return (
              <div
                key={row.key}
                className={`diff-line ${l.kind} ${chosen ? "selected" : ""}`}
                style={{
                  position: "absolute",
                  top: row.start,
                  height: 25,
                  width: "100%",
                }}
              >
                <button
                  tabIndex={l.old ? 0 : -1}
                  disabled={!l.old}
                  aria-hidden={!l.old}
                  className="line-number"
                  aria-label={`Select ${hunk.path} old line ${l.old}`}
                  aria-pressed={chosen && selection?.side === "LEFT"}
                  onClick={(e) => select(l.old, "LEFT", e.shiftKey)}
                >
                  {l.old}
                </button>
                <button
                  tabIndex={l.new ? 0 : -1}
                  disabled={!l.new}
                  aria-hidden={!l.new}
                  className="line-number"
                  aria-label={`Select ${hunk.path} line ${l.new}`}
                  aria-pressed={chosen && selection?.side === "RIGHT"}
                  onClick={(e) => select(l.new, "RIGHT", e.shiftKey)}
                >
                  {l.new}
                </button>
                <span className="sr-only">
                  {l.kind === "addition"
                    ? "Added: "
                    : l.kind === "deletion"
                      ? "Removed: "
                      : "Unchanged: "}
                </span>
                <span className="diff-sign" aria-hidden="true">
                  {l.kind === "addition"
                    ? "+"
                    : l.kind === "deletion"
                      ? "−"
                      : " "}
                </span>
                {split ? (
                  <>
                    <code className="split-code old">
                      {l.kind !== "addition" ? l.text : ""}
                    </code>
                    <code className="split-code new">
                      {l.kind !== "deletion" ? l.text : ""}
                    </code>
                  </>
                ) : (
                  <code>{l.text || " "}</code>
                )}
                {line && (
                  <button
                    className={`line-comment ${annotated ? "has-comment" : ""}`}
                    title="Discuss this line"
                    aria-label={`Discuss ${hunk.path} line ${line}`}
                    onClick={(e) => select(line, side, e.shiftKey)}
                  >
                    <MessageSquare size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
