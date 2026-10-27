import {
  Children,
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "react-aria-components";
import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Anchor, ChangedFile, Hunk } from "../lib/api";
import { useConversation } from "./conversation";
import { followScrollTarget } from "../lib/scrollTarget";
import { contextAfter, contextBefore, sharedContext } from "../lib/contextGaps";
import { ContextGap } from "./ContextGap";
import { useGuideJump } from "./guideJump";

/** One header for consecutive hunks of a file, preserving the guide's reading order. */
export function FileDiff({
  file,
  hunks,
  selection,
  children,
  snapshotId,
  split = false,
}: {
  file: ChangedFile;
  hunks: Hunk[];
  selection: Anchor | null;
  children: ReactNode;
  snapshotId?: string;
  split?: boolean;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = () =>
      root.current?.style.setProperty(
        "--file-header-height",
        `${element.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const conversation = useConversation();
  const jump = useGuideJump(hunks.map((h) => h.id))?.sequence ?? 0;
  const selected =
    selection && hunks.some((h) => h.id === selection.hunkId)
      ? selection
      : null;
  const editing = conversation?.inline.draft?.anchor;
  const focus =
    editing && hunks.some((h) => h.id === editing.hunkId)
      ? conversation?.inline.focus
      : 0;
  const [closed, setClosed] = useState<{
    selected: Anchor | null;
    focus: number | undefined;
    jump: number;
  } | null>(null);
  const collapsed =
    !!closed &&
    closed.selected === selected &&
    closed.focus === focus &&
    closed.jump === jump;
  const keepHeader = useRef(false);
  const stopJump = useRef(() => {});
  useLayoutEffect(() => {
    if (!keepHeader.current || !collapsed) return;
    keepHeader.current = false;
    const fileElement = root.current;
    const viewport = fileElement?.closest<HTMLElement>("[data-review-scroll]");
    if (fileElement && viewport) {
      stopJump.current = followScrollTarget(viewport, fileElement, () => 8);
    }
    return () => stopJump.current();
  }, [collapsed]);
  const counts = hunks
    .flatMap((h) => h.lines)
    .reduce(
      (sum, line) => ({
        additions: sum.additions + Number(line.kind === "addition"),
        deletions: sum.deletions + Number(line.kind === "deletion"),
      }),
      { additions: 0, deletions: 0 },
    );
  return (
    <div
      ref={root}
      className="diff-file-group"
      data-file-path={file.path}
      data-file-collapsed={collapsed}
    >
      <div className="file-bar" ref={header}>
        <Button
          className="icon-button"
          aria-label={t(
            collapsed ? "Expand file {{path}}" : "Collapse file {{path}}",
            { path: file.path },
          )}
          aria-expanded={!collapsed}
          onPress={() => {
            const viewport = root.current?.closest<HTMLElement>(
              "[data-review-scroll]",
            );
            keepHeader.current =
              !collapsed &&
              !!viewport &&
              root.current!.getBoundingClientRect().top <
                viewport.getBoundingClientRect().top;
            setClosed(collapsed ? null : { selected, focus, jump });
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </Button>
        <FileCode2 size={14} aria-hidden />
        <span
          title={
            file.previousPath
              ? `${file.previousPath} → ${file.path}`
              : file.path
          }
        >
          {file.previousPath && <>{file.previousPath} → </>}
          {file.path}
        </span>
        <small className="file-status">{t(file.status)}</small>
        {!!counts.additions && (
          <span className="added mono">+{counts.additions}</span>
        )}
        {!!counts.deletions && (
          <span className="removed mono">−{counts.deletions}</span>
        )}
      </div>
      {!collapsed &&
        (snapshotId
          ? Children.toArray(children).map((child, index) => {
              const hunk = hunks[index];
              if (!hunk) return child;
              const sharedBefore = sharedContext(hunks[index - 1], hunk, file);
              const sharedAfter = sharedContext(hunk, hunks[index + 1], file);
              return (
                <Fragment key={hunk.id}>
                  {!sharedBefore && (
                    <ContextGap
                      key={`${snapshotId}/${hunk.id}/before`}
                      gap={contextBefore(hunk, file)}
                      snapshotId={snapshotId}
                      split={split}
                    />
                  )}
                  {child}
                  <ContextGap
                    key={`${snapshotId}/${hunk.id}/after/${sharedAfter?.below?.id ?? ""}`}
                    gap={sharedAfter ?? contextAfter(hunk, file)}
                    snapshotId={snapshotId}
                    split={split}
                  />
                </Fragment>
              );
            })
          : children)}
    </div>
  );
}
