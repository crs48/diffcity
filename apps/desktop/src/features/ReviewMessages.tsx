import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AgentApproval } from "./AgentAccess";
import { isActiveRun, type AiRun } from "./useAiRuns";
import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import {
  Github,
  ListOrdered,
  MessageSquare,
  Reply,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import type { Note, RemoteComment } from "../lib/api";
import { lineRange, sameAnchor } from "../lib/selection";
import type { Conversation } from "./conversation";
import { SelectionQuote } from "./SelectionQuote";
import { visibleReply } from "../lib/threadTitle";
import { orderReviewMessages, type ReviewMessage } from "./orderReviewMessages";
import { IconAction } from "../ui/IconAction";
import { CopyAction } from "../ui/CopyAction";

const noComments: RemoteComment[] = [];

export function ReviewMessages({
  notes,
  remote = noComments,
  conversation: c,
  inline = false,
  scrollElementRef,
  followReplies,
}: {
  notes: Note[];
  remote?: RemoteComment[];
  conversation: Conversation;
  inline?: boolean;
  scrollElementRef?: RefObject<HTMLDivElement | null>;
  followReplies?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const ordered = useMemo(
    () => orderReviewMessages(notes, remote, c.runs),
    [notes, remote, c.runs],
  );
  const virtual = !!scrollElementRef && ordered.length > 40;
  const listRoot = useRef<HTMLDivElement>(null);
  const keyFor = (entry: ReviewMessage) =>
    entry.kind === "run"
      ? `run:${entry.run.id}`
      : `${entry.kind}:${entry.message.id}`;
  const keys = ordered.map(keyFor).join("\n");
  const getItemKey = useMemo(() => {
    const values = keys.split("\n");
    return (index: number) => values[index];
  }, [keys]);
  const estimateSize = useCallback(
    (index: number) => {
      const entry = ordered[index];
      const text = entry.kind === "run" ? entry.run.stream : entry.message.body;
      return 120 + Math.min(4000, Math.ceil(text.length / 55) * 22);
    },
    [ordered],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: ordered.length,
    enabled: virtual,
    getScrollElement: () =>
      scrollElementRef?.current ??
      (listRoot.current?.parentElement as HTMLDivElement | null),
    getItemKey,
    estimateSize,
    overscan: 2,
    useFlushSync: false,
  });
  const total = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (virtual && followReplies?.current && scrollElementRef?.current)
      scrollElementRef.current.scrollTop =
        scrollElementRef.current.scrollHeight;
  }, [virtual, total, ordered.length, followReplies, scrollElementRef]);
  const renderEntry = (entry: ReviewMessage) => {
    if (entry.kind === "run")
      return (
        <RunReply
          key={`run:${entry.run.id}`}
          run={entry.run}
          conversation={c}
        />
      );
    if (entry.kind === "local") {
      const n = entry.message;
      return (
        <article
          className={`message ${n.role}${n.githubDraft || n.publishedUrl ? " github-comment" : ""}`}
          key={`local:${n.id}`}
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
              <span className="draft-tag">
                {t("GitHub draft · not published")}{" "}
              </span>
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
            <CopyAction
              label={t(
                n.role === "assistant" ? "Copy response" : "Copy message",
              )}
              getText={() => visibleReply(n.body)}
            />
            {!inline && (
              <IconAction
                label={t("Continue conversation")}
                onPress={() => c.openChat(n.anchor)}
              >
                <Reply size={14} aria-hidden />
              </IconAction>
            )}
            {n.role === "user" && !n.githubDraft && (
              <IconAction
                label={t(
                  n.anchor?.textSelection
                    ? "Ask again about this selection"
                    : "Ask AI about this comment",
                )}
                isDisabled={c.runs.some(
                  (r) => r.question?.id === n.id && isActiveRun(r),
                )}
                onPress={() => void c.ask(n).catch(c.onError)}
              >
                <RotateCcw size={14} aria-hidden />
              </IconAction>
            )}
            {n.githubDraft && !n.publishedUrl && (
              <Button
                className="text-button"
                onPress={() => void c.edit(n, inline).catch(c.onError)}
              >
                {t("Edit draft")}{" "}
              </Button>
            )}
            {!n.githubDraft && !n.publishedUrl && !n.anchor?.textSelection && (
              <IconAction
                label={t("Prepare GitHub draft")}
                isDisabled={c.workspace.notes.some(
                  (other) =>
                    other.parentId === n.id &&
                    (other.githubDraft || !!other.publishedUrl),
                )}
                onPress={() => void c.prepare(n).catch(c.onError)}
              >
                <Github size={14} aria-hidden />
              </IconAction>
            )}
          </div>
        </article>
      );
    }
    const r = entry.message;
    return (
      <article
        className="message remote"
        data-remote-comment-id={r.id}
        key={`remote:${r.id}`}
      >
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
  };
  return (
    <>
      {virtual ? (
        <div
          ref={listRoot}
          data-virtual-chat
          style={{ height: total, position: "relative", flexShrink: 0 }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                display: "flow-root",
                transform: `translateY(${item.start}px)`,
              }}
            >
              {renderEntry(ordered[item.index])}
            </div>
          ))}
        </div>
      ) : (
        ordered.map(renderEntry)
      )}
      <span className="sr-only" role="status">
        {t("{{count}} AI replies in this conversation.", {
          count: notes.filter((n) => n.role === "assistant").length,
        })}
      </span>
    </>
  );
}

function RunReply({
  run,
  conversation: c,
}: {
  run: AiRun;
  conversation: Conversation;
}) {
  const { t } = useTranslation();
  if (run.phase === "waiting") {
    const position =
      c.runs
        .filter(
          (r) =>
            r.phase === "waiting" &&
            r.snapshotId === run.snapshotId &&
            sameAnchor(
              r.question?.anchor ?? null,
              run.question?.anchor ?? null,
            ),
        )
        .findIndex((r) => r.id === run.id) + 1;
    return (
      <article
        className="message message-queued"
        data-run-id={run.id}
        aria-label={t("Queued AI question")}
      >
        <div className="message-label" role="status">
          <ListOrdered size={14} /> {t("Queued · {{position}}", { position })}
        </div>
        <Button className="text-button" onPress={() => void c.cancel(run.id)}>
          {t("Remove from queue")}
        </Button>
      </article>
    );
  }
  return (
    <article
      className="message assistant streaming"
      data-run-id={run.id}
      aria-label={t(
        isActiveRun(run) ? "AI response in progress" : "AI response stopped",
      )}
    >
      <div className="message-label">
        <Sparkles size={12} /> {run.preference.model}
        <span className="muted" role="status">
          {t(
            run.phase === "cancelled" &&
              run.text !== "Removed from queue · saved as a private note"
              ? "Cancelled"
              : run.text,
          )}
        </span>
      </div>
      {run.stream && (
        <CommentMarkdown
          body={visibleReply(run.stream)}
          diagrams={!isActiveRun(run)}
        />
      )}
      {run.prompt && c.respondAgent && (
        <AgentApproval
          key={run.prompt.id}
          prompt={run.prompt}
          runId={run.id}
          onRespond={c.respondAgent}
        />
      )}
      <Button
        className="text-button"
        isDisabled={run.phase === "cancelling"}
        onPress={() =>
          isActiveRun(run) ? void c.cancel(run.id) : c.dismiss(run.id)
        }
      >
        {t(isActiveRun(run) ? "Cancel response" : "Dismiss")}
      </Button>
    </article>
  );
}
