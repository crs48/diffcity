import type {
  Anchor,
  Bootstrap,
  ModelPreference,
  Note,
  ReviewWorkspace,
  RunEvent,
} from "../../desktop/src/lib/api";
import type { AiRun } from "../../desktop/src/features/useAiRuns";
import { sameAnchor } from "../../desktop/src/lib/selection";
import { commentsForAnchor } from "../../desktop/src/lib/commentContext";
import { inlineAnchor } from "./context";
import type { PullContext } from "./protocol";

export type InlineView = {
  draft: { noteId: string | null; body: string } | null;
  collapsed: boolean;
};
export type InlineState = { notes: Note[]; runs: AiRun[] };
export type InlineContext = {
  context: PullContext;
  workspace: ReviewWorkspace;
  anchor: Anchor;
  preference: ModelPreference;
  theme: string;
  view?: InlineView;
  resuming: boolean;
  runs: AiRun[];
};
type Rpc = (command: string, args: Record<string, unknown>) => Promise<unknown>;
type Options = {
  anchor?: Anchor;
  view?: InlineView;
  persist?: (view: InlineView) => Promise<void>;
  changed?: (state: InlineState) => void;
};

// Keep only this conversation's code in each worker session, not a copy of a
// thousand-file PR for every virtualized thread. The agent still uses the full
// persisted snapshot through its native API.
function threadWorkspace(
  workspace: ReviewWorkspace,
  anchor: Anchor,
): ReviewWorkspace {
  return {
    ...workspace,
    snapshot: {
      ...workspace.snapshot,
      files: workspace.snapshot.files
        .filter((f) => f.path === anchor.path)
        .map((f) => ({
          ...f,
          hunks: f.hunks.filter((h) => h.id === anchor.hunkId),
        })),
    },
    guide: workspace.guide
      ? {
          ...workspace.guide,
          sections: workspace.guide.sections.filter((s) =>
            s.hunkIds.includes(anchor.hunkId),
          ),
        }
      : workspace.guide,
    notes: workspace.notes.filter((n) => sameAnchor(n.anchor, anchor)),
    comments: commentsForAnchor(workspace.comments, anchor),
  };
}
/** A worker-owned conversation survives unmounting its isolated UI frame. */
export function inlineSession(
  context: PullContext,
  rpc: Rpc,
  options: Options = {},
) {
  let loaded: Promise<Omit<InlineContext, "resuming" | "runs">> | undefined;
  const runIds = new Set<string>();
  const runs = new Map<string, AiRun>();
  const notes = new Map<string, Note>();
  let view = options.view;
  let opened = false;
  let writes = Promise.resolve();
  const state = (): InlineState => ({
    notes: [...notes.values()],
    runs: [...runs.values()],
  });
  const changed = () => options.changed?.(state());
  const load = () =>
    (loaded ??= (async () => {
      const [workspace, bootstrap] = await Promise.all([
        rpc("open_pull", {
          repository: context.repository,
          number: context.number,
          refresh: !!context.commentUrl,
        }) as Promise<ReviewWorkspace>,
        rpc("bootstrap", {}) as Promise<Bootstrap>,
      ]);
      const anchor = inlineAnchor(workspace, context, options.anchor);
      if (!anchor)
        throw new Error(
          "This code could not be matched to the current PR. Refresh GitHub or open the full guide; no question was sent.",
        );
      const scoped = threadWorkspace(workspace, anchor);
      scoped.notes.forEach((note) => notes.set(note.id, note));
      return {
        context,
        workspace: scoped,
        anchor,
        preference: bootstrap.modelPreference,
        theme: bootstrap.settings.theme,
      };
    })().catch((error) => {
      loaded = undefined;
      throw error;
    }));
  return {
    restore(collapsed: boolean) {
      // A page reload restores the default, while virtualization keeps manual folds.
      view = { draft: view?.draft ?? null, collapsed };
      opened = true;
    },
    acceptsEvent: (event: { event?: string; payload?: { runId?: string } }) =>
      event.event === "bridge-disconnected" ||
      (event.event === "codex-run" && runIds.has(event.payload?.runId ?? "")),
    event(event: RunEvent) {
      const run = runs.get(event.runId);
      if (!run || run.snapshotId !== event.snapshotId) return;
      runs.set(
        run.id,
        event.phase === "stream"
          ? {
              ...run,
              phase: "working",
              stream: (run.stream + event.text).slice(-512000),
            }
          : {
              ...run,
              phase: event.phase === "queued" ? "queued" : "working",
              text: event.text,
            },
      );
      changed();
    },
    async invoke(command: string, args: Record<string, unknown>) {
      if (command === "inline_context") {
        const info = await load();
        const resuming = opened || !!view;
        opened = true;
        return {
          ...info,
          workspace: { ...info.workspace, notes: [...notes.values()] },
          view,
          resuming,
          runs: [...runs.values()],
        };
      }
      if (
        ![
          "save_inline_view",
          "dismiss_inline_run",
          "save_note",
          "ask_codex",
          "cancel_codex",
          "open_saved_review",
        ].includes(command)
      )
        throw new Error(
          "This action is only available in the full Diff City review.",
        );
      const info = await load();
      const snapshotId = info.workspace.snapshot.id;
      if (command === "save_inline_view") {
        const next = args.view as InlineView | undefined;
        if (
          !next ||
          typeof next.collapsed !== "boolean" ||
          (next.draft !== null &&
            (!next.draft ||
              typeof next.draft.body !== "string" ||
              next.draft.body.length > 1000000 ||
              (next.draft.noteId !== null &&
                notes.get(next.draft.noteId)?.role !== "user")))
        )
          throw new Error("Invalid inline draft");
        view = {
          collapsed: next.collapsed,
          draft: next.draft && {
            noteId: next.draft.noteId,
            body: next.draft.body,
          },
        };
        const saved = view;
        writes = writes.catch(() => {}).then(() => options.persist?.(saved));
        await writes;
        return;
      }
      if (command === "dismiss_inline_run") {
        const run = runs.get(String(args.runId));
        if (run && ["error", "cancelled"].includes(run.phase)) {
          runs.delete(run.id);
          changed();
        }
        return;
      }
      if (command === "cancel_codex") {
        if (!runIds.has(String(args.runId)))
          throw new Error("Unknown inline run");
        return rpc(command, { runId: args.runId });
      }
      if (command === "save_note") {
        const note = args.note as Note | undefined;
        if (
          !note ||
          note.snapshotId !== snapshotId ||
          !sameAnchor(note.anchor, info.anchor) ||
          note.role !== "user" ||
          note.publishedUrl ||
          (note.id &&
            (notes.get(note.id)?.role !== "user" ||
              notes.get(note.id)?.publishedUrl)) ||
          (note.parentId && !notes.has(note.parentId))
        )
          throw new Error("Invalid inline note context");
        if (note.githubDraft && info.anchor.textSelection)
          throw new Error("Text selections are AI-only.");
        const saved = (await rpc(command, {
          note: { ...note, anchor: info.anchor },
        })) as Note;
        notes.set(saved.id, saved);
        changed();
        return saved;
      }
      if (args.snapshotId !== snapshotId)
        throw new Error("Invalid inline snapshot");
      if (command === "open_saved_review") {
        const saved = threadWorkspace(
          (await rpc(command, { snapshotId })) as ReviewWorkspace,
          info.anchor,
        );
        saved.notes.forEach((note) => notes.set(note.id, note));
        return { ...saved, notes: [...notes.values()] };
      }
      const question = notes.get(String(args.noteId));
      if (
        question?.role !== "user" ||
        typeof args.runId !== "string" ||
        !args.runId ||
        runIds.has(args.runId)
      )
        throw new Error("Save the inline question before asking AI");
      const runId = args.runId;
      runIds.add(runId);
      runs.set(runId, {
        id: runId,
        snapshotId,
        kind: "question",
        question,
        preference: (args.preference as ModelPreference) ?? info.preference,
        access: "limited",
        phase: "queued",
        text: "Waiting for an AI slot…",
        stream: "",
      });
      changed();
      try {
        const reply = (await rpc(command, {
          snapshotId,
          noteId: args.noteId,
          runId,
          preference: args.preference,
          access: "limited",
        })) as { answer: Note; draft?: Note | null };
        for (const note of [reply.answer, reply.draft])
          if (note && sameAnchor(note.anchor, info.anchor))
            notes.set(note.id, note);
        runs.delete(runId);
        changed();
        return reply;
      } catch (error) {
        runs.set(runId, {
          ...runs.get(runId)!,
          phase: "error",
          text: String(error),
          stream: "",
        });
        changed();
        throw error;
      }
    },
  };
}
