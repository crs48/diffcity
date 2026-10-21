// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type PullRequest } from "../lib/api";
import { pinKey, SAMPLE_REPO } from "../lib/inbox";
import { prefetchCandidates, useReviewPrefetch } from "./useReviewPrefetch";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const pull = (
  number: number,
  changes: Partial<PullRequest> = {},
): PullRequest =>
  ({
    ...fixture.snapshot.pull,
    repository: "owner/repo",
    number,
    author: "other",
    requested: [],
    assigned: [],
    state: "open",
    updatedAt: "2026-10-21T00:00:00Z",
    ...changes,
  }) as PullRequest;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("prefetches every authored, requested, and assigned open PR, including drafts, across repos", () => {
  const pulls = [
    pull(1, { assigned: ["ME"], draft: true }),
    pull(2, { requested: ["me"] }),
    pull(3, { author: "me", draft: true, repository: "another/repo" }),
    pull(4),
    pull(5, { author: "me", state: "closed" }),
    pull(6, { author: "me", repository: SAMPLE_REPO }),
    pull(7, { author: "me", updatedAt: "2026-10-22T00:00:00Z" }),
  ];
  expect(
    prefetchCandidates([...pulls, pulls[0]], "Me").map((p) => p.number),
  ).toEqual([7, 3, 2, 1]);
  expect(prefetchCandidates(pulls, "")).toEqual([]);
});

it("runs one download at a time, skips active review, and retries changed heads without waiting for TTL", async () => {
  let complete: (value: boolean) => void = () => {};
  const prefetch = vi
    .spyOn(api, "prefetch")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(true);
  const pulls = [pull(1, { author: "me" }), pull(2, { assigned: ["me"] })];
  const { rerender } = renderHook(
    ({ items, active }) => useReviewPrefetch(items, "me", true, false, active),
    { initialProps: { items: pulls, active: null as string | null } },
  );
  await advance(1_000);
  expect(prefetch).toHaveBeenCalledWith(pulls[0]);
  await advance(10_000);
  expect(prefetch).toHaveBeenCalledTimes(1);
  await act(async () => complete(true));
  await advance(1_000);
  expect(prefetch).toHaveBeenLastCalledWith(pulls[1]);
  await advance(10_000);
  expect(prefetch).toHaveBeenCalledTimes(2);
  const changed = { ...pulls[0], head: "new-head" };
  rerender({ items: [changed, pulls[1]], active: pinKey(changed) });
  await advance(1_000);
  expect(prefetch).toHaveBeenCalledTimes(2);
  rerender({ items: [changed, pulls[1]], active: null });
  await advance(1_000);
  expect(prefetch).toHaveBeenLastCalledWith(changed);
  expect(prefetch).toHaveBeenCalledTimes(3);
});

it("pauses for foreground work and hidden windows, retries interruptions, and backs off errors", async () => {
  const prefetch = vi
    .spyOn(api, "prefetch")
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(Error("rate limit"))
    .mockResolvedValue(true);
  const pulls = [pull(1, { author: "me" })];
  const { rerender } = renderHook(
    ({ paused }) => useReviewPrefetch(pulls, "me", true, paused, null),
    { initialProps: { paused: true } },
  );
  await advance(10_000);
  expect(prefetch).not.toHaveBeenCalled();
  rerender({ paused: false });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await advance(1_000);
  expect(prefetch).not.toHaveBeenCalled();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await advance(1_000);
  expect(prefetch).toHaveBeenCalledTimes(1);
  await advance(2_000);
  expect(prefetch).toHaveBeenCalledTimes(2);
  await advance(59_000);
  expect(prefetch).toHaveBeenCalledTimes(2);
  await advance(1_000);
  expect(prefetch).toHaveBeenCalledTimes(3);
});
