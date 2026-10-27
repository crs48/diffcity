import { describe, expect, it } from "vitest";
import { countProgress, parsePullUrl } from "./review";
import type { ReviewWorkspace } from "./api";
describe("review navigation", () => {
  it("opens only recognized GitHub pull request URLs", () => {
    expect(
      parsePullUrl("https://github.com/crs48/diffcity/pull/1/files"),
    ).toEqual({ repository: "crs48/diffcity", number: 1 });
    expect(parsePullUrl("https://github.com.evil.test/a/b/pull/1")).toBeNull();
    expect(parsePullUrl("javascript:alert(1)")).toBeNull();
  });
  it("never counts folded summaries or deferral as code review", () => {
    const w = {
      snapshot: { files: [{ hunks: [{ id: "one" }, { id: "two" }] }] },
      guide: {
        sections: [
          {
            attention: "high",
            assessed: true,
            hunkIds: ["one"],
            unavailablePaths: [],
          },
        ],
      },
      progress: { reviewed: [], acknowledged: ["one"], deferred: ["two"] },
    } as unknown as ReviewWorkspace;
    expect(countProgress(w)).toMatchObject({
      total: 2,
      reviewed: 0,
      acknowledged: 1,
      deferred: 1,
      highRemaining: 1,
    });
  });
});
