import { expect, it } from "vitest";
import { indexedWorkspace } from "../lib/guideIndex.fixture";
import { newNote } from "../lib/review";
import { conversationMarkdown } from "./conversationMarkdown";
import type { AiRun } from "./useAiRuns";

it("copies an inline conversation with the PR, full code, guide and linked GitHub replies", () => {
  const w = indexedWorkspace();
  const anchor = w.notes[0].anchor!;
  w.comments.push({
    ...w.comments[1],
    id: "unrelated",
    path: "elsewhere.ts",
    body: "UNRELATED COMMENT",
  });
  const text = conversationMarkdown(w, { anchor });
  for (const value of [
    w.snapshot.pull.title,
    w.snapshot.pull.url,
    w.snapshot.pull.body,
    w.snapshot.pull.head,
    w.snapshot.pull.base,
    anchor.path,
    w.snapshot.files[0].hunks[0].header,
    w.guide.summary,
    "Please add smoke coverage.",
    "This guards against a deployment regression.",
    "Comment ID: reply · Reply to: root",
    "Invitation migration rollout",
    "What about existing invitations?",
    "Backfill before setting NOT NULL.",
    "Validate the existing row count.",
    "Name to confirm: expires_at",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain("How should we roll this out?");
  expect(text).not.toContain("UNRELATED COMMENT");
  expect(text.indexOf("Please add smoke coverage.")).toBeLessThan(
    text.indexOf("This guards against a deployment regression."),
  );
});

it("interleaves answers with their questions and preserves Markdown, Mermaid and model identity", () => {
  const w = indexedWorkspace();
  const q1 = w.notes[0],
    a1 = w.notes[1];
  const q2 = {
    ...q1,
    id: "second",
    body: "SECOND QUESTION",
    createdAt: "2026-10-23T10:00:30Z",
  };
  const body =
    "**Answer**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\nA --> B\n```";
  const a2 = {
    ...a1,
    id: "second-answer",
    parentId: q2.id,
    body,
    model: {
      provider: "claude",
      model: "claude-fable-5",
      reasoningEffort: "high",
    },
    createdAt: "2026-10-23T10:02:00Z",
  };
  w.notes = [q2, a2, q1, a1];
  const text = conversationMarkdown(w, { anchor: q1.anchor! });
  expect([q1.body, a1.body, q2.body, body].map((s) => text.indexOf(s))).toEqual(
    [q1.body, a1.body, q2.body, body]
      .map((s) => text.indexOf(s))
      .sort((a, b) => a - b),
  );
  expect(text).toContain("Claude · claude-fable-5");
  expect(text.match(/```diff/g)).toHaveLength(1);
});

it("copies exact selected text, including nested fences, without unrelated line comments or conversations", () => {
  const w = indexedWorkspace();
  const selected = "```mermaid\nA --> B\n```";
  const anchor = {
    ...w.notes[0].anchor!,
    textSelection: {
      snapshotId: w.snapshot.id,
      startColumn: 3,
      endColumn: 9,
      text: selected,
    },
  };
  w.notes.push({
    ...newNote(w.snapshot.id, anchor, "EXPLAIN THIS TEXT"),
    id: "selection",
  });
  const text = conversationMarkdown(w, { anchor });
  expect(text).toContain(`\`\`\`\`text\n${selected}\n\`\`\`\``);
  expect(text).toContain("columns 3–9");
  expect(text).toContain("EXPLAIN THIS TEXT");
  expect(text).not.toContain("Please add smoke coverage.");
  expect(text).not.toContain("What about existing invitations?");
});

it("exports the whole PR feed with each location, including current reply context, but excludes the composer draft and other revisions", () => {
  const w = indexedWorkspace();
  w.notes.push({
    ...w.notes[0],
    id: "old",
    snapshotId: "old-revision",
    body: "OLD NOTE",
  });
  w.notes.push({ ...w.notes[0], id: "draft", body: "UNSENT" });
  const replyAnchor = {
    ...w.notes[0].anchor!,
    hunkId: "missing",
    path: "missing.ts",
    side: "LEFT" as const,
    startLine: 20,
    line: 23,
  };
  const text = conversationMarkdown(w, { replyAnchor, excludeNoteId: "draft" });
  expect(text).toContain("How should we roll this out?");
  expect(text).toContain("What about existing invitations?");
  expect(text).toContain("Replying to: missing.ts · Old lines 20–23");
  expect(text).toContain("Surrounding diff is not available");
  expect(text).not.toContain("OLD NOTE");
  expect(text).not.toContain("UNSENT");
});

it("marks partial and queued answers without leaking hidden response metadata", () => {
  const w = indexedWorkspace();
  w.notes = [w.notes[0], { ...w.notes[0], id: "next", body: "NEXT QUESTION" }];
  const run: AiRun = {
    id: "first",
    snapshotId: w.snapshot.id,
    question: w.notes[0],
    kind: "question",
    phase: "working",
    text: "Thinking…",
    stream: "PARTIAL ANSWER\n<!-- diffcity-thread-title: Hidden -->",
    preference: {
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "high",
    },
  };
  const text = conversationMarkdown(w, {
    runs: [
      run,
      {
        ...run,
        id: "second",
        phase: "waiting",
        question: w.notes[1],
        stream: "",
        text: "Waiting",
      },
    ],
  });
  expect(text).toContain("response in progress");
  expect(text).toContain("(queued)");
  expect(text.indexOf("PARTIAL ANSWER")).toBeLessThan(
    text.indexOf("NEXT QUESTION"),
  );
  expect(text).not.toContain("diffcity-thread-title");
});

it("distinguishes unpublished drafts and stale GitHub comments, and deduplicates published comments", () => {
  const w = indexedWorkspace();
  w.comments[0].url = "https://github.com/example/repo/pull/1#discussion_r2";
  w.comments[1].commit = "older-head";
  w.notes.push({
    ...w.notes[0],
    id: "draft",
    githubDraft: true,
    body: "DRAFT COMMENT",
  });
  w.notes.push({
    ...w.notes[0],
    id: "published",
    publishedUrl: w.comments[0].url,
    body: w.comments[0].body,
  });
  const text = conversationMarkdown(w);
  expect(text).toContain("GitHub draft (not published)");
  expect(text).toContain("Published comment");
  expect(text).toContain("older-head (earlier revision)");
  expect(text.split(w.comments[0].body)).toHaveLength(2);
});
