import { Button } from "react-aria-components";
import { MessageSquare, PanelRightOpen, X } from "lucide-react";
import type { InlineThread } from "../lib/diffRows";
import { lineRange, sameAnchor } from "../lib/selection";
import { useConversation } from "./conversation";
import { NoteComposer } from "./NoteComposer";
import { ReviewMessages } from "./ReviewMessages";
import { useConversationScroll } from "./useConversationScroll";

export function InlineDiscussion({ thread }: { thread: InlineThread }) {
  const c = useConversation();
  const messages = useConversationScroll(thread.notes.length, c?.stream ?? "");
  if (!c) return null;
  const active =
    c.inline.draft?.snapshotId === c.workspace.snapshot.id &&
    sameAnchor(c.inline.draft.anchor, thread.anchor);
  const streaming =
    c.activeQuestion?.snapshotId === c.workspace.snapshot.id &&
    sameAnchor(c.activeQuestion.anchor, thread.anchor);
  const label = `${thread.anchor.side === "LEFT" ? "Old" : "New"} ${lineRange(thread.anchor)}`;
  return (
    <section
      className="inline-thread"
      aria-label={`Discussion for ${thread.anchor.path}, ${label}`}
    >
      <header>
        <MessageSquare size={14} />
        <strong>{label}</strong>
        <Button
          className="text-button"
          onPress={() => c.openChat(thread.anchor)}
        >
          <PanelRightOpen size={13} /> Continue in PR chat
        </Button>
        {active && (
          <Button
            className="icon-button"
            aria-label="Close inline composer"
            onPress={() => void c.inline.close().catch(c.onError)}
          >
            <X size={15} />
          </Button>
        )}
      </header>
      <div className="inline-messages" {...messages}>
        <ReviewMessages
          notes={thread.notes.filter(
            (n) => !active || n.id !== c.inline.draft?.id,
          )}
          remote={thread.remote}
          conversation={c}
          inline
          streaming={streaming}
        />
      </div>
      {active ? (
        <NoteComposer
          state={c.inline}
          inline
          busy={c.busy}
          onAsk={c.ask}
          onError={c.onError}
        />
      ) : (
        <Button
          className="text-button inline-reply"
          onPress={() => c.openInline(thread.anchor)}
        >
          Reply or ask Codex
        </Button>
      )}
    </section>
  );
}
