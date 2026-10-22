// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { TextSelectionAction } from "./TextSelectionAction";
import { NoteComposer } from "./NoteComposer";
import { ReviewMessages } from "./ReviewMessages";
import { ConversationContext, type Conversation } from "./conversation";
import { newNote } from "../lib/review";
import type { Anchor, ReviewWorkspace } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const workspace = fixture as ReviewWorkspace;
const anchor: Anchor = {
  hunkId: "h",
  path: "test.ts",
  side: "RIGHT",
  startLine: 1,
  line: 1,
  textSelection: {
    snapshotId: "snapshot",
    startColumn: 6,
    endColumn: 11,
    text: "first",
  },
};
const composer = {
  draft: newNote("snapshot", anchor, "What does it do?"),
  saved: false,
  focus: 0,
  start: vi.fn(),
  change: vi.fn(),
  submit: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  flush: vi.fn(),
};
const conversation: Conversation = {
  workspace,
  inline: composer,
  chat: composer,
  modelFor: () => ({
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "high",
  }),
  runs: [],
  isBusy: () => false,
  cancel: vi.fn(),
  dismiss: vi.fn(),
  ask: vi.fn(),
  explainText: vi.fn().mockResolvedValue(undefined),
  prepare: vi.fn(),
  edit: vi.fn(),
  openInline: vi.fn(),
  openChat: vi.fn(),
  onError: vi.fn(),
};
function Example() {
  const root = useRef<HTMLDivElement>(null);
  return (
    <ConversationContext.Provider value={conversation}>
      <div data-review-scroll>
        <div ref={root}>
          <div
            data-source-snapshot="snapshot"
            data-hunk-id="h"
            data-source-path="test.ts"
          >
            <button onKeyDown={(event) => event.stopPropagation()}>
              Gutter
            </button>
            <code data-code-text data-new-line="1">
              const first = second;
            </code>
          </div>
          <TextSelectionAction root={root} />
        </div>
      </div>
    </ConversationContext.Provider>
  );
}
function select() {
  const code = document.querySelector("code")!;
  const range = document.createRange();
  range.setStart(code.firstChild!, 6);
  range.setEnd(code.firstChild!, 11);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(fn, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON() {},
  });
  Range.prototype.getClientRects = vi.fn(() => [
    { top: 100, bottom: 125, left: 100, right: 140, width: 40, height: 25 },
  ]) as unknown as typeof Range.prototype.getClientRects;
});
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("shows an AI action for a precise native selection and submits it without a composer step", async () => {
  render(<Example />);
  select();
  const action = await screen.findByRole("button", {
    name: "Ask AI to explain selected code",
  });
  fireEvent.pointerDown(action);
  fireEvent.click(action);
  expect(conversation.explainText).toHaveBeenCalledExactlyOnceWith(anchor);
  expect(
    screen.queryByRole("button", { name: "Ask AI to explain selected code" }),
  ).toBeNull();
});
it("supports Alt+Enter and dismisses the action with Escape", async () => {
  render(<Example />);
  select();
  await screen.findByRole("button", {
    name: "Ask AI to explain selected code",
  });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("button", { name: "Ask AI to explain selected code" }),
  ).toBeNull();
  select();
  await screen.findByRole("button", {
    name: "Ask AI to explain selected code",
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "Gutter" }), {
    key: "Enter",
    altKey: true,
  });
  await waitFor(() =>
    expect(conversation.explainText).toHaveBeenCalledExactlyOnceWith(anchor),
  );
});
it("offers only AI follow-up actions on both questions and answers", () => {
  const question = {
    ...newNote("snapshot", anchor, "Explain first"),
    id: "question",
  };
  const answer = {
    ...question,
    id: "answer",
    role: "assistant",
    body: "It holds the first value.",
  };
  render(
    <>
      <NoteComposer
        state={composer}
        inline
        busy={false}
        onAsk={conversation.ask}
        onError={conversation.onError}
      />
      <ReviewMessages notes={[question, answer]} conversation={conversation} />
    </>,
  );
  expect(
    screen.queryByRole("button", { name: "Save private note" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Prepare GitHub draft" }),
  ).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Follow-up about selected code" }),
  ).toBeTruthy();
  expect(screen.getByText("AI only · never published to GitHub")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(composer.submit).toHaveBeenCalledWith(conversation.ask);
});
