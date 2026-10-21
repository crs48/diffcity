// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Anchor, Hunk, Note, ReviewWorkspace } from "../lib/api";
import { Diff } from "./Diff";
import App from "../App";
import fixture from "../../../../tests/fixtures/review-workspace.json";

const workspace = fixture as ReviewWorkspace;
const hunk: Hunk = {
  ...workspace.snapshot.files[1].hunks[0],
  lines: [
    { kind: "context", old: 10, new: 10, text: "unchanged" },
    { kind: "deletion", old: 11, new: null, text: "old one" },
    { kind: "deletion", old: 12, new: null, text: "old two" },
    { kind: "addition", old: null, new: 11, text: "new one" },
    { kind: "addition", old: null, new: 12, text: "new two" },
    { kind: "context", old: 13, new: 13, text: "last" },
  ],
};

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
    addListener() {},
    removeListener() {},
  }));
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    },
  );
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  clearMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function SelectionExample({
  onDiscuss = vi.fn(),
}: {
  onDiscuss?: (a: Anchor) => void;
}) {
  const [selection, setSelection] = useState<Anchor | null>(null);
  return (
    <Diff
      hunk={hunk}
      selection={selection}
      onSelect={setSelection}
      onDiscuss={onDiscuss}
      notes={[]}
      comments={[]}
      split
      readingMode
    />
  );
}
const lineButton = (line: number, old = false) =>
  screen.getByRole("button", {
    name: `Select ${hunk.path} ${old ? "old " : ""}line ${line}`,
  });

describe("multi-line review", () => {
  it("extends and shrinks a keyboard range while keeping its original endpoint", async () => {
    const user = userEvent.setup();
    const discuss = vi.fn();
    render(<SelectionExample onDiscuss={discuss} />);
    lineButton(11).focus();
    await user.keyboard("{Enter}{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(document.activeElement).toBe(lineButton(12)));
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(document.activeElement).toBe(lineButton(13)));
    expect(
      screen.getByRole("button", { name: "Comment on lines 11–13" }),
    ).toBeTruthy();
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await user.click(
      screen.getByRole("button", { name: "Comment on lines 11–12" }),
    );
    expect(discuss).toHaveBeenCalledWith(
      expect.objectContaining({ side: "RIGHT", startLine: 11, line: 12 }),
    );
    expect(lineButton(11).getAttribute("aria-pressed")).toBe("true");
    expect(lineButton(13).getAttribute("aria-pressed")).toBe("false");
  });

  it("normalizes reverse drag, preserves it when commenting, and resets when switching sides", async () => {
    const user = userEvent.setup();
    const discuss = vi.fn();
    render(<SelectionExample onDiscuss={discuss} />);
    const region = screen.getByRole("region");
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 150,
    } as DOMRect);
    fireEvent.pointerDown(lineButton(12, true), {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientY: 62,
    });
    fireEvent.pointerMove(region, { pointerId: 1, clientY: 37 });
    fireEvent.pointerUp(region, { pointerId: 1, clientY: 37 });
    await user.click(
      screen.getAllByRole("button", {
        name: `Discuss ${hunk.path} lines 11–12`,
      })[0],
    );
    expect(discuss).toHaveBeenCalledWith(
      expect.objectContaining({ side: "LEFT", startLine: 11, line: 12 }),
    );
    // Shift cannot accidentally join old and new line coordinates.
    fireEvent.click(lineButton(13), { detail: 0, shiftKey: true });
    expect(screen.getByText("New line 13 selected")).toBeTruthy();
  });

  it("saves a range comment, sends that saved comment to Codex, and keeps another range separate", async () => {
    const user = userEvent.setup();
    const saved = new Map<string, Note>();
    const asked: Note[] = [];
    mockWindows("main");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
    mockIPC(
      (command, args) => {
        const payload = args as Record<string, unknown>;
        if (command === "bootstrap")
          return {
            settings: {
              repositories: [],
              ghPath: null,
              codexPath: null,
              theme: "system",
              model: null,
            },
            github: {
              connected: true,
              identity: "fixture",
              detail: "",
              executable: "",
            },
            codex: {
              connected: true,
              identity: "fixture",
              detail: "",
              executable: "",
            },
            models: [],
            pulls: [],
            dataDirectory: "test-data",
          };
        if (command === "sample_review") return structuredClone(workspace);
        if (command === "refresh_inbox") return [];
        if (command === "save_progress") return payload.progress;
        if (command === "save_note") {
          const note = payload.note as Note;
          const result = { ...note, id: note.id || crypto.randomUUID() };
          saved.set(result.id, result);
          return result;
        }
        if (command === "ask_codex") {
          const note = saved.get(payload.noteId as string)!;
          asked.push(note);
          return {
            ...note,
            id: crypto.randomUUID(),
            parentId: note.id,
            role: "assistant",
            body: "Backfill existing invitations before enforcing the constraint.",
          };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
      { shouldMockEvents: true },
    );
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Explore a sample" }),
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: "All lines for assistive reading",
      }),
    );
    const path = workspace.snapshot.files[0].path;
    const first = screen.getByRole("button", { name: `Select ${path} line 1` });
    const last = screen.getByRole("button", { name: `Select ${path} line 2` });
    fireEvent.click(first, { detail: 0 });
    await waitFor(() =>
      expect(first.getAttribute("aria-pressed")).toBe("true"),
    );
    fireEvent.click(last, { detail: 0, shiftKey: true });
    await user.click(
      await screen.findByRole("button", { name: "Comment on lines 1–2" }),
    );
    const composer = screen.getByRole("textbox", {
      name: "Review note or Codex question",
    });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    await user.type(
      composer,
      "Will these two migration statements work with existing rows?",
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Ask Codex about this comment",
      }),
    );
    expect(
      await screen.findByText(
        "Backfill existing invitations before enforcing the constraint.",
      ),
    ).toBeTruthy();
    expect(asked).toHaveLength(1);
    expect(asked[0].anchor).toMatchObject({
      side: "RIGHT",
      startLine: 1,
      line: 2,
    });
    expect(asked[0].githubDraft).toBe(false);
    fireEvent.click(first, { detail: 0 });
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Backfill existing invitations before enforcing the constraint.",
        ),
      ).toBeNull(),
    );
    await user.click(screen.getByText("Other discussions in this change (1)"));
    await user.click(screen.getByRole("button", { name: "New lines 1–2" }));
    expect(
      await screen.findByText(
        "Backfill existing invitations before enforcing the constraint.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Finish review" }));
    expect(
      within(screen.getByRole("dialog", { name: "Finish review" })).getByText(
        "No drafts selected. Private notes and Codex conversations are not included.",
      ),
    ).toBeTruthy();
  });
});
