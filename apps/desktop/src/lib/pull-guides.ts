import type { ModelPreference, PullGuide, PullRequest } from "./api";
import { pinKey } from "./inbox";

export const guideProviders = ["codex", "claude"] as const;
export type GuideProvider = (typeof guideProviders)[number];
export type GuideState = "current" | "stale" | "missing";
export type GuideInventory = ReturnType<typeof indexPullGuides>;
export const guideJobKey = (pull: PullRequest, provider: string) =>
  `${pinKey(pull)}/${provider}`;

export function indexPullGuides(guides: PullGuide[]) {
  const byPull = new Map<string, PullGuide[]>();
  const latest = new Map<string, ModelPreference>();
  for (const guide of [...guides].sort((a, b) =>
    b.generatedAt.localeCompare(a.generatedAt),
  )) {
    const provider = guide.preference.provider;
    if (!guideProviders.some((p) => p === provider)) continue;
    const key = `${guide.repository.toLowerCase()}#${guide.number}`;
    byPull.set(key, [...(byPull.get(key) ?? []), guide]);
    if (!latest.has(provider)) latest.set(provider, guide.preference);
  }
  return { byPull, latest };
}

export function pullGuideStatus(
  inventory: GuideInventory,
  pull: PullRequest,
  provider: GuideProvider,
  fallback: ModelPreference,
) {
  const guides = (inventory.byPull.get(pinKey(pull)) ?? []).filter(
    (guide) => guide.preference.provider === provider,
  );
  const current = guides.find(
    (guide) =>
      !!pull.head &&
      !!pull.base &&
      guide.head === pull.head &&
      guide.base === pull.base,
  );
  const guide = current ?? guides[0];
  const preference =
    guides[0]?.preference ??
    inventory.latest.get(provider) ??
    (fallback.provider === provider
      ? fallback
      : {
          provider,
          model: provider === "claude" ? "claude-fable-5" : "gpt-6-astra",
          reasoningEffort: provider === "claude" ? "high" : "xhigh",
        });
  const state: GuideState = current ? "current" : guide ? "stale" : "missing";
  return { guide, preference, state };
}
