// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Note } from "../lib/api";
import { useNoteComposer } from "./useNoteComposer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("retains an unsaved comment on failure and serializes saves without duplicate messages", async () => {
  const onNote = vi.fn();
  const persisted = new Map<string, Note>();
  const save = vi
    .spyOn(api, "note")
    .mockRejectedValueOnce(new Error("disk full"))
    .mockImplementation(async (note) => {
      const result = { ...note, id: note.id || "saved-one" };
      persisted.set(result.id, result);
      return result;
    });
  const { result } = renderHook(() => useNoteComposer(onNote, vi.fn()));
  await act(() => result.current.start("snapshot", null));
  act(() => result.current.change("Keep this question."));
  await act(async () => {
    await expect(result.current.close()).rejects.toThrow("disk full");
  });
  expect(result.current.draft?.body).toBe("Keep this question.");
  await act(async () => {
    await Promise.all([result.current.flush(), result.current.flush()]);
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(persisted.size).toBe(1);
  expect(result.current.saved).toBe(true);
  await act(() => result.current.start("snapshot", null));
  expect(result.current.draft?.body).toBe("Keep this question.");
  act(() => result.current.change("An updated question."));
  await act(() => result.current.submit());
  expect(persisted.size).toBe(1);
  expect(persisted.get("saved-one")?.body).toBe("An updated question.");
  expect(result.current.draft?.body).toBe("");
});

it("keeps exact text context on follow-up drafts and distinguishes two words on the same line", async () => {
  const anchor = {
    hunkId: "h",
    path: "a.ts",
    side: "RIGHT" as const,
    startLine: 1,
    line: 1,
    textSelection: {
      snapshotId: "snapshot",
      startColumn: 2,
      endColumn: 5,
      text: "foo",
    },
  };
  vi.spyOn(api, "note").mockImplementation(async (n) => ({
    ...n,
    id: n.id || "question",
  }));
  const { result } = renderHook(() => useNoteComposer(vi.fn(), vi.fn()));
  await act(() => result.current.start("snapshot", anchor));
  act(() => result.current.change("Why is foo here?"));
  const ask = vi.fn().mockResolvedValue(undefined);
  await act(() => result.current.submit(ask));
  expect(result.current.draft?.anchor).toEqual(anchor);
  expect(result.current.draft?.githubDraft).toBe(false);
  const second = {
    ...anchor,
    textSelection: {
      ...anchor.textSelection,
      startColumn: 7,
      endColumn: 10,
      text: "bar",
    },
  };
  await act(() => result.current.start("snapshot", second));
  expect(result.current.draft?.anchor).toEqual(second);
});
it("converts an autosaved private note to one unpublished draft without sending to AI", async () => {
  const notes = new Map<string, Note>();
  vi.spyOn(api, "note").mockImplementation(async (n) => {
    const saved = { ...n, id: n.id || "one" };
    notes.set(saved.id, saved);
    return saved;
  });
  const { result } = renderHook(() => useNoteComposer(vi.fn(), vi.fn()));
  await act(() => result.current.start("s", null));
  act(() => result.current.change("Please add a migration test."));
  await act(() => result.current.flush());
  await act(() => result.current.submit(undefined, true));
  expect(notes.size).toBe(1);
  expect(notes.get("one")).toMatchObject({
    githubDraft: true,
    publishedUrl: null,
  });
  expect(result.current.draft?.body).toBe("");
});
