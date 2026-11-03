// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useGuideIndexScrub } from "./useGuideIndexScrub";
import { followScrollTarget } from "../lib/scrollTarget";

const jump = vi.fn();
function Example() {
  const root = useRef<HTMLDivElement>(null),
    track = useRef<HTMLDivElement>(null),
    scrubber = useRef<HTMLDivElement>(null);
  const scrub = useGuideIndexScrub(root, track, scrubber);
  return (
    <>
      <div ref={track} data-testid="track" {...scrub.pointerHandlers}>
        <div
          ref={scrubber}
          role="slider"
          tabIndex={0}
          aria-label="Position"
          onKeyDown={scrub.onKeyDown}
        />
        <button data-index-marker="example" onClick={jump}>
          Marker
        </button>
      </div>
      <div data-review-scroll data-testid="viewport">
        <div ref={root} data-testid="root" />
      </div>
    </>
  );
}
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  frames = new Map();
  let sequence = 0;
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++sequence, fn);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.releasePointerCapture = vi.fn();
  jump.mockClear();
  render(<Example />);
  const viewport = screen.getByTestId("viewport"),
    root = screen.getByTestId("root"),
    track = screen.getByTestId("track");
  Object.defineProperties(viewport, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 10600 },
  });
  viewport.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
  root.getBoundingClientRect = () =>
    ({ top: 150 - viewport.scrollTop, height: 10500 }) as DOMRect;
  track.getBoundingClientRect = () => ({ top: 100, height: 500 }) as DOMRect;
  viewport.scrollTo = vi.fn((options) => {
    viewport.scrollTop = (options as ScrollToOptions).top!;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = () =>
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });

it("maps clicks to document positions, coalesces dragging, and clamps the ends", () => {
  const track = screen.getByTestId("track"),
    viewport = screen.getByTestId("viewport");
  fireEvent.pointerDown(screen.getByRole("slider"), {
    button: 0,
    clientY: 350,
  });
  expect(viewport.scrollTop).toBe(5050);
  expect(document.activeElement).toBe(screen.getByRole("slider"));
  const scroll = vi.mocked(viewport.scrollTo);
  scroll.mockClear();
  fireEvent.pointerMove(track, { clientY: 450 });
  fireEvent.pointerMove(track, { clientY: 500 });
  expect(scroll).not.toHaveBeenCalled();
  tick();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(viewport.scrollTop).toBe(8200);
  fireEvent.pointerUp(track, { clientY: 800 });
  expect(viewport.scrollTop).toBe(10000);
  fireEvent.pointerDown(track, { button: 0, clientY: 0 });
  expect(viewport.scrollTop).toBe(0);
});

it("preserves marker clicks, but dragging a marker cannot trigger a second jump", () => {
  const marker = screen.getByRole("button"),
    viewport = screen.getByTestId("viewport");
  fireEvent.pointerDown(marker, { button: 0, clientY: 350 });
  fireEvent.pointerUp(marker, { clientY: 350 });
  fireEvent.click(marker, { detail: 1 });
  expect(jump).toHaveBeenCalledOnce();
  expect(viewport.scrollTo).not.toHaveBeenCalled();
  jump.mockClear();
  fireEvent.pointerDown(marker, { button: 0, clientY: 350 });
  fireEvent.pointerMove(marker, { clientY: 500 });
  fireEvent.lostPointerCapture(marker);
  tick();
  fireEvent.pointerUp(marker, { clientY: 500 });
  fireEvent.click(marker, { detail: 1 });
  expect(viewport.scrollTop).toBe(8200);
  expect(jump).not.toHaveBeenCalled();
});

it("cancels pending movement on pointer cancellation and accepts keyboard scrolling", () => {
  const track = screen.getByTestId("track"),
    viewport = screen.getByTestId("viewport"),
    slider = screen.getByRole("slider");
  fireEvent.pointerDown(track, { button: 2, clientY: 350 });
  expect(viewport.scrollTo).not.toHaveBeenCalled();
  fireEvent.pointerDown(track, { button: 0, clientY: 100 });
  fireEvent.pointerMove(track, { clientY: 500 });
  fireEvent.pointerCancel(track);
  tick();
  expect(viewport.scrollTop).toBe(0);
  fireEvent.keyDown(slider, { key: "PageDown" });
  expect(viewport.scrollTop).toBe(600);
  fireEvent.keyDown(slider, { key: "End" });
  expect(viewport.scrollTop).toBe(10000);
  fireEvent.keyDown(slider, { key: "Home" });
  expect(viewport.scrollTop).toBe(0);
});

it("takes control from a settling exact jump so virtual measurement cannot pull it back", () => {
  const track = screen.getByTestId("track"),
    viewport = screen.getByTestId("viewport"),
    root = screen.getByTestId("root");
  const settled = vi.fn();
  followScrollTarget(viewport, root, () => 16, settled);
  expect(frames.size).toBe(1);
  fireEvent.pointerDown(track, { button: 0, clientY: 350 });
  expect(settled).toHaveBeenCalledOnce();
  tick();
  expect(viewport.scrollTop).toBe(5050);
});
