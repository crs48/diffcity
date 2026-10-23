// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAiRuns, threadModel, threadRuns, isActiveRun } from "./useAiRuns";
import { api, type RunEvent } from "../lib/api";
import { newNote } from "../lib/review";
import { defaultModelPreference } from "../lib/models";

const events = vi.hoisted(() => ({
  listener: (event: { payload: RunEvent }) => {
    void event;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, listener) => {
    events.listener = listener;
    return vi.fn();
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const anchor = {
  hunkId: "h",
  path: "a.ts",
  side: "RIGHT" as const,
  startLine: 1,
  line: 1,
};

it("routes interleaved replies independently while a guide runs, and cancels only one job", async () => {
  const { result } = renderHook(useAiRuns);
  const a = { ...newNote("snapshot", anchor, "A"), id: "a" };
  const b = {
    ...newNote("snapshot", { ...anchor, line: 2, startLine: 2 }, "B"),
    id: "b",
  };
  const inputs = [
    { kind: "question" as const, question: a },
    { kind: "question" as const, question: b },
    { kind: "guide" as const },
  ].map((x) => ({
    ...x,
    snapshotId: "snapshot",
    preference: defaultModelPreference,
  }));
  const work = [deferred<string>(), deferred<string>(), deferred<string>()];
  const tasks = work.map((w) => vi.fn(() => w.promise));
  let promises: Promise<string | undefined>[] = [];
  act(() => {
    promises = inputs.map((input, i) => result.current.start(input, tasks[i]));
  });
  await waitFor(() =>
    expect(tasks.every((t) => t.mock.calls.length === 1)).toBe(true),
  );
  const ids = result.current.runs.map((r) => r.id);
  act(() => {
    events.listener({
      payload: {
        runId: ids[1],
        snapshotId: "snapshot",
        phase: "stream",
        text: "B1",
      },
    });
    events.listener({
      payload: {
        runId: ids[0],
        snapshotId: "wrong-revision",
        phase: "stream",
        text: "WRONG",
      },
    });
    events.listener({
      payload: {
        runId: ids[0],
        snapshotId: "snapshot",
        phase: "stream",
        text: "A1",
      },
    });
    events.listener({
      payload: {
        runId: ids[1],
        snapshotId: "snapshot",
        phase: "stream",
        text: "B2",
      },
    });
  });
  expect(result.current.runs.map((r) => r.stream)).toEqual(["A1", "B1B2", ""]);
  const duplicate = vi.fn();
  await act(() => result.current.start(inputs[0], duplicate));
  expect(duplicate).not.toHaveBeenCalled();
  const cancel = vi.spyOn(api, "cancel").mockResolvedValue(undefined);
  await act(() => result.current.cancel(ids[1]));
  expect(cancel).toHaveBeenCalledExactlyOnceWith(ids[1]);
  expect(result.current.runs[0].phase).toBe("working");
  await act(async () => {
    work[1].reject(new Error("cancelled"));
    await promises[1];
  });
  expect(result.current.runs[1].phase).toBe("cancelled");
  expect(
    threadRuns(result.current.runs, "snapshot", b.anchor).some(isActiveRun),
  ).toBe(false);
  await act(async () => {
    work[0].resolve("answer");
    await promises[0];
  });
  expect(result.current.runs.some((r) => r.id === ids[2])).toBe(true);
  await act(async () => {
    work[2].resolve("guide");
    await promises[2];
  });
  expect(result.current.runs.map((r) => r.id)).toEqual([ids[1]]);
});

it("retains failures in their thread and permits a fresh request without reusing stale events", async () => {
  const { result } = renderHook(useAiRuns);
  const input = {
    kind: "question" as const,
    snapshotId: "snapshot",
    question: { ...newNote("snapshot", anchor, "why"), id: "q" },
    preference: defaultModelPreference,
  };
  await act(() =>
    result.current.start(input, () =>
      Promise.reject(new Error("Account unavailable")),
    ),
  );
  const failed = result.current.runs[0];
  expect(failed.text).toContain("Account unavailable");
  const task = deferred<string>();
  let pending: Promise<string | undefined>;
  act(() => {
    pending = result.current.start(input, () => task.promise);
  });
  await waitFor(() => expect(result.current.runs).toHaveLength(2));
  act(() =>
    events.listener({
      payload: {
        runId: failed.id,
        snapshotId: "snapshot",
        phase: "stream",
        text: "late",
      },
    }),
  );
  expect(result.current.runs[0].stream).toBe("");
  await act(async () => {
    task.resolve("ok");
    await pending;
  });
  expect(result.current.runs).toHaveLength(1);
});

it("defaults new threads to Fable and preserves the model of an existing exact selection", () => {
  expect(defaultModelPreference).toEqual({
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "high",
  });
  const codex = {
    provider: "codex",
    model: "gpt-6-astra",
    reasoningEffort: "xhigh",
  };
  const notes = [
    {
      ...newNote("snapshot", anchor, "answer"),
      role: "assistant",
      model: codex,
      createdAt: "2026-10-22",
    },
  ];
  expect(threadModel(notes, anchor, defaultModelPreference)).toEqual(codex);
  expect(
    threadModel(
      notes,
      {
        ...anchor,
        textSelection: {
          snapshotId: "snapshot",
          startColumn: 0,
          endColumn: 3,
          text: "foo",
        },
      },
      defaultModelPreference,
    ),
  ).toEqual(defaultModelPreference);
});

it("routes incremental enrichment only to its guide while question responses remain independent", async () => {
  const { result } = renderHook(useAiRuns);
  const task = deferred<string>();
  const updates = vi.fn();
  const details = {
    kind: "enrichment" as const,
    guideId: "guide-one",
    snapshotId: "snapshot",
    preference: defaultModelPreference,
  };
  let promise: Promise<string | undefined>;
  act(() => {
    promise = result.current.start(details, () => task.promise, updates);
  });
  const run = result.current.runs[0];
  const guide = { id: "guide-one", snapshotId: "snapshot" } as NonNullable<
    RunEvent["guide"]
  >;
  act(() => {
    events.listener({
      payload: {
        runId: run.id,
        snapshotId: "snapshot",
        phase: "enriched",
        text: "First file saved",
        guide,
      },
    });
    events.listener({
      payload: {
        runId: run.id,
        snapshotId: "snapshot",
        phase: "enriched",
        text: "Wrong guide",
        guide: { ...guide, id: "other" },
      },
    });
  });
  expect(updates).toHaveBeenCalledExactlyOnceWith(guide);
  await act(async () => {
    task.resolve("done");
    await promise;
  });
  act(() => {
    events.listener({
      payload: {
        runId: run.id,
        snapshotId: "snapshot",
        phase: "enriched",
        text: "Late event",
        guide,
      },
    });
  });
  expect(updates).toHaveBeenCalledTimes(1);
});

const questionInput = (
  id: string,
  selected = anchor,
  snapshotId = "snapshot",
) => ({
  kind: "question" as const,
  snapshotId,
  question: { ...newNote(snapshotId, selected, id), id },
  preference: defaultModelPreference,
});

it("dispatches follow-ups FIFO only after each answer settles, with other conversations independent", async () => {
  const { result } = renderHook(useAiRuns);
  const work = Array.from({ length: 5 }, () => deferred<string>());
  const tasks = work.map((w) => vi.fn(() => w.promise));
  const inputs = [
    questionInput("one"),
    questionInput("two"),
    questionInput("three"),
    questionInput("other-line", { ...anchor, line: 2, startLine: 2 }),
    questionInput("other-revision", anchor, "other-snapshot"),
  ];
  let promises: Promise<string | undefined>[] = [];
  act(() => {
    promises = inputs.map((input, i) => result.current.start(input, tasks[i]));
  });
  await waitFor(() =>
    expect(tasks.map((t) => t.mock.calls.length)).toEqual([1, 0, 0, 1, 1]),
  );
  expect(result.current.runs.map((r) => r.phase)).toEqual([
    "queued",
    "waiting",
    "waiting",
    "queued",
    "queued",
  ]);
  const duplicate = vi.fn();
  await act(() => result.current.start(inputs[1], duplicate));
  expect(duplicate).not.toHaveBeenCalled();
  await act(async () => {
    work[0].resolve("first answer saved");
    await promises[0];
  });
  await waitFor(() =>
    expect(tasks.map((t) => t.mock.calls.length)).toEqual([1, 1, 0, 1, 1]),
  );
  await act(async () => {
    work[1].resolve("second answer saved");
    await promises[1];
  });
  await waitFor(() => expect(tasks[2]).toHaveBeenCalledTimes(1));
  await act(async () => {
    work[2].resolve("third answer");
    work[3].resolve("other line");
    work[4].resolve("other revision");
    await Promise.all(promises);
  });
  expect(result.current.runs).toEqual([]);
});

it("removing the middle or tail question never dispatches it or lets a later question bypass the running reply", async () => {
  const { result } = renderHook(useAiRuns);
  const cancel = vi.spyOn(api, "cancel").mockResolvedValue(undefined);
  const first = deferred<string>();
  const last = deferred<string>();
  const tasks = [
    vi.fn(() => first.promise),
    vi.fn(async () => "removed"),
    vi.fn(() => last.promise),
  ];
  let promises: Promise<string | undefined>[] = [];
  act(() => {
    promises = tasks
      .slice(0, 2)
      .map((task, i) => result.current.start(questionInput(String(i)), task));
  });
  await waitFor(() => expect(tasks[0]).toHaveBeenCalledTimes(1));
  const middleId = result.current.runs[1].id;
  await act(async () => {
    await result.current.cancel(middleId);
    await promises[1];
  });
  expect(cancel).not.toHaveBeenCalled();
  expect(result.current.runs[1].phase).toBe("cancelled");
  // Queue a new question after removing the tail: the cancelled barrier must
  // continue waiting on the active first question.
  act(() => {
    promises.push(result.current.start(questionInput("third"), tasks[2]));
  });
  await act(async () => {});
  expect(tasks[1]).not.toHaveBeenCalled();
  expect(tasks[2]).not.toHaveBeenCalled();
  await act(async () => {
    first.resolve("answer");
    await promises[0];
  });
  await waitFor(() => expect(tasks[2]).toHaveBeenCalledTimes(1));
  await act(async () => {
    last.resolve("last");
    await promises[2];
  });
  expect(result.current.runs).toHaveLength(1);
  expect(result.current.runs[0].text).toBe(
    "Removed from queue · saved as a private note",
  );
});

it.each([false, true])(
  "advances after a failed or cancelled response without affecting other queued questions (cancel: %s)",
  async (cancelled) => {
    const { result } = renderHook(useAiRuns);
    const first = deferred<string>();
    const next = vi.fn(async () => "next answer");
    const cancel = vi.spyOn(api, "cancel").mockResolvedValue(undefined);
    let pending!: Promise<string | undefined>;
    let queued!: Promise<string | undefined>;
    act(() => {
      pending = result.current.start(
        questionInput("first"),
        () => first.promise,
      );
      queued = result.current.start(questionInput("second"), next);
    });
    await act(async () => {});
    const firstId = result.current.runs[0].id;
    if (cancelled) await act(() => result.current.cancel(firstId));
    expect(next).not.toHaveBeenCalled();
    await act(async () => {
      first.reject(new Error(cancelled ? "cancelled" : "Provider unavailable"));
      await Promise.all([pending, queued]);
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(result.current.runs[0].phase).toBe(
      cancelled ? "cancelled" : "error",
    );
    expect(cancel).toHaveBeenCalledTimes(cancelled ? 1 : 0);
  },
);
