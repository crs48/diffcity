import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import {
  ChevronDown,
  ChevronRight,
  PanelRightOpen,
  Sparkles,
  X,
} from "lucide-react";
import type { InlineThread } from "../lib/diffRows";
import { lineRange, sameAnchor } from "../lib/selection";
import { useConversation } from "./conversation";
import { NoteComposer } from "./NoteComposer";
import { ReviewMessages } from "./ReviewMessages";
import { useLayoutEffect, useRef, useState } from "react";
import { SelectionQuote } from "./SelectionQuote";
import { threadTitle } from "../lib/threadTitle";
import { followScrollTarget } from "../lib/scrollTarget";
import { IconAction } from "../ui/IconAction";
import { threadTarget } from "../lib/guideIndex";
import { useGuideJump } from "./guideJump";

export function InlineDiscussion({ thread }: { thread: InlineThread }) {
  const { t } = useTranslation();
  const c = useConversation();
  const root = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  const keepHeader = useRef(false);
  const jump = useGuideJump([thread.anchor.hunkId]);
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  const focus = `${c?.inline.focus ?? 0}/${jump?.entry.target === threadTarget(thread.anchor) ? jump.sequence : 0}`;
  const collapsed = collapsedAt === focus;
  useLayoutEffect(() => {
    if (!collapsed || !keepHeader.current) return;
    keepHeader.current = false;
    const element = root.current;
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (element && viewport)
      return followScrollTarget(viewport, element, () =>
        header.current ? parseFloat(getComputedStyle(header.current).top) : 0,
      );
  }, [collapsed]);
  if (!c) return null;
  const active =
    c.inline.draft?.snapshotId === c.workspace.snapshot.id &&
    sameAnchor(c.inline.draft.anchor, thread.anchor);
  const label = `${thread.anchor.side === "LEFT" ? "Old" : "New"} ${lineRange(thread.anchor)}`;
  const title = threadTitle(thread.notes, thread.remote, thread.anchor);
  return (
    <section
      ref={root}
      className="inline-thread"
      data-guide-index-target={threadTarget(thread.anchor)}
      tabIndex={-1}
      aria-label={`Discussion for ${thread.anchor.path}, ${label}`}
    >
      <header ref={header}>
        <Button
          className="icon-button"
          aria-label={t(
            collapsed
              ? "Expand inline discussion"
              : "Collapse inline discussion",
          )}
          aria-expanded={!collapsed}
          onPress={() => {
            const viewport = root.current?.closest<HTMLElement>(
              "[data-review-scroll]",
            );
            keepHeader.current =
              !collapsed &&
              !!viewport &&
              !!header.current &&
              root.current!.getBoundingClientRect().top <
                viewport.getBoundingClientRect().top +
                  parseFloat(getComputedStyle(header.current).top);
            setCollapsedAt(collapsed ? null : focus);
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </Button>
        <Sparkles size={14} aria-hidden />
        <div className="inline-thread-heading">
          <strong title={title || label}>{title || label}</strong>
          <span className="muted">
            {title ? `${label} · ` : ""}
            {t("Private AI conversation")}
          </span>
        </div>
        <IconAction
          label={t("Continue in PR chat")}
          onPress={() => c.openChat(thread.anchor)}
        >
          <PanelRightOpen size={15} aria-hidden />
        </IconAction>
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
