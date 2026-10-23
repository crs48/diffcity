import { expect, it } from "vitest";
import { indexPullGuides, pullGuideStatus } from "./pull-guides";
import { defaultModelPreference } from "./models";
import type { PullGuide } from "./api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

const pull = fixture.snapshot.pull;
const guide: PullGuide = {
  repository: pull.repository,
  number: pull.number,
  head: pull.head,
  base: pull.base,
  snapshotId: fixture.snapshot.id,
  generatedAt: "2026-10-23T10:00:00Z",
  preference: {
    provider: "codex",
    model: "gpt-6-astra",
    reasoningEffort: "xhigh",
  },
};
it("tracks both commits, ignores non-code updates, and isolates providers and PRs", () => {
  const inventory = indexPullGuides([guide]);
  const get = (p = pull) =>
    pullGuideStatus(inventory, p, "codex", defaultModelPreference);
  expect(get({ ...pull, updatedAt: "2026-10-24T00:00:00Z" }).state).toBe(
    "current",
  );
  expect(get({ ...pull, head: "new" }).state).toBe("stale");
  expect(get({ ...pull, base: "new-base" }).state).toBe("stale");
  expect(get({ ...pull, head: "" }).state).toBe("stale");
  expect(get({ ...pull, number: pull.number + 1 }).state).toBe("missing");
  expect(
    get({ ...pull, repository: pull.repository.toUpperCase() }).state,
  ).toBe("current");
  expect(
    pullGuideStatus(inventory, pull, "claude", defaultModelPreference).state,
  ).toBe("missing");
});
it("keeps a current guide green if a historical run finishes later, and repeats the last model/effort", () => {
  const latest = {
    ...guide,
    head: "older",
    generatedAt: "2026-10-24T10:00:00Z",
    preference: {
      ...guide.preference,
      model: "another-codex-model",
      reasoningEffort: "high",
    },
  };
  const inventory = indexPullGuides([guide, latest]);
  const status = pullGuideStatus(
    inventory,
    pull,
    "codex",
    defaultModelPreference,
  );
  expect(status.state).toBe("current");
  expect(status.guide).toEqual(guide);
  expect(status.preference).toEqual(latest.preference);
  expect(
    pullGuideStatus(
      inventory,
      { ...pull, number: 999 },
      "codex",
      defaultModelPreference,
    ).preference,
  ).toEqual(latest.preference);
});
