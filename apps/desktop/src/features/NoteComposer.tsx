import { useConversation } from "./conversation";
import { AgentAccessSelector } from "./AgentAccess";
import { useTranslation } from "react-i18next";
import "../i18n";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Button } from "react-aria-components";
import {
  ArrowUp,
  Github,
  ListOrdered,
  LockKeyhole,
  StickyNote,
} from "lucide-react";
import { IconAction } from "../ui/IconAction";
import type { Note } from "../lib/api";
import type { NoteComposerState } from "./useNoteComposer";

export function NoteComposer({
  state,
  inline = false,
  contextDescriptionId,
  busy,
  model,
  onAsk,
  onError,
}: {
  state: NoteComposerState;
  inline?: boolean;
  contextDescriptionId?: string;
  busy: boolean;
  model?: string;
  onAsk: (note: Note) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const conversation = useConversation();
  const input = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  useEffect(() => {
    if (state.focus) input.current?.focus();
  }, [state.focus]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + 2}px`;
    };
    resize();
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.draft?.body]);
  if (!state.draft) return null;
  const editing = state.draft.githubDraft;
  const textOnly = !!state.draft.anchor?.textSelection;
  return (
    <div className="composer">
      <textarea
        ref={input}
        aria-describedby={[contextDescriptionId, helpId]
          .filter(Boolean)
          .join(" ")}
        aria-label={
          textOnly
            ? t("Follow-up about selected code")
            : inline
              ? t("Inline comment or AI question")
              : t("Message to AI about this PR")
        }
        placeholder={
          textOnly
            ? t("Ask a follow-up about this selection…")
            : editing
              ? t("Write a GitHub review comment…")
              : inline
                ? t("Ask AI about this code, or ask it to draft feedback…")
                : t("Discuss this PR with AI…")
        }
        value={state.draft.body}
        onChange={(e) => state.change(e.target.value)}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            editing
          )
            return;
          event.preventDefault();
          if (state.draft?.body.trim()) void state.submit(onAsk).catch(onError);
        }}
      />
      <div className="sr-only" id={helpId}>
        {textOnly
          ? t("AI conversation · selected text is not a GitHub line comment")
          : editing
            ? t("GitHub draft · publish later in Finish review")
            : t(
                "Private conversation · Enter to ask AI · Shift+Enter for a new line",
              )}
      </div>
      <div className="composer-footer">
        <div className="composer-settings">
          <span
            className="composer-privacy"
            title={t(
              editing
                ? "GitHub draft · publish later in Finish review"
                : "Private AI conversation",
            )}
          >
            {editing ? (
              <Github size={12} aria-hidden />
            ) : (
              <LockKeyhole size={12} aria-hidden />
            )}
            {t(editing ? "Unpublished draft" : "Private")}
          </span>
          {!editing && conversation?.access && conversation.setAccess && (
            <AgentAccessSelector
              value={conversation.access}
              onChange={conversation.setAccess}
            />
          )}
        </div>
        <div className="composer-actions">
          {model && !editing && (
            <span
              className="composer-model"
              title={t("Replies use {{model}}", { model })}
            >
              {model}
            </span>
          )}
          {!textOnly &&
            (editing ? (
              <Button
                className="secondary"
                isDisabled={!state.draft.body.trim()}
                onPress={() => void state.submit().catch(onError)}
              >
                {t("Save draft")}
              </Button>
            ) : (
              <IconAction
                label={t("Save private note")}
                isDisabled={!state.draft.body.trim()}
                onPress={() => void state.submit().catch(onError)}
              >
                <StickyNote size={15} aria-hidden />
              </IconAction>
            ))}
          {!textOnly && !editing && (
            <IconAction
              label={t("Save GitHub draft")}
              isDisabled={!state.draft.body.trim()}
              onPress={() => void state.submit(undefined, true).catch(onError)}
            >
              <Github size={15} aria-hidden />
            </IconAction>
          )}
          {!editing && (
            <IconAction
              label={t(busy ? "Queue question" : "Ask AI")}
              className="composer-send"
              isDisabled={!state.draft.body.trim()}
              onPress={() => void state.submit(onAsk).catch(onError)}
            >
              {busy ? (
                <ListOrdered size={17} aria-hidden />
              ) : (
                <ArrowUp size={18} aria-hidden />
              )}
            </IconAction>
          )}
        </div>
      </div>
      {busy && (
        <p className="composer-queue-hint" role="status">
          {t("Your next question will be queued.")}
        </p>
      )}
    </div>
  );
}
