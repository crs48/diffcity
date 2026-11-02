export type PullContext = {
  repository: string;
  number: number;
  path?: string;
  commentUrl?: string;
  selection?: {
    text: string;
    path?: string;
    line?: number;
    side?: "LEFT" | "RIGHT";
  };
};
export function pullFromUrl(input: string): PullContext | null {
  try {
    const url = new URL(input);
    if (url.origin !== "https://github.com" || url.username || url.password)
      return null;
    const match = url.pathname.match(
      /^\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:\/|$)/,
    );
    const number = Number(match?.[2]);
    return match &&
      Number.isSafeInteger(number) &&
      number > 0 &&
      number <= 0xffffffff
      ? { repository: match[1], number }
      : null;
  } catch {
    return null;
  }
}
export function safeContext(raw: unknown, tabUrl: string): PullContext | null {
  const pull = pullFromUrl(tabUrl);
  if (!pull || !raw || typeof raw !== "object") return null;
  const input = raw as Partial<PullContext>;
  if (input.repository !== pull.repository || input.number !== pull.number)
    return null;
  if (input.path !== undefined) {
    if (
      typeof input.path !== "string" ||
      !input.path ||
      input.path.length > 1024 ||
      input.path.includes("\0")
    )
      return null;
    pull.path = input.path;
  }
  if (input.commentUrl) {
    const comment = pullFromUrl(input.commentUrl);
    if (
      comment?.repository !== pull.repository ||
      comment.number !== pull.number
    )
      return null;
    const hash = new URL(input.commentUrl).hash;
    if (
      !/^#(?:discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+)$/.test(
        hash,
      )
    )
      return null;
    pull.commentUrl = input.commentUrl;
  }
  if (input.selection) {
    const { text, path, line, side } = input.selection;
    if (typeof text !== "string" || !text.trim() || text.length > 16000)
      return null;
    if (
      path !== undefined &&
      (typeof path !== "string" || path.length > 1024 || path.includes("\0"))
    )
      return null;
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1))
      return null;
    if (side !== undefined && side !== "LEFT" && side !== "RIGHT") return null;
    pull.selection = { text, path, line, side };
  }
  return pull;
}
export function trustedPage(url: string | undefined, origin: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      `${parsed.protocol}//${parsed.host}` === origin &&
      ["/index.html", "/sidepanel.html"].includes(parsed.pathname)
    );
  } catch {
    return false;
  }
}
export const RPC_COMMANDS = new Set([
  "ping",
  "bootstrap",
  "open_pull",
  "sync_pull",
  "open_saved_review",
  "model_catalog",
  "save_model_preference",
  "repository_context",
  "guide_versions",
  "select_guide",
  "save_note",
  "save_progress",
  "hunk_context",
  "analyze",
  "enrich_guide",
  "dismiss_enrichment",
  "ask_codex",
  "cancel_codex",
  "respond_agent",
  "save_review_checkpoint",
  "publish_review",
]);
