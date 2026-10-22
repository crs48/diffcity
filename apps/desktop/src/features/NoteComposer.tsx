import { useTranslation } from "react-i18next";
import "../i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "react-aria-components";
import { Github, Send, StickyNote } from "lucide-react";
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
  const input = useRef<HTMLTextAreaElement>(null);
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
        aria-describedby={contextDescriptionId}
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
          if (!busy && state.draft?.body.trim())
            void state.submit(onAsk).catch(onError);
        }}
      />
      <div className="composer-status" role="status">
        {textOnly
          ? t("AI only · never published to GitHub")
          : editing
            ? t("GitHub draft · publish later in Finish review")
            : t(
                "Private conversation · Enter to ask AI · Shift+Enter for a new line",
              )}
      </div>
      {model && !editing && (
        <p className="muted composer-model">
          {t("Replies use {{model}}", { model })}
        </p>
      )}
      {busy && (
        <p className="muted">
          {t("This conversation is responding. You can ask in another thread.")}
        </p>
      )}
      <div className="composer-actions">
        {!textOnly && (
          <Button
            className="secondary"
            isDisabled={!state.draft.body.trim()}
            onPress={() => void state.submit().catch(onError)}
          >
            <StickyNote size={13} />
            {editing ? t("Save draft") : t("Save private note")}
          </Button>
        )}
        {!textOnly && !editing && (
          <Button
            className="secondary"
            isDisabled={!state.draft.body.trim()}
            onPress={() => void state.submit(undefined, true).catch(onError)}
          >
            <Github size={13} />
            {t("Save GitHub draft")}
          </Button>
        )}
        {!editing && (
          <Button
            className="primary"
            isDisabled={busy || editing || !state.draft.body.trim()}
            onPress={() => void state.submit(onAsk).catch(onError)}
          >
            <Send size={13} />
            {t("Ask AI")}{" "}
          </Button>
        )}
      </div>
    </div>
  );
}
