import { useTranslation } from "react-i18next";
import "../i18n";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  MessageSquare,
} from "lucide-react";
import { Button } from "react-aria-components";
import type { Anchor, Hunk, Note, RemoteComment, Side } from "../lib/api";
import { containsLine, lineRange, rangeAnchor } from "../lib/selection";
import { useLineSelection } from "./useLineSelection";
import { anchorKey, diffRows } from "../lib/diffRows";
import { InlineDiscussion } from "./InlineDiscussion";
import { useConversation } from "./conversation";
import { useHunkContext } from "./useHunkContext";
import { ContextLines } from "./ContextLines";

export function Diff({
  hunk,
  file,
  selection,
  onSelect,
  onDiscuss = onSelect,
  notes,
  comments,
  split,
  snapshotId,
}: {
  hunk: Hunk;
  file?: { status: string; previousPath: string | null };
  selection: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  onDiscuss?: (anchor: Anchor) => void;
  notes: Note[];
  comments: RemoteComment[];
  split: boolean;
  snapshotId?: string;
}) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const conversation = useConversation();
  const hasConversation = !!conversation;
  const editing =
    conversation?.inline.draft?.snapshotId ===
    conversation?.workspace.snapshot.id
      ? (conversation?.inline.draft?.anchor ?? null)
      : null;
  const items = useMemo(
    () =>
      diffRows(
        hunk,
        hasConversation ? notes : [],
        hasConversation ? comments : [],
        editing,
      ),
    [hunk, notes, comments, editing, hasConversation],
  );
  const context = useHunkContext(snapshotId, hunk.id);
  const expansionKey = `${conversation?.inline.focus ?? 0}/${selection?.hunkId === hunk.id ? anchorKey(selection) : ""}`;
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  const collapsed = collapsedAt === expansionKey;
  const renderedRows = items.map((item, index) => ({ index, key: item.key }));
  const indexAtOffset = useCallback(
    (offset: number) => {
      const element = scroll.current;
      if (!element) return null;
      const rows = element.children;
      const top = element.getBoundingClientRect().top;
      let left = 0,
        right = rows.length - 1;
      while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const bounds = rows[middle].getBoundingClientRect();
        if (offset < bounds.top - top) right = middle - 1;
        else if (offset >= bounds.bottom - top) left = middle + 1;
        else {
          const item = items[middle];
          return item?.kind === "code" ? item.codeIndex : null;
        }
      }
      return null;
    },
    [items],
  );
  const scrollToCode = (index: number) => {
    scroll.current
      ?.querySelector<HTMLElement>(`[data-code-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const interaction = useLineSelection(
    hunk,
    selection,
    scroll,
    onSelect,
    scrollToCode,
    indexAtOffset,
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
        <Button
          className="icon-button"
          aria-label={t(
            collapsed ? "Expand diff {{path}}" : "Collapse diff {{path}}",
            { path: hunk.path },
          )}
          aria-expanded={!collapsed}
          onPress={() => setCollapsedAt(collapsed ? null : expansionKey)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </Button>
        <FileCode2 size={14} />
        <span>
          {file?.previousPath && <>{file.previousPath} → </>}
          {hunk.path}
        </span>
        {file && <small className="file-status">{t(file.status)}</small>}
        <span className="muted mono">
          {hunk.lines.filter((l) => l.kind === "addition").length > 0 &&
            `+${hunk.lines.filter((l) => l.kind === "addition").length}`}
        </span>
      </div>
      {!collapsed && (
        <>
          <div className="hunk-header">{hunk.header}</div>
          {snapshotId && (
            <div className="context-controls">
              <Button
                className="text-button"
                isDisabled={
                  context.busy || context.context?.beforeRemaining === 0
                }
                onPress={() => void context.expand("before")}
              >
                {t("Show 25 lines above")}
              </Button>
              {context.context?.beforeRemaining === 0 && (
                <span role="status">
                  {t("No more unchanged lines above this hunk.")}
                </span>
              )}
              {!!(
                context.context?.before.length || context.context?.after.length
              ) && (
                <Button
                  className="text-button"
                  isDisabled={context.busy}
                  onPress={context.collapse}
                >
                  {t("Collapse context")}
                </Button>
              )}
              <span className="muted">
                {t("Extra context is read-only; comment within the diff.")}
              </span>
            </div>
          )}
          {context.error && (
            <p className="context-error error-text" role="alert">
              {context.error}
            </p>
          )}
          <ContextLines lines={context.context?.before ?? []} split={split} />
          <div className="range-toolbar">
            <span role="status" aria-live="polite">
              {activeRange
                ? `${activeRange.side === "LEFT" ? "Old" : "New"} ${lineRange(activeRange)} selected`
                : "Drag line numbers or Shift-click to select a range"}
            </span>
            {activeRange && !interaction.dragging && (
              <Button
                className="secondary"
                onPress={() => onDiscuss(activeRange)}
              >
                <MessageSquare size={13} />
                {t("Comment on")} {lineRange(activeRange)}
              </Button>
            )}
          </div>
          <div
            ref={scroll}
            className={`diff-content ${split ? "split" : ""}`}
            role="region"
            aria-label={`Code changes in ${hunk.path}. Plus marks additions; minus marks deletions. Drag line numbers, Shift-click, or use Shift with Up and Down to select a range within this hunk.`}
            tabIndex={0}
            onPointerMove={interaction.pointerMove}
            onPointerUp={interaction.pointerUp}
            onPointerCancel={interaction.pointerCancel}
            onLostPointerCapture={interaction.pointerCancel}
          >
            {renderedRows.map((row) => {
              const item = items[row.index];
              const wrapper = {
                "data-index": row.index,
                "data-row-key": item.key,
                "data-code-index":
                  item.kind === "code" ? item.codeIndex : undefined,
              };
              if (item.kind === "thread")
                return (
                  <div key={row.key} {...wrapper}>
                    <InlineDiscussion thread={item.thread} />
                  </div>
                );
              const l = hunk.lines[item.codeIndex];
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
                <div key={row.key} {...wrapper}>
                  <div
                    className={`diff-line ${l.kind} ${chosen ? "selected" : ""}`}
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
                </div>
              );
            })}
          </div>
          <ContextLines lines={context.context?.after ?? []} split={split} />
          {snapshotId && (
            <div className="context-controls">
              <Button
                className="text-button"
                isDisabled={
                  context.busy || context.context?.afterRemaining === 0
                }
                onPress={() => void context.expand("after")}
              >
                {t("Show 25 lines below")}
              </Button>
              <span role="status">
                {context.busy
                  ? t("Loading surrounding code…")
                  : context.context?.afterRemaining === 0
                    ? t("No more unchanged lines below this hunk.")
                    : ""}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
