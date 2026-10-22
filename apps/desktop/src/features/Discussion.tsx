import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import { Sparkles, X } from "lucide-react";
import { lineRange } from "../lib/selection";
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
  }, [c?.workspace.notes, c?.workspace.comments, c?.stream]);
  if (!c) return null;
  const anchor = c.chat.draft?.anchor;
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
      <div className="discussion-context">
        <span>{t("One conversation with AI across this review.")} </span>
        {anchor ? (
          <>
            <SelectionQuote anchor={anchor} compact />
            <code>
              {anchor.path} · {anchor.side === "LEFT" ? "Old" : "New"}{" "}
              {lineRange(anchor)}
            </code>
            <Button className="text-button" onPress={() => c.openChat(null)}>
              {t("Remove code context")}{" "}
            </Button>
          </>
        ) : (
          <span>
            {t("Ask about the PR, or continue any inline discussion.")}{" "}
          </span>
        )}
      </div>
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
          streaming={
            !!c.activeQuestion &&
            c.activeQuestion.snapshotId === c.workspace.snapshot.id
          }
        />
      </div>
      <NoteComposer
        state={c.chat}
        busy={c.busy}
        onAsk={c.ask}
        onError={c.onError}
      />
    </aside>
  );
}
