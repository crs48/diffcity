import type { Note, RemoteComment } from "../lib/api";
import { sameAnchor } from "../lib/selection";
import type { AiRun } from "./useAiRuns";

type SavedMessage =
  { kind: "local"; message: Note } | { kind: "remote"; message: RemoteComment };
export type ReviewMessage = SavedMessage | { kind: "run"; run: AiRun };

/** Autosaves and concurrent replies can arrive out of order. Keep answers and
 * prepared drafts with their parent, while ordering independent questions and
 * GitHub comments chronologically. Streaming replies occupy the same turn. */
export function orderReviewMessages(
  notes: Note[],
  remote: RemoteComment[],
  runs: AiRun[],
): ReviewMessage[] {
  const published = new Set(notes.map((note) => note.publishedUrl));
  const timeline: SavedMessage[] = [
    ...notes.map((message) => ({ kind: "local" as const, message })),
    ...remote
      .filter((message) => !published.has(message.url))
      .map((message) => ({ kind: "remote" as const, message })),
  ];
  const timestamp = (entry: SavedMessage) => {
    const parsed = Date.parse(entry.message.createdAt);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  timeline.sort((a, b) => timestamp(a) - timestamp(b));
  const byId = new Map(notes.map((note) => [note.id, note]));
  const children = new Map<string, SavedMessage[]>();
  const parentOf = (entry: SavedMessage) => {
    if (entry.kind !== "local") return;
    const note = entry.message;
    const parent = note.parentId ? byId.get(note.parentId) : undefined;
    return parent &&
      parent.id !== note.id &&
      parent.snapshotId === note.snapshotId &&
      sameAnchor(parent.anchor, note.anchor)
      ? parent
      : undefined;
  };
  const roots = timeline.filter((entry) => {
    const parent = parentOf(entry);
    if (!parent) return true;
    children.set(parent.id, [...(children.get(parent.id) ?? []), entry]);
    return false;
  });
  const replies = new Map<string, AiRun[]>();
  runs.forEach((run) => {
    if (run.question)
      replies.set(run.question.id, [
        ...(replies.get(run.question.id) ?? []),
        run,
      ]);
  });
  const seen = new Set<SavedMessage>();
  const visit = (entry: SavedMessage): ReviewMessage[] => {
    if (seen.has(entry)) return [];
    seen.add(entry);
    return entry.kind === "remote"
      ? [entry]
      : [
          entry,
          ...(children.get(entry.message.id) ?? []).flatMap(visit),
          ...(replies.get(entry.message.id) ?? []).map((run) => ({
            kind: "run" as const,
            run,
          })),
        ];
  };
  // Missing parents remain roots; malformed cycles must not hide saved messages.
  return [...roots.flatMap(visit), ...timeline.flatMap(visit)];
}
