import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  api,
  type Note,
  type ReviewWorkspace,
} from "../../desktop/src/lib/api";
import { sameAnchor } from "../../desktop/src/lib/selection";
import { newNote } from "../../desktop/src/lib/review";
import { commentsForAnchor } from "../../desktop/src/lib/commentContext";
import {
  ConversationContext,
  type Conversation,
} from "../../desktop/src/features/conversation";
import { InlineDiscussion } from "../../desktop/src/features/InlineDiscussion";
import { useNoteComposer } from "../../desktop/src/features/useNoteComposer";
import {
  useAiRuns,
  isActiveRun,
  threadRuns,
  threadModel,
} from "../../desktop/src/features/useAiRuns";
import { transport } from "./transport";
import type { InlineContext } from "./inlineSession";

const id = new URLSearchParams(location.search).get("id");
const notifyParent = (type: string, extra = {}) =>
  parent.postMessage({ type, id, ...extra }, "https://github.com");

export function InlineReview() {
  const [info, setInfo] = useState<InlineContext | null>(null);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const onError = useCallback((error: unknown) => setError(String(error)), []);
  const onNote = useCallback(
    (note: Note) =>
      setWorkspace((w) =>
        w?.snapshot.id === note.snapshotId
          ? { ...w, notes: [...w.notes.filter((n) => n.id !== note.id), note] }
          : w,
      ),
    [],
  );
  const composer = useNoteComposer(onNote);
  const currentComposer = useRef(composer);
  currentComposer.current = composer;
  const ai = useAiRuns();
  useEffect(() => {
    let disposed = false;
    setError("");
    void transport
      .invoke<InlineContext>("inline_context")
      .then(async (result) => {
        if (disposed) return;
        setInfo(result);
        setWorkspace(result.workspace);
        await currentComposer.current.start(
          result.workspace.snapshot.id,
          result.anchor,
        );
        if (result.context.commentUrl)
          currentComposer.current.change(
            "What does this comment mean, and is it a concern?",
          );
      })
      .catch((error) => {
        if (!disposed) onError(error);
      });
    return () => {
      disposed = true;
    };
  }, [version, onError]);
  useEffect(() => {
    const root = document.getElementById("root")!;
    let previous = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height) + 2;
      if (height !== previous) {
        previous = height;
        notifyParent("diffcity-inline-size", { height });
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        !info || info.theme === "system"
          ? dark.matches
            ? "dark"
            : "light"
          : info.theme;
    };
    update();
    dark.addEventListener("change", update);
    return () => dark.removeEventListener("change", update);
  }, [info]);
  useEffect(() => {
    const snapshotId = workspace?.snapshot.id;
    if (!snapshotId) return;
    let disposed = false;
    let pending = false;
    const timer = setInterval(() => {
      if (document.hidden || pending) return;
      pending = true;
      void api
        .saved(snapshotId)
        .then((saved) => {
          if (!disposed)
            setWorkspace((w) =>
              w ? { ...w, notes: saved.notes, comments: saved.comments } : w,
            );
        })
        .catch((error) => {
          if (!disposed) onError(error);
        })
        .finally(() => {
          pending = false;
        });
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [workspace?.snapshot.id, onError]);
  const openPanel = () => {
    void chrome.runtime
      .sendMessage({ type: "inline-panel", id })
      .then((result) => {
        if (result?.error) onError(result.error);
      })
      .catch(onError);
  };
  const close = async () => {
    await composer.flush();
    notifyParent("diffcity-inline-close");
  };
  const conversation: Conversation | null =
    info && workspace
      ? {
          workspace,
          inline: composer,
          chat: composer,
          runs: ai.runs,
          isBusy: (anchor) =>
            threadRuns(ai.runs, workspace.snapshot.id, anchor).some(
              isActiveRun,
            ),
          modelFor: (anchor) =>
            threadModel(workspace.notes, anchor, info.preference),
          cancel: ai.cancel,
          dismiss: ai.dismiss,
          onError,
          openChat: openPanel,
          openInline: (anchor) =>
            void composer.start(workspace.snapshot.id, anchor).catch(onError),
          edit: (note) => composer.start(note.snapshotId, note.anchor, note),
          prepare: async (note) => {
            if (note.anchor?.textSelection)
              throw new Error("Text selections are AI-only");
            onNote(
              await api.note({
                ...newNote(note.snapshotId, note.anchor, note.body),
                githubDraft: true,
                parentId: note.id,
              }),
            );
          },
          ask: async (note) => {
            setError("");
            const reference = info.context.commentUrl;
            const question =
              reference &&
              !note.body.startsWith(`Regarding GitHub comment ${reference}:`)
                ? await api.note({
                    ...note,
                    body: `Regarding GitHub comment ${reference}:\n\n${note.body}`,
                  })
                : note;
            onNote(question);
            const preference = threadModel(
              workspace.notes,
              note.anchor,
              info.preference,
            );
            const reply = await ai.start(
              {
                kind: "question",
                snapshotId: note.snapshotId,
                question,
                preference,
                access: "limited",
              },
              (runId) =>
                api.ask(note.snapshotId, note.id, runId, preference, "limited"),
            );
            if (reply) {
              onNote(reply.answer);
              if (reply.draft) onNote(reply.draft);
            }
          },
        }
      : null;
  return (
    <main className="embedded-review">
      {error && (
        <div className="embedded-error" role="alert">
          {error}
          <Button
            className="text-button"
            onPress={() => setVersion((v) => v + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      {!info && !error && (
        <p className="embedded-loading" role="status">
          Opening inline conversation…
        </p>
      )}
      {conversation && info && workspace ? (
        <ConversationContext.Provider value={conversation}>
          <InlineDiscussion
            onClose={() => void close().catch(onError)}
            thread={{
              anchor: info.anchor,
              notes: workspace.notes.filter((note) =>
                sameAnchor(note.anchor, info.anchor),
              ),
              remote: commentsForAnchor(workspace.comments, info.anchor),
            }}
          />
          <div className="embedded-footer">
            <span>Private · Limited agent access</span>
            <Button className="text-button" onPress={openPanel}>
              Continue in PR chat
            </Button>
          </div>
        </ConversationContext.Provider>
      ) : (
        <Button
          className="text-button"
          onPress={() => notifyParent("diffcity-inline-close")}
        >
          Close
        </Button>
      )}
    </main>
  );
}
