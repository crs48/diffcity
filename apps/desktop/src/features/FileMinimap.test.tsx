// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FileMinimap } from "./FileMinimap";
import { createFileNavigation, FileNavigationContext } from "./fileNavigation";
import { DiffChunks } from "./DiffChunks";
import "../i18n";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("mounts in its rail, navigates with the keyboard, and hides for a file that fits", async () => {
  let fileHeight = 2400;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    scale() {},
    fillRect() {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const scroll =
        document.querySelector<HTMLElement>("[data-review-scroll]")
          ?.scrollTop ?? 0;
      const code =
        this.classList.contains("diff-chunks") ||
        this.classList.contains("diff-chunk") ||
        this.hasAttribute("data-map-line");
      const top =
        code || this.hasAttribute("data-file-path")
          ? Number(this.dataset.mapLine ?? 0) * 100 - scroll
          : 0;
      const height = this.hasAttribute("data-file-path")
        ? fileHeight
        : this.hasAttribute("data-map-line")
          ? 100
          : code
            ? 2400
            : 600;
      return {
        top,
        bottom: top + height,
        height,
        width: 72,
        left: 0,
        right: 72,
        x: 0,
        y: top,
      } as DOMRect;
    },
  );
  Element.prototype.scrollTo = vi.fn(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
  });
  const registry = createFileNavigation();
  const lines = Array.from({ length: 24 }, (_, index) => ({
    kind: "addition" as const,
    old: null,
    new: index + 1,
    text: String(index),
  }));
  render(
    <div className="review-document">
      <div className="review-canvas">
        <div data-review-scroll>
          <FileNavigationContext.Provider value={registry}>
            <div data-file-path="src/example.ts">
              <div className="file-bar">src/example.ts</div>
              <DiffChunks
                items={lines}
                minimapLines={lines}
                itemKey={(line) => line.text}
                render={(line, index) => (
                  <div key={line.text} data-map-line={index}>
                    {line.text}
                  </div>
                )}
              />
            </div>
            <FileMinimap />
          </FileNavigationContext.Provider>
        </div>
        <div id="review-minimap-host" />
      </div>
    </div>,
  );
  const slider = await screen.findByRole("slider", {
    name: "Code minimap for src/example.ts",
  });
  expect(slider.closest("#review-minimap-host")).toBeTruthy();
  const viewport = document.querySelector<HTMLElement>("[data-review-scroll]")!;
  fireEvent.keyDown(slider, { key: "End" });
  expect(viewport.scrollTop).toBeGreaterThan(1500);
  fireEvent.keyDown(slider, { key: "Home" });
  expect(viewport.scrollTop).toBe(0);
  fileHeight = 400;
  fireEvent.scroll(viewport);
  await waitFor(() => expect(screen.queryByRole("slider")).toBeNull());
});
