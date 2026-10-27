import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultRangeExtractor,
  observeElementOffset,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { useVirtualReview } from "./reviewRendering";
import type { DiffLine } from "../lib/api";
import { FileNavigationContext } from "./fileNavigation";
import { observeReviewScroll } from "../lib/reviewViewport";

// Stable code boundaries keep discussions from shifting later row identities.
export const DIFF_CHUNK_SIZE = 64;

export function DiffChunks<T>({
  items,
  render,
  itemKey,
  startsChunk = (_, index) => index % DIFF_CHUNK_SIZE === 0,
  keepItem = () => false,
  estimateItem = () => 25,
  minimapLines,
  lineIndex = (_, index) => index,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  itemKey: (item: T) => string;
  startsChunk?: (item: T, index: number) => boolean;
  keepItem?: (item: T) => boolean;
  estimateItem?: (item: T) => number;
  minimapLines?: readonly DiffLine[];
  lineIndex?: (item: T, index: number) => number | null;
}) {
  const virtual = useVirtualReview();
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const navigation = useContext(FileNavigationContext);
  useLayoutEffect(() => {
    if (root.current && minimapLines?.length && navigation)
      return navigation.register({
        element: root.current,
        lines: minimapLines,
      });
  }, [minimapLines, navigation]);
  const sizes = useRef(new Map<string, number>());
  const [near, setNear] = useState(false);
  const [margin, setMargin] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const [nativeRange, setNativeRange] = useState<number[]>([]);
  const [requested, setRequested] = useState<number | null>(null);
  const chunks = items.reduce<Array<Array<{ item: T; index: number }>>>(
    (result, item, index) => {
      if (index === 0 || startsChunk(item, index)) result.push([]);
      result.at(-1)!.push({ item, index });
      return result;
    },
    [],
  );
  const keys = chunks.map((chunk) => itemKey(chunk[0].item));
  const pinned = new Set(nativeRange);
  chunks.forEach((chunk, index) => {
    if (chunk.some(({ item }) => keepItem(item))) pinned.add(index);
  });
  if (focused !== null) {
    // The adjacent block is also available for Tab and Shift-arrow navigation.
    for (
      let i = Math.max(0, focused - 1);
      i <= Math.min(chunks.length - 1, focused + 1);
      i++
    )
      pinned.add(i);
  }
  if (requested !== null) pinned.add(requested);
  const pinnedKey = [...pinned].sort((a, b) => a - b).join(",");
  const rangeExtractor = useMemo(
    () => (range: Range) =>
      [
        ...new Set([
          ...(near ? defaultRangeExtractor(range) : []),
          ...pinnedKey.split(",").filter(Boolean).map(Number),
        ]),
      ].sort((a, b) => a - b),
    [near, pinnedKey],
  );
  const keyList = keys.join("\n");
  const getItemKey = useMemo(() => {
    const values = keyList.split("\n");
    return (index: number) => values[index];
  }, [keyList]);
  const estimate = (index: number) =>
    sizes.current.get(keys[index]) ??
    chunks[index].reduce((sum, row) => sum + estimateItem(row.item), 0);
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: chunks.length,
    enabled: virtual,
    getScrollElement: () =>
      root.current?.closest<HTMLElement>("[data-review-scroll]") ?? null,
    getItemKey,
    estimateSize: estimate,
    scrollMargin: margin,
    overscan: 2,
    indexAttribute: "data-virtual-index",
    rangeExtractor,
    useFlushSync: false,
    // Multiple hunk windows observe one document. Only the document and its
    // navigation controls may write an absolute scroll position.
    scrollToFn: () => {},
    observeElementOffset: (instance, callback) => {
      callback(instance.scrollElement?.scrollTop ?? 0, false);
      return observeElementOffset(instance, callback);
    },
    measureElement: (element, entry) => {
      const height =
        entry?.borderBoxSize?.[0]?.blockSize ??
        element.getBoundingClientRect().height;
      const key = element.dataset.chunkKey!;
      const index = Number(element.dataset.virtualIndex);
      const previous = sizes.current.get(key) ?? estimate(index);
      if (height > 0) {
        sizes.current.set(key, height);
        const viewport = root.current?.closest<HTMLElement>(
          "[data-review-scroll]",
        );
        const delta = height - previous;
        // Compensate only a whole block above the reader. Growth inside a
        // visible inline reply must not drag the reader toward its bottom.
        if (
          viewport &&
          delta &&
          element.getBoundingClientRect().top + previous <=
            viewport.getBoundingClientRect().top
        ) {
          viewport.scrollTop += delta;
        }
      }
      return height > 0 ? height : previous;
    },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  // All hunks share the review viewport. Only nearby ones render code; keeping
  // normal-flow block shells preserves sticky chapters and exact visited heights.
  useLayoutEffect(() => {
    if (!virtual) return;
    const element = root.current;
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (!element || !viewport) return;
    let region = { top: 0, bottom: 0, near: false };
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const top = viewport.scrollTop + bounds.top - view.top;
      const near =
        bounds.bottom >= view.top - 2000 && bounds.top <= view.bottom + 2000;
      region = { top, bottom: top + bounds.height, near };
      setMargin(top);
      setNear(near);
    };
    measure();
    // Cached numeric bounds make offscreen checks cheap. IntersectionObserver
    // can retain stale visibility at clipped/sticky file boundaries in WebKit.
    const stopScroll = observeReviewScroll(viewport, (top, height) => {
      const near =
        region.bottom >= top - 2000 && region.top <= top + height + 2000;
      if (near !== region.near) measure();
    });
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    resize.observe(element);
    const panel = element.closest(".review-panel, .review-code");
    if (panel) resize.observe(panel);
    return () => {
      stopScroll();
      resize.disconnect();
    };
  }, [virtual]);
  useEffect(() => {
    if (!virtual) return;
    const update = () => {
      const element = root.current;
      const selection = document.getSelection();
      const range =
        selection?.rangeCount && !selection.isCollapsed
          ? selection.getRangeAt(0)
          : null;
      const selected =
        element && range
          ? [...element.children].flatMap((chunk, index) =>
              range.intersectsNode(chunk) ? [index] : [],
            )
          : [];
      setNativeRange((previous) =>
        previous.join(",") === selected.join(",") ? previous : selected,
      );
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [virtual]);
  useLayoutEffect(() => {
    if (requested === null) return;
    const chunk = root.current?.children[requested];
    const target = chunk?.querySelector<HTMLElement>(
      ".diff-line button:not(:disabled), .diff-chunk-content",
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
    setRequested(null);
  }, [requested]);
  const mounted = new Set([
    ...virtualizer.getVirtualItems().map((item) => item.index),
    ...pinned,
  ]);
  const onFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!virtual) return;
      const chunk = (event.target as Element).closest<HTMLElement>(
        "[data-chunk-index]",
      );
      if (chunk) setFocused(Number(chunk.dataset.chunkIndex));
    },
    [virtual],
  );
  return (
    <div
      className="diff-chunks"
      ref={root}
      data-virtualized={virtual}
      onFocusCapture={onFocus}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(null);
      }}
    >
      {chunks.map((chunk, index) => {
        const visible = !virtual || mounted.has(index);
        const lines = minimapLines
          ? chunk.flatMap(({ item, index: rowIndex }) => {
              const line = lineIndex(item, rowIndex);
              return line === null ? [] : [line];
            })
          : [];
        return (
          <div
            className="diff-chunk"
            key={keys[index]}
            data-chunk-index={index}
            data-map-start={lines[0]}
            data-map-end={lines.at(-1)}
            style={visible ? undefined : { height: estimate(index) }}
          >
            {visible ? (
              <div
                className="diff-chunk-content"
                data-virtual-index={index}
                data-chunk-key={keys[index]}
                ref={virtual ? virtualizer.measureElement : undefined}
                tabIndex={-1}
              >
                {chunk.map(({ item, index: rowIndex }) =>
                  render(item, rowIndex),
                )}
              </div>
            ) : (
              <button
                className="virtual-code-gap"
                onFocus={() => setRequested(index)}
                onClick={() => setRequested(index)}
              >
                {t("Load code block {{number}}", { number: index + 1 })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Binary search the paint blocks, then their variable-height rows (including threads). */
export function rowAtOffset(
  element: HTMLElement,
  offset: number,
): HTMLElement | null {
  const y = element.getBoundingClientRect().top + offset;
  const atY = (rows: HTMLCollection): HTMLElement | null => {
    let left = 0,
      right = rows.length - 1;
    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      const row = rows[middle] as HTMLElement;
      const bounds = row.getBoundingClientRect();
      if (y < bounds.top) right = middle - 1;
      else if (y >= bounds.bottom) left = middle + 1;
      else return row;
    }
    return null;
  };
  const blocks = element.firstElementChild?.classList.contains("diff-chunks")
    ? element.firstElementChild
    : element;
  const chunk = atY(blocks.children);
  const content = chunk?.querySelector(":scope > .diff-chunk-content") ?? chunk;
  return content ? atY(content.children) : null;
}
