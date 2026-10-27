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
      {
        kind: "addition",
        old: null,
        new: 159,
        text: "export * from './portal';",
      },
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

it("keeps connectors attached before a note becomes active and after its code leaves the viewport", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let codeTop = 260;
  let noteTop = 320;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      let top = 0,
        height = 1800,
        left = 0,
        width = 300;
      if (this.hasAttribute("data-review-scroll")) height = 600;
      else if (
        this.classList.contains("code-note-slot") ||
        this.classList.contains("code-note-content")
      ) {
        top = this.closest<HTMLElement>("[data-note-id]") ? noteTop : 0;
        height = 300;
      } else if (this.hasAttribute("data-map-start")) {
        top = codeTop;
        height = 100;
      } else if (this.hasAttribute("data-map-line")) {
        top = codeTop + Number(this.dataset.mapLine) * 25;
        height = 25;
      }
      if (this.closest(".guide-code")) {
        left = 328;
        width = 672;
      }
      return {
        x: left,
        y: top,
        top,
        bottom: top + height,
        left,
        right: left + width,
        width,
        height,
        toJSON() {},
      };
    },
  );
  const notes: GuideAnnotation[] = [0, 1].map((index) => ({
    id: `note-${index}`,
    title: `Note ${index}`,
    body: "Keep the connection visible.",
    anchor: {
      path: "index.ts",
      hunkId: "hunk",
      side: index === 0 ? "RIGHT" : "LEFT",
      startLine: index + 1,
      line: index + 3,
    },
  }));
  const registry = createFileNavigation();
  const { container } = render(
    <FileNavigationContext.Provider value={registry}>
      <div data-review-scroll>
        <section
          className="guide-chapter"
          style={{ display: "grid", gridTemplateColumns: "300px 700px" }}
        >
          <GuideMargin notes={notes} title="Section" onRead={() => {}}>
            <h2>Overview</h2>
          </GuideMargin>
          <div className="guide-code">
            <div data-file-path="index.ts">
              <div data-hunk-id="hunk">
                <div data-source>
                  <div data-map-start="0" data-map-end="3">
                    {[0, 1, 2, 3].map((index) => (
                      <div key={index} data-map-line={index} />
                    ))}
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
    lines: [1, 2, 3, 4].map((line) => ({
      kind: "addition",
      old: line,
      new: line,
      text: "code",
    })),
  });
  const viewport = container.querySelector<HTMLElement>(
    "[data-review-scroll]",
  )!;
  const paths = () => [
    ...container.querySelectorAll<SVGPathElement>(".code-note-connector path"),
  ];
  await waitFor(() =>
    expect(paths().filter((p) => p.getAttribute("d"))).toHaveLength(2),
  );
  expect(
    container.querySelector<HTMLElement>(".guide-margin")!.dataset.activeNote,
  ).toBeUndefined();
  const geometry = () =>
    paths().map((path) => {
      const numbers = path
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      // M fromX fromY H elbowX V codeY H codeX M codeX topY V bottomY
      return {
        from: numbers[1],
        code: numbers[3],
        top: numbers[6],
        bottom: numbers[7],
      };
    });
  const scroll = async () => {
    fireEvent.scroll(viewport);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  for (const position of [260, 20, -300, 700, 260]) {
    codeTop = position;
    await scroll();
    expect(paths().every((path) => !!path.getAttribute("d"))).toBe(true);
    expect(geometry()[0]).toMatchObject({
      code: codeTop + 37.5,
      top: codeTop,
      bottom: codeTop + 75,
    });
    expect(geometry()[1]).toMatchObject({
      code: codeTop + 62.5,
      top: codeTop + 25,
      bottom: codeTop + 100,
    });
  }
  // Offscreen blocks keep their geometry even after their code rows unmount.
  container.querySelector("[data-map-start]")!.replaceChildren();
  codeTop = -500;
  noteTop = -100; // A long note's heading has scrolled away, but its body remains.
  await scroll();
  expect(geometry()[0]).toMatchObject({
    code: -462.5,
    top: -500,
    bottom: -425,
  });
  expect(geometry()[0].from).toBeGreaterThanOrEqual(16);
  remove();
  await waitFor(() =>
    expect(paths().every((path) => !path.getAttribute("d"))).toBe(true),
  );
});
