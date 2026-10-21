import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { Anchor, Hunk, Side } from "../lib/api";
import { rangeAnchor } from "../lib/selection";

const rowHeight = 25;
type Endpoint = { side: Side; origin: number; end: number };
type Drag = Endpoint & { pointerId: number; clientY: number };

const lineAtPointer = (hunk: Hunk, element: HTMLDivElement, active: Drag) => {
  const bounds = element.getBoundingClientRect();
  const y = active.clientY - bounds.top;
  const index = Math.max(
    0,
    Math.min(
      hunk.lines.length - 1,
      Math.floor(
        (Math.max(0, Math.min(bounds.height - 1, y)) + element.scrollTop) /
          rowHeight,
      ),
    ),
  );
  const position = hunk.lines[index];
  return (active.side === "LEFT" ? position.old : position.new) ?? active.end;
};

export function useLineSelection(
  hunk: Hunk,
  selection: Anchor | null,
  scroll: RefObject<HTMLDivElement | null>,
  onSelect: (anchor: Anchor) => void,
  scrollToIndex: (index: number) => void,
) {
  const pivot = useRef<Endpoint | null>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Anchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const originFor = (line: number, side: Side, extend: boolean) => {
    if (!extend || selection?.hunkId !== hunk.id || selection.side !== side)
      return line;
    const previous = pivot.current;
    // Keep the original endpoint so extending a selection can also shrink it.
    return previous?.side === side &&
      Math.min(previous.origin, previous.end) === selection.startLine &&
      Math.max(previous.origin, previous.end) === selection.line
      ? previous.origin
      : selection.startLine;
  };
  const commit = (origin: number, end: number, side: Side) => {
    pivot.current = { origin, end, side };
    onSelect(rangeAnchor(hunk, side, origin, end));
  };
  const select = (line: number, side: Side, extend: boolean) =>
    commit(originFor(line, side, extend), line, side);

  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const update = () => {
      const active = drag.current;
      const element = scroll.current;
      if (!active || !element) return;
      const bounds = element.getBoundingClientRect();
      const y = active.clientY - bounds.top;
      // Keep dragging usable when a hunk has virtualized, offscreen rows.
      if (y < 24) element.scrollTop -= Math.min(16, (24 - y) / 2);
      else if (y > bounds.height - 24)
        element.scrollTop += Math.min(16, (y - bounds.height + 24) / 2);
      const end = lineAtPointer(hunk, element, active);
      if (end !== active.end) {
        active.end = end;
        setPreview(rangeAnchor(hunk, active.side, active.origin, end));
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [dragging, hunk, scroll]);

  const pointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    line: number,
    side: Side,
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus();
    const origin = originFor(line, side, event.shiftKey);
    drag.current = {
      pointerId: event.pointerId,
      origin,
      end: line,
      side,
      clientY: event.clientY,
    };
    scroll.current?.setPointerCapture(event.pointerId);
    setPreview(rangeAnchor(hunk, side, origin, line));
    setDragging(true);
  };
  const finish = (event: PointerEvent, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setPreview(null);
    if (scroll.current?.hasPointerCapture(event.pointerId))
      scroll.current.releasePointerCapture(event.pointerId);
    if (!cancelled) commit(active.origin, active.end, active.side);
  };
  const keyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    line: number,
    side: Side,
  ) => {
    if (!event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    const positions = hunk.lines.flatMap((row, index) => {
      const n = side === "LEFT" ? row.old : row.new;
      return n === null ? [] : [{ line: n, index }];
    });
    const current = positions.findIndex((p) => p.line === line);
    const next = positions[current + (event.key === "ArrowUp" ? -1 : 1)];
    if (!next) return;
    commit(originFor(line, side, true), next.line, side);
    scrollToIndex(next.index);
    requestAnimationFrame(() => {
      scroll.current
        ?.querySelector<HTMLButtonElement>(
          `[data-side="${side}"][data-line="${next.line}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  };
  return {
    selected: preview ?? selection,
    dragging,
    select,
    pointerDown,
    keyDown,
    pointerMove: (event: PointerEvent) => {
      const active = drag.current;
      if (active?.pointerId === event.pointerId && scroll.current) {
        active.clientY = event.clientY;
        active.end = lineAtPointer(hunk, scroll.current, active);
        setPreview(rangeAnchor(hunk, active.side, active.origin, active.end));
      }
    },
    pointerUp: (event: PointerEvent) => finish(event),
    pointerCancel: (event: PointerEvent) => finish(event, true),
  };
}
