// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DiffChunks } from "./DiffChunks";
import { ReviewRenderingContext } from "./reviewRendering";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-review-scroll")
        ? 600
        : this.getBoundingClientRect().height;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const chunk = this.closest<HTMLElement>(".diff-chunk");
      const scroll = this.closest<HTMLElement>("[data-review-scroll]");
      const viewport = this.hasAttribute("data-review-scroll");
      const height = viewport
        ? 600
        : this.classList.contains("diff-chunks")
          ? this.children.length * 1600
          : this.classList.contains("diff-chunk-content")
            ? this.children.length * 25
            : Number.parseFloat(this.style.height) || 1600;
      const top = viewport
        ? 0
        : Number(scroll?.dataset.codeOffset ?? 0) +
          Number(chunk?.dataset.chunkIndex ?? 0) * 1600 -
          (scroll?.scrollTop ?? 0);
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: top,
      } as DOMRect;
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items = Array.from({ length: 1000 }, (_, index) => index);
const example = (all = false, selected = -1, offset = 0) => (
  <>
    <button>Outside code</button>
    <div data-review-scroll data-code-offset={offset}>
      <ReviewRenderingContext.Provider value={!all}>
        <DiffChunks
          items={items}
          itemKey={(index) => String(index)}
          keepItem={(index) => index === selected}
          render={(index) => (
            <div key={index}>
              <button>Line {index + 1}</button>
            </div>
          )}
        />
      </ReviewRenderingContext.Provider>
    </div>
  </>
);

it("mounts a bounded window, retains focused and selected code, and restores all-code mode", async () => {
  const { container, rerender } = render(example());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Line 1" })).toBeTruthy(),
  );
  expect(
    container.querySelectorAll(".diff-chunk-content button").length,
  ).toBeLessThan(400);
  expect(screen.queryByRole("button", { name: "Line 900" })).toBeNull();
  const first = screen.getByRole("button", { name: "Line 1" });
  fireEvent.focusIn(first);
  const viewport = container.querySelector<HTMLElement>(
    "[data-review-scroll]",
  )!;
  viewport.scrollTop = 20000;
  fireEvent.scroll(viewport);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Line 805" })).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Line 1" })).toBe(first);
  rerender(example(false, 449));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Line 450" })).toBeTruthy(),
  );
  rerender(example(true));
  expect(container.querySelectorAll(".diff-chunk-content button")).toHaveLength(
    1000,
  );
  rerender(example());
  await waitFor(() =>
    expect(
      container.querySelectorAll(".diff-chunk-content button").length,
    ).toBeLessThan(600),
  );
});

it("loads a newly visible hunk when no intersection notification arrives", async () => {
  const { container } = render(example(false, -1, 50000));
  expect(screen.queryByRole("button", { name: "Line 1" })).toBeNull();
  const viewport = container.querySelector<HTMLElement>(
    "[data-review-scroll]",
  )!;
  viewport.scrollTop = 49500;
  fireEvent.scroll(viewport);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Line 1" })).toBeTruthy(),
  );
  expect(
    container.querySelectorAll(".diff-chunk-content button").length,
  ).toBeLessThan(400);
  viewport.scrollTop = 90000;
  fireEvent.scroll(viewport);
  await waitFor(() =>
    expect(container.querySelectorAll(".diff-chunk-content")).toHaveLength(0),
  );
});
