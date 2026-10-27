import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { FileNavigationContext } from "./fileNavigation";
import { observeReviewScroll } from "../lib/reviewViewport";
import { mapYAtLine } from "../lib/minimap";
import { guideIndexTargets } from "./guideIndexTargets";
import {
  packIndex,
  type GuideIndexEntry,
  type IndexGroup,
} from "../lib/guideIndex";

/** Layout changes remeasure destinations; scrolling only moves one indicator. */
export function useGuideIndexLayout(
  root: RefObject<HTMLDivElement | null>,
  entries: GuideIndexEntry[],
) {
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const registry = useContext(FileNavigationContext);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [groups, setGroups] = useState<IndexGroup[]>([]);
  const [sectionRanges, setSectionRanges] = useState<
    { id: string; top: number; height: number }[]
  >([]);
  useEffect(() => {
    setHost(
      root.current
        ?.closest(".review-canvas")
        ?.querySelector<HTMLElement>("#review-guide-index") ?? null,
    );
  }, [root]);
  useLayoutEffect(() => {
    const element = root.current;
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (!element || !viewport || !host || !track.current) return;
    let frame = 0;
    let height = 1,
      offset = 0,
      trackHeight = 1;
    const updateIndicator = () => {
      if (!indicator.current) return;
      const start = Math.max(
        0,
        Math.min(1, (viewport.scrollTop - offset) / height),
      );
      const end = Math.max(
        start,
        Math.min(
          1,
          (viewport.scrollTop + viewport.clientHeight - offset) / height,
        ),
      );
      indicator.current.style.transform = `translateY(${start * trackHeight}px)`;
      indicator.current.style.height = `${Math.max(3, (end - start) * trackHeight)}px`;
    };
    const measure = () => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      height = Math.max(1, bounds.height);
      offset =
        bounds.top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      trackHeight = Math.max(30, track.current?.clientHeight ?? 30);
      const sections = new Map(
        [...element.querySelectorAll<HTMLElement>("[data-guide-section]")].map(
          (el) => [el.dataset.guideSection!, el],
        ),
      );
      setSectionRanges(
        entries
          .filter((entry) => entry.kind === "section")
          .flatMap((entry) => {
            const section = sections.get(entry.sectionId);
            if (!section) return [];
            const rect = section.getBoundingClientRect();
            const start = Math.max(
              0,
              Math.min(1, (rect.top - bounds.top) / height),
            );
            const end = Math.max(
              start,
              Math.min(1, (rect.bottom - bounds.top) / height),
            );
            return [
              {
                id: entry.sectionId,
                top: start * trackHeight,
                height: (end - start) * trackHeight,
              },
            ];
          }),
      );
      const targets = guideIndexTargets(element);
      const sources = new Map(
        [...(registry?.sources ?? [])]
          .filter((s) => s.element.isConnected)
          .map((s) => [
            s.element.closest<HTMLElement>("[data-hunk-id]")?.dataset.hunkId,
            s,
          ]),
      );
      const positioned = entries.map((entry) => {
        const section = sections.get(entry.sectionId);
        const target = targets.get(entry.target) ?? sections.get(entry.target);
        const source = entry.anchor && sources.get(entry.anchor.hunkId);
        const line =
          source && entry.anchor
            ? source.lines.findIndex(
                (l) =>
                  (entry.anchor!.side === "LEFT" ? l.old : l.new) ===
                  (entry.anchor!.startLine ?? entry.anchor!.line),
              )
            : -1;
        const y = target
          ? target.getBoundingClientRect().top
          : source && line >= 0
            ? mapYAtLine(source, line)
            : (section?.getBoundingClientRect().top ?? bounds.top) +
              Math.min(100, (section?.offsetHeight ?? 200) / 2);
        return {
          entry,
          position: Math.max(0, Math.min(1, (y - bounds.top) / height)),
        };
      });
      setGroups(packIndex(positioned, trackHeight));
      updateIndicator();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    resize.observe(viewport);
    resize.observe(track.current);
    // Margin passages settle asynchronously and can redistribute space without
    // resizing the chapter. Watch their geometry, but ignore sticky content,
    // connectors and row highlights updated during ordinary scrolling.
    const destinationSelector =
      "[data-guide-index-target], [data-guide-section], [data-note-id]";
    const mutation = new MutationObserver((records) => {
      if (
        records.some((record) =>
          record.type === "attributes"
            ? record.target instanceof Element &&
              record.target.matches(".guide-margin > .code-note-slot")
            : [...record.addedNodes, ...record.removedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (node.matches(destinationSelector) ||
                    node.querySelector(destinationSelector)),
              ),
        )
      )
        schedule();
    });
    mutation.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "hidden"],
    });
    const unsubscribe = registry?.subscribe(schedule);
    const stopScroll = observeReviewScroll(viewport, updateIndicator);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      unsubscribe?.();
      stopScroll();
    };
  }, [root, entries, registry, host]);
  return { host, groups, sectionRanges, track, indicator };
}
