import type { Anchor, Note, RemoteComment } from "./api";

const short = (text: string) => {
  const line =
    text
      .trim()
      .split("\n")
      .find((line) => line.trim()) ?? "";
  const plain = line
    .replace(/^[#>*\s-]+/, "")
    .replace(/[`*]/g, "")
    .trim();
  return plain.length > 72 ? `${plain.slice(0, 69).trimEnd()}…` : plain;
};

/** Call with one conversation's notes, never the PR-wide feed. */
export function threadTitle(
  notes: Note[],
  remote: RemoteComment[] = [],
  anchor?: Anchor | null,
) {
  const privateNotes = notes
    .filter((n) => !n.githubDraft && !n.publishedUrl)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const named = privateNotes.find(
    (n) => n.role === "assistant" && n.threadTitle?.trim(),
  );
  if (named) return named.threadTitle!.trim();
  const opening = privateNotes.find((n) => n.role === "user")?.body;
  // The default "explain this selection" prompt is less useful than its subject.
  if (
    anchor?.textSelection &&
    opening?.startsWith("Help me understand this selected code.")
  )
    return short(anchor.textSelection.text);
  return short(
    opening ??
      [...remote].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
        ?.body ??
      [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
        ?.body ??
      "",
  );
}

const marker = "<!-- diffcity-thread-title:";

/** Keep final-line metadata, including a partial streamed marker, out of chat. */
export function visibleReply(body: string) {
  const start = body.lastIndexOf("\n");
  if (start < 0) return body;
  const last = body.slice(start + 1);
  return last.startsWith(marker) ||
    (last.startsWith("<") && marker.startsWith(last))
    ? body.slice(0, start).trimEnd()
    : body;
}
