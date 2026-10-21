// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type PullPage, type PullRequest } from "../lib/api";
import { usePullHistory } from "./usePullHistory";
const pull = (number: number) =>
  ({ repository: "owner/repo", number, state: "closed" }) as PullRequest;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads history on demand, deduplicates pages, and leaves open inbox data separate", async () => {
  const history = vi
    .spyOn(api, "history")
    .mockResolvedValueOnce({ pulls: [pull(1)], nextPage: 2, syncError: null })
    .mockResolvedValueOnce({
      pulls: [pull(1), pull(2)],
      nextPage: null,
      syncError: "Showing saved history",
    });
  const { result, rerender } = renderHook(
    ({ enabled }) => usePullHistory(null, enabled),
    { initialProps: { enabled: false } },
  );
  expect(history).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.pulls).toHaveLength(1));
  await act(() => result.current.load(2));
  expect(result.current.pulls.map((p) => p.number)).toEqual([1, 2]);
  expect(result.current.error).toBe("Showing saved history");
  expect(result.current.nextPage).toBeNull();
});
it("ignores an old repository response when the user changes projects", async () => {
  let first: (value: PullPage) => void = () => {};
  vi.spyOn(api, "history")
    .mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve;
      }),
    )
    .mockResolvedValueOnce({
      pulls: [pull(2)],
      nextPage: null,
      syncError: null,
    });
  const { result, rerender } = renderHook(
    ({ repo }) => usePullHistory(repo, true),
    { initialProps: { repo: "owner/old" } },
  );
  rerender({ repo: "owner/new" });
  await waitFor(() => expect(result.current.pulls[0]?.number).toBe(2));
  await act(async () =>
    first({ pulls: [pull(1)], nextPage: null, syncError: null }),
  );
  expect(result.current.pulls[0]?.number).toBe(2);
});
