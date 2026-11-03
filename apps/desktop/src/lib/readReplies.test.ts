// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createReadReplies } from "./readReplies";

beforeEach(() => localStorage.clear());

it("persists individual read replies across reloads and isolates PRs", () => {
  createReadReplies("owner/repo#1").mark(["answer-1"]);
  const reloaded = createReadReplies("owner/repo#1");
  expect([...reloaded.getSnapshot()]).toEqual(["answer-1"]);
  expect(createReadReplies("owner/repo#2").getSnapshot().size).toBe(0);
  const listener = vi.fn();
  const unsubscribe = reloaded.subscribe(listener);
  reloaded.mark(["answer-1"]);
  expect(listener).not.toHaveBeenCalled();
  reloaded.mark(["answer-2"]);
  expect(listener).toHaveBeenCalledOnce();
  expect([...createReadReplies("owner/repo#1").getSnapshot()]).toEqual([
    "answer-1",
    "answer-2",
  ]);
  unsubscribe();
});

it("merges receipts from another window without losing local reads", () => {
  const store = createReadReplies("owner/repo#1");
  const unsubscribe = store.subscribe(() => {});
  store.mark(["answer-1"]);
  const key = "diffcity.read-ai.v1:owner/repo#1";
  localStorage.setItem(key, JSON.stringify(["answer-2"]));
  window.dispatchEvent(new StorageEvent("storage", { key }));
  expect([...store.getSnapshot()]).toEqual(["answer-1", "answer-2"]);
  store.mark(["answer-3"]);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([
    "answer-1",
    "answer-2",
    "answer-3",
  ]);
  unsubscribe();
});

it("tolerates corrupt or unavailable storage and keeps session receipts", () => {
  localStorage.setItem("diffcity.read-ai.v1:broken", "invalid JSON");
  const store = createReadReplies("broken");
  expect(store.getSnapshot().size).toBe(0);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("unavailable");
    });
  try {
    store.mark(["answer"]);
    expect(store.getSnapshot().has("answer")).toBe(true);
  } finally {
    write.mockRestore();
  }
});
