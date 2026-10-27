// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { noteTarget, type GuideIndexEntry } from "../lib/guideIndex";
import { useGuideIndexLayout } from "./useGuideIndexLayout";

const entries: GuideIndexEntry[] = ["first", "last"].map((id) => ({
  id,
  kind: "note",
  title: id,
  body: "Read this beside its code.",
  sectionId: "chapter",
  sectionNumber: 1,
  target: noteTarget("chapter", id),
}));

function Example() {
  const root = useRef<HTMLDivElement>(null);
  const { groups, track, indicator } = useGuideIndexLayout(root, entries);
  return (
    <div className="review-canvas">
      <div id="review-guide-index">
        <div ref={track} data-track>
          <div ref={indicator} data-indicator />
          {groups.map((group) => (
            <span
              key={group.id}
              data-marker={group.items[0].id}
              style={{ top: group.top }}
            />
          ))}
        </div>
      </div>
      <div data-review-scroll>
        <div ref={root} data-root>
          <section data-guide-section="chapter">
            <aside className="guide-margin">
              <div
                className="code-note-slot code-note-overview"
                style={{ height: 1000 }}
              />
              <div
                className="code-note-slot"
                data-note-id="first"
                style={{ height: 1000 }}
                hidden
              >
                <h3 style={{ position: "sticky" }}>First note</h3>
              </div>
              <div
                className="code-note-slot"
                data-note-id="last"
                style={{ height: 3000 }}
                hidden
              >
                <h3 style={{ position: "sticky" }}>Last note</h3>
              </div>
              <svg>
                <path data-note-connector="last" />
              </svg>
            </aside>
            <div className="guide-code">
              {entries.map((entry) => (
                <article key={entry.id} data-guide-index-target={entry.target}>
                  Full detail copy
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("tracks settled margin positions instead of duplicate details, without measuring on scroll", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const scroll =
        this.closest<HTMLElement>("[data-review-scroll]")?.scrollTop ?? 0;
      let top = -scroll;
      if (this.matches(".code-note-slot")) {
        for (
          let previous = this.previousElementSibling as HTMLElement | null;
          previous;
          previous = previous.previousElementSibling as HTMLElement | null
        )
          top += parseFloat(previous.style.height) || 0;
      } else if (this.hasAttribute("data-guide-index-target")) top += 100;
      else if (this.hasAttribute("data-review-scroll")) top = 0;
      return {
        x: 0,
        y: top,
        top,
        bottom: top + 5000,
        left: 0,
        right: 1000,
        width: 1000,
        height: 5000,
        toJSON() {},
      };
    });
  const { container } = render(<Example />);
  const marker = (id: string) =>
    container.querySelector<HTMLElement>(`[data-marker="${id}"]`)!;
  const first = container.querySelector<HTMLElement>('[data-note-id="first"]')!;
  const last = container.querySelector<HTMLElement>('[data-note-id="last"]')!;
  const overview = container.querySelector<HTMLElement>(".code-note-overview")!;
  const viewport = container.querySelector<HTMLElement>(
    "[data-review-scroll]",
  )!;
  const indicator = container.querySelector<HTMLElement>("[data-indicator]")!;

  // Both hidden margin notes initially fall back to their full-detail copies.
  await waitFor(() => expect(marker("first")?.style.top).toBe("0px"));
  first.hidden = false;
  last.hidden = false;
  await waitFor(() => expect(marker("last")?.style.top).toBe("226px"));
  expect(marker("first").style.top).toBe("106px");

  // Asynchronous margin layout can move notes without changing chapter height.
  overview.style.height = "2500px";
  first.style.height = "500px";
  last.style.height = "2000px";
  await waitFor(() => expect(marker("last").style.top).toBe("346px"));
  expect(marker("first").style.top).toBe("286px");

  const reads = bounds.mock.calls.length;
  viewport.scrollTop = 3000;
  fireEvent.scroll(viewport);
  last.querySelector("h3")!.style.top = "16px";
  container.querySelector("path")!.setAttribute("d", "M0 0 L20 40");
  await waitFor(() =>
    expect(indicator.style.transform).toBe("translateY(360px)"),
  );
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(marker("last").style.top).toBe("346px");
  expect(bounds.mock.calls.length).toBe(reads);

  // Responsive single-column layouts fall back to visible full details.
  first.hidden = true;
  last.hidden = true;
  await waitFor(() => expect(marker("first").style.top).toBe("0px"));
});
