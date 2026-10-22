// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteComposer } from "./NoteComposer";
import { newNote } from "../lib/review";
import "../i18n";
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup({ busy = false, editing = false, text = false } = {}) {
  const draft = {
    ...newNote("s", null, "Explain this branch"),
    githubDraft: editing,
  };
  if (text)
    draft.anchor = {
      hunkId: "h",
      path: "a.ts",
      side: "RIGHT",
      startLine: 1,
      line: 1,
      textSelection: {
        snapshotId: "s",
        text: "x",
        startColumn: 0,
        endColumn: 1,
      },
    };
  const submit = vi.fn().mockResolvedValue(undefined),
    ask = vi.fn();
  render(
    <NoteComposer
      state={{
        draft,
        focus: 0,
        saved: false,
        submit,
        start: vi.fn(),
        close: vi.fn(),
        change: vi.fn(),
        flush: vi.fn(),
      }}
      inline
      busy={busy}
      onAsk={ask}
      onError={vi.fn()}
    />,
  );
  return { submit, ask, input: screen.getByRole("textbox") };
}
it("Enter asks AI; Shift+Enter and composition keep typing", () => {
  const { submit, ask, input } = setup();
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toHaveBeenCalledExactlyOnceWith(ask);
});
it("private notes and GitHub drafts require their own explicit buttons", () => {
  const { submit, ask } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Save private note" }));
  expect(submit).toHaveBeenLastCalledWith();
  fireEvent.click(screen.getByRole("button", { name: "Save GitHub draft" }));
  expect(submit).toHaveBeenLastCalledWith(undefined, true);
  expect(ask).not.toHaveBeenCalled();
});
it("cannot accidentally send a draft to AI or send into an active conversation", () => {
  const { input, submit } = setup({ editing: true });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
  cleanup();
  const busy = setup({ busy: true });
  fireEvent.keyDown(busy.input, { key: "Enter" });
  expect(busy.submit).not.toHaveBeenCalled();
});
it("text selections remain AI-only", () => {
  setup({ text: true });
  expect(
    screen.queryByRole("button", { name: "Save GitHub draft" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save private note" }),
  ).toBeNull();
});
