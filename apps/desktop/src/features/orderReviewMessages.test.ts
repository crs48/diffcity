import { expect, it } from "vitest";
import { newNote } from "../lib/review";
import type { Note, RemoteComment } from "../lib/api";
import type { AiRun } from "./useAiRuns";
import { orderReviewMessages } from "./orderReviewMessages";

const note = (
  id: string,
  second: number,
  parentId: string | null = null,
): Note => ({
  ...newNote("snapshot", null, id),
  id,
  parentId,
  role: parentId ? "assistant" : "user",
  createdAt: `2026-10-23T02:09:${second.toString().padStart(2, "0")}Z`,
});
const ids = (notes: Note[], remote: RemoteComment[] = [], runs: AiRun[] = []) =>
  orderReviewMessages(notes, remote, runs).map((entry) =>
    entry.kind === "run" ? entry.run.id : entry.message.id,
  );

it("interleaves saved replies even when the follow-up was autosaved before the first answer", () => {
  const first = note("question-1", 41);
  const second = note("question-2", 56);
  const answer = {
    ...note("answer-1", 59, first.id),
    createdAt: "2026-10-23T02:10:00.351063+00:00",
  };
  const followup = {
    ...note("answer-2", 59, second.id),
    createdAt: "2026-10-22T19:10:21.654077-07:00",
  };
  const notes = [followup, second, first, answer]; // Reload/storage order is irrelevant.
  expect(ids(notes)).toEqual([first.id, answer.id, second.id, followup.id]);
  expect(notes.map((n) => n.id)).toEqual([
    followup.id,
    second.id,
    first.id,
    answer.id,
  ]);
});

it("keeps streaming, stopped, and retried responses in their question's turn with prepared drafts", () => {
  const first = note("q1", 1),
    second = note("q2", 2),
    answer = note("a1", 3, first.id);
  const draft = {
    ...note("draft", 4, answer.id),
    role: "user",
    githubDraft: true,
  };
  const run: AiRun = {
    id: "stream",
    question: first,
    snapshotId: first.snapshotId,
    kind: "question",
    phase: "working",
    text: "Thinking…",
    stream: "Partial answer",
    preference: {
      provider: "claude",
      model: "claude-fable-5",
      reasoningEffort: "high",
    },
  };
  for (const phase of ["working", "cancelled", "error"] as const)
    expect(
      ids([first, second, answer, draft], [], [{ ...run, phase }]),
    ).toEqual(["q1", "a1", "draft", "stream", "q2"]);
  const retry = note("a1-retry", 6, first.id);
  expect(ids([first, second, answer, draft, retry])).toEqual([
    "q1",
    "a1",
    "draft",
    "a1-retry",
    "q2",
  ]);
});

it("groups concurrently completed threads without duplicating published GitHub comments", () => {
  const first = note("q1", 1);
  const second = {
    ...note("q2", 2),
    anchor: {
      path: "a.ts",
      hunkId: "h",
      side: "RIGHT" as const,
      startLine: 1,
      line: 1,
    },
  };
  const remote: RemoteComment = {
    id: "github",
    author: "reviewer",
    body: "Feedback",
    path: null,
    line: null,
    side: null,
    commit: null,
    url: "https://github.com/example/repo/pull/1#comment",
    createdAt: note("time", 3).createdAt,
  };
  const a2 = { ...note("a2", 4, second.id), anchor: second.anchor };
  const a1 = note("a1", 5, first.id);
  expect(ids([first, second, a2, a1], [remote])).toEqual([
    "q1",
    "a1",
    "q2",
    "a2",
    "github",
  ]);
  const draft = {
    ...note("published", 6, a1.id),
    role: "user",
    githubDraft: true,
    publishedUrl: remote.url,
  };
  expect(ids([first, second, a2, a1, draft], [remote])).toEqual([
    "q1",
    "a1",
    "published",
    "q2",
    "a2",
  ]);
});

it("retains orphaned and cyclic messages and does not attach across snapshots or selections", () => {
  const notes = [
    note("orphan", 1, "missing"),
    note("cycle-a", 2, "cycle-b"),
    note("cycle-b", 3, "cycle-a"),
    note("self", 4, "self"),
    note("q", 5),
    note("unrelated", 6),
    { ...note("different-revision", 7, "q"), snapshotId: "other" },
  ];
  const result = ids(notes);
  expect(new Set(result).size).toBe(notes.length);
  expect(result.indexOf("different-revision")).toBeGreaterThan(
    result.indexOf("unrelated"),
  );
});
