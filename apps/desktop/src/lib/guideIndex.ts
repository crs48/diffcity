import type { Anchor, ReviewWorkspace } from "./api";
import { anchorKey } from "./diffRows";
import { commentsForAnchor } from "./commentContext";
import { threadTitle } from "./threadTitle";

export const GUIDE_OVERVIEW = "guide-overview";
export type GuideIndexKind =
  | "overview"
  | "section"
  | "conversation"
  | "comment"
  | "naming"
  | "note"
  | "finding";
export type GuideIndexEntry = {
  id: string;
  kind: GuideIndexKind;
  title: string;
  body: string;
  sectionId: string;
  sectionNumber: number;
  target: string;
  anchor?: Anchor;
  chat?: { local?: string; remote?: string };
  count?: number;
  reviewed?: boolean;
};
export const namingTarget = (section: string, path: string, name: string) =>
  `naming:${section}:${path}:${name}`;
export const noteTarget = (section: string, id: string) =>
  `note:${section}:${id}`;
export const findingTarget = (section: string, index: number) =>
  `finding:${section}:${index}`;
export const threadTarget = (anchor: Anchor) => `thread:${anchorKey(anchor)}`;

/** One entry per place to visit, not one per streamed reply. */
export function buildGuideIndex(
  w: Pick<
    ReviewWorkspace,
    "snapshot" | "guide" | "notes" | "comments" | "progress"
  >,
): GuideIndexEntry[] {
  const sections = w.guide.sections;
  const reviewed = new Set(w.progress.reviewed);
  const sectionFor = new Map(
    sections.flatMap((s, i) =>
      s.hunkIds.map(
        (id) => [id, { sectionId: s.id, sectionNumber: i + 1 }] as const,
      ),
    ),
  );
  const overview = { sectionId: GUIDE_OVERVIEW, sectionNumber: 0 };
  const entries: GuideIndexEntry[] = [
    {
      ...overview,
      id: GUIDE_OVERVIEW,
      kind: "overview",
      title: "PR overview",
      body: w.guide.summary,
      target: GUIDE_OVERVIEW,
    },
  ];
  for (const [i, section] of sections.entries()) {
    const scope = { sectionId: section.id, sectionNumber: i + 1 };
    entries.push({
      ...scope,
      id: section.id,
      kind: "section",
      title: section.title,
      body: section.summary,
      target: section.id,
      reviewed:
        section.hunkIds.length > 0 &&
        section.hunkIds.every((id) => reviewed.has(id)),
    });
    (section.namingDecisions ?? []).forEach((n) =>
      entries.push({
        ...scope,
        id: namingTarget(section.id, n.anchor.path, n.name),
        target: namingTarget(section.id, n.anchor.path, n.name),
        kind: "naming",
        title: n.previousName ? `${n.previousName} → ${n.name}` : n.name,
        body: `${n.reason}\n\n${n.question}`,
        anchor: n.anchor,
      }),
    );
    (section.annotations ?? []).forEach((n) =>
      entries.push({
        ...scope,
        id: noteTarget(section.id, n.id),
        target: noteTarget(section.id, n.id),
        kind: "note",
        title: n.title,
        body: n.body,
        anchor: n.anchor,
      }),
    );
    section.findings.forEach((f, index) =>
      entries.push({
        ...scope,
        id: findingTarget(section.id, index),
        target: findingTarget(section.id, index),
        kind: "finding",
        title: f.title,
        body: f.body,
        anchor: f.anchor,
      }),
    );
  }
  const conversations = new Map<string, typeof w.notes>();
  for (const note of w.notes) {
    if (note.snapshotId !== w.snapshot.id || !note.body.trim()) continue;
    const key = note.anchor ? anchorKey(note.anchor) : "pr-chat";
    conversations.set(key, [...(conversations.get(key) ?? []), note]);
  }
  for (const [key, notes] of conversations) {
    const first = [...notes].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )[0];
    const anchor = first.anchor;
    const scope = anchor && sectionFor.get(anchor.hunkId);
    const questions = notes.filter((n) => n.role === "user" && !n.githubDraft);
    entries.push({
      ...(scope || overview),
      id: `conversation:${key}`,
      kind:
        questions.length || notes.some((n) => n.role === "assistant")
          ? "conversation"
          : "comment",
      title: threadTitle(notes, [], anchor),
      body: (questions.at(-1) ?? first).body,
      target: anchor ? threadTarget(anchor) : "",
      anchor: anchor ?? undefined,
      count: questions.length || notes.length,
      ...(!scope ? { chat: { local: first.id } } : {}),
    });
  }
  // Match the current-revision comments actually rendered in GuideView. Older
  // and PR-wide comments remain accessible through their PR-chat destinations.
  const current = w.comments.filter((c) => c.commit === w.snapshot.pull.head);
  const hunks = w.snapshot.files.flatMap((f) => f.hunks);
  const consumed = new Set<string>();
  // Visit located roots first so replies without their own line join the same destination.
  const ordered = [...w.comments].sort(
    (a, b) =>
      Number(!!b.line && !!b.side && b.commit === w.snapshot.pull.head) -
      Number(!!a.line && !!a.side && a.commit === w.snapshot.pull.head),
  );
  for (const comment of ordered) {
    if (consumed.has(comment.id)) continue;
    const hunk =
      comment.commit === w.snapshot.pull.head && comment.side && comment.line
        ? hunks.find(
            (h) =>
              h.path === comment.path &&
              h.lines.some(
                (l) =>
                  (comment.side === "LEFT" ? l.old : l.new) === comment.line,
              ),
          )
        : undefined;
    const scope = hunk && sectionFor.get(hunk.id);
    const anchor: Anchor | undefined =
      hunk && comment.side && comment.line
        ? {
            hunkId: hunk.id,
            path: hunk.path,
            side: comment.side,
            startLine: comment.line,
            line: comment.line,
          }
        : undefined;
    const remote =
      anchor && scope ? commentsForAnchor(current, anchor) : [comment];
    remote.forEach((c) => consumed.add(c.id));
    const root = remote[0] ?? comment;
    entries.push({
      ...(scope || overview),
      id: `comment:${root.id}`,
      kind: "comment",
      title: threadTitle([], remote),
      body: `${root.author}: ${root.body}`,
      target: anchor ? threadTarget(anchor) : "",
      anchor,
      count: remote.length,
      ...(!scope ? { chat: { remote: comment.id } } : {}),
    });
  }
  return entries;
}

export type PositionedEntry = { entry: GuideIndexEntry; position: number };
export type IndexGroup = {
  id: string;
  lane: "sections" | "activity";
  top: number;
  items: GuideIndexEntry[];
};

/** Pack content markers and chapter dots independently, preserving every destination. */
export function packIndex(
  entries: PositionedEntry[],
  height: number,
): IndexGroup[] {
  const slots = Math.max(1, Math.floor(height / 30));
  const groups = new Map<string, IndexGroup>();
  for (const { entry, position } of entries) {
    const lane =
      entry.kind === "section" || entry.kind === "overview"
        ? "sections"
        : "activity";
    const slot = Math.min(slots - 1, Math.max(0, Math.floor(position * slots)));
    const id = `${lane}-${slot}`;
    const group = groups.get(id) ?? {
      id,
      lane,
      top: slot * (height / slots),
      items: [],
    };
    group.items.push(entry);
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.top - b.top || a.lane.localeCompare(b.lane),
  );
}

export function indexExcerpt(body: string, limit = 240) {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
