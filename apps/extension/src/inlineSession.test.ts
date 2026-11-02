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

it("keeps unsent drafts private and restores them when the UI remounts", async () => {
  const { rpc } = setup();
  const persist = vi.fn().mockResolvedValue(undefined);
  const session = inlineSession(context, rpc, { persist });
  expect(await session.invoke("inline_context", {})).toMatchObject({
    resuming: false,
  });
  const view = {
    draft: { noteId: null, body: "Unsent question — final keystroke" },
    collapsed: true,
  };
  await session.invoke("save_inline_view", { view });
  expect(persist).toHaveBeenCalledWith(view);
  expect(rpc.mock.calls.some(([name]) => name === "save_note")).toBe(false);
  expect(await session.invoke("inline_context", {})).toMatchObject({
    view,
    resuming: true,
  });
  const restarted = inlineSession(context, rpc, { view });
  expect(await restarted.invoke("inline_context", {})).toMatchObject({
    view,
    resuming: true,
  });
  await expect(
    session.invoke("save_inline_view", {
      view: { ...view, draft: { noteId: "another-thread", body: "changed" } },
    }),
  ).rejects.toThrow("Invalid inline draft");
});
it("keeps a streaming job alive with no mounted UI and restores its completion exactly once", async () => {
  const { rpc } = setup();
  let complete!: (value: unknown) => void;
  const call = vi.fn((command: string, args: Record<string, unknown>) =>
    command === "ask_codex"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : rpc(command, args),
  );
  const changed = vi.fn();
  const session = inlineSession(context, call, { changed });
  await session.invoke("inline_context", {});
  await session.invoke("save_note", {
    note: newNote("snapshot", anchor, "Explain this"),
  });
  const pending = session.invoke("ask_codex", {
    snapshotId: "snapshot",
    noteId: "question",
    runId: "active",
    preference: { provider: "claude", model: "test" },
  });
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  session.event({
    runId: "active",
    snapshotId: "snapshot",
    phase: "stream",
    text: "Partial response",
  });
  expect(await session.invoke("inline_context", {})).toMatchObject({
    resuming: true,
    runs: [{ id: "active", stream: "Partial response" }],
  });
  const answer = {
    ...newNote("snapshot", anchor, "Full response"),
    id: "answer",
    role: "assistant",
    parentId: "question",
  };
  complete({ answer, draft: null });
  await pending;
  expect(await session.invoke("inline_context", {})).toMatchObject({
    runs: [],
    workspace: { notes: expect.arrayContaining([answer]) },
  });
  expect(call.mock.calls.filter(([name]) => name === "ask_codex")).toHaveLength(
    1,
  );
});
