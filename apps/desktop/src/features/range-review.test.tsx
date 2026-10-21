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
  split = true,
  source = hunk,
}: {
  onDiscuss?: (a: Anchor) => void;
  split?: boolean;
  source?: Hunk;
}) {
  const [selection, setSelection] = useState<Anchor | null>(null);
  return (
    <Diff
      hunk={source}
      selection={selection}
      onSelect={setSelection}
      onDiscuss={onDiscuss}
      notes={[]}
      comments={[]}
      split={split}
    />
  );
}
const lineButton = (line: number, old = false) =>
  screen.getByRole("button", {
    name: `Select ${hunk.path} ${old ? "old " : ""}line ${line}`,
  });

describe("multi-line review", () => {
  it.each([false, true])(
    "selects across paint boundaries with pointer and keyboard (split: %s)",
    async (split) => {
      const user = userEvent.setup();
      const discuss = vi.fn();
      const source: Hunk = {
        ...hunk,
        lines: Array.from({ length: 140 }, (_, index) => ({
          kind: "addition",
          old: null,
          new: index + 1,
          text: `line ${index + 1}`,
        })),
      };
      render(
        <SelectionExample source={source} split={split} onDiscuss={discuss} />,
      );
      const region = screen.getByRole("region");
      const bounds = (top: number, bottom: number) =>
        ({ top, bottom, height: bottom - top }) as DOMRect;
      vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
        bounds(-100, 3400),
      );
      Array.from(region.children).forEach((chunk, index) => {
        vi.spyOn(chunk, "getBoundingClientRect").mockReturnValue(
          bounds(index * 1600 - 100, Math.min((index + 1) * 1600, 3500) - 100),
        );
      });
      Array.from(region.querySelectorAll("[data-index]")).forEach(
        (row, index) => {
          vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
            bounds(index * 25 - 100, (index + 1) * 25 - 100),
          );
        },
      );
      fireEvent.pointerDown(lineButton(63), {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientY: 1460,
      });
      fireEvent.pointerMove(region, { pointerId: 1, clientY: 1560 });
      fireEvent.pointerUp(region, { pointerId: 1, clientY: 1560 });
      expect(screen.getByText("New lines 63–67 selected")).toBeTruthy();
      lineButton(67).focus();
      await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}");
      await waitFor(() => expect(document.activeElement).toBe(lineButton(64)));
      await user.click(
        screen.getByRole("button", { name: "Comment on lines 63–64" }),
      );
      expect(discuss).toHaveBeenCalledWith(
        expect.objectContaining({ side: "RIGHT", startLine: 63, line: 64 }),
      );
      expect(region.querySelectorAll("[data-code-index]")).toHaveLength(140);
    },
  );

  it.each([false, true])(
    "keeps a Shift-click range when opening its gutter comment (split: %s)",
    async (split) => {
      const user = userEvent.setup();
      const discuss = vi.fn();
      render(<SelectionExample onDiscuss={discuss} split={split} />);
      const region = screen.getByRole("region");
      for (const [line, shiftKey] of [
        [11, false],
        [13, true],
      ] as const) {
        fireEvent.pointerDown(lineButton(line), {
          pointerId: 1,
          isPrimary: true,
          button: 0,
          shiftKey,
        });
        fireEvent.pointerUp(region, { pointerId: 1 });
      }
      expect(discuss).not.toHaveBeenCalled();
      expect(lineButton(11).getAttribute("aria-pressed")).toBe("true");
      expect(lineButton(13).getAttribute("aria-pressed")).toBe("true");
      await user.click(
        within(lineButton(13).closest(".diff-line") as HTMLElement).getByRole(
          "button",
          { name: `Discuss ${hunk.path} lines 11–13` },
        ),
      );
      expect(discuss).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ side: "RIGHT", startLine: 11, line: 13 }),
      );
    },
  );

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
    vi.spyOn(region.children[0], "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 150,
      height: 150,
    } as DOMRect);
    Array.from(region.querySelectorAll("[data-index]")).forEach(
      (row, index) => {
        vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
          top: index * 25,
          bottom: (index + 1) * 25,
          height: 25,
        } as DOMRect);
      },
    );
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

  it("mirrors inline questions and replies in PR chat and preserves their original range", async () => {
    const user = userEvent.setup();
    const saved = new Map<string, Note>();
    const asked: Note[] = [];
    let reply: ((note: Note) => void) | undefined;
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
            pins: { repositories: [], pulls: [] },
            directory: { repositories: [], organizations: [], syncError: null },
            models: [],
            modelPreference: {
              provider: "codex",
              model: "gpt-6-astra",
              reasoningEffort: "xhigh",
            },
            pulls: [],
            dataDirectory: "test-data",
          };
        if (command === "sample_review")
          return {
            ...structuredClone(workspace),
            comments: [
              {
                id: "remote-old",
                author: "reviewer",
                body: "Earlier GitHub feedback",
                path: null,
                line: null,
                side: null,
                commit: null,
                url: "https://github.com/example/repo/pull/1#issuecomment-1",
                createdAt: "2020-01-01T00:00:00Z",
              },
            ],
          };
        if (command === "refresh_inbox") return { pulls: [], syncError: null };
        if (command === "save_progress") return payload.progress;
        if (command === "save_note") {
          const note = payload.note as Note;
          const result = {
            ...note,
            id: note.id || crypto.randomUUID(),
            createdAt: note.createdAt || new Date().toISOString(),
          };
          saved.set(result.id, result);
          return result;
        }
        if (command === "ask_codex") {
          const note = saved.get(payload.noteId as string)!;
          asked.push(note);
          return new Promise<Note>((resolve) => {
            reply = resolve;
          });
        }
        throw new Error(`Unexpected command: ${command}`);
      },
      { shouldMockEvents: true },
    );
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Explore a sample" }),
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
      name: "Inline comment or Codex question",
    });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    await user.paste(
      "Will these two migration statements work with existing rows?",
    );
    await user.click(screen.getByRole("button", { name: "Save comment" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Ask Codex about this comment",
      }),
    );
    const thread = screen.getByRole("region", {
      name: `Discussion for ${path}, New lines 1–2`,
    });
    expect(screen.queryByRole("complementary", { name: "PR chat" })).toBeNull();
    expect(
      within(thread).getByLabelText("Codex response in progress"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^PR chat/ }));
    const chat = screen.getByRole("complementary", { name: "PR chat" });
    expect(
      within(chat).getByLabelText("Codex response in progress"),
    ).toBeTruthy();
    expect(asked).toHaveLength(1);
    expect(asked[0].anchor).toMatchObject({
      side: "RIGHT",
      startLine: 1,
      line: 2,
    });
    expect(asked[0].githubDraft).toBe(false);
    // Changing the selection while Codex is running must not move its response.
    fireEvent.click(first, { detail: 0 });
    reply!({
      ...asked[0],
      id: "answer-one",
      parentId: asked[0].id,
      role: "assistant",
      body: "Backfill existing invitations before enforcing the constraint.",
      createdAt: new Date().toISOString(),
    });
    const answer = await within(thread).findByText(
      "Backfill existing invitations before enforcing the constraint.",
    );
    const mirror = await within(chat).findByText(answer.textContent!);
    expect(answer.closest("article")?.dataset.noteId).toBe(
      mirror.closest("article")?.dataset.noteId,
    );
    expect(saved.size).toBe(1); // Mirroring never persists a second copy.
    expect(within(chat).getByText("Earlier GitHub feedback")).toBeTruthy();
    expect(
      chat.querySelector(".message:last-of-type")?.getAttribute("data-note-id"),
    ).toBe("answer-one");
    await user.click(
      within(chat).getAllByRole("button", {
        name: `${path} · New lines 1–2`,
      })[0],
    );
    await waitFor(() => expect(document.activeElement).toBe(composer));
    await user.paste("Keep this unfinished inline thought.");
    await user.click(
      within(thread).getByRole("button", {
        name: "Collapse inline discussion",
      }),
    );
    expect(within(thread).queryByRole("textbox")).toBeNull();
    await user.click(
      within(thread).getByRole("button", { name: "Expand inline discussion" }),
    );
    expect(
      (within(thread).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("Keep this unfinished inline thought.");
    await user.click(screen.getByRole("tab", { name: /Overview/ }));
    await user.click(screen.getByRole("tab", { name: "Guide" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Inline comment or Codex question",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Keep this unfinished inline thought.");
    await user.click(
      within(chat).getByRole("textbox", {
        name: "Message to Codex about this PR",
      }),
    );
    await user.paste("How does that affect the rest of the PR?");
    await user.click(within(chat).getByRole("button", { name: "Ask Codex" }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].anchor).toBeNull();
    reply!({
      ...asked[1],
      id: "answer-two",
      parentId: asked[1].id,
      role: "assistant",
      body: "The API must accommodate the migration rollout.",
      createdAt: new Date().toISOString(),
    });
    expect(
      await within(chat).findByText(
        "The API must accommodate the migration rollout.",
      ),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", {
          name: `Discussion for ${path}, New lines 1–2`,
        }),
      ).queryByText("The API must accommodate the migration rollout."),
    ).toBeNull();
    await user.click(
      screen.getAllByRole("button", { name: "Finish review" })[0],
    );
    expect(
      within(screen.getByRole("dialog", { name: "Finish review" })).getByText(
        "No drafts selected. Private notes and Codex conversations are not included.",
      ),
    ).toBeTruthy();
  });
});
