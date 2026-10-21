// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { followScrollTarget } from "./scrollTarget";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("reconciles measured height changes and yields immediately to a wheel gesture", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const viewport = document.createElement("div"),
    target = document.createElement("h2");
  viewport.append(target);
  document.body.append(viewport);
  Object.defineProperty(viewport, "clientHeight", { value: 600 });
  let targetOffset = 1500;
  viewport.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  target.getBoundingClientRect = () =>
    ({ top: targetOffset - viewport.scrollTop + 100 }) as DOMRect;
  viewport.scrollTo = vi.fn((options) => {
    viewport.scrollTop = (options as ScrollToOptions).top!;
  });
  const settled = vi.fn();
  followScrollTarget(viewport, target, () => 70, settled);
  expect(viewport.scrollTop).toBe(1430);
  targetOffset += 400;
  const tick = [...frames.entries()][0];
  frames.delete(tick[0]);
  tick[1](0);
  expect(viewport.scrollTop).toBe(1830);
  viewport.dispatchEvent(new WheelEvent("wheel"));
  expect(frames.size).toBe(0);
  expect(settled).toHaveBeenCalledOnce();
});
