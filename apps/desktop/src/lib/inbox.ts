import type { PullRequest } from "./api";

export const SAMPLE_REPO = "diffcity/inbox-samples";
export const isSampleRepo = (repo: string) =>
  repo === SAMPLE_REPO || repo === "diffcity/demo";
export const sameLogin = (a: string, b: string) =>
  !!b && a.toLowerCase() === b.toLowerCase();
export const requestedFrom = (p: PullRequest, login: string) =>
  p.requested.some((name) => sameLogin(name, login));
export const completedAt = (p: PullRequest) => p.mergedAt || p.closedAt;
export const hasReviewed = (p: PullRequest) =>
  !!p.viewerReview &&
  ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(p.viewerReview.state);
export const inboxGroups = [
  "Your pull requests",
  "Needs your review",
  "Assigned to you",
  "Awaiting review",
  "Reviewed",
  "Drafts",
  "Recently completed",
] as const;
export function inboxGroup(p: PullRequest, login: string) {
  if (p.state !== "open") return "Recently completed";
  if (sameLogin(p.author, login)) return "Your pull requests";
  // A current request wins over a previous submission, including re-requests.
  if (requestedFrom(p, login)) return "Needs your review";
  if (p.draft) return "Drafts";
  if (hasReviewed(p)) return "Reviewed";
  if (p.assigned.some((name) => sameLogin(name, login)))
    return "Assigned to you";
  if (p.reviewDecision === "APPROVED") return "Reviewed";
  return "Awaiting review";
}
export function visiblePulls(
  pulls: PullRequest[],
  {
    login,
    repository,
    owner = null,
    query,
    history,
    completedDays,
    now = Date.now(),
  }: {
    login: string;
    repository: string | null;
    owner?: string | null;
    query: string;
    history: boolean;
    completedDays: number;
    now?: number;
  },
) {
  const cutoff = now - completedDays * 86_400_000;
  return [
    ...new Map(pulls.map((p) => [`${p.repository}#${p.number}`, p])).values(),
  ]
    .filter((p) => {
      if (repository && !sameLogin(p.repository, repository)) return false;
      if (owner && !sameLogin(p.repository.split("/")[0], owner)) return false;
      if (
        !`${p.title} ${p.number} ${p.author} ${p.repository} ${p.state}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      if (history) return p.state !== "open";
      if (p.state === "open") return true;
      const completed = Date.parse(completedAt(p) || "");
      return (
        completedDays > 0 &&
        sameLogin(p.author, login) &&
        completed >= cutoff &&
        completed <= now
      );
    })
    .sort((a, b) => {
      const time = (p: PullRequest) =>
        Date.parse(p.state === "open" ? p.updatedAt : completedAt(p) || "") ||
        0;
      return (
        time(b) - time(a) ||
        a.repository.localeCompare(b.repository) ||
        b.number - a.number
      );
    });
}
export function reviewLabel(p: PullRequest, login: string) {
  if (p.state !== "open") return p.state === "merged" ? "Merged" : "Closed";
  if (requestedFrom(p, login))
    return hasReviewed(p) ? "Review requested again" : "Review requested";
  if (sameLogin(p.author, login)) return p.draft ? "Draft" : "Open";
  if (p.draft) return "Draft";
  if (hasReviewed(p))
    return (
      {
        APPROVED: "You approved",
        CHANGES_REQUESTED: "You requested changes",
        COMMENTED: "You reviewed",
      } as Record<string, string>
    )[p.viewerReview!.state];
  if (p.assigned.some((name) => sameLogin(name, login)))
    return "Assigned to you";
  if (!p.reviewMetadataAvailable) return "Review status unavailable";
  if (p.reviewDecision === "APPROVED") return "Approved";
  if (p.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
  return "Awaiting review";
}

export type InboxScope = { owner: string | null; repository: string | null };
export const repositoryOwners = (repositories: string[]) =>
  [
    ...new Map(
      repositories.map((repo) => {
        const owner = repo.split("/")[0];
        return [owner.toLowerCase(), owner];
      }),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
export const repositoriesForOwner = (
  repositories: string[],
  owner: string | null,
) =>
  repositories.filter((repo) => !owner || sameLogin(repo.split("/")[0], owner));
// Losing access to a repo/account returns to the nearest available scope.
export function resolveScope(
  scope: InboxScope,
  repositories: string[],
  owners = repositoryOwners(repositories),
): InboxScope {
  if (scope.repository === SAMPLE_REPO)
    return { owner: null, repository: SAMPLE_REPO };
  const owner =
    owners.find((name) => sameLogin(name, scope.owner || "")) ?? null;
  const repository =
    repositoriesForOwner(repositories, owner).find((repo) =>
      sameLogin(repo, scope.repository || ""),
    ) ?? null;
  return { owner, repository };
}

export const accountOwners = (
  repositories: string[],
  organizations: string[],
  login: string,
) => {
  const names = [
    ...new Map(
      [...organizations, ...repositoryOwners(repositories)].map((name) => [
        name.toLowerCase(),
        name,
      ]),
    ).values(),
  ]
    .filter((name) => !sameLogin(name, login))
    .sort((a, b) => a.localeCompare(b));
  return login ? [login, ...names] : names;
};
