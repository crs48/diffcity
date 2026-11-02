// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteComposer } from "./NoteComposer";
import { newNote } from "../lib/review";
import { api } from "../lib/api";
import { useNoteComposer } from "./useNoteComposer";
import { useState } from "react";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
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
        submit,
        start: vi.fn(),
        close: vi.fn(),
        change: vi.fn(),
        flush: vi.fn(),
        subscribeDraft: () => () => {},
        getDraft: () => draft,
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
it("cannot accidentally send a GitHub draft to AI", () => {
  const { input, submit } = setup({ editing: true });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
});
it("queues another question with Enter or the button while a conversation responds", () => {
  const busy = setup({ busy: true });
  fireEvent.keyDown(busy.input, { key: "Enter" });
  expect(busy.submit).toHaveBeenCalledExactlyOnceWith(busy.ask);
  fireEvent.click(screen.getByRole("button", { name: "Queue question" }));
  expect(busy.submit).toHaveBeenCalledTimes(2);
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

it.each([true, false])(
  "keeps typing out of the workspace and persists the latest text on submit (inline: %s)",
  async (inline) => {
    vi.useFakeTimers();
    const ownerRender = vi.fn();
    const onNote = vi.fn();
    const ask = vi.fn().mockResolvedValue(undefined);
    const save = vi
      .spyOn(api, "note")
      .mockImplementation(async (note) => ({ ...note, id: "saved" }));
    function Workspace() {
      ownerRender();
      const state = useNoteComposer(onNote);
      const [visible, setVisible] = useState(true);
      return (
        <>
          <button onClick={() => void state.start("snapshot", null)}>
            Open editor
          </button>
          <button onClick={() => setVisible((v) => !v)}>Toggle editor</button>
          {visible && (
            <NoteComposer
              state={state}
              inline={inline}
              busy={false}
              onAsk={ask}
              onError={vi.fn()}
            />
          )}
        </>
      );
    }
    render(<Workspace />);
    await act(async () => {
      fireEvent.click(screen.getByText("Open editor"));
    });
    const rendersBeforeTyping = ownerRender.mock.calls.length;
    const input = screen.getByRole("textbox");
    const question = "Why is this branch needed?";
    for (let i = 1; i <= question.length; i++) {
      fireEvent.change(input, { target: { value: question.slice(0, i) } });
    }
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect((input as HTMLTextAreaElement).value).toBe(question);
    expect(ownerRender).toHaveBeenCalledTimes(rendersBeforeTyping);
    expect(save).not.toHaveBeenCalled();
    expect(onNote).not.toHaveBeenCalled();
    // A virtualized/collapsed editor can remount without losing its draft.
    fireEvent.click(screen.getByText("Toggle editor"));
    fireEvent.click(screen.getByText("Toggle editor"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      question,
    );
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: question }),
    );
    expect(ask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "saved", body: question }),
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  },
);
