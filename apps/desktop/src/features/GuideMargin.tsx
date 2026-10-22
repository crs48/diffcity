import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "react-aria-components";
import { ArrowDown, ArrowUp, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GuideAnnotation } from "../lib/api";
import { annotationLine, annotationPosition } from "../lib/guideAnnotations";
import { mapRowAtLine, mapYAtLine } from "../lib/minimap";
import { followScrollOffset } from "../lib/scrollTarget";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { FileNavigationContext, type MapSource } from "./fileNavigation";

type Located = {
  note: GuideAnnotation;
  source: MapSource;
  start: number;
  end: number;
};

/** A single sticky margin follows exact code coordinates, including virtual blocks.
 * Scrolls update two transforms and an SVG path; React updates only at note boundaries. */
export function GuideMargin({
  notes,
  title,
  headingId,
  children,
}: {
  notes: GuideAnnotation[];
  title: string;
  headingId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const registry = useContext(FileNavigationContext);
  const root = useRef<HTMLElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const connector = useRef<SVGPathElement>(null);
  const located = useRef<Located[]>([]);
  const stopJump = useRef(() => {});
  const refresh = useRef(() => {});
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  // Explicit navigation can show either of two nearby notes. The next reader
  // gesture resumes automatic tracking after virtual code has settled.
  const manual = useRef<string | null>(null);
  const active = notes.findIndex((n) => n.id === activeId);
  const current = notes[active];

  useLayoutEffect(() => {
    const element = root.current;
    const chapter = element?.closest<HTMLElement>(".guide-chapter");
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (!element || !chapter || !viewport || !registry || !notes.length) return;
    let frame = 0;
    let marked = new Set<HTMLElement>();
    const update = () => {
      frame = 0;
      const view = viewport.getBoundingClientRect();
      const bounds = chapter.getBoundingClientRect();
      // No row measurements in offscreen chapters.
      if (bounds.bottom < view.top || bounds.top > view.bottom) return;
      const inset =
        parseFloat(
          getComputedStyle(element).getPropertyValue("--guide-inset"),
        ) || 16;
      const readingY = view.top + inset + 120;
      const height = pane.current?.clientHeight ?? 0;
      const targets = located.current;
      const tops = targets.map(({ source, start }) =>
        mapYAtLine(source, start),
      );
      const automatic = annotationPosition(tops, readingY, height);
      const requested = targets.findIndex((p) => p.note.id === manual.current);
      const index = requested >= 0 ? requested : automatic.active;
      const push = requested >= 0 ? 0 : automatic.push;
      const target = targets[index];
      const file =
        target?.source.element.closest<HTMLElement>("[data-file-path]");
      // End the annotation when its file has left the viewport. Collapsing a file
      // unregisters its code sources, so stale notes cannot attach to another file.
      const shown =
        target &&
        file &&
        file.getBoundingClientRect().bottom > readingY &&
        getComputedStyle(chapter).gridTemplateColumns.split(" ").length > 1;
      const id = shown ? target.note.id : null;
      if (activeRef.current !== id) {
        activeRef.current = id;
        setActiveId(id);
      }
      pane.current?.style.setProperty("--note-push", `${shown ? push : 0}px`);
      const covered = new Set<HTMLElement>();
      if (shown) {
        for (let line = target.start; line <= target.end; line++) {
          const row = mapRowAtLine(target.source, line);
          if (row) covered.add(row);
        }
      }
      marked.forEach((row) => {
        if (!covered.has(row)) delete row.dataset.guideNote;
      });
      covered.forEach((row) => {
        row.dataset.guideNote = "true";
      });
      marked = covered;
      const path = connector.current;
      if (!path) return;
      const margin = element.getBoundingClientRect();
      const startY = shown ? mapYAtLine(target.source, target.start) : 0;
      const endRow = shown ? mapRowAtLine(target.source, target.end) : null;
      const endY = endRow?.getBoundingClientRect().bottom ?? startY + 25;
      const top = Math.max(
        startY,
        view.top +
          inset +
          (file?.querySelector<HTMLElement>(".file-bar")?.offsetHeight ?? 52),
      );
      const bottom = Math.min(endY, view.bottom - 8);
      if (
        !shown ||
        bottom <= top ||
        !pane.current ||
        getComputedStyle(element).position !== "sticky"
      ) {
        path.setAttribute("d", "");
        return;
      }
      const x =
        target.source.element.getBoundingClientRect().left - margin.right - 2;
      const y = (top + bottom) / 2 - margin.top;
      const from = pane.current.getBoundingClientRect().top - margin.top + 32;
      path.setAttribute(
        "d",
        `M 0 ${from} H ${x / 2} V ${y} H ${x} M ${x} ${top - margin.top} V ${bottom - margin.top}`,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    refresh.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    resize.observe(chapter);
    resize.observe(element);
    const collect = () => {
      located.current = notes.flatMap((note): Located[] => {
        const source = [...registry.sources].find(
          (s) =>
            chapter.contains(s.element) &&
            s.element.closest<HTMLElement>("[data-hunk-id]")?.dataset.hunkId ===
              note.anchor.hunkId &&
            s.lines.some(
              (line) =>
                (note.anchor.side === "LEFT" ? line.old : line.new) ===
                note.anchor.startLine,
            ),
        );
        if (!source) return [];
        const coordinate = (n: number) =>
          source.lines.findIndex(
            (line) => (note.anchor.side === "LEFT" ? line.old : line.new) === n,
          );
        const start = coordinate(note.anchor.startLine),
          end = coordinate(note.anchor.line);
        return start >= 0 && end >= start ? [{ note, source, start, end }] : [];
      });
      schedule();
    };
    collect();
    const unsubscribe = registry.subscribe(collect);
    const gestures = viewport.closest(".review-document") ?? viewport;
    const resume = () => {
      manual.current = null;
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    events.forEach((event) =>
      gestures.addEventListener(event, resume, {
        passive: true,
        capture: true,
      }),
    );
    viewport.addEventListener("scroll", schedule, { passive: true });
    return () => {
      refresh.current = () => {};
      cancelAnimationFrame(frame);
      stopJump.current();
      unsubscribe();
      resize.disconnect();
      viewport.removeEventListener("scroll", schedule);
      events.forEach((event) =>
        gestures.removeEventListener(event, resume, true),
      );
      marked.forEach((row) => {
        delete row.dataset.guideNote;
      });
    };
  }, [notes, registry]);

  useLayoutEffect(() => refresh.current(), [activeId]);

  const jump = (note: GuideAnnotation) => {
    const target = located.current.find((p) => p.note.id === note.id);
    const viewport = root.current?.closest<HTMLElement>("[data-review-scroll]");
    if (!target || !viewport) return;
    stopJump.current();
    manual.current = note.id;
    activeRef.current = note.id;
    setActiveId(note.id);
    stopJump.current = followScrollOffset(
      viewport,
      () => mapYAtLine(target.source, target.start),
      () =>
        (parseFloat(
          getComputedStyle(root.current!).getPropertyValue("--guide-inset"),
        ) || 16) + 80,
    );
  };
  const noteBody = (note: GuideAnnotation) => (
    <>
      <h3>{note.title}</h3>
      <span className="code-note-location" title={note.anchor.path}>
        {note.anchor.path.split("/").at(-1)} ·{" "}
        {annotationLine(note, t("Old"), t("New"))}
      </span>
      <CommentMarkdown body={note.body} diagrams={false} />
    </>
  );
  return (
    <aside
      ref={root}
      className="guide-annotation guide-margin"
      aria-label={t("Section explanation")}
    >
      {current ? (
        <>
          <h2
            id={headingId}
            tabIndex={-1}
            className="code-note-section"
            title={title}
          >
            {title}
          </h2>
          <div className="code-note-navigation">
            <span>
              <Sparkles size={13} aria-hidden />{" "}
              {t("Code note {{current}} of {{total}}", {
                current: active + 1,
                total: notes.length,
              })}
            </span>
            <Button
              className="icon-button"
              aria-label={t("Previous code note")}
              isDisabled={active === 0}
              onPress={() => jump(notes[active - 1])}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              className="icon-button"
              aria-label={t("Next code note")}
              isDisabled={active === notes.length - 1}
              onPress={() => jump(notes[active + 1])}
            >
              <ArrowDown size={14} />
            </Button>
          </div>
          <div
            className="code-note-window"
            ref={pane}
            data-active-note={current.id}
          >
            <div className="code-note-track">
              <article className="code-note">{noteBody(current)}</article>
              {notes[active + 1] && (
                <article
                  className="code-note code-note-incoming"
                  aria-hidden="true"
                  inert
                >
                  {noteBody(notes[active + 1])}
                </article>
              )}
            </div>
          </div>
          <Button
            className="text-button code-note-jump"
            onPress={() => jump(current)}
          >
            {t("Show referenced lines")}
          </Button>
        </>
      ) : (
        children
      )}
      <svg className="code-note-connector" aria-hidden="true">
        <path ref={connector} />
      </svg>
    </aside>
  );
}
