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
vi.mock("../ui/MermaidDiagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <figure aria-label="Code diagram">{source}</figure>
  ),
}));

import fixture from "../../../../tests/fixtures/review-workspace.json";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
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
  onDiscuss = () => {},
}: {
  initial?: ReviewWorkspace;
  onDiscuss?: (anchor: import("../lib/api").Anchor) => void;
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
        onDiscuss={onDiscuss}
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
it.each(["document", "toolbar"])(
  "docks navigation in the %s and jumps without covering the destination",
  async (placement) => {
    const user = userEvent.setup();
    render(
      placement === "toolbar" ? (
        <div className="review-tabs">
          <div className="workspace-tabs">
            <div id="review-guide-navigation" />
          </div>
          <div className="review-document">
            <Example />
          </div>
        </div>
      ) : (
        <div className="review-document">
          <div id="review-guide-navigation" />
          <Example />
        </div>
      ),
    );
    document
      .querySelectorAll<HTMLElement>("[data-guide-section]")
      .forEach((element, index) => {
        element.dataset.testChapter = String(index);
      });
    const viewport = document.querySelector<HTMLElement>(
      "[data-review-scroll]",
    )!;
    const navigation = screen.getByRole("navigation", {
      name: "Guide navigation",
    });
    expect(viewport.contains(navigation)).toBe(false);
    await user.click(screen.getByRole("button", { name: "Next section" }));
    expect(viewport.scrollTop).toBe(984);
    expect(document.activeElement?.textContent).toBe(
      fixture.guide.sections[0].title,
    );
    fireEvent.wheel(viewport);
    viewport.scrollTop = 2050;
    fireEvent.scroll(viewport);
    await screen.findByRole("button", {
      name: "Review outline, 2 of 5 sections",
    });
    expect(viewport.scrollTop).toBe(2050);
  },
);

it("keeps every chapter mounted while jumping and preserves independent reviewed/collapsed state", async () => {
  const user = userEvent.setup();
  mount();
  const first = screen.getByRole("region", {
    name: fixture.guide.sections[0].title,
  });
  const second = screen.getByRole("region", {
    name: fixture.guide.sections[1].title,
  });
  expect(document.querySelectorAll("[data-guide-section]")).toHaveLength(6);
  await user.click(
    screen.getByRole("button", { name: "Start code walkthrough" }),
  );
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
  ).toBe(1930);
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
  await screen.findByRole("button", {
    name: "Review outline, 1 of 5 sections",
  });
  expect(viewport.scrollTop).toBe(1050);
  expect(document.activeElement).toBe(focus);
  viewport.scrollTop = 3050;
  fireEvent.scroll(viewport);
  await screen.findByRole("button", {
    name: "Review outline, 3 of 5 sections",
  });
  expect(viewport.scrollTop).toBe(3050);
  Object.defineProperty(viewport, "scrollHeight", { value: 4100 });
  viewport.scrollTop = 3500;
  fireEvent.scroll(viewport);
  await screen.findByRole("button", {
    name: "Review outline, 5 of 5 sections",
  });
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

it("starts with a rich overview and returns to it from the first code chapter", async () => {
  const user = userEvent.setup();
  mount();
  const overview = screen.getByRole("region", { name: "PR overview" });
  expect(
    within(overview).getByRole("figure", { name: "Code diagram" }).textContent,
  ).toContain("Team invitation changes");
  expect(within(overview).getByRole("table")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review outline, overview" }),
  ).toBeTruthy();
  expect(
    document.querySelector<HTMLElement>("[data-review-scroll]")!.scrollTop,
  ).toBe(0);
  await user.click(screen.getByRole("button", { name: "Next section" }));
  await screen.findByRole("button", {
    name: "Review outline, 1 of 5 sections",
  });
  await user.click(screen.getByRole("button", { name: "Previous section" }));
  expect(document.activeElement).toBe(
    within(overview).getByRole("heading", { name: "PR overview" }),
  );
  expect(
    document.querySelector<HTMLElement>("[data-review-scroll]")!.scrollTop,
  ).toBe(0);
  await user.click(
    screen.getByRole("button", { name: "Review outline, overview" }),
  );
  expect(screen.getByRole("menuitem", { name: /^PR overview/ })).toBeTruthy();
});

it("renders escaped line breaks in an existing saved overview as Markdown and a diagram", () => {
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.summary = w.guide.summary.replaceAll("\n", "\\n");
  mount(w);
  const overview = screen.getByRole("region", { name: "PR overview" });
  const diagram = within(overview).getByRole("figure", {
    name: "Code diagram",
  });
  expect(diagram.textContent).toContain("flowchart TD\n");
  expect(within(overview).getByRole("table")).toBeTruthy();
  expect(overview.textContent).not.toContain("\\n");
});

it.each(["\n", "\\n"])(
  "renders scannable Markdown and diagrams inside a chapter with %j breaks",
  async (separator) => {
    const w = structuredClone(fixture) as ReviewWorkspace;
    w.guide.sections[0].explanation = [
      "#### What changes",
      "",
      "- **Existing rows.** Backfill before enforcing the constraint.",
      "- **New writes.** Supply `expires_at` during creation.",
      "",
      "| Before | After |",
      "| --- | --- |",
      "| No deadline | Required expiry |",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Create invitation] --> B[Store deadline]",
      "```",
    ].join(separator);
    w.guide.sections[0].questions = [
      "Does the upgrade preserve existing rows?",
    ];
    mount(w);
    const full = within(
      screen.getByRole("region", { name: w.guide.sections[0].title }),
    ).getByRole("region", { name: "Full section context" });
    expect(
      within(full).getByRole("heading", { name: "What changes", level: 4 }),
    ).toBeTruthy();
    expect(within(full).getByRole("table").textContent).toContain(
      "Required expiry",
    );
    expect(within(full).getAllByRole("list")).toHaveLength(2);
    expect(within(full).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(full).getByRole("figure", { name: "Code diagram" }).textContent,
    ).toContain("A[Create invitation] --> B[Store deadline]");
    expect(
      within(full).getByText("Does the upgrade preserve existing rows?"),
    ).toBeTruthy();
  },
);

it("retains an overview for guides with no text chapters", () => {
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.sections = [];
  mount(w);
  expect(screen.getByRole("region", { name: "PR overview" })).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "No reviewable text changes" }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Next section" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("puts naming decisions up front, navigates to their chapter, and opens the exact code conversation", async () => {
  const user = userEvent.setup();
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.policyVersion = 5;
  const hunk = w.snapshot.files[0].hunks[0];
  const decision = {
    name: "expires_at",
    previousName: "valid_until",
    kind: "database" as const,
    reason:
      "This stored deadline determines when an invitation **stops working**.",
    question:
      "Does `expires_at` mean the invitation deadline, including after redemption?",
    anchor: {
      hunkId: hunk.id,
      path: hunk.path,
      side: "RIGHT" as const,
      startLine: 1,
      line: 1,
    },
  };
  w.guide.sections[0].namingDecisions = [decision];
  const discuss = vi.fn();
  render(<Example initial={w} onDiscuss={discuss} />);
  document
    .querySelectorAll<HTMLElement>("[data-guide-section]")
    .forEach((el, i) => (el.dataset.testChapter = String(i)));
  const overview = screen.getByRole("region", { name: "PR overview" });
  const naming = within(overview).getByRole("region", {
    name: "Naming decisions",
  });
  expect(naming.textContent).toContain("valid_until");
  expect(naming.textContent).toContain("expires_at");
  await user.click(
    within(naming).getByRole("button", {
      name: "Review naming decision: expires_at",
    }),
  );
  expect(document.activeElement?.textContent).toBe(w.guide.sections[0].title);
  const chapter = screen.getByRole("region", {
    name: w.guide.sections[0].title,
  });
  const card = within(chapter).getByRole("region", {
    name: "Naming decisions for this section",
  });
  expect(card.querySelector("strong")?.textContent).toBe("stops working");
  await user.click(
    within(chapter).getByRole("button", { name: "Hide walkthrough" }),
  );
  expect(card.isConnected).toBe(true);
  await user.click(
    within(card).getByRole("button", { name: "Discuss name: expires_at" }),
  );
  expect(discuss).toHaveBeenCalledWith(decision.anchor);
  expect(within(chapter).queryByText(/finding$/)).toBeNull();
});

it("distinguishes older guides from a naming review with no decisions", () => {
  const w = structuredClone(fixture) as ReviewWorkspace;
  w.guide.source = "claude";
  w.guide.policyVersion = 4;
  mount(w);
  expect(
    screen.getByText(/Choose New guide to highlight database names/),
  ).toBeTruthy();
  expect(screen.queryByText(/No consequential naming decisions/)).toBeNull();
  cleanup();
  w.guide.policyVersion = 5;
  mount(w);
  expect(screen.queryByRole("region", { name: "Naming decisions" })).toBeNull();
  expect(screen.getByText(/No consequential naming decisions/)).toBeTruthy();
  expect(
    screen.queryByText(/Choose New guide to highlight database names/),
  ).toBeNull();
});
