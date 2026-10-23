// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReviewMessages } from "./ReviewMessages";
import type { Conversation } from "./conversation";
import type { AiRun } from "./useAiRuns";
import { newNote } from "../lib/review";

vi.mock("../ui/CommentMarkdown", () => ({
  CommentMarkdown: ({ body }: { body: string }) => <p>{body}</p>,
}));
afterEach(cleanup);

it.each([true, false])(
  "keeps exchanges in place from streaming through completion (inline: %s)",
  (inline) => {
    const q1 = {
      ...newNote("s", null, "First question"),
      id: "q1",
      createdAt: "2026-10-23T02:09:41Z",
    };
    const q2 = {
      ...newNote("s", null, "Second question"),
      id: "q2",
      createdAt: "2026-10-23T02:09:56Z",
    };
    const a1 = {
      ...q1,
      id: "a1",
      role: "assistant",
      parentId: q1.id,
      body: "First answer",
      createdAt: "2026-10-23T02:10:00Z",
    };
    const a2 = {
      ...q2,
      id: "a2",
      role: "assistant",
      parentId: q2.id,
      body: "Second answer",
      createdAt: "2026-10-23T02:10:21Z",
    };
    const run: AiRun = {
      id: "r1",
      question: q1,
      snapshotId: "s",
      kind: "question",
      phase: "working",
      text: "Thinking…",
      stream: "First answer",
      preference: {
        provider: "claude",
        model: "claude-fable-5",
        reasoningEffort: "high",
      },
    };
    const c = {
      runs: [run],
      workspace: { snapshot: { pull: { head: "h" } }, notes: [] },
      isBusy: () => false,
    } as unknown as Conversation;
    const { container, rerender } = render(
      <ReviewMessages notes={[q1, q2]} conversation={c} inline={inline} />,
    );
    const order = () =>
      [...container.querySelectorAll<HTMLElement>(".message")].map(
        (e) => e.dataset.noteId ?? e.dataset.runId,
      );
    expect(order()).toEqual(["q1", "r1", "q2"]);
    rerender(
      <ReviewMessages
        notes={[q1, q2, a1]}
        conversation={{
          ...c,
          runs: [{ ...run, id: "r2", question: q2, stream: "Second answer" }],
        }}
        inline={inline}
      />,
    );
    expect(order()).toEqual(["q1", "a1", "q2", "r2"]);
    rerender(
      <ReviewMessages
        notes={[q1, q2, a1, a2]}
        conversation={{ ...c, runs: [] }}
        inline={inline}
      />,
    );
    expect(order()).toEqual(["q1", "a1", "q2", "a2"]);
  },
);
