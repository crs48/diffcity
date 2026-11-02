import type {
  Anchor,
  Bootstrap,
  ModelPreference,
  Note,
  ReviewWorkspace,
} from "../../desktop/src/lib/api";
import { sameAnchor } from "../../desktop/src/lib/selection";
import { commentAnchor, lineAnchor, selectionAnchor } from "./context";
import type { PullContext } from "./protocol";

export type InlineContext = {
  context: PullContext;
  workspace: ReviewWorkspace;
  anchor: Anchor;
  preference: ModelPreference;
  theme: string;
};
type Rpc = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Embedded pages get a single verified conversation, never the full UI RPC. */
export function inlineSession(context: PullContext, rpc: Rpc) {
  let loaded: Promise<InlineContext> | undefined;
  const runs = new Set<string>();
  const notes = new Map<string, Note>();
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
      const anchor = context.selection
        ? selectionAnchor(workspace, context.selection)
        : context.line
          ? lineAnchor(workspace, context.line)
          : context.commentUrl
            ? commentAnchor(workspace, context.commentUrl)
            : null;
      if (!anchor)
        throw new Error(
          "This code could not be matched to the current PR. Refresh GitHub or open the full guide; no question was sent.",
        );
      for (const note of workspace.notes)
        if (sameAnchor(note.anchor, anchor)) notes.set(note.id, note);
      return {
        context,
        workspace,
        anchor,
        preference: bootstrap.modelPreference,
        theme: bootstrap.settings.theme,
      };
    })().catch((error) => {
      loaded = undefined;
      throw error;
    }));

  return {
    acceptsEvent: (event: { event?: string; payload?: { runId?: string } }) =>
      event.event === "bridge-disconnected" ||
      (event.event === "codex-run" && runs.has(event.payload?.runId ?? "")),
    async invoke(command: string, args: Record<string, unknown>) {
      if (command === "inline_context") return load();
      if (
        ![
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
      if (command === "cancel_codex") {
        if (!runs.has(String(args.runId)))
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
        // Canonical anchor only; text selections cannot become GitHub drafts.
        if (note.githubDraft && info.anchor.textSelection)
          throw new Error("Text selections are AI-only.");
        const saved = (await rpc(command, {
          note: { ...note, anchor: info.anchor },
        })) as Note;
        notes.set(saved.id, saved);
        return saved;
      }
      if (args.snapshotId !== snapshotId)
        throw new Error("Invalid inline snapshot");
      if (command === "open_saved_review") {
        const saved = (await rpc(command, { snapshotId })) as ReviewWorkspace;
        for (const note of saved.notes)
          if (sameAnchor(note.anchor, info.anchor)) notes.set(note.id, note);
        return saved;
      }
      if (
        notes.get(String(args.noteId))?.role !== "user" ||
        typeof args.runId !== "string" ||
        !args.runId ||
        runs.has(args.runId)
      )
        throw new Error("Save the inline question before asking AI");
      runs.add(args.runId);
      // A web page can overlay embedded controls: privileged tools/approvals and
      // publishing remain in the top-level extension UI, not an embedded frame.
      const reply = (await rpc(command, {
        snapshotId,
        noteId: args.noteId,
        runId: args.runId,
        preference: args.preference,
        access: "limited",
      })) as { answer: Note; draft?: Note | null };
      for (const note of [reply.answer, reply.draft])
        if (note && sameAnchor(note.anchor, info.anchor))
          notes.set(note.id, note);
      return reply;
    },
  };
}
