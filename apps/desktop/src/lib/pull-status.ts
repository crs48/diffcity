import type { PullRequest } from "./api";
import { hasReviewed, requestedFrom, sameLogin } from "./inbox";

export type SignalTone =
  "green" | "purple" | "red" | "amber" | "blue" | "muted";
const signal = <K extends string>(
  kind: K,
  label: string,
  tone: SignalTone,
) => ({ kind, label, tone });
const signals = {
  requested: signal("requested", "Review requested", "blue"),
  requestedAgain: signal("requestedAgain", "Review requested again", "blue"),
  assigned: signal("assigned", "Assigned to you", "blue"),
  approved: signal("approved", "Approved", "green"),
  youApproved: signal("approved", "You approved", "green"),
  changes: signal("changes", "Changes requested", "red"),
  yourChanges: signal("changes", "You requested changes", "red"),
  reviewed: signal("reviewed", "You reviewed", "purple"),
  awaiting: signal("awaiting", "Awaiting review", "muted"),
  passed: signal("passed", "Checks passed", "green"),
  failed: signal("failed", "Checks failed", "red"),
  pending: signal("pending", "Checks pending", "amber"),
  expected: signal("expected", "Checks expected", "amber"),
  noChecks: signal("noChecks", "No checks", "muted"),
  unknownChecks: signal("unknownChecks", "Checks unavailable", "muted"),
  conflicts: signal("conflicts", "Merge conflicts", "red"),
  behind: signal("behind", "Behind base", "amber"),
  blocked: signal("blocked", "Merge blocked", "amber"),
  mergeable: signal("mergeable", "Mergeable", "green"),
  hooks: signal("hooks", "Merge hooks", "amber"),
  unstable: signal("unstable", "Checks not passing", "amber"),
};
export type PullSignal = (typeof signals)[keyof typeof signals];

const checksByState: Record<string, PullSignal> = {
  SUCCESS: signals.passed,
  FAILURE: signals.failed,
  ERROR: signals.failed,
  PENDING: signals.pending,
  EXPECTED: signals.expected,
  NONE: signals.noChecks,
};
const mergeByState: Record<string, PullSignal> = {
  BEHIND: signals.behind,
  BLOCKED: signals.blocked,
  CLEAN: signals.mergeable,
  HAS_HOOKS: signals.hooks,
  UNSTABLE: signals.unstable,
};

export function pullSignals(p: PullRequest, login: string) {
  const lifecycle =
    p.state === "merged"
      ? ({ kind: "merged", label: "Merged", tone: "purple" } as const)
      : p.state === "closed"
        ? ({ kind: "closed", label: "Closed", tone: "red" } as const)
        : p.draft
          ? ({ kind: "draft", label: "Draft", tone: "muted" } as const)
          : ({ kind: "open", label: "Open", tone: "green" } as const);
  // Completion takes precedence over stale checks and review requests.
  if (p.state !== "open")
    return { lifecycle, badges: [] as PullSignal[], emphasis: null };

  const review = (() => {
    if (requestedFrom(p, login))
      return hasReviewed(p) ? signals.requestedAgain : signals.requested;
    if (p.reviewDecision === "CHANGES_REQUESTED")
      return p.viewerReview?.state === "CHANGES_REQUESTED"
        ? signals.yourChanges
        : signals.changes;
    if (p.reviewDecision === "APPROVED")
      return p.viewerReview?.state === "APPROVED"
        ? signals.youApproved
        : signals.approved;
    if (hasReviewed(p))
      return p.viewerReview?.state === "APPROVED"
        ? signals.youApproved
        : p.viewerReview?.state === "CHANGES_REQUESTED"
          ? signals.yourChanges
          : signals.reviewed;
    if (p.assigned.some((name) => sameLogin(name, login)))
      return signals.assigned;
    if (
      !p.draft &&
      p.reviewMetadataAvailable &&
      (!sameLogin(p.author, login) || p.reviewDecision === "REVIEW_REQUIRED")
    )
      return signals.awaiting;
    return null;
  })();
  const checks = p.status
    ? (checksByState[p.status.checks ?? ""] ?? signals.unknownChecks)
    : null;
  const merge =
    p.status?.mergeable === "CONFLICTING" || p.status?.mergeState === "DIRTY"
      ? signals.conflicts
      : p.draft ||
          (p.status?.mergeState === "UNSTABLE" && checks?.kind === "failed")
        ? null
        : (mergeByState[p.status?.mergeState ?? ""] ?? null);
  const badges = [review, checks, merge].filter(
    (item): item is PullSignal => !!item,
  );
  const emphasis =
    badges.find((item) => item.kind === "conflicts") ??
    badges.find((item) => item.tone === "red") ??
    badges.find((item) => item.tone === "blue") ??
    badges.find((item) => item.tone === "amber") ??
    badges.find((item) => item.tone !== "muted") ??
    null;
  return { lifecycle, badges, emphasis };
}

export function relativePullTime(
  date: string,
  language: string,
  now = Date.now(),
) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000)
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
      0,
      "second",
    );
  const [unit, size] =
    elapsed < 3_600_000
      ? (["minute", 60_000] as const)
      : elapsed < 86_400_000
        ? (["hour", 3_600_000] as const)
        : elapsed < 30 * 86_400_000
          ? (["day", 86_400_000] as const)
          : elapsed < 365 * 86_400_000
            ? (["month", 30 * 86_400_000] as const)
            : (["year", 365 * 86_400_000] as const);
  return new Intl.RelativeTimeFormat(language, {
    style: "narrow",
    numeric: "auto",
  }).format(-Math.floor(elapsed / size), unit);
}
