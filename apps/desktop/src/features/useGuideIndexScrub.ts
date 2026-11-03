import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/** Keep high-frequency pointer movement out of React's render path. A click on
 * a marker keeps its exact destination; dragging it takes over as a scrollbar. */
export function useGuideIndexScrub(
  root: RefObject<HTMLDivElement | null>,
  track: RefObject<HTMLDivElement | null>,
  scrubber: RefObject<HTMLDivElement | null>,
) {
  const [scrubbing, setScrubbing] = useState(false);
  const didDrag = useRef(false);
  const gesture = useRef<{
    id: number;
    startY: number;
    y: number;
    active: boolean;
  } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const viewport = () =>
    root.current?.closest<HTMLElement>("[data-review-scroll]");
  const takeControl = () => {
    viewport()?.dispatchEvent(new Event("review-scroll-intent"));
    setScrubbing(true);
    scrubber.current?.focus({ preventScroll: true });
  };
  const move = (y: number) => {
    const scroll = viewport(),
      element = root.current,
      rail = track.current;
    if (!scroll || !element || !rail) return;
    const bounds = rail.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (y - bounds.top) / Math.max(1, bounds.height)),
    );
    const document = element.getBoundingClientRect();
    const offset =
      document.top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({
      top: Math.max(
        0,
        Math.min(
          scroll.scrollHeight - scroll.clientHeight,
          offset + ratio * document.height - scroll.clientHeight / 2,
        ),
      ),
      behavior: "instant",
    });
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (current.active && event.type === "pointerup") move(event.clientY);
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setScrubbing(false);
  };
  return {
    scrubbing,
    didDrag,
    pointerHandlers: {
      onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
        // Ignore events bubbling through React portals from a preview.
        if (
          event.button !== 0 ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        const marker = (event.target as Element).closest("[data-index-marker]");
        didDrag.current = false;
        gesture.current = {
          id: event.pointerId,
          startY: event.clientY,
          y: event.clientY,
          active: !marker,
        };
        // Keep receiving movement even if the first move leaves the small hit area.
        if (marker) marker.setPointerCapture(event.pointerId);
        if (!marker) {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          takeControl();
          move(event.clientY);
        }
      },
      onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        current.y = event.clientY;
        if (Math.abs(current.y - current.startY) >= 4) {
          didDrag.current = true;
          if (!current.active) {
            current.active = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            takeControl();
          }
        }
        if (!current.active) return;
        event.preventDefault();
        if (!frame.current)
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            if (gesture.current?.active) move(gesture.current.y);
          });
      },
      onPointerUpCapture: finish,
      onPointerCancelCapture: finish,
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
        // A marker loses capture when we transfer its drag to the whole track.
        if (event.target === event.currentTarget) finish(event);
      },
      onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
        if (
          didDrag.current &&
          event.detail !== 0 &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const scroll = viewport();
      if (!scroll) return;
      const destinations: Record<string, number> = {
        ArrowUp: scroll.scrollTop - 80,
        ArrowDown: scroll.scrollTop + 80,
        PageUp: scroll.scrollTop - scroll.clientHeight,
        PageDown: scroll.scrollTop + scroll.clientHeight,
        Home: 0,
        End: scroll.scrollHeight - scroll.clientHeight,
      };
      if (!(event.key in destinations)) return;
      event.preventDefault();
      didDrag.current = false;
      scroll.dispatchEvent(new Event("review-scroll-intent"));
      scroll.scrollTo({
        top: Math.max(0, destinations[event.key]),
        behavior: "instant",
      });
    },
  };
}
