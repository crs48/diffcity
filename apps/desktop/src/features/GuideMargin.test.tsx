// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GuideMargin } from "./GuideMargin";
import { createFileNavigation, FileNavigationContext } from "./fileNavigation";
import type { GuideAnnotation } from "../lib/api";

vi.mock("../ui/CommentMarkdown", () => ({
  CommentMarkdown: ({ body }: { body: string }) => <p>{body}</p>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves the full final note after its short file scrolls away, and releases it only on collapse", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const e = this as HTMLElement;
      const scroll =
        e.closest<HTMLElement>("[data-review-scroll]")?.scrollTop ?? 0;
      let top = -scroll;
      let height: number;
      if (e.hasAttribute("data-review-scroll")) {
        top = 0;
        height = 600;
      } else if (e.classList.contains("guide-code")) height = 900;
      else if (e.hasAttribute("data-file-path")) {
        top += 700;
        height = 150;
      } else if (e.classList.contains("code-note-content"))
        height = e.parentElement?.dataset.noteId ? 1200 : 300;
      else if (e.hasAttribute("data-code-index")) {
        top += 800;
        height = 25;
      } else if (e.classList.contains("code-note-slot")) {
        height = parseFloat(e.style.height) || 0;
        for (
          let previous = e.previousElementSibling as HTMLElement | null;
          previous;
          previous = previous.previousElementSibling as HTMLElement | null
        )
          top += parseFloat(previous.style.height) || 0;
      } else height = 1880;
      return {
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 1000,
        width: 1000,
        height,
        toJSON() {},
      };
    },
  );
  const note: GuideAnnotation = {
    id: "final",
    title: "Registration side effects",
    body: "Every word must remain readable.",
    anchor: {
      path: "index.ts",
      hunkId: "last-hunk",
      side: "RIGHT",
      startLine: 159,
      line: 159,
    },
  };
  const registry = createFileNavigation();
  const { container } = render(
    <FileNavigationContext.Provider value={registry}>
      <div data-review-scroll>
        <section
          className="guide-chapter"
          style={{ display: "grid", gridTemplateColumns: "300px 700px" }}
        >
          <GuideMargin notes={[note]} title="Registration" onRead={() => {}}>
            <h2>Section overview</h2>
          </GuideMargin>
          <div className="guide-code">
            <div data-file-path="index.ts">
              <div data-hunk-id="last-hunk">
                <div data-source>
                  <div data-map-start="0" data-map-end="0">
                    <div data-code-index="0" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </FileNavigationContext.Provider>,
  );
  const remove = registry.register({
    element: container.querySelector<HTMLElement>("[data-source]")!,
    lines: [
      { kind: "addition", old: null, new: 159, text: "export * from './portal';" },
    ],
  });
  const slot = container.querySelector<HTMLElement>("[data-note-id=final]")!;
  const content = slot.firstElementChild;
  await waitFor(() => expect(slot.hidden).toBe(false));
  expect(parseFloat(slot.style.height)).toBe(1200);
  const viewport = container.querySelector<HTMLElement>(
    "[data-review-scroll]",
  )!;
  for (const position of [800, 1100, 1400, 1100, 800]) {
    viewport.scrollTop = position;
    fireEvent.scroll(viewport);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(slot.hidden).toBe(false);
    expect(slot.firstElementChild).toBe(content);
    expect(
      container.querySelector<HTMLElement>(".guide-margin")!.dataset.activeNote,
    ).toBe("final");
  }
  remove();
  await waitFor(() => expect(slot.hidden).toBe(true));
  expect(
    parseFloat(
      container.querySelector<HTMLElement>(".code-note-overview")!.style.height,
    ),
  ).toBe(900);
});
