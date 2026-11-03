import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  type AiRun,
  isActiveRun,
  threadRuns,
  threadModel,
} from "../../desktop/src/features/useAiRuns";
import { transport } from "./transport";
import type { InlineContext, InlineState, InlineView } from "./inlineSession";

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
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [initialized, setInitialized] = useState(false);
  const live = useRef(false);
  const collapsed = useRef(false);
  const persistView = useCallback(async () => {
    if (!live.current) return;
    const draft = currentComposer.current.getDraft();
    const view: InlineView = {
      collapsed: collapsed.current,
      draft: draft ? { noteId: draft.id || null, body: draft.body } : null,
    };
    await transport.invoke("save_inline_view", { view });
  }, []);
  useEffect(() => {
    const stop = currentComposer.current.subscribeDraft(() => {
      void persistView().catch(onError);
    });
    const subscription = transport.listen<InlineState>(
      "inline-state",
      ({ payload }) => {
        setRuns(payload.runs);
        setWorkspace((w) => (w ? { ...w, notes: payload.notes } : w));
      },
    );
    const suspend = async (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== "https://github.com" ||
        event.data?.type !== "diffcity-inline-suspend" ||
        event.data.id !== id ||
        typeof event.data.token !== "string"
      )
        return;
      try {
        if (live.current) {
          // A disconnected desktop must not keep an offscreen UI alive.
          // The private worker draft below preserves text if native saving fails.
          await currentComposer.current.flush().catch(() => undefined);
          await persistView();
        }
        notifyParent("diffcity-inline-suspended", { token: event.data.token });
      } catch (error) {
        onError(error);
      }
    };
    window.addEventListener("message", suspend);
    return () => {
      stop();
      void subscription.then((stop) => stop());
      window.removeEventListener("message", suspend);
    };
  }, [persistView, onError]);
  useEffect(() => {
    let disposed = false;
    setError("");
    void transport
      .invoke<InlineContext>("inline_context")
      .then(async (result) => {
        if (disposed) return;
        setInfo(result);
        setWorkspace(result.workspace);
        const savedDraft = result.view?.draft;
        const editing = savedDraft?.noteId
          ? result.workspace.notes.find((n) => n.id === savedDraft.noteId)
          : undefined;
        await currentComposer.current.start(
          result.workspace.snapshot.id,
          result.anchor,
          editing,
          !result.resuming,
        );
        collapsed.current = result.view?.collapsed ?? false;
        setRuns(result.runs);
        if (savedDraft) currentComposer.current.change(savedDraft.body);
        else if (!result.resuming && result.context.commentUrl)
          currentComposer.current.change(
            "What does this comment mean, and is it a concern?",
          );
        live.current = true;
        setInitialized(true);
      })
      .catch((error) => {
        if (!disposed) {
          onError(error);
          setInitialized(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [version, onError]);
  useLayoutEffect(() => {
    if (!initialized) return;
    notifyParent("diffcity-inline-ready", {
      height:
        Math.ceil(
          document.getElementById("root")!.getBoundingClientRect().height,
        ) + 2,
    });
  }, [initialized]);
  useEffect(() => {
    const root = document.getElementById("root")!;
    let previous = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height) + 2;
      if (live.current && height !== previous) {
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
          runs,
          isBusy: (anchor) =>
            threadRuns(runs, workspace.snapshot.id, anchor).some(isActiveRun),
          modelFor: (anchor) =>
            threadModel(workspace.notes, anchor, info.preference),
          cancel: api.cancel,
          dismiss: (runId) => {
            void transport
              .invoke("dismiss_inline_run", { runId })
              .catch(onError);
          },
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
            const reply = await api.ask(
              note.snapshotId,
              note.id,
              crypto.randomUUID(),
              preference,
              "limited",
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
      {conversation && info && workspace && initialized ? (
        <ConversationContext.Provider value={conversation}>
          <InlineDiscussion
            initiallyCollapsed={info.view?.collapsed}
            onCollapsedChange={(value) => {
              collapsed.current = value;
              void persistView().catch(onError);
            }}
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
