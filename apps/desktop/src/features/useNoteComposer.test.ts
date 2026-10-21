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
