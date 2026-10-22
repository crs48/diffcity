import { useTranslation } from "react-i18next";
import "../i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "react-aria-components";
import { Check, Send } from "lucide-react";
import type { Note } from "../lib/api";
import type { NoteComposerState } from "./useNoteComposer";

export function NoteComposer({
  state,
  inline = false,
  busy,
  onAsk,
  onError,
}: {
  state: NoteComposerState;
  inline?: boolean;
  busy: boolean;
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
        aria-label={
          textOnly
            ? t("Follow-up about selected code")
            : inline
              ? t("Inline comment or Codex question")
              : t("Message to Codex about this PR")
        }
        placeholder={
          textOnly
            ? t("Ask a follow-up about this selection…")
            : inline
              ? t("Comment on this code or ask Codex…")
              : t("Discuss this PR with Codex…")
        }
        value={state.draft.body}
        onChange={(e) => state.change(e.target.value)}
      />
      <div className="composer-status" role="status">
        {textOnly ? (
          t("AI only · never published to GitHub")
        ) : state.saved ? (
          <>
            <Check size={12} />
            {t("Saved locally")}{" "}
          </>
        ) : editing ? (
          t("GitHub draft · not published")
        ) : (
          t("Private · shared with this PR’s Codex conversation")
        )}
      </div>
      <div className="composer-actions">
        {!textOnly && (
          <Button
            className="secondary"
            isDisabled={!state.draft.body.trim()}
            onPress={() => void state.submit().catch(onError)}
          >
            {editing ? t("Save draft") : t("Save comment")}
          </Button>
        )}
        <Button
          className="primary"
          isDisabled={busy || editing || !state.draft.body.trim()}
          onPress={() => void state.submit(onAsk).catch(onError)}
        >
          <Send size={13} />
          {t("Ask Codex")}{" "}
        </Button>
      </div>
    </div>
  );
}
