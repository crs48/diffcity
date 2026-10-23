import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { ArrowDown, ArrowUp, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GuideAnnotation } from "../lib/api";
import { annotationLine, annotationLayout } from "../lib/guideAnnotations";
import { clamp, mapRowAtLine, mapYAtLine } from "../lib/minimap";
import { followScrollOffset, followScrollTarget } from "../lib/scrollTarget";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { FileNavigationContext, type MapSource } from "./fileNavigation";

type Located = {
  note: GuideAnnotation;
  source: MapSource;
  start: number;
  end: number;
  slot: HTMLElement;
  content: HTMLElement;
};

/** Notes occupy real space in the document. Each sticks inside its own passage,
 * so a short final file cannot cut off a long explanation. Ordinary scrolling
 * only updates the connector/highlight, without replacing content in React. */
export function GuideMargin({
  notes,
  title,
  onRead,
  children,
}: {
  notes: GuideAnnotation[];
  title: string;
  onRead: (id: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const registry = useContext(FileNavigationContext);
  const root = useRef<HTMLElement>(null);
  const connector = useRef<SVGSVGElement>(null);
  const located = useRef<Located[]>([]);
  const stopJump = useRef(() => {});

  useLayoutEffect(() => {
    const element = root.current;
    const chapter = element?.closest<HTMLElement>(".guide-chapter");
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    const code = chapter?.querySelector<HTMLElement>(".guide-code");
    const overview = element?.querySelector<HTMLElement>(".code-note-overview");
    if (!element || !chapter || !viewport || !code || !overview) return;
    const slots = [...element.querySelectorAll<HTMLElement>("[data-note-id]")];
    const paths = new Map(
      [
        ...(connector.current?.querySelectorAll<SVGPathElement>("path") ?? []),
      ].map((path) => [path.dataset.noteConnector!, path]),
    );
    let frame = 0;
    let needsLayout = true;
    let marked = new Set<HTMLElement>();
    const setPixels = (el: HTMLElement, property: string, value: number) => {
      const pixels = `${Math.round(value * 100) / 100}px`;
      if (el.style.getPropertyValue(property) !== pixels)
        el.style.setProperty(property, pixels);
    };
    const update = () => {
      frame = 0;
      const view = viewport.getBoundingClientRect();
      const bounds = chapter.getBoundingClientRect();
      const wide =
        getComputedStyle(chapter).gridTemplateColumns.split(" ").length > 1;
      const inset =
        parseFloat(
          getComputedStyle(element).getPropertyValue("--guide-inset"),
        ) || 16;
      const targets = located.current;
      if (needsLayout) {
        needsLayout = false;
        slots.forEach((slot) => {
          slot.hidden = !wide || !targets.some((t) => t.slot === slot);
        });
        const passages = [
          {
            slot: overview,
            content: overview.firstElementChild as HTMLElement,
            anchor: 0,
          },
          ...(wide
            ? targets.map((target) => ({
                ...target,
                anchor:
                  mapYAtLine(target.source, target.start) -
                  element.getBoundingClientRect().top -
                  120,
              }))
            : []),
        ];
        const heights = passages.map(
          (p) => p.content.getBoundingClientRect().height,
        );
        const layout = annotationLayout(
          passages.map((p, index) => ({
            anchor: p.anchor,
            height: heights[index],
          })),
          wide ? code.getBoundingClientRect().height : 0,
        );
        passages.forEach((p, index) => {
          setPixels(p.slot, "height", layout[index].height);
          // Tall passages scroll naturally until their bottom is visible. No
          // inner scrollbar, clipped window, or height-dependent content swap.
          setPixels(
            p.content,
            "--note-inset",
            Math.min(inset, view.height - heights[index] - 16),
          );
        });
      }
      if (bounds.bottom < view.top || bounds.top > view.bottom) {
        paths.forEach((path) => path.setAttribute("d", ""));
        return;
      }
      const readingY = view.top + inset + 120;
      const target = wide
        ? targets
            .filter((p) => p.slot.getBoundingClientRect().top <= readingY)
            .at(-1)
        : undefined;
      if (target) element.dataset.activeNote = target.note.id;
      else delete element.dataset.activeNote;
      const covered = new Set<HTMLElement>();
      if (target) {
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
      const margin = element.getBoundingClientRect();
      paths.forEach((path, id) => {
        const passage = wide
          ? targets.find((p) => p.note.id === id)
          : undefined;
        if (!passage) {
          path.setAttribute("d", "");
          return;
        }
        // Connect every note, including one entering below the reading line.
        // Keep code coordinates in document flow: the viewport clips the SVG
        // naturally when the referenced range scrolls away or is virtualized.
        const top = mapYAtLine(passage.source, passage.start);
        const bottom =
          mapRowAtLine(passage.source, passage.end)?.getBoundingClientRect()
            .bottom ?? mapYAtLine(passage.source, passage.end + 1);
        const content = passage.content.getBoundingClientRect();
        const visibleTop = Math.max(content.top, view.top + inset);
        const visibleBottom = Math.min(content.bottom, view.bottom);
        // A tall note still has a visible connection while its heading scrolls
        // away. Notes outside the viewport retain their actual attachment point.
        const from =
          visibleBottom > visibleTop
            ? clamp(
                content.top + 32,
                visibleTop + Math.min(16, (visibleBottom - visibleTop) / 2),
                visibleBottom - Math.min(16, (visibleBottom - visibleTop) / 2),
              )
            : content.top + 32;
        const x =
          passage.source.element.getBoundingClientRect().left -
          margin.right -
          2;
        const y = (top + bottom) / 2 - margin.top;
        path.setAttribute(
          "d",
          `M 0 ${from - margin.top} H ${x / 2} V ${y} H ${x} M ${x} ${top - margin.top} V ${bottom - margin.top}`,
        );
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(() => {
      needsLayout = true;
      schedule();
    });
    resize.observe(viewport);
    resize.observe(code);
    // Observe content, not the allocated slot/chapter heights: layout cannot
    // create a feedback loop when an explanation extends beyond the code.
    [overview, ...slots].forEach((slot) => {
      if (slot.firstElementChild) resize.observe(slot.firstElementChild);
    });
    const collect = () => {
      located.current = notes.flatMap((note, index): Located[] => {
        const source = [...(registry?.sources ?? [])].find(
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
        const slot = slots[index];
        if (!source || !slot) return [];
        const coordinate = (n: number) =>
          source.lines.findIndex(
            (line) => (note.anchor.side === "LEFT" ? line.old : line.new) === n,
          );
        const start = coordinate(note.anchor.startLine),
          end = coordinate(note.anchor.line);
        return start >= 0 && end >= start
          ? [
              {
                note,
                source,
                start,
                end,
                slot,
                content: slot.firstElementChild as HTMLElement,
              },
            ]
          : [];
      });
      needsLayout = true;
      schedule();
    };
    collect();
    const unsubscribe = registry?.subscribe(collect);
    viewport.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      stopJump.current();
      unsubscribe?.();
      resize.disconnect();
      viewport.removeEventListener("scroll", schedule);
      marked.forEach((row) => {
        delete row.dataset.guideNote;
      });
    };
  }, [notes, registry]);

  const jump = (note: GuideAnnotation, code = false) => {
    const target = located.current.find((p) => p.note.id === note.id);
    const viewport = root.current?.closest<HTMLElement>("[data-review-scroll]");
    if (!target || !viewport) return;
    stopJump.current();
    const inset = () =>
      parseFloat(
        getComputedStyle(root.current!).getPropertyValue("--guide-inset"),
      ) || 16;
    stopJump.current = code
      ? followScrollOffset(
          viewport,
          () => mapYAtLine(target.source, target.start),
          () => inset() + 80,
        )
      : followScrollTarget(viewport, target.slot, inset);
    if (!code)
      target.content
        .querySelector<HTMLElement>("h3")
        ?.focus({ preventScroll: true });
  };
  const adjacent = (note: GuideAnnotation, direction: number) => {
    const index = located.current.findIndex((p) => p.note.id === note.id);
    const target = located.current[index + direction];
    if (target) jump(target.note);
  };
  return (
    <aside
      ref={root}
      className="guide-annotation guide-margin"
      aria-label={t("Section explanation")}
    >
      <div className="code-note-slot code-note-overview">
        <div className="code-note-content">{children}</div>
      </div>
      {notes.map((note, index) => (
        <div
          key={note.id}
          className="code-note-slot"
          data-note-id={note.id}
          hidden
        >
          <div className="code-note-content">
            <p className="code-note-section">{title}</p>
            <div className="code-note-navigation">
              <span>
                <Sparkles size={13} aria-hidden />{" "}
                {t("Code note {{current}} of {{total}}", {
                  current: index + 1,
                  total: notes.length,
                })}
              </span>
              <Button
                className="icon-button"
                aria-label={t("Previous code note")}
                isDisabled={index === 0}
                onPress={() => adjacent(note, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                className="icon-button"
                aria-label={t("Next code note")}
                isDisabled={index === notes.length - 1}
                onPress={() => adjacent(note, 1)}
              >
                <ArrowDown size={14} />
              </Button>
            </div>
            <article className="code-note">
              <h3 tabIndex={-1}>{note.title}</h3>
              <span className="code-note-location" title={note.anchor.path}>
                {note.anchor.path.split("/").at(-1)} ·{" "}
                {annotationLine(note, t("Old"), t("New"))}
              </span>
              <CommentMarkdown body={note.body} diagrams={false} />
              {!!note.details && (
                <Button className="text-button" onPress={() => onRead(note.id)}>
                  {t("Read deeper")}
                </Button>
              )}
            </article>
            <Button
              className="text-button code-note-jump"
              onPress={() => jump(note, true)}
            >
              {t("Show referenced lines")}
            </Button>
          </div>
        </div>
      ))}
      <svg ref={connector} className="code-note-connector" aria-hidden="true">
        {notes.map((note) => (
          <path key={note.id} data-note-connector={note.id} />
        ))}
      </svg>
    </aside>
  );
}
