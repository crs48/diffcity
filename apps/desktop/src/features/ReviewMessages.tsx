import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import { Github, MessageSquare, Sparkles } from "lucide-react";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import type { Note, RemoteComment } from "../lib/api";
import { lineRange } from "../lib/selection";
import type { Conversation } from "./conversation";
import { SelectionQuote } from "./SelectionQuote";

export function ReviewMessages({
  notes,
  remote = [],
  conversation: c,
  inline = false,
  streaming = false,
}: {
  notes: Note[];
  remote?: RemoteComment[];
  conversation: Conversation;
  inline?: boolean;
  streaming?: boolean;
}) {
  const { t } = useTranslation();
  const ordered = [
    ...notes.map((note) => ({ kind: "local" as const, message: note })),
    ...remote
      .filter((r) => !notes.some((n) => n.publishedUrl === r.url))
      .map((message) => ({ kind: "remote" as const, message })),
  ].sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
  return (
    <>
      {ordered.map((entry) => {
        if (entry.kind === "local") {
          const n = entry.message;
          return (
            <article
              className={`message ${n.role}`}
              key={n.id}
              data-note-id={n.id}
            >
              <div className="message-label">
                {n.role === "assistant" ? (
                  <Sparkles size={12} />
                ) : (
                  <MessageSquare size={12} />
                )}
                {n.role === "assistant"
                  ? n.model
                    ? `${n.model.provider === "claude" ? "Claude" : "Codex"} · ${n.model.model}`
                    : "Codex"
                  : t("You")}
                {n.githubDraft && (
                  <span className="draft-tag">{t("GitHub draft")} </span>
                )}
                {n.publishedUrl && (
                  <span className="draft-tag">{t("Published")} </span>
                )}
              </div>
              {!inline && n.anchor && (
                <Button
                  className="message-location text-button"
                  onPress={() =>
                    n.anchor?.textSelection
                      ? c.openChat(n.anchor)
                      : c.openInline(n.anchor!)
                  }
                >
                  {n.anchor.path} · {n.anchor.side === "LEFT" ? "Old" : "New"}{" "}
                  {lineRange(n.anchor)}
                </Button>
              )}
              {!inline && !n.anchor && (
                <span className="message-scope">{t("PR discussion")} </span>
              )}
              {!inline && n.anchor?.textSelection && n.role === "user" && (
                <SelectionQuote anchor={n.anchor} />
              )}
              <CommentMarkdown body={n.body} />
              <div className="message-actions">
                {n.role === "user" && !n.githubDraft && (
                  <Button
                    className="text-button"
                    isDisabled={c.busy}
                    onPress={() => void c.ask(n).catch(c.onError)}
                  >
                    <Sparkles size={12} />
                    {t(
                      n.anchor?.textSelection
                        ? "Ask again about this selection"
                        : "Ask AI about this comment",
                    )}{" "}
                  </Button>
                )}
                {n.githubDraft && !n.publishedUrl && (
                  <Button
                    className="text-button"
                    onPress={() => void c.edit(n, inline).catch(c.onError)}
                  >
                    {t("Edit draft")}{" "}
                  </Button>
                )}
                {!n.githubDraft &&
                  !n.publishedUrl &&
                  !n.anchor?.textSelection && (
                    <Button
                      className="text-button"
                      isDisabled={c.workspace.notes.some(
                        (other) =>
                          other.parentId === n.id &&
                          (other.githubDraft || !!other.publishedUrl),
                      )}
                      onPress={() => void c.prepare(n).catch(c.onError)}
                    >
                      <Github size={12} />
                      {t("Prepare GitHub draft")}{" "}
                    </Button>
                  )}
              </div>
            </article>
          );
        }
        const r = entry.message;
        return (
          <article className="message remote" key={r.id}>
            <div className="message-label">
              <Github size={12} />
              {r.author} · GitHub
            </div>
            {!inline && r.path && (
              <code className="message-location">
                {r.path}:{r.line}
              </code>
            )}
            {r.commit && r.commit !== c.workspace.snapshot.pull.head && (
              <span className="draft-tag">{t("Earlier revision")} </span>
            )}
            <CommentMarkdown body={r.body} />
          </article>
        );
      })}
      {streaming && (
        <article
          className="message assistant streaming"
          aria-label={t("AI response in progress")}
        >
          <div className="message-label">
            <Sparkles size={12} /> AI{" "}
            <span className="muted">{t("Responding…")} </span>
          </div>
          {c.stream ? (
            <CommentMarkdown body={c.stream} />
          ) : (
            <p className="muted">{t("Thinking about your comment…")} </p>
          )}
        </article>
      )}
      <span className="sr-only" role="status">
        {streaming
          ? t("AI is responding.")
          : `${notes.filter((n) => n.role === "assistant").length} AI replies in this conversation.`}
      </span>
    </>
  );
}
