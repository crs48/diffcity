import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { followScrollTarget } from "../lib/scrollTarget";

/** One review viewport owns scrolling; chapter visibility never steals keyboard focus. */
export function useGuideScroll(
  root: RefObject<HTMLDivElement | null>,
  sectionKey: string,
  activeId: string | null,
  onActive: (id: string) => void,
  docked = false,
) {
  const latest = useRef({ activeId, onActive });
  latest.current = { activeId, onActive };
  const observed = useRef(activeId);
  const move = useRef<(id: string, focus: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const element = root.current;
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (!element || !viewport) return;
    const chapters = [
      ...element.querySelectorAll<HTMLElement>("[data-guide-section]"),
    ];
    const nav = docked
      ? element
          .closest(".review-document")
          ?.querySelector<HTMLElement>(".guide-navigation")
      : element.querySelector<HTMLElement>(".guide-navigation");
    let frame = 0;
    let settling = false;
    let stopJump = () => {};
    const topInset = () =>
      (docked ? 0 : (nav?.getBoundingClientRect().height ?? 56)) + 16;
    const measure = () => {
      const inset = topInset();
      element.style.setProperty("--guide-inset", `${inset}px`);
      for (const chapter of chapters) {
        const annotation =
          chapter.querySelector<HTMLElement>(".guide-annotation");
        if (annotation && !annotation.classList.contains("guide-margin"))
          annotation.dataset.sticky = String(
            annotation.offsetHeight <= viewport.clientHeight - inset - 16,
          );
      }
    };
    move.current = (id, focus) => {
      const chapter = chapters.find((c) => c.dataset.guideSection === id);
      if (!chapter) return;
      stopJump();
      observed.current = id;
      settling = chapter !== chapters[0];
      if (settling)
        stopJump = followScrollTarget(viewport, chapter, topInset, () => {
          settling = false;
        });
      else viewport.scrollTo({ top: 0, behavior: "instant" });
      if (focus)
        chapter
          .querySelector<HTMLElement>("h2")
          ?.focus({ preventScroll: true });
    };
    const update = () => {
      frame = 0;
      if (!viewport.clientHeight || settling) return; // Explicit jumps settle before recording another chapter.
      const top = viewport.getBoundingClientRect().top + topInset() + 2;
      const atBottom =
        viewport.scrollHeight > viewport.clientHeight &&
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
      const current = atBottom
        ? chapters.at(-1)
        : (chapters
            .filter((c) => c.getBoundingClientRect().top <= top)
            .at(-1) ?? chapters[0]);
      const id = current?.dataset.guideSection;
      if (id && id !== observed.current) {
        observed.current = id;
        latest.current.onActive(id);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(() => {
      measure();
      schedule();
    });
    resize.observe(viewport);
    if (nav) resize.observe(nav);
    chapters.forEach((c) => {
      resize.observe(c);
      const annotation = c.querySelector(".guide-annotation");
      if (annotation) resize.observe(annotation);
    });
    measure();
    // Restore a chapter after parent layout effects have reset a changed view/revision.
    const restore = requestAnimationFrame(() => {
      if (
        latest.current.activeId &&
        latest.current.activeId !== chapters[0]?.dataset.guideSection
      )
        move.current(latest.current.activeId, false);
      else viewport.scrollTop = 0;
      schedule();
    });
    viewport.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(restore);
      cancelAnimationFrame(frame);
      stopJump();
      viewport.removeEventListener("scroll", schedule);
      resize.disconnect();
      move.current = () => {};
    };
  }, [root, sectionKey, docked]);
  useLayoutEffect(() => {
    if (activeId && activeId !== observed.current)
      move.current(activeId, false);
  }, [activeId]);
  return useCallback((id: string) => {
    move.current(id, true);
    latest.current.onActive(id);
  }, []);
}
