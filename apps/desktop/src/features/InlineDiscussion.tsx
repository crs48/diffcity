import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PanelRightOpen,
  Sparkles,
  X,
} from "lucide-react";
import type { InlineThread } from "../lib/diffRows";
import { lineRange, sameAnchor } from "../lib/selection";
import { useConversation } from "./conversation";
import { NoteComposer } from "./NoteComposer";
import { ReviewMessages } from "./ReviewMessages";
import { useState } from "react";
import { SelectionQuote } from "./SelectionQuote";

export function InlineDiscussion({ thread }: { thread: InlineThread }) {
  const { t } = useTranslation();
  const c = useConversation();
  const [collapsedAt, setCollapsedAt] = useState<number | null>(null);
  const focus = c?.inline.focus ?? 0;
  const collapsed = collapsedAt === focus;
  if (!c) return null;
  const active =
    c.inline.draft?.snapshotId === c.workspace.snapshot.id &&
    sameAnchor(c.inline.draft.anchor, thread.anchor);
  const label = `${thread.anchor.side === "LEFT" ? "Old" : "New"} ${lineRange(thread.anchor)}`;
  return (
    <section
      className="inline-thread"
      aria-label={`Discussion for ${thread.anchor.path}, ${label}`}
    >
      <header>
        <Button
          className="icon-button"
          aria-label={t(
            collapsed
              ? "Expand inline discussion"
              : "Collapse inline discussion",
          )}
          aria-expanded={!collapsed}
          onPress={() => setCollapsedAt(collapsed ? null : focus)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </Button>
        {thread.anchor.textSelection ? (
          <Sparkles size={14} />
        ) : (
          <MessageSquare size={14} />
        )}
        <strong>{label}</strong>
        <Button
          className="text-button"
          onPress={() => c.openChat(thread.anchor)}
        >
          <PanelRightOpen size={13} />
          {t("Continue in PR chat")}{" "}
        </Button>
        {active && (
          <Button
            className="icon-button"
            aria-label={t("Close inline composer")}
            onPress={() => void c.inline.close().catch(c.onError)}
          >
            <X size={15} />
          </Button>
        )}
      </header>
      {!collapsed && (
        <>
          <SelectionQuote anchor={thread.anchor} />
          <div className="inline-messages">
            <ReviewMessages
              notes={thread.notes.filter(
                (n) => !active || n.id !== c.inline.draft?.id,
              )}
              remote={thread.remote}
              conversation={c}
              inline
            />
          </div>
          {active ? (
            <NoteComposer
              state={c.inline}
              inline
              busy={c.isBusy(thread.anchor)}
              model={c.modelFor(thread.anchor).model}
              onAsk={c.ask}
              onError={c.onError}
            />
          ) : (
            <Button
              className="text-button inline-reply"
              onPress={() => c.openInline(thread.anchor)}
            >
              {t("Reply or ask AI")}{" "}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
