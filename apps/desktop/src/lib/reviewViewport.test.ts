// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeReviewScroll } from "./reviewViewport";
afterEach(() => vi.unstubAllGlobals());

it("batches scroll work for every hunk and keeps remaining subscribers after cleanup", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientHeight", { value: 600 });
  const a = vi.fn(),
    b = vi.fn();
  const stopA = observeReviewScroll(viewport, a),
    stopB = observeReviewScroll(viewport, b);
  for (let i = 0; i < 20; i++) {
    viewport.scrollTop = i * 100;
    viewport.dispatchEvent(new Event("scroll"));
  }
  expect(frames.size).toBe(1);
  const tick = () => {
    const [key, callback] = [...frames][0];
    frames.delete(key);
    callback(0);
  };
  tick();
  expect(a).toHaveBeenCalledExactlyOnceWith(1900, 600);
  expect(b).toHaveBeenCalledExactlyOnceWith(1900, 600);
  stopA();
  viewport.scrollTop = 2000;
  viewport.dispatchEvent(new Event("scroll"));
  tick();
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenLastCalledWith(2000, 600);
  viewport.dispatchEvent(new Event("scroll"));
  stopB();
  expect(frames.size).toBe(0);
});
