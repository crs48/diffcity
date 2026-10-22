import { describe, expect, it } from "vitest";
import { fullReviewAnchor } from "./reviewComparison";
import type { Anchor, ReviewWorkspace } from "./api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const full = (fixture as ReviewWorkspace).snapshot;
const anchor: Anchor = {
  path: full.files[1].path,
  hunkId: "delta-hunk",
  side: "RIGHT",
  startLine: 2,
  line: 4,
};
describe("comparison comment coordinates", () => {
  it("maps a multi-line selection at the shared head to its full PR hunk", () => {
    expect(fullReviewAnchor(anchor, full)).toEqual({
      ...anchor,
      hunkId: full.files[1].hunks[0].id,
    });
  });
  it("never treats reviewed-head deletions as original PR-base lines", () => {
    expect(fullReviewAnchor({ ...anchor, side: "LEFT" }, full)).toBeNull();
    expect(
      fullReviewAnchor({ ...anchor, path: "removed-in-new-revision.ts" }, full),
    ).toBeNull();
    expect(fullReviewAnchor({ ...anchor, line: 100 }, full)).toBeNull();
  });
});
