import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  BookOpen,
  Check,
  Cpu,
  ExternalLink,
  FileCode2,
  Library,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  type Anchor,
  type Bootstrap,
  type Guide,
  type ModelPreference,
  type Note,
  type ReviewProgress,
  type ReviewWorkspace,
} from "../../desktop/src/lib/api";
import { GuideView } from "../../desktop/src/features/Guide";
import { Discussion } from "../../desktop/src/features/Discussion";
import {
  ConversationContext,
  type Conversation,
} from "../../desktop/src/features/conversation";
import { useNoteComposer } from "../../desktop/src/features/useNoteComposer";
import {
  useAiRuns,
  isActiveRun,
  threadRuns,
  threadModel,
} from "../../desktop/src/features/useAiRuns";
import { useAgentAccess } from "../../desktop/src/features/AgentAccess";
import { ModelSettings } from "../../desktop/src/features/ModelSettings";
import { GuideSwitcher } from "../../desktop/src/features/GuideSwitcher";
import { GuideEnrichment } from "../../desktop/src/features/GuideEnrichment";
import { ReviewPopover } from "../../desktop/src/features/ReviewToolbar";
import { Finish } from "../../desktop/src/features/Dialogs";
import { CommentMarkdown } from "../../desktop/src/ui/CommentMarkdown";
import { defaultModelPreference } from "../../desktop/src/lib/models";
import { sameAnchor } from "../../desktop/src/lib/selection";
import { newNote } from "../../desktop/src/lib/review";
import { mergeEnrichment } from "../../desktop/src/lib/enrichment";
import { listen } from "../../desktop/src/lib/transport";
import { commentAnchor, lineAnchor, selectionAnchor } from "./context";
import { pullFromUrl, type PullContext } from "./protocol";

const panel = location.pathname.endsWith("sidepanel.html");
const params = new URLSearchParams(location.search);
const initial = pullFromUrl(
  `https://github.com/${params.get("repo")}/pull/${params.get("number")}`,
);

export function BrowserReview() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const connected = !!data;
  const [context, setContext] = useState<PullContext | null>(initial);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(panel);
  const [mode, setMode] = useState<"guide" | "files" | "overview">("guide");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<"model" | "guide" | "finish" | null>(
    null,
  );
  const [pendingGuide, setPendingGuide] = useState<Guide | null>(null);
  const [version, setVersion] = useState(0);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
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
  const inline = useNoteComposer(onNote);
  const chat = useNoteComposer(onNote);
  const ai = useAiRuns();
  const access = useAgentAccess();
  const handlers = useRef({ inline, chat });
  handlers.current = { inline, chat };
  const preference = data?.modelPreference ?? defaultModelPreference;
  const boot = useCallback(async () => {
    setError("");
    try {
      setData(await api.bootstrap());
    } catch (error) {
      onError(error);
    }
  }, [onError]);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        data?.settings.theme === "system" || !data
          ? dark.matches
            ? "dark"
            : "light"
          : data.settings.theme;
    };
    update();
    dark.addEventListener("change", update);
    return () => dark.removeEventListener("change", update);
  }, [data]);
  useEffect(() => {
    if (!panel) return;
    let disposed = false;
    let received = false;
    const apply = (entry?: { context?: PullContext }) => {
      if (!disposed && entry?.context) setContext(entry.context);
    };
    void chrome.storage.session
      .get("reviewContext")
      .then(
        (result) =>
          !received &&
          apply(result.reviewContext as { context?: PullContext } | undefined),
      );
    const subscription = listen<{ context: PullContext }>(
      "review-context",
      (event) => {
        received = true;
        apply(event.payload);
      },
    );
    return () => {
      disposed = true;
      void subscription.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    const subscription = listen<string>("bridge-disconnected", (event) =>
      setError(event.payload),
    );
    return () => {
      void subscription.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!context || !connected) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    void (async () => {
      await Promise.all([
        handlers.current.inline.flush(),
        handlers.current.chat.flush(),
      ]);
      const w = await api.open(
        context.repository,
        context.number,
        !!context.commentUrl,
      );
      if (request !== generation.current) return;
      setWorkspace(w);
      setReference(null);
      setSelection(null);
      let anchor: Anchor | null = null;
      if (context.path) {
        const file = w.snapshot.files.find(
          (file) => file.path === context.path,
        );
        if (!file)
          throw new Error(
            "This file is not part of the captured PR. Refresh and try again.",
          );
        const hunk = file.hunks[0];
        const line = hunk?.lines.find(
          (line) => line.new !== null || line.old !== null,
        );
        if (hunk && line)
          anchor = {
            path: file.path,
            hunkId: hunk.id,
            side: line.new !== null ? "RIGHT" : "LEFT",
            line: line.new ?? line.old!,
            startLine: line.new ?? line.old!,
          };
      }
      if (context.selection) {
        anchor = selectionAnchor(w, context.selection);
        if (!anchor)
          throw new Error(
            "This selection could not be matched uniquely to the current PR code. Open the guide and select the code there; no question was sent.",
          );
      }
      if (context.line) {
        anchor = lineAnchor(w, context.line);
        if (!anchor)
          throw new Error(
            "This line is not part of the captured PR. Refresh and try again.",
          );
      }
      if (context.commentUrl) {
        if (!w.comments.some((c) => c.url === context.commentUrl))
          throw new Error(
            "This GitHub comment is not available in the captured PR. Refresh the PR and try again.",
          );
        anchor = commentAnchor(w, context.commentUrl);
        setReference(context.commentUrl);
      }
      setSelection(anchor);
      await handlers.current.chat.start(w.snapshot.id, anchor);
      if (context.path)
        handlers.current.chat.change(
          `Help me review the changes in ${context.path}. What should I pay attention to?`,
        );
      if (context.commentUrl)
        handlers.current.chat.change(
          "What does this comment mean, and is it a concern?",
        );
      if (context.selection) handlers.current.chat.change("");
    })()
      .catch(onError)
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current = request + 1;
    };
  }, [context, connected, version, onError]);
  useEffect(() => {
    const snapshotId = workspace?.snapshot.id;
    if (!snapshotId) return;
    // Reconnect to completed browser jobs and edits made in the desktop app.
    const timer = setInterval(() => {
      if (document.hidden) return;
      void api
        .saved(snapshotId)
        .then((saved) =>
          setWorkspace((w) =>
            w?.snapshot.id === snapshotId
              ? { ...w, notes: saved.notes, comments: saved.comments }
              : w,
          ),
        )
        .catch(onError);
    }, 5000);
    return () => clearInterval(timer);
  }, [workspace?.snapshot.id, onError]);
  const modelFor = (anchor: Anchor | null) =>
    threadModel(workspace?.notes ?? [], anchor, preference);
  const ask = async (note: Note) => {
    // Only reference a canonical API comment. Its body/replies are supplied by the backend.
    const prepared =
      reference &&
      !note.body.startsWith(`Regarding GitHub comment ${reference}:`) &&
      sameAnchor(chat.draft?.anchor ?? null, note.anchor)
        ? await api.note({
            ...note,
            body: `Regarding GitHub comment ${reference}:\n\n${note.body}`,
          })
        : note;
    onNote(prepared);
    const reply = await ai.start(
      {
        kind: "question",
        snapshotId: note.snapshotId,
        question: prepared,
        preference: modelFor(note.anchor),
        access: access.access,
      },
      (id) =>
        api.ask(
          note.snapshotId,
          note.id,
          id,
          modelFor(note.anchor),
          access.access,
        ),
    );
    if (reply) {
      onNote(reply.answer);
      if (reply.draft) onNote(reply.draft);
    }
  };
  const openChat = async (anchor: Anchor | null) => {
    if (!workspace) return;
    setReference(null);
    setChatOpen(true);
    await chat.start(workspace.snapshot.id, anchor);
  };
  const openInline = async (anchor: Anchor) => {
    if (!workspace) return;
    setSelection(anchor);
    if (panel) await openChat(anchor);
    else await inline.start(workspace.snapshot.id, anchor);
  };
  const progressWrites = useRef(Promise.resolve<unknown>(undefined));
  const progress = (value: ReviewProgress) => {
    if (!workspace) return;
    setWorkspace((w) => (w ? { ...w, progress: value } : w));
    progressWrites.current = progressWrites.current
      .then(() => api.progress(workspace.snapshot.id, value))
      .catch(onError);
  };
  const selectGuide = async (
    id: string,
    snapshotId = workspace?.snapshot.id,
  ) => {
    if (!snapshotId) return;
    await progressWrites.current;
    const selected = await api.selectGuide(snapshotId, id);
    setWorkspace(selected);
    setPendingGuide(null);
    setMode("guide");
  };
  const enriched = (guide: Guide) =>
    setWorkspace((w) =>
      w && w.guide.id === guide.id
        ? { ...w, guide: mergeEnrichment(w.guide, guide) }
        : w,
    );
  const enrich = async (guide: Guide, tier: "priority" | "further") => {
    if (!guide.id) return;
    const result = await ai.start(
      {
        kind: "enrichment",
        snapshotId: guide.snapshotId,
        guideId: guide.id,
        preference: {
          provider: guide.source,
          model: guide.model,
          reasoningEffort: guide.reasoningEffort ?? null,
        },
      },
      (id) => api.enrich(guide.snapshotId, guide.id!, tier, id),
      enriched,
    );
    if (result) enriched(result);
  };
  const generate = async (model: ModelPreference) => {
    if (!workspace) return;
    const guide = await ai.start(
      { kind: "guide", snapshotId: workspace.snapshot.id, preference: model },
      (id) => api.analyze(workspace.snapshot.id, id, model),
    );
    if (guide) {
      setPendingGuide(guide);
      if (
        guide.enrichment?.files.some(
          (f) => f.tier === "priority" && f.status === "pending",
        )
      )
        void enrich(guide, "priority").catch(onError);
    }
  };
  const fullGuide = () => {
    if (!context) return;
    const url = new URL(chrome.runtime.getURL("index.html"));
    url.searchParams.set("repo", context.repository);
    url.searchParams.set("number", String(context.number));
    void chrome.tabs.create({ url: url.href });
  };
  const conversation: Conversation | null = workspace
    ? {
        workspace,
        inline,
        chat,
        runs: ai.runs.filter((r) => r.snapshotId === workspace.snapshot.id),
        access: access.access,
        setAccess: access.change,
        respondAgent: api.respondAgent,
        isBusy: (anchor) =>
          threadRuns(ai.runs, workspace.snapshot.id, anchor).some(isActiveRun),
        modelFor,
        cancel: ai.cancel,
        dismiss: ai.dismiss,
        ask,
        explainText: async (anchor, question) => {
          await openInline(anchor);
          const note = await api.note(
            newNote(
              workspace.snapshot.id,
              anchor,
              question?.trim() ||
                "Help me understand this selected code. What does it do, and how does it fit into the surrounding code?",
            ),
          );
          onNote(note);
          await ask(note);
        },
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
        edit: async (note, inCode) => {
          if (inCode && note.anchor && !panel)
            await inline.start(note.snapshotId, note.anchor, note);
          else {
            setChatOpen(true);
            await chat.start(note.snapshotId, note.anchor, note);
          }
        },
        openInline: (anchor) => void openInline(anchor).catch(onError),
        openChat: (anchor) => void openChat(anchor).catch(onError),
        onError,
      }
    : null;
  const comment = workspace?.comments.find((c) => c.url === reference);
  const refreshModels = useCallback(
    (provider: string) => api.models(provider),
    [],
  );
  return (
    <main
      data-review-workspace
      className={`browser-review ${panel ? "browser-panel" : "browser-guide"}`}
    >
      <header className="browser-header">
        <BookOpen size={18} aria-hidden />
        <strong>Diff City</strong>
        <span className="browser-pr" title={workspace?.snapshot.pull.title}>
          {context
            ? `${context.repository} #${context.number}`
            : "GitHub companion"}
        </span>
        {loading && (
          <LoaderCircle
            className="spin"
            size={15}
            aria-label="Loading review"
          />
        )}
        <Button
          className="icon-button"
          aria-label="Refresh PR"
          onPress={() => {
            if (!data) void boot();
            else setVersion((n) => n + 1);
          }}
        >
          <RefreshCw size={15} />
        </Button>
        <Button
          ref={modelTrigger}
          className="icon-button"
          aria-label="Model"
          onPress={() => setDialog("model")}
        >
          <Cpu size={16} />
        </Button>
        {panel && (
          <Button
            className="icon-button"
            aria-label="Open full guide"
            onPress={fullGuide}
          >
            <ExternalLink size={16} />
          </Button>
        )}
      </header>
      {error && (
        <div className="browser-error" role="alert">
          <span>{error}</span>
          <Button
            className="text-button"
            onPress={() => {
              setError("");
              void boot();
              setVersion((n) => n + 1);
            }}
          >
            Retry
          </Button>
          <Button
            className="icon-button"
            aria-label="Dismiss error"
            onPress={() => setError("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {!data && (
        <section className="browser-setup">
          <h1>Your local agents, inside GitHub.</h1>
          <p>
            Open Diff City, then enable <strong>Chrome connection</strong> in
            Connections. Your existing Codex and Claude logins stay on your
            computer.
          </p>
          <Button className="primary" onPress={() => void boot()}>
            Connect to Diff City
          </Button>
        </section>
      )}
      {data && !context && (
        <section className="browser-setup">
          <h1>Open a GitHub pull request</h1>
          <p>
            Use Ask AI on a comment or select code to start a conversation. Open
            the full guide for a guided review.
          </p>
        </section>
      )}
      {workspace && conversation && (
        <ConversationContext.Provider value={conversation}>
          {!panel && (
            <nav className="browser-toolbar" aria-label="Review views">
              {(["guide", "files", "overview"] as const).map((view) => (
                <Button
                  key={view}
                  className="text-button"
                  aria-pressed={view === mode}
                  onPress={() => setMode(view)}
                >
                  {view === "files" ? (
                    <FileCode2 size={15} />
                  ) : (
                    <BookOpen size={15} />
                  )}{" "}
                  {view[0].toUpperCase() + view.slice(1)}
                </Button>
              ))}
              <div id="review-guide-navigation" />
              <span className="browser-spacer" />
              <ReviewPopover
                label="Saved guides"
                icon={<Library size={16} />}
                attention={!!pendingGuide}
              >
                <GuideSwitcher
                  disabled={loading}
                  guide={workspace.guide}
                  pendingId={pendingGuide?.id}
                  onSelect={selectGuide}
                />
              </ReviewPopover>
              <Button
                className="text-button"
                onPress={() => setDialog("guide")}
              >
                <Sparkles size={15} />
                New guide
              </Button>
              <Button
                className="icon-button"
                aria-label="PR chat"
                onPress={() => void openChat(null)}
              >
                <MessageSquare size={16} />
              </Button>
              <Button className="secondary" onPress={() => setDialog("finish")}>
                <Check size={15} />
                Finish review
              </Button>
            </nav>
          )}
          {pendingGuide?.id && (
            <div className="browser-ready" role="status">
              <Sparkles size={16} />
              <span>{pendingGuide.model} guide is ready.</span>
              <Button
                className="primary"
                onPress={() => {
                  if (panel) fullGuide();
                  else void selectGuide(pendingGuide.id!).catch(onError);
                }}
              >
                View guide
              </Button>
            </div>
          )}
          {ai.runs
            .filter((r) => r.kind === "guide")
            .map((run) => (
              <div className="browser-job" role="status" key={run.id}>
                {isActiveRun(run) && (
                  <LoaderCircle className="spin" size={14} />
                )}{" "}
                {run.preference.model} · {run.text}
                <Button
                  className="text-button"
                  onPress={() =>
                    isActiveRun(run)
                      ? void ai.cancel(run.id)
                      : ai.dismiss(run.id)
                  }
                >
                  {isActiveRun(run) ? "Cancel" : "Dismiss"}
                </Button>
              </div>
            ))}
          <div className="review-body" data-chat-open={chatOpen}>
            {!panel && (
              <div className="review-document">
                <div className="review-canvas">
                  <div id="review-guide-index" />
                  <div className="review-scroll" data-review-scroll>
                    <div className="review-panel">
                      <GuideEnrichment
                        guide={workspace.guide}
                        runs={ai.runs}
                        onStart={(tier) =>
                          void enrich(workspace.guide, tier).catch(onError)
                        }
                        onCancel={(id) => void ai.cancel(id)}
                        onDismissRun={ai.dismiss}
                        onDismiss={(dismissed) =>
                          void api
                            .dismissEnrichment(
                              workspace.snapshot.id,
                              workspace.guide.id!,
                              dismissed,
                            )
                            .then(enriched)
                            .catch(onError)
                        }
                      />
                      <GuideView
                        workspace={workspace}
                        selection={selection}
                        onSelect={setSelection}
                        onDiscuss={(anchor) =>
                          void openInline(anchor).catch(onError)
                        }
                        onProgress={progress}
                        onFinish={() => setDialog("finish")}
                        mode={mode}
                        onNewGuide={() => setDialog("guide")}
                        onOriginalGuide={
                          workspace.guide.previousRevision && workspace.guide.id
                            ? () =>
                                void selectGuide(
                                  workspace.guide.id!,
                                  workspace.guide.previousRevision!.snapshotId,
                                ).catch(onError)
                            : undefined
                        }
                      />
                    </div>
                  </div>
                  <div id="review-minimap-host" />
                </div>
              </div>
            )}
            {chatOpen && (
              <Discussion
                onClose={() => (panel ? window.close() : setChatOpen(false))}
                replyContext={
                  comment && (
                    <div className="browser-comment-context">
                      <strong>
                        Replying about {comment.author}’s GitHub comment
                      </strong>
                      <CommentMarkdown
                        body={
                          comment.body.length > 500
                            ? `${comment.body.slice(0, 500)}…`
                            : comment.body
                        }
                      />
                      <Button
                        className="text-button"
                        onPress={() => setReference(null)}
                      >
                        Remove comment context
                      </Button>
                    </div>
                  )
                }
              />
            )}
          </div>
          {dialog === "finish" && (
            <Finish
              workspace={workspace}
              login={data?.github.identity ?? ""}
              onPublished={async () => {
                setWorkspace(
                  await api.sync(context!.repository, context!.number),
                );
              }}
              onCheckpoint={() => setDialog(null)}
              onClose={() => setDialog(null)}
            />
          )}
        </ConversationContext.Provider>
      )}
      {(dialog === "model" || dialog === "guide") && data && (
        <ModelSettings
          preference={preference}
          models={data.models}
          connection={data.codex}
          purpose={dialog === "guide" ? "guide" : "default"}
          triggerRef={dialog === "model" ? modelTrigger : undefined}
          onRefresh={refreshModels}
          onClose={() => setDialog(null)}
          onSave={async (model) => {
            const purpose = dialog;
            setDialog(null);
            if (purpose === "guide") void generate(model).catch(onError);
            else
              setData({
                ...data,
                modelPreference: await api.modelPreference(model),
              });
          }}
        />
      )}
    </main>
  );
}
