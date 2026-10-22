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
