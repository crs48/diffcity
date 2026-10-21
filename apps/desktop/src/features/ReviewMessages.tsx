import { Button } from "react-aria-components";
import { Github, MessageSquare, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Note, RemoteComment } from "../lib/api";
import { lineRange } from "../lib/selection";
import type { Conversation } from "./conversation";

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
  const ordered = [...notes].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <>
      {ordered.map((n) => (
        <article className={`message ${n.role}`} key={n.id} data-note-id={n.id}>
          <div className="message-label">
            {n.role === "assistant" ? (
              <Sparkles size={12} />
            ) : (
              <MessageSquare size={12} />
            )}
            {n.role === "assistant" ? "Codex" : "You"}
            {n.githubDraft && <span className="draft-tag">GitHub draft</span>}
            {n.publishedUrl && <span className="draft-tag">Published</span>}
          </div>
          {!inline && n.anchor && (
            <Button
              className="message-location text-button"
              onPress={() => c.openInline(n.anchor!)}
            >
              {n.anchor.path} · {n.anchor.side === "LEFT" ? "Old" : "New"}{" "}
              {lineRange(n.anchor)}
            </Button>
          )}
          {!inline && !n.anchor && (
            <span className="message-scope">PR discussion</span>
          )}
          <ReactMarkdown
            components={{
              img: () => null,
              a: ({ children }) => <span>{children}</span>,
            }}
          >
            {n.body}
          </ReactMarkdown>
          <div className="message-actions">
            {n.role === "user" && !n.githubDraft && (
              <Button
                className="text-button"
                isDisabled={c.busy}
                onPress={() => void c.ask(n).catch(c.onError)}
              >
                <Sparkles size={12} /> Ask Codex about this comment
              </Button>
            )}
            {n.githubDraft && !n.publishedUrl && (
              <Button
                className="text-button"
                onPress={() => void c.edit(n, inline).catch(c.onError)}
              >
                Edit draft
              </Button>
            )}
            {!n.githubDraft && !n.publishedUrl && (
              <Button
                className="text-button"
                isDisabled={c.workspace.notes.some(
                  (other) =>
                    other.parentId === n.id &&
                    (other.githubDraft || !!other.publishedUrl),
                )}
                onPress={() => void c.prepare(n).catch(c.onError)}
              >
                <Github size={12} /> Prepare GitHub draft
              </Button>
            )}
          </div>
        </article>
      ))}
      {remote
        .filter((r) => !notes.some((n) => n.publishedUrl === r.url))
        .map((r) => (
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
              <span className="draft-tag">Earlier revision</span>
            )}
            <p>{r.body}</p>
          </article>
        ))}
      {streaming && (
        <article
          className="message assistant streaming"
          aria-label="Codex response in progress"
        >
          <div className="message-label">
            <Sparkles size={12} /> Codex{" "}
            <span className="muted">Responding…</span>
          </div>
          {c.stream ? (
            <p>{c.stream}</p>
          ) : (
            <p className="muted">Thinking about your comment…</p>
          )}
        </article>
      )}
      <span className="sr-only" role="status">
        {streaming
          ? "Codex is responding."
          : `${notes.filter((n) => n.role === "assistant").length} Codex replies in this conversation.`}
      </span>
    </>
  );
}
