import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** One review viewport owns scrolling; chapter visibility never steals keyboard focus. */
export function useGuideScroll(
  root: RefObject<HTMLDivElement | null>,
  sectionKey: string,
  activeId: string | null,
  onActive: (id: string) => void,
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
    const nav = element.querySelector<HTMLElement>(".guide-navigation");
    let frame = 0;
    const topInset = () => (nav?.getBoundingClientRect().height ?? 56) + 16;
    const measure = () => {
      const inset = topInset();
      element.style.setProperty("--guide-inset", `${inset}px`);
      for (const chapter of chapters) {
        const annotation =
          chapter.querySelector<HTMLElement>(".guide-annotation");
        if (annotation)
          annotation.dataset.sticky = String(
            annotation.offsetHeight <= viewport.clientHeight - inset - 16,
          );
      }
    };
    move.current = (id, focus) => {
      const chapter = chapters.find((c) => c.dataset.guideSection === id);
      if (!chapter) return;
      observed.current = id;
      viewport.scrollTo({
        top: Math.max(
          0,
          viewport.scrollTop +
            chapter.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            topInset(),
        ),
        behavior: "auto",
      });
      if (focus)
        chapter
          .querySelector<HTMLElement>("h2")
          ?.focus({ preventScroll: true });
    };
    const update = () => {
      frame = 0;
      if (!viewport.clientHeight) return; // No layout in nonvisual renderers.
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
      if (latest.current.activeId) move.current(latest.current.activeId, false);
      else viewport.scrollTop = 0;
      schedule();
    });
    viewport.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(restore);
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", schedule);
      resize.disconnect();
      move.current = () => {};
    };
  }, [root, sectionKey]);
  useLayoutEffect(() => {
    if (activeId && activeId !== observed.current)
      move.current(activeId, false);
  }, [activeId]);
  return useCallback((id: string) => {
    move.current(id, true);
    latest.current.onActive(id);
  }, []);
}
