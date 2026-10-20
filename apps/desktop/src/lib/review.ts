import type {
  Anchor,
  GuideSection,
  Note,
  PullRequest,
  ReviewWorkspace,
} from "./api";
export const key = (p: PullRequest) => `${p.repository}#${p.number}`;
export const bucket = (p: PullRequest, login: string) =>
  p.author === login
    ? "My pull requests"
    : p.requested.includes(login)
      ? "Review requested"
      : p.assigned.includes(login)
        ? "Assigned to me"
        : "Other pull requests";
export const labels = {
  high: "High attention",
  needsAssessment: "Needs assessment",
  standard: "Standard review",
  routine: "Routine",
} as const;
export const newNote = (
  snapshotId: string,
  anchor: Anchor | null,
  body: string,
): Note => ({
  id: "",
  snapshotId,
  anchor,
  body,
  role: "user",
  parentId: null,
  githubDraft: false,
  publishedUrl: null,
  createdAt: "",
});
export const sectionHasDiscussion = (s: GuideSection, w: ReviewWorkspace) =>
  w.notes.some((n) => n.anchor && s.hunkIds.includes(n.anchor.hunkId)) ||
  w.comments.some(
    (c) =>
      c.path &&
      w.snapshot.files.some(
        (f) =>
          f.path === c.path && f.hunks.some((h) => s.hunkIds.includes(h.id)),
      ),
  );
export const countProgress = (w: ReviewWorkspace) => {
  const ids = w.snapshot.files.flatMap((f) => f.hunks.map((h) => h.id));
  return {
    total: ids.length,
    reviewed: ids.filter((id) => w.progress.reviewed.includes(id)).length,
    acknowledged: ids.filter(
      (id) =>
        w.progress.acknowledged.includes(id) &&
        !w.progress.reviewed.includes(id),
    ).length,
    deferred: ids.filter(
      (id) =>
        w.progress.deferred.includes(id) && !w.progress.reviewed.includes(id),
    ).length,
    unassessed: w.guide.sections
      .filter((s) => !s.assessed)
      .reduce((n, s) => n + s.hunkIds.length + s.unavailablePaths.length, 0),
    highRemaining: w.guide.sections.filter(
      (s) =>
        s.attention === "high" &&
        s.hunkIds.some((id) => !w.progress.reviewed.includes(id)),
    ).length,
  };
};
export function parsePullUrl(
  input: string,
): { repository: string; number: number } | null {
  const match = input
    .trim()
    .match(
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/,
    );
  return match && Number(match[2]) > 0
    ? { repository: match[1], number: Number(match[2]) }
    : null;
}
