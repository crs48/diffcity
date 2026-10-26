import { useTranslation } from "react-i18next";
import "../i18n";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Plus } from "lucide-react";
import { Button } from "react-aria-components";
import type {
  Anchor,
  ChangedFile,
  GuideAnnotation,
  Hunk,
  Note,
  RemoteComment,
  Side,
} from "../lib/api";
import { containsLine, lineRange, rangeAnchor } from "../lib/selection";
import { useLineSelection } from "./useLineSelection";
import { anchorKey, diffRows } from "../lib/diffRows";
import { InlineDiscussion } from "./InlineDiscussion";
import { useConversation } from "./conversation";
import { ContextGap } from "./ContextGap";
import { contextBefore, contextAfter } from "../lib/contextGaps";
import { DIFF_CHUNK_SIZE, DiffChunks, rowAtOffset } from "./DiffChunks";
import { codeTextProps } from "../lib/textSelection";

import { CodeText } from "../ui/CodeText";
import { NoteDetails } from "./GuideCodeNotes";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { annotationLine } from "../lib/guideAnnotations";
import { useGuideJump } from "./guideJump";

const NO_ANNOTATIONS: GuideAnnotation[] = [];

type DiffProps = {
  annotations?: GuideAnnotation[];
  hunk: Hunk;
  file?: Pick<ChangedFile, "status" | "previousPath"> &
    Partial<Pick<ChangedFile, "hunks">>;
  selection: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  onDiscuss?: (anchor: Anchor) => void;
  notes: Note[];
  comments: RemoteComment[];
  split: boolean;
  snapshotId?: string;
  hideFileHeader?: boolean;
  hideContext?: boolean;
};

// Conversation updates reach inline threads directly; unchanged code does not need
// to rerender when the guide's active chapter or an unrelated chat message changes.
export function Diff(props: DiffProps) {
  const conversation = useConversation();
  const callbacks = useRef(props);
  callbacks.current = props;
  const onSelect = useCallback(
    (anchor: Anchor) => callbacks.current.onSelect(anchor),
    [],
  );
  const onDiscuss = useCallback(
    (anchor: Anchor) =>
      (callbacks.current.onDiscuss ?? callbacks.current.onSelect)(anchor),
    [],
  );
  const draft = conversation?.inline.draft;
  const editing =
    draft?.snapshotId === conversation?.workspace.snapshot.id &&
    draft?.anchor?.hunkId === props.hunk.id
      ? draft.anchor
      : null;
  return (
    <DiffContent
      {...props}
      selection={
        props.selection?.hunkId === props.hunk.id ? props.selection : null
      }
      onSelect={onSelect}
      onDiscuss={onDiscuss}
      editing={editing}
      composerFocus={editing ? (conversation?.inline.focus ?? 0) : 0}
      hasConversation={!!conversation}
    />
  );
}

const DiffContent = memo(function DiffContent({
  hunk,
  annotations = NO_ANNOTATIONS,
  file,
  selection,
  onSelect,
  onDiscuss = onSelect,
  notes,
  comments,
  split,
  snapshotId,
  editing,
  composerFocus,
  hasConversation,
  hideFileHeader,
  hideContext,
}: DiffProps & {
  editing: Anchor | null;
  composerFocus: number;
  hasConversation: boolean;
}) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      diffRows(
        hunk,
        hasConversation ? notes : [],
        hasConversation ? comments : [],
        editing,
        split,
      ),
    [hunk, notes, comments, editing, hasConversation, split],
  );
  const contextFile = file?.hunks
    ? { status: file.status, hunks: file.hunks }
    : undefined;
  const jump = useGuideJump([hunk.id]);
  const expansionKey = `${composerFocus}/${selection?.hunkId === hunk.id ? anchorKey(selection) : ""}/${jump?.sequence ?? 0}`;
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  const collapsed = collapsedAt === expansionKey;
  const indexAtOffset = useCallback(
    (offset: number, side: Side) => {
      const element = scroll.current;
      if (!element) return null;
      const row = rowAtOffset(element, offset);
      const item = row ? items[Number(row.dataset.index)] : null;
      return item?.kind === "code"
        ? (item.indices.find(
            (index) =>
              (side === "LEFT"
                ? hunk.lines[index].old
                : hunk.lines[index].new) !== null,
          ) ?? null)
        : null;
    },
    [items, hunk],
  );
  const scrollToCode = (index: number) => {
    const row = scroll.current?.querySelector<HTMLElement>(
      `[data-code-index="${index}"]`,
    );
    if (row) {
      delete row.dataset.headerOccluded;
      row.scrollIntoView({ block: "nearest" });
    }
  };
  const interaction = useLineSelection(
    hunk,
    selection?.textSelection ? null : selection,
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
  const mapLines = useMemo(
    () =>
      split
        ? items.flatMap((item) =>
            item.kind === "code" ? [hunk.lines[item.indices.at(-1)!]] : [],
          )
        : hunk.lines,
    [split, items, hunk],
  );
  const renderLine = (index: number, splitSide?: Side) => {
    const line = hunk.lines[index];
    const side = splitSide ?? (line.kind === "deletion" ? "LEFT" : "RIGHT");
    const number = side === "LEFT" ? line.old : line.new;
    const chosen = splitSide
      ? containsLine(selected, hunk, side, number)
      : containsLine(selected, hunk, "LEFT", line.old) ||
        containsLine(selected, hunk, "RIGHT", line.new);
    const showAction =
      !chosen ||
      (activeRange?.side === "LEFT" ? line.old : line.new) ===
        activeRange?.line;
    const annotated =
      notes.some(
        (n) =>
          n.anchor?.hunkId === hunk.id &&
          n.anchor.side === side &&
          n.anchor.line === number,
      ) ||
      comments.some(
        (c) => c.path === hunk.path && c.side === side && c.line === number,
      );
    return (
      <div
        key={side}
        data-code-index={index}
        className={`diff-line ${line.kind} ${chosen ? "selected" : ""}`}
      >
        {number && showAction ? (
          <button
            className={`line-comment ${annotated ? "has-comment" : ""}`}
            title={
              chosen && activeRange
                ? `Ask AI about ${lineRange(activeRange)}`
                : "Ask AI about this line"
            }
            aria-label={`Discuss ${hunk.path} ${chosen && activeRange ? lineRange(activeRange) : `${splitSide === "LEFT" ? "old " : ""}line ${number}`}`}
            onClick={() =>
              onDiscuss(
                chosen && activeRange
                  ? activeRange
                  : rangeAnchor(hunk, side, number, number),
              )
            }
          >
            <Plus size={14} aria-hidden />
          </button>
        ) : (
          <span className="line-comment-placeholder" aria-hidden="true" />
        )}
        {(!splitSide || splitSide === "LEFT") && (
          <button {...lineControls(line.old, "LEFT")}>{line.old}</button>
        )}
        {(!splitSide || splitSide === "RIGHT") && (
          <button {...lineControls(line.new, "RIGHT")}>{line.new}</button>
        )}
        <span className="sr-only">
          {line.kind === "addition"
            ? "Added: "
            : line.kind === "deletion"
              ? "Removed: "
              : "Unchanged: "}
        </span>
        {!splitSide && (
          <span className="diff-sign" aria-hidden="true">
            {line.kind === "addition"
              ? "+"
              : line.kind === "deletion"
                ? "−"
                : " "}
          </span>
        )}
        <code {...codeTextProps(line, splitSide)}>
          <CodeText path={hunk.path} text={line.text} />
        </code>
      </div>
    );
  };
  return (
    <div
      className="diff-file"
      data-split={split}
      data-hunk-id={hunk.id}
      data-source-snapshot={snapshotId}
      data-source-path={hunk.path}
    >
      {!hideFileHeader && (
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
      )}
      {!collapsed && (
        <>
          {snapshotId && !hideContext && (
            <ContextGap
              key={`${snapshotId}/${hunk.id}/before`}
              gap={contextBefore(hunk, contextFile)}
              snapshotId={snapshotId}
              split={split}
            />
          )}
          {selection && activeRange && (
            <div className="range-toolbar">
              {activeRange && !interaction.dragging && (
                <Button
                  className="secondary"
                  onPress={() => onDiscuss(activeRange)}
                >
                  <Plus size={13} />
                  {t("Ask AI about")} {lineRange(activeRange)}
                </Button>
              )}
              <span role="status" aria-live="polite">
                {`${activeRange.side === "LEFT" ? "Old" : "New"} ${lineRange(activeRange)} selected`}
              </span>
            </div>
          )}
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
            <DiffChunks
              items={items}
              minimapLines={mapLines}
              lineIndex={(item) =>
                item.kind === "code" ? item.mapIndex : null
              }
              itemKey={(item) => item.key}
              startsChunk={(item) =>
                item.kind === "code" && item.mapIndex % DIFF_CHUNK_SIZE === 0
              }
              keepItem={(item) =>
                item.kind === "thread" ||
                item.indices.some(
                  (index) =>
                    containsLine(
                      selected,
                      hunk,
                      "LEFT",
                      hunk.lines[index].old,
                    ) ||
                    containsLine(
                      selected,
                      hunk,
                      "RIGHT",
                      hunk.lines[index].new,
                    ),
                )
              }
              estimateItem={(item) => (item.kind === "thread" ? 160 : 25)}
              render={(item, index) => {
                const wrapper = {
                  "data-index": index,
                  "data-row-key": item.key,
                  "data-map-line":
                    item.kind === "code" ? item.mapIndex : undefined,
                };
                if (item.kind === "thread")
                  return (
                    <div
                      key={item.key}
                      {...wrapper}
                      className={split ? "diff-thread-row" : undefined}
                      data-side={item.thread.anchor.side}
                    >
                      <div className="diff-thread-cell">
                        <InlineDiscussion thread={item.thread} />
                      </div>
                    </div>
                  );
                return (
                  <div key={item.key} {...wrapper}>
                    {annotations
                      .filter((n) =>
                        item.indices.some(
                          (index) =>
                            (n.anchor.side === "LEFT"
                              ? hunk.lines[index].old
                              : hunk.lines[index].new) === n.anchor.startLine,
                        ),
                      )
                      .map((n) => (
                        <aside
                          className="code-note-inline"
                          key={n.id}
                          aria-label={t("Code explanation")}
                        >
                          <strong>{n.title}</strong>
                          <small>{annotationLine(n, t("Old"), t("New"))}</small>
                          <CommentMarkdown body={n.body} diagrams={false} />
                          {n.details && <NoteDetails body={n.details} />}
                        </aside>
                      ))}
                    {split ? (
                      <div className="split-row">
                        {(["LEFT", "RIGHT"] as const).map((side) => {
                          const index = item.indices.find(
                            (i) =>
                              (side === "LEFT"
                                ? hunk.lines[i].old
                                : hunk.lines[i].new) !== null,
                          );
                          return index === undefined ? (
                            <div
                              className="diff-empty-cell"
                              key={side}
                              aria-hidden="true"
                            />
                          ) : (
                            renderLine(index, side)
                          );
                        })}
                      </div>
                    ) : (
                      renderLine(item.codeIndex)
                    )}
                  </div>
                );
              }}
            />
          </div>
          {snapshotId && !hideContext && (
            <ContextGap
              key={`${snapshotId}/${hunk.id}/after`}
              gap={contextAfter(hunk, contextFile)}
              snapshotId={snapshotId}
              split={split}
            />
          )}
        </>
      )}
    </div>
  );
});
