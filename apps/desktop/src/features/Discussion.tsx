import { useTranslation } from "react-i18next";
import "../i18n";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { Reply, Sparkles, X } from "lucide-react";
import { lineRange, sameAnchor } from "../lib/selection";
import { threadTitle } from "../lib/threadTitle";
import { commentsForAnchor } from "../lib/commentContext";
import { useConversation } from "./conversation";
import { NoteComposer } from "./NoteComposer";
import { ReviewMessages } from "./ReviewMessages";
import { useLayoutEffect, useRef } from "react";
import { SelectionQuote } from "./SelectionQuote";

export function Discussion({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const c = useConversation();
  const messages = useRef<HTMLDivElement>(null);
  const followReplies = useRef(true);
  useLayoutEffect(() => {
    const viewport = messages.current;
    if (viewport && followReplies.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [c?.workspace.notes, c?.workspace.comments, c?.runs]);
  if (!c) return null;
  const anchor = c.chat.draft?.anchor;
  const title = threadTitle(
    c.workspace.notes.filter((n) => sameAnchor(n.anchor, anchor ?? null)),
    anchor ? commentsForAnchor(c.workspace.comments, anchor) : [],
    anchor,
  );
  return (
    <aside
      id="pr-chat"
      className="discussion"
      aria-label={t("PR chat")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <Sparkles size={16} />
        <strong>{t("PR chat")} </strong>
        <Button
          className="icon-button"
          aria-label={t("Close PR chat")}
          onPress={onClose}
        >
          <X size={17} />
        </Button>
      </header>
      <div
        ref={messages}
        className="messages"
        role="region"
        aria-label={t("PR chat messages")}
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followReplies.current =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            48;
        }}
      >
        {!c.workspace.notes.length && !c.workspace.comments.length && (
          <div className="discussion-empty">
            <Sparkles size={22} />
            <h3>{t("Review together.")} </h3>
            <p>
              {t(
                "Inline comments and replies also appear here. Click a code reference to return to its thread.",
              )}{" "}
            </p>
          </div>
        )}
        <ReviewMessages
          notes={c.workspace.notes}
          remote={c.workspace.comments}
          conversation={c}
        />
      </div>
      <div className="discussion-compose">
        <div
          id="pr-chat-reply-context"
          className="discussion-context"
          role="group"
          aria-label={t("Reply context")}
        >
          <div className="discussion-context-label">
            <Reply size={14} aria-hidden />
            <span>
              {t(anchor ? "Replying to code" : "Replying to this PR")}
            </span>
            {anchor && (
              <TooltipTrigger delay={300}>
                <Button
                  className="icon-button"
                  aria-label={t("Remove code context")}
                  onPress={() => c.openChat(null)}
                >
                  <X size={14} />
                </Button>
                <Tooltip className="rail-tooltip" placement="top">
                  {t("Remove code context")}
                </Tooltip>
              </TooltipTrigger>
            )}
          </div>
          {title && (
            <strong className="discussion-title" title={title}>
              {title}
            </strong>
          )}
          {anchor ? (
            <>
              <code className="discussion-context-path" title={anchor.path}>
                {anchor.path}
              </code>
              <span>
                {anchor.side === "LEFT" ? "Old" : "New"} {lineRange(anchor)}
              </span>
              <SelectionQuote anchor={anchor} compact />
            </>
          ) : (
            <code
              className="discussion-context-path"
              title={c.workspace.snapshot.pull.repository}
            >
              {c.workspace.snapshot.pull.repository} #
              {c.workspace.snapshot.pull.number}
            </code>
          )}
        </div>
        <NoteComposer
          state={c.chat}
          contextDescriptionId="pr-chat-reply-context"
          busy={c.isBusy(c.chat.draft?.anchor ?? null)}
          model={c.modelFor(c.chat.draft?.anchor ?? null).model}
          onAsk={c.ask}
          onError={c.onError}
        />
      </div>
    </aside>
  );
}
