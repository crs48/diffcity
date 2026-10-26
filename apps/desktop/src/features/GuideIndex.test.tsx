// @vitest-environment jsdom
import { useState } from "react";
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
import { GuideView } from "./Guide";
import { ConversationContext, type Conversation } from "./conversation";
import { indexedWorkspace } from "../lib/guideIndex.fixture";
import type { ReviewWorkspace } from "../lib/api";
import { namingTarget, noteTarget, threadTarget } from "../lib/guideIndex";
import "../i18n";
vi.mock("../ui/MermaidDiagram", () => ({ MermaidDiagram: () => <figure /> }));
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
  Element.prototype.scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: 0,
        bottom: 1000,
        left: 0,
        right: 1000,
        width: 1000,
        height: 1000,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const openChat = vi.fn();
const ask = vi.fn();
const onSelect = vi.fn();
function Example({
  initial = indexedWorkspace(),
}: {
  initial?: ReviewWorkspace;
}) {
  const [w, setW] = useState(initial);
  const c = {
    workspace: w,
    inline: { draft: null, focus: 0 },
    chat: { draft: null },
    runs: [],
    isBusy: () => false,
    modelFor: () => ({ model: "claude-fable-5" }),
    ask,
    openChat,
  } as unknown as Conversation;
  return (
    <ConversationContext.Provider value={c}>
      <div className="review-body">
        <div className="review-document">
          <div id="review-guide-navigation" />
          <div className="review-canvas">
            <div id="review-guide-index" />
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
                onSelect={onSelect}
                onDiscuss={vi.fn()}
                onProgress={(p) => setW((old) => ({ ...old, progress: p }))}
                onFinish={vi.fn()}
              />
            </div>
          </div>
        </div>
      </div>
    </ConversationContext.Provider>
  );
}
async function browse() {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /Browse guide index \(/ }));
  return screen.getByRole("dialog", { name: "Guide index" });
}
async function jumpTo(title: string) {
  const dialog = await browse();
  await userEvent
    .setup()
    .click(within(dialog).getByRole("button", { name: `Jump to ${title}` }));
}

it("keeps the map outside the scrolling document and supports hover, keyboard and searchable categories", async () => {
  render(<Example />);
  const rail = screen.getByRole("navigation", { name: "Guide index" });
  expect(document.querySelector("[data-review-scroll]")!.contains(rail)).toBe(
    false,
  );
  const markers = [
    ...rail.querySelectorAll<HTMLButtonElement>("[data-index-marker]"),
  ];
  expect(markers.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  markers[0].focus();
  fireEvent.keyDown(markers[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(markers[1]);
  await userEvent.setup().hover(markers[1]);
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  const dialog = await browse();
  await userEvent
    .setup()
    .click(within(dialog).getByRole("button", { name: "Name to confirm" }));
  expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
  await userEvent
    .setup()
    .type(
      within(dialog).getByRole("textbox", { name: "Search guide index" }),
      "no such name",
    );
  expect(within(dialog).getByText("No matching locations.")).toBeTruthy();
  await userEvent.setup().keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("jumps to exact names, findings and full code notes without sending messages", async () => {
  const w = indexedWorkspace();
  render(<Example initial={w} />);
  await jumpTo("valid_until → expires_at");
  await waitFor(() =>
    expect(
      (document.activeElement as HTMLElement).dataset.guideIndexTarget,
    ).toBe(
      namingTarget(
        w.guide.sections[0].id,
        w.notes[0].anchor!.path,
        "expires_at",
      ),
    ),
  );
  await jumpTo("Backfill existing invitations");
  await waitFor(() =>
    expect(
      (document.activeElement as HTMLElement).dataset.guideIndexTarget,
    ).toBe(noteTarget(w.guide.sections[0].id, "backfill")),
  );
  expect(screen.getByText("Validate the existing row count.")).toBeTruthy();
  expect(ask).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it("reopens a collapsed conversation, file, and chapter when navigating back to its thread", async () => {
  const w = indexedWorkspace();
  render(<Example initial={w} />);
  const target = threadTarget(w.notes[0].anchor!);
  const thread = () =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-guide-index-target]"),
    ].find((el) => el.dataset.guideIndexTarget === target)!;
  await userEvent.setup().click(
    within(thread()).getByRole("button", {
      name: "Collapse inline discussion",
    }),
  );
  await jumpTo("Invitation migration rollout");
  await waitFor(() => expect(document.activeElement).toBe(thread()));
  expect(
    within(thread()).getByRole("button", {
      name: "Collapse inline discussion",
    }),
  ).toBeTruthy();
  await userEvent.setup().click(
    screen.getByRole("button", {
      name: `Collapse file ${w.notes[0].anchor!.path}`,
    }),
  );
  expect(thread()).toBeUndefined();
  await jumpTo("Invitation migration rollout");
  await waitFor(() => expect(document.activeElement).toBe(thread()));
  const chapter = screen.getByRole("region", {
    name: w.guide.sections[0].title,
  });
  await userEvent
    .setup()
    .click(within(chapter).getByRole("button", { name: "Collapse changes" }));
  expect(thread()).toBeUndefined();
  await jumpTo("Please add smoke coverage.");
  await waitFor(() => expect(document.activeElement).toBe(thread()));
  expect(
    within(thread()).getByText("This guards against a deployment regression."),
  ).toBeTruthy();
});

it("opens PR chat for discussions without a guide location", async () => {
  openChat.mockClear();
  render(<Example />);
  await jumpTo("How should we roll this out?");
  await waitFor(() => expect(openChat).toHaveBeenCalledWith(null, false));
});
