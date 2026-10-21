import { describe, expect, it } from "vitest";
import type { PullRequest } from "./api";
import {
  inboxGroup,
  inboxGroups,
  reviewLabel,
  visiblePulls,
  repositoryOwners,
  accountOwners,
  repositoriesForOwner,
  resolveScope,
} from "./inbox";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const now = Date.parse("2026-10-21T12:00:00Z");
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
const pr = (changes: Partial<PullRequest> = {}): PullRequest => ({
  ...fixture.snapshot.pull,
  author: "other",
  state: "open",
  requested: [],
  assigned: [],
  updatedAt: ago(0),
  ...changes,
});
const options = {
  login: "me",
  repository: null,
  query: "",
  history: false,
  completedDays: 2,
  now,
};
describe("repo inbox priorities", () => {
  it("keeps owned drafts and ready PRs above all reviewer work, case insensitively", () => {
    for (const draft of [false, true])
      expect(
        inboxGroup(pr({ author: "ME", draft, requested: ["me"] }), "me"),
      ).toBe("Your pull requests");
    expect(inboxGroups).toEqual([
      "Your pull requests",
      "Needs your review",
      "Assigned to you",
      "Awaiting review",
      "Reviewed",
      "Drafts",
      "Recently completed",
    ]);
  });
  it("demotes a submitted review and restores priority for a re-request", () => {
    const requested = pr({ assigned: ["ME"], requested: ["Me"] });
    expect(inboxGroup(requested, "me")).toBe("Needs your review");
    const reviewed = {
      ...requested,
      requested: [],
      viewerReview: { state: "CHANGES_REQUESTED", submittedAt: ago(1) },
    };
    expect(inboxGroup(reviewed, "me")).toBe("Reviewed");
    expect(reviewLabel(reviewed, "me")).toBe("You requested changes");
    const again = { ...reviewed, requested: ["me"] };
    expect(inboxGroup(again, "me")).toBe("Needs your review");
    expect(reviewLabel(again, "me")).toBe("Review requested again");
  });
  it("separates assignments, ready work, approved work and drafts", () => {
    expect(inboxGroup(pr({ assigned: ["me"] }), "me")).toBe("Assigned to you");
    expect(inboxGroup(pr(), "me")).toBe("Awaiting review");
    expect(inboxGroup(pr({ reviewDecision: "APPROVED" }), "me")).toBe(
      "Reviewed",
    );
    expect(inboxGroup(pr({ draft: true, assigned: ["me"] }), "me")).toBe(
      "Drafts",
    );
    expect(
      inboxGroup(
        pr({ viewerReview: { state: "DISMISSED", submittedAt: ago(1) } }),
        "me",
      ),
    ).toBe("Awaiting review");
    expect(reviewLabel(pr(), "me")).toBe("Review status unavailable");
  });
  it("uses completion time rather than recent comments, and only includes your completed PRs", () => {
    const pulls = [
      pr({ number: 1 }),
      pr({ number: 2, author: "me", state: "merged", mergedAt: ago(1) }),
      pr({ number: 3, author: "me", state: "closed", closedAt: ago(2) }),
      pr({
        number: 4,
        author: "me",
        state: "closed",
        closedAt: ago(4),
        updatedAt: ago(0),
      }),
      pr({ number: 5, state: "merged", mergedAt: ago(1) }),
      pr({ number: 6, author: "me", state: "closed", closedAt: null }),
    ];
    expect(visiblePulls(pulls, options).map((p) => p.number)).toEqual([
      1, 2, 3,
    ]);
    expect(
      visiblePulls(pulls, { ...options, completedDays: 0 }).map(
        (p) => p.number,
      ),
    ).toEqual([1]);
    expect(
      visiblePulls(pulls, { ...options, completedDays: 7 }).map(
        (p) => p.number,
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(
      visiblePulls(pulls, { ...options, history: true }).map((p) => p.number),
    ).toEqual([5, 2, 3, 4, 6]);
  });
  it("filters by repo and search, sorts newest first without mutating input", () => {
    const pulls = [
      pr({ number: 1, repository: "a/one", updatedAt: ago(2) }),
      pr({ number: 2, repository: "b/two", title: "Focus" }),
      pr({ number: 3, repository: "a/one", title: "Focus" }),
    ];
    expect(
      visiblePulls(pulls, {
        ...options,
        repository: "a/one",
        query: "focus",
      }).map((p) => p.number),
    ).toEqual([3]);
    expect(pulls.map((p) => p.number)).toEqual([1, 2, 3]);
  });
});

it("narrows accounts and repos without losing review priority or completion rules", () => {
  const pulls = [
    pr({ number: 1, repository: "Acme/api" }),
    pr({ number: 2, repository: "acme/web" }),
    pr({ number: 3, repository: "another/api" }),
    pr({
      number: 4,
      repository: "acme/api",
      state: "merged",
      mergedAt: ago(1),
      author: "ME",
    }),
  ];
  expect(
    visiblePulls(pulls, { ...options, owner: "ACME" }).map((p) => p.number),
  ).toEqual([1, 2, 4]);
  expect(
    visiblePulls(pulls, {
      ...options,
      owner: "acme",
      repository: "ACME/API",
    }).map((p) => p.number),
  ).toEqual([1, 4]);
  expect(
    visiblePulls(pulls, { ...options, owner: "acme", history: true }).map(
      (p) => p.number,
    ),
  ).toEqual([4]);
});
it("deduplicates account names and falls back when a tracked repo or account is removed", () => {
  const repos = ["Acme/api", "acme/web", "me/personal"];
  expect(repositoryOwners(repos)).toEqual(["acme", "me"]);
  expect(repositoriesForOwner(repos, "ACME")).toEqual(["Acme/api", "acme/web"]);
  expect(
    resolveScope({ owner: "ACME", repository: "acme/deleted" }, repos),
  ).toEqual({ owner: "acme", repository: null });
  expect(
    resolveScope({ owner: "gone", repository: "gone/repo" }, repos),
  ).toEqual({ owner: null, repository: null });
  expect(
    resolveScope({ owner: "acme", repository: "me/personal" }, repos),
  ).toEqual({ owner: "acme", repository: null });
});

it("keeps discovered organizations selectable even without repos and puts your account first", () => {
  const owners = accountOwners(
    ["Acme/api", "outside/repo"],
    ["acme", "empty-org"],
    "me",
  );
  expect(owners).toEqual(["me", "Acme", "empty-org", "outside"]);
  expect(
    resolveScope(
      { owner: "empty-org", repository: null },
      ["Acme/api"],
      owners,
    ),
  ).toEqual({ owner: "empty-org", repository: null });
});
