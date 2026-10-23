// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ReviewMessages } from "./ReviewMessages";
import type { Conversation } from "./conversation";
import type { AiRun } from "./useAiRuns";
import { newNote } from "../lib/review";

vi.mock("../ui/CommentMarkdown", () => ({
  CommentMarkdown: ({ body }: { body: string }) => <p>{body}</p>,
}));
afterEach(cleanup);

it.each([true, false])(
  "labels waiting questions in order and removes only the requested one (inline: %s)",
  (inline) => {
    const questions = [1, 2, 3].map((id) => ({
      ...newNote("s", null, `Question ${id}`),
      id: `q${id}`,
      createdAt: String(id),
    }));
    const runs: AiRun[] = questions.map((question, index) => ({
      id: `r${index}`,
      question,
      snapshotId: "s",
      kind: "question",
      phase: index === 0 ? "working" : "waiting",
      text: "Thinking…",
      stream: "",
      preference: {
        provider: "claude",
        model: "claude-fable-5",
        reasoningEffort: "high",
      },
    }));
    const cancel = vi.fn();
    const c = {
      runs,
      cancel,
      workspace: { notes: [], snapshot: { pull: { head: "h" } } },
    } as unknown as Conversation;
    const { container } = render(
      <ReviewMessages notes={questions} conversation={c} inline={inline} />,
    );
    const waiting = screen.getAllByRole("article", {
      name: "Queued AI question",
    });
    expect(waiting).toHaveLength(2);
    expect(waiting[0].textContent).toContain("Queued · 1");
    expect(waiting[1].textContent).toContain("Queued · 2");
    expect(
      [...container.querySelectorAll<HTMLElement>(".message")].map(
        (el) => el.dataset.noteId ?? el.dataset.runId,
      ),
    ).toEqual(["q1", "r0", "q2", "r1", "q3", "r2"]);
    expect(
      screen
        .getAllByRole("button", { name: "Ask AI about this comment" })
        .every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
    fireEvent.click(
      within(waiting[0]).getByRole("button", { name: "Remove from queue" }),
    );
    expect(cancel).toHaveBeenCalledExactlyOnceWith("r1");
  },
);

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
