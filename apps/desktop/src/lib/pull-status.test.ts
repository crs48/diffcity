import { describe, expect, it } from "vitest";
import type { PullRequest } from "./api";
import { pullSignals, relativePullTime } from "./pull-status";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const pull = (patch: Partial<PullRequest> = {}): PullRequest => ({
  ...fixture.snapshot.pull,
  author: "other",
  state: "open",
  draft: false,
  requested: [],
  assigned: [],
  ...patch,
});

describe("PR card signals", () => {
  it("gives completed PRs their own colors and ignores stale draft, CI and review flags", () => {
    for (const [state, tone] of [
      ["merged", "purple"],
      ["closed", "red"],
    ]) {
      const result = pullSignals(
        pull({
          state,
          draft: true,
          requested: ["me"],
          status: {
            checks: "FAILURE",
            mergeable: "CONFLICTING",
            mergeState: "DIRTY",
          },
        }),
        "me",
      );
      expect(result.lifecycle).toMatchObject({ kind: state, tone });
      expect(result.badges).toEqual([]);
      expect(result.emphasis).toBeNull();
    }
    expect(pullSignals(pull({ draft: true }), "me").lifecycle.tone).toBe(
      "muted",
    );
    expect(pullSignals(pull(), "me").lifecycle.tone).toBe("green");
  });
  it("surfaces conflicting merge, check and review information independently", () => {
    const result = pullSignals(
      pull({
        reviewDecision: "APPROVED",
        status: {
          mergeable: "CONFLICTING",
          mergeState: "DIRTY",
          checks: "FAILURE",
        },
      }),
      "me",
    );
    expect(result.badges.map((b) => b.label)).toEqual([
      "Approved",
      "Checks failed",
      "Merge conflicts",
    ]);
    expect(result.emphasis?.kind).toBe("conflicts");
    const pending = pullSignals(
      pull({
        status: {
          mergeable: "MERGEABLE",
          mergeState: "BLOCKED",
          checks: "PENDING",
        },
      }),
      "me",
    );
    expect(pending.badges.map((b) => b.label)).toEqual([
      "Checks pending",
      "Merge blocked",
    ]);
  });
  it("does not interpret missing checks, unknown merge state, or an approval as merge readiness", () => {
    expect(pullSignals(pull(), "me").badges).toEqual([]);
    const unknown = pullSignals(
      pull({
        reviewDecision: "APPROVED",
        status: { checks: null, mergeable: "UNKNOWN", mergeState: "UNKNOWN" },
      }),
      "me",
    );
    expect(unknown.badges.map((b) => b.label)).toEqual([
      "Approved",
      "Checks unavailable",
    ]);
    const none = pullSignals(
      pull({ status: { checks: "NONE", mergeable: null, mergeState: null } }),
      "me",
    );
    expect(none.badges.map((b) => b.label)).toEqual(["No checks"]);
    const passed = pullSignals(
      pull({
        status: {
          checks: "SUCCESS",
          mergeable: "UNKNOWN",
          mergeState: "UNKNOWN",
        },
      }),
      "me",
    );
    expect(passed.badges.map((b) => b.label)).toEqual(["Checks passed"]);
  });
  it("keeps requests and re-requests visible and respects the current aggregate review decision", () => {
    const reviewed = pull({
      viewerReview: { state: "APPROVED", submittedAt: "2026-10-20T12:00:00Z" },
      reviewDecision: "CHANGES_REQUESTED",
    });
    expect(pullSignals(reviewed, "me").badges[0].label).toBe(
      "Changes requested",
    );
    expect(
      pullSignals({ ...reviewed, requested: ["ME"] }, "me").badges[0].label,
    ).toBe("Review requested again");
    expect(pullSignals(pull({ requested: ["me"] }), "me").badges[0].tone).toBe(
      "blue",
    );
    expect(pullSignals(pull({ assigned: ["me"] }), "me").badges[0].label).toBe(
      "Assigned to you",
    );
  });
  it("distinguishes draft checks, expected checks, behind-base and mergeable states", () => {
    expect(
      pullSignals(
        pull({
          draft: true,
          status: {
            mergeable: "MERGEABLE",
            mergeState: "CLEAN",
            checks: "EXPECTED",
          },
        }),
        "me",
      ).badges.map((b) => b.kind),
    ).toEqual(["expected"]);
    for (const [state, kind] of [
      ["BEHIND", "behind"],
      ["CLEAN", "mergeable"],
      ["HAS_HOOKS", "hooks"],
    ]) {
      expect(
        pullSignals(
          pull({
            status: {
              mergeable: "MERGEABLE",
              mergeState: state,
              checks: "SUCCESS",
            },
          }),
          "me",
        ).badges.map((b) => b.kind),
      ).toEqual(["passed", kind]);
    }
  });
});
it("formats update age locally and omits invalid timestamps", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  expect(relativePullTime("2026-10-21T10:00:00Z", "en", now)).toBe("2h ago");
  expect(relativePullTime("2026-10-21T12:01:00Z", "en", now)).toBe("now");
  expect(relativePullTime("not a date", "en", now)).toBeNull();
});
