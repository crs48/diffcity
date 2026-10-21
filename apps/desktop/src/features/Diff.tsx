import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileCode2, MessageSquare } from "lucide-react";
import { Button } from "react-aria-components";
import type { Anchor, Hunk, Note, RemoteComment, Side } from "../lib/api";
import { containsLine, lineRange, rangeAnchor } from "../lib/selection";
import { useLineSelection } from "./useLineSelection";

export function Diff({
  hunk,
  selection,
  onSelect,
  onDiscuss = onSelect,
  notes,
  comments,
  split,
  readingMode = false,
}: {
  hunk: Hunk;
  selection: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  onDiscuss?: (anchor: Anchor) => void;
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
  const interaction = useLineSelection(
    hunk,
    selection,
    scroll,
    onSelect,
    (index) => {
      if (readingMode) scroll.current?.scrollTo({ top: index * 25 });
      else rows.scrollToIndex(index);
    },
  );
  const selected = interaction.selected;
  const activeRange = selected?.hunkId === hunk.id ? selected : null;
  const lineControls = (line: number | null, side: Side) => ({
    tabIndex: line ? 0 : -1,
    disabled: !line,
    "aria-hidden": !line,
    "data-side": side,
    "data-line": line,
    className: "line-number",
    "aria-label": `Select ${hunk.path} ${side === "LEFT" ? "old " : ""}line ${line}`,
    "aria-pressed": containsLine(selected, hunk, side, line),
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) =>
      line && interaction.pointerDown(event, line, side),
    // Pointer selection is committed on release. Keyboard and assistive clicks
    // have no pointer event and retain native button behavior.
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (line && event.detail === 0)
        interaction.select(line, side, event.shiftKey);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) =>
      line && interaction.keyDown(event, line, side),
  });
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
      <div className="range-toolbar">
        <span role="status" aria-live="polite">
          {activeRange
            ? `${activeRange.side === "LEFT" ? "Old" : "New"} ${lineRange(activeRange)} selected`
            : "Drag line numbers or Shift-click to select a range"}
        </span>
        {activeRange && !interaction.dragging && (
          <Button className="secondary" onPress={() => onDiscuss(activeRange)}>
            <MessageSquare size={13} /> Comment on {lineRange(activeRange)}
          </Button>
        )}
      </div>
      <div
        ref={scroll}
        className={`diff-scroll ${split ? "split" : ""}`}
        role="region"
        aria-label={`Code changes in ${hunk.path}. Plus marks additions; minus marks deletions. Drag line numbers, Shift-click, or use Shift with Up and Down to select a range within this hunk.`}
        tabIndex={0}
        onPointerMove={interaction.pointerMove}
        onPointerUp={interaction.pointerUp}
        onPointerCancel={interaction.pointerCancel}
        onLostPointerCapture={interaction.pointerCancel}
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
              containsLine(selected, hunk, "LEFT", l.old) ||
              containsLine(selected, hunk, "RIGHT", l.new);
            const annotated =
              notes.some(
                (n) =>
                  n.anchor?.hunkId === hunk.id &&
                  n.anchor.startLine <= (line ?? 0) &&
                  n.anchor.line >= (line ?? 0) &&
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
                <button {...lineControls(l.old, "LEFT")}>{l.old}</button>
                <button {...lineControls(l.new, "RIGHT")}>{l.new}</button>
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
                    title={
                      chosen && activeRange
                        ? `Discuss ${lineRange(activeRange)}`
                        : "Discuss this line"
                    }
                    aria-label={`Discuss ${hunk.path} ${chosen && activeRange ? lineRange(activeRange) : `line ${line}`}`}
                    onClick={() =>
                      onDiscuss(
                        chosen && activeRange
                          ? activeRange
                          : rangeAnchor(hunk, side, line, line),
                      )
                    }
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
