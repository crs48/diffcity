// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GuideView } from "./Guide";
import type { ReviewWorkspace } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const viewport = this.closest<HTMLElement>("[data-review-scroll]");
      const index = Number(this.dataset.testChapter ?? 0);
      const top = this.hasAttribute("data-guide-section")
        ? index * 1000 - (viewport?.scrollTop ?? 0)
        : 0;
      return {
        top,
        bottom: top + 1000,
        left: 0,
        right: 1000,
        width: 1000,
        height: this.classList.contains("guide-navigation") ? 54 : 1000,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  Element.prototype.scrollTo = vi.fn(function (
    this: Element,
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Example({
  initial = fixture as ReviewWorkspace,
}: {
  initial?: ReviewWorkspace;
}) {
  const [w, setW] = useState(structuredClone(initial));
  return (
    <div
      data-review-scroll
      ref={(el) => {
        if (el)
          Object.defineProperty(el, "clientHeight", {
            configurable: true,
            value: 600,
          });
      }}
    >
      <GuideView
        workspace={w}
        mode="guide"
        selection={null}
        onSelect={() => {}}
        onDiscuss={() => {}}
        onProgress={(p) => setW((current) => ({ ...current, progress: p }))}
        onFinish={() => {}}
      />
    </div>
  );
}
const mount = (initial?: ReviewWorkspace) => {
  render(<Example initial={initial} />);
  document
    .querySelectorAll<HTMLElement>("[data-guide-section]")
    .forEach((el, i) => (el.dataset.testChapter = String(i)));
};
it("keeps every chapter mounted while jumping and preserves independent reviewed/collapsed state", async () => {
  const user = userEvent.setup();
  mount();
  const first = screen.getByRole("region", {
    name: fixture.guide.sections[0].title,
  });
  const second = screen.getByRole("region", {
    name: fixture.guide.sections[1].title,
  });
  expect(document.querySelectorAll("[data-guide-section]")).toHaveLength(5);
  const firstDiff = first.querySelector("[data-code-index]");
  await user.click(
    within(first).getByRole("button", { name: "Mark code reviewed" }),
  );
  await user.click(screen.getByRole("button", { name: "Next section" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(second).getByRole("heading", { level: 2 }),
    ),
  );
  expect(
    document.querySelector<HTMLElement>("[data-review-scroll]")!.scrollTop,
  ).toBe(930);
  expect(first.querySelector("[data-code-index]")).toBe(firstDiff);
  expect(
    within(first).getByRole("button", { name: "Code reviewed" }),
  ).toBeTruthy();
  await user.click(
    within(first).getByRole("button", { name: "Collapse changes" }),
  );
  await user.click(
    within(second).getByRole("button", { name: "Collapse changes" }),
  );
  await user.click(
    within(first).getByRole("button", { name: "Expand all changes" }),
  );
  expect(first.querySelector("[data-code-index]")).toBeTruthy();
  expect(second.querySelector("[data-code-index]")).toBeNull();
});
it("tracks scrolling without resetting the viewport or moving keyboard focus", async () => {
  mount();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const viewport = document.querySelector<HTMLElement>("[data-review-scroll]")!;
  const focus = screen.getByRole("button", { name: "Next section" });
  focus.focus();
  viewport.scrollTop = 1050;
  fireEvent.scroll(viewport);
  await screen.findByRole("button", { name: "Review outline, section 2 of 5" });
  expect(viewport.scrollTop).toBe(1050);
  expect(document.activeElement).toBe(focus);
  viewport.scrollTop = 3050;
  fireEvent.scroll(viewport);
  await screen.findByRole("button", { name: "Review outline, section 4 of 5" });
  expect(viewport.scrollTop).toBe(3050);
  Object.defineProperty(viewport, "scrollHeight", { value: 4100 });
  viewport.scrollTop = 3500;
  fireEvent.scroll(viewport);
  await screen.findByRole("button", { name: "Review outline, section 5 of 5" });
  expect(viewport.scrollTop).toBe(3500);
});
it("shows the full Markdown walkthrough and concrete checks by default, with independent collapse", async () => {
  const user = userEvent.setup();
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.sections[0].explanation =
    "Existing invitations need a deadline **before** the constraint.\n\n`migrate()` must backfill rows before adding `NOT NULL`.";
  w.guide.sections[0].questions = [
    "Does `migrate()` preserve existing invitations?",
  ];
  mount(w);
  const first = screen.getByRole("region", { name: w.guide.sections[0].title });
  const full = within(first).getByRole("region", {
    name: "Full section context",
  });
  expect(full.closest(".guide-code")).toBeTruthy();
  expect(full.closest(".guide-annotation")).toBeNull();
  expect(full.querySelector("strong")?.textContent).toBe("before");
  expect(full.querySelector("code")?.textContent).toBe("migrate()");
  expect(within(full).getByText("Does", { exact: false })).toBeTruthy();
  const second = screen.getByRole("region", {
    name: w.guide.sections[1].title,
  });
  await user.click(
    within(first).getByRole("button", { name: "Hide walkthrough" }),
  );
  expect(
    within(first).queryByRole("region", { name: "Full section context" }),
  ).toBeNull();
  expect(
    within(second).getByRole("region", { name: "Full section context" }),
  ).toBeTruthy();
  await user.click(
    within(first).getByRole("button", { name: "Show walkthrough" }),
  );
  expect(
    within(first).getByRole("region", { name: "Full section context" }),
  ).toBeTruthy();
});
it("preserves legacy explanations and distinguishes provisional groups from generated guides", () => {
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.source = "codex";
  w.guide.policyVersion = 1;
  mount(w);
  expect(screen.getByText(/earlier brief format/)).toBeTruthy();
  expect(
    within(
      screen.getAllByRole("region", { name: "Full section context" })[0],
    ).getAllByText(w.guide.sections[0].summary),
  ).toBeTruthy();
  cleanup();
  w.guide.source = "provisional";
  mount(w);
  expect(
    screen.getByRole("heading", { name: "Guide not generated yet" }),
  ).toBeTruthy();
  expect(screen.queryByText(/earlier brief format/)).toBeNull();
});
