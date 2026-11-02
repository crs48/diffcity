import { expect, it, vi } from "vitest";
import { inlineSession } from "./inlineSession";
import type { Note, ReviewWorkspace } from "../../desktop/src/lib/api";
import { newNote } from "../../desktop/src/lib/review";

const context = {
  repository: "example/repo",
  number: 1,
  line: { path: "a.ts", line: 3, side: "RIGHT" as const },
};
const anchor = { ...context.line, startLine: 3, hunkId: "hunk" };
const workspace = {
  snapshot: {
    id: "snapshot",
    pull: { head: "head" },
    files: [
      {
        path: "a.ts",
        hunks: [
          {
            id: "hunk",
            lines: [
              { kind: "addition", new: 3, old: null, text: "return title;" },
            ],
          },
        ],
      },
    ],
  },
  notes: [],
  comments: [],
} as unknown as ReviewWorkspace;
function setup(input = context as Parameters<typeof inlineSession>[0]) {
  const rpc = vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "open_pull" || command === "open_saved_review")
      return workspace;
    if (command === "bootstrap")
      return {
        modelPreference: { provider: "claude", model: "test" },
        settings: { theme: "light" },
        repositories: ["private/other"],
      };
    if (command === "save_note")
      return {
        ...(args.note as Note),
        id: (args.note as Note).id || "question",
      };
    if (command === "ask_codex")
      return {
        answer: {
          ...newNote("snapshot", anchor, "Answer"),
          role: "assistant",
          id: "answer",
        },
        draft: null,
      };
    return null;
  });
  return { rpc, session: inlineSession(input, rpc) };
}
it("opens only the captured PR and a canonical code anchor without leaking bootstrap", async () => {
  const { session, rpc } = setup();
  const info = await session.invoke("inline_context", {});
  expect(info).toMatchObject({ anchor, theme: "light" });
  expect(info).not.toHaveProperty("repositories");
  expect(rpc).toHaveBeenCalledWith("open_pull", {
    repository: "example/repo",
    number: 1,
    refresh: false,
  });
  await expect(
    setup({ ...context, line: { ...context.line, line: 900 } }).session.invoke(
      "inline_context",
      {},
    ),
  ).rejects.toThrow("could not be matched");
});
it("refuses unrelated snapshots, notes, authors, and privileged commands", async () => {
  const { session, rpc } = setup();
  for (const command of [
    "publish_review",
    "respond_agent",
    "bootstrap",
    "model_preference",
    "open_pull",
    "shell",
  ])
    await expect(session.invoke(command, {})).rejects.toThrow("full Diff City");
  const valid = newNote("snapshot", anchor, "What is this?");
  for (const patch of [
    { snapshotId: "other" },
    { anchor: { ...anchor, line: 4 } },
    { role: "assistant" },
    { id: "unknown" },
    { parentId: "unknown" },
    { publishedUrl: "https://github.com/" },
  ])
    await expect(
      session.invoke("save_note", { note: { ...valid, ...patch } }),
    ).rejects.toThrow("Invalid inline note");
  await expect(
    session.invoke("open_saved_review", { snapshotId: "other" }),
  ).rejects.toThrow("snapshot");
  expect(rpc.mock.calls.some(([name]) => name === "save_note")).toBe(false);
});
it("binds runs to saved thread notes, forces limited access, and isolates run events/cancellation", async () => {
  const { session, rpc } = setup();
  const args = {
    snapshotId: "snapshot",
    noteId: "question",
    runId: "run-1",
    access: "full",
    preference: { provider: "claude", model: "test" },
  };
  await expect(session.invoke("ask_codex", args)).rejects.toThrow(
    "Save the inline question",
  );
  await session.invoke("save_note", {
    note: newNote("snapshot", anchor, "What is this?"),
  });
  await session.invoke("ask_codex", args);
  expect(rpc).toHaveBeenCalledWith("ask_codex", { ...args, access: "limited" });
  expect(
    session.acceptsEvent({ event: "codex-run", payload: { runId: "run-1" } }),
  ).toBe(true);
  expect(
    session.acceptsEvent({ event: "codex-run", payload: { runId: "other" } }),
  ).toBe(false);
  expect(session.acceptsEvent({ event: "review-context" })).toBe(false);
  await expect(
    session.invoke("cancel_codex", { runId: "other" }),
  ).rejects.toThrow("Unknown inline run");
  await session.invoke("cancel_codex", { runId: "run-1" });
  await expect(session.invoke("ask_codex", args)).rejects.toThrow(
    "Save the inline question",
  );
  await expect(
    session.invoke("save_note", {
      note: {
        ...newNote("snapshot", anchor, "Draft"),
        githubDraft: true,
        parentId: "answer",
      },
    }),
  ).resolves.toMatchObject({ parentId: "answer" });
});
it("never allows selected text to become a GitHub draft", async () => {
  const { session } = setup({
    repository: "example/repo",
    number: 1,
    selection: { text: "title", path: "a.ts", line: 3, side: "RIGHT" },
  });
  const info = (await session.invoke("inline_context", {})) as {
    anchor: typeof anchor;
  };
  await expect(
    session.invoke("save_note", {
      note: {
        ...newNote("snapshot", info.anchor, "Question"),
        githubDraft: true,
      },
    }),
  ).rejects.toThrow("AI-only");
});
