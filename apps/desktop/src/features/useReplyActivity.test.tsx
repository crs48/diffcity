// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { indexedWorkspace } from "../lib/guideIndex.fixture";
import { readReplies } from "../lib/readReplies";
import {
  combinedActivity,
  replyActivity,
  replyThreadKey,
  useReplyReceipt,
} from "./useReplyActivity";
import type { AiRun } from "./useAiRuns";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("tracks unread answers, working and queued questions independently for each thread", () => {
  const w = indexedWorkspace();
  const question = w.notes[0];
  const run: AiRun = {
    id: "run",
    snapshotId: w.snapshot.id,
    kind: "question",
    question,
    phase: "working",
    text: "Thinking",
    stream: "partial",
    preference: {
      provider: "claude",
      model: "claude-fable-5",
      reasoningEffort: "high",
    },
  };
  const runs: AiRun[] = [
    run,
    { ...run, id: "queued", phase: "waiting" },
    { ...run, id: "other", question: w.notes[2], phase: "queued" },
    { ...run, id: "failed", phase: "error" },
    { ...run, id: "cancelled", phase: "cancelled" },
    { ...run, id: "guide", kind: "guide" },
    { ...run, id: "stale", snapshotId: "old" },
  ];
  const notes = [
    ...w.notes,
    { ...w.notes[1], id: "draft", githubDraft: true },
    {
      ...w.notes[1],
      id: "published",
      publishedUrl: "https://github.com/example/repo/pull/1",
    },
    { ...w.notes[1], id: "stale", snapshotId: "old" },
  ];
  const activity = replyActivity(notes, runs, w.snapshot.id, new Set());
  expect(activity.get(replyThreadKey(question.anchor))).toEqual({
    unread: 1,
    working: 1,
    queued: 1,
  });
  expect(activity.get("pr-chat")).toEqual({ unread: 0, working: 0, queued: 1 });
  expect(combinedActivity([...activity.values()])).toEqual({
    unread: 1,
    working: 1,
    queued: 2,
  });
  // Completion turns a spinner into an unread dot; reading one response does
  // not clear the next response in the same conversation.
  const completed = [...notes, { ...w.notes[1], id: "next-answer" }];
  expect(
    replyActivity(completed, [], w.snapshot.id, new Set(["answer"])).get(
      replyThreadKey(question.anchor),
    ),
  ).toEqual({ unread: 1, working: 0, queued: 0 });
});

function Receipt({ scope, ids }: { scope: string; ids: string[] }) {
  const track = useReplyReceipt(scope);
  return ids.map((id) => (
    <article key={id} ref={track} data-note-id={id}>
      Answer
    </article>
  ));
}

function observeReplies() {
  let notify: IntersectionObserverCallback;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  const visibility = (id: string, height: number) =>
    act(() => {
      const target = document.querySelector(`[data-note-id="${id}"]`)!;
      notify(
        [
          {
            target,
            isIntersecting: height > 0,
            intersectionRect: { height },
            boundingClientRect: { height: 500 },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  return { visibility, observe, unobserve, disconnect };
}

it("only marks replies read after visible dwell, not mounting, overscan, or a quick scroll past", () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const io = observeReplies();
  const scope = "visibility-test";
  const store = readReplies(scope);
  const view = render(<Receipt scope={scope} ids={["first", "second"]} />);
  act(() => vi.advanceTimersByTime(1000));
  expect(store.getSnapshot().size).toBe(0);
  io.visibility("first", 200);
  act(() => vi.advanceTimersByTime(500));
  io.visibility("first", 0);
  act(() => vi.advanceTimersByTime(1000));
  expect(store.getSnapshot().size).toBe(0);
  io.visibility("second", 100);
  act(() => vi.advanceTimersByTime(750));
  expect([...store.getSnapshot()]).toEqual(["second"]);
  view.rerender(<Receipt scope={scope} ids={["second", "third"]} />);
  expect(io.unobserve).toHaveBeenCalledOnce();
  expect(io.observe).toHaveBeenCalledTimes(3);
  io.visibility("third", 100);
  view.unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect([...store.getSnapshot()]).toEqual(["second"]);
  expect(io.disconnect).toHaveBeenCalledOnce();
});

it("does not read replies in a background tab and restarts dwell when the tab is visible", () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const io = observeReplies();
  const scope = "hidden-tab-test";
  render(<Receipt scope={scope} ids={["answer"]} />);
  io.visibility("answer", 100);
  act(() => vi.advanceTimersByTime(500));
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(1000));
  expect(readReplies(scope).getSnapshot().size).toBe(0);
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(750));
  expect(readReplies(scope).getSnapshot().has("answer")).toBe(true);
});
