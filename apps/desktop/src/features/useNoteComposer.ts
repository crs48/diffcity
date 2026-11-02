import { useCallback, useRef, useState } from "react";
import { api, type Anchor, type Note } from "../lib/api";
import { newNote } from "../lib/review";
import { sameAnchor } from "../lib/selection";

// Workspace-owned drafts survive collapsing/virtualizing an editor. Only the
// editor subscribes to text changes; the workspace observes lifecycle changes.
export function useNoteComposer(onNote: (note: Note) => void) {
  const [draft, setDraft] = useState<Pick<
    Note,
    "id" | "snapshotId" | "anchor"
  > | null>(null);
  const [focus, setFocus] = useState(0);
  const current = useRef<{ note: Note; savedBody: string | null } | null>(null);
  const listeners = useRef(new Set<() => void>());
  const subscribeDraft = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const getDraft = useCallback(() => current.current?.note ?? null, []);
  const notifyDraft = useCallback(() => {
    listeners.current.forEach((listener) => listener());
  }, []);
  const queue = useRef<Promise<Note | null>>(Promise.resolve(null));
  const flush = useCallback(() => {
    const entry = current.current;
    if (!entry?.note.body.trim()) return queue.current;
    const body = entry.note.body;
    queue.current = queue.current
      .catch(() => null)
      .then(async () => {
        if (entry.savedBody === body) return { ...entry.note, body };
        const note = await api.note({ ...entry.note, body });
        entry.note = { ...note, body: entry.note.body };
        entry.savedBody = body;
        onNote(note);
        if (current.current === entry) {
          setDraft({ ...entry.note });
          notifyDraft();
        }
        return note;
      });
    return queue.current;
  }, [onNote, notifyDraft]);
  const start = async (
    snapshotId: string,
    anchor: Anchor | null,
    editing?: Note,
    focusComposer = true,
  ) => {
    await flush();
    if (
      !editing &&
      current.current?.note.snapshotId === snapshotId &&
      sameAnchor(current.current.note.anchor, anchor)
    ) {
      setFocus((n) => (focusComposer ? n + 1 : 0));
      return;
    }
    const note = editing ?? newNote(snapshotId, anchor, "");
    current.current = { note, savedBody: editing ? note.body : null };
    setDraft(note);
    setFocus((n) => (focusComposer ? n + 1 : 0));
    notifyDraft();
  };
  const change = (body: string) => {
    if (!current.current) return;
    current.current.note = { ...current.current.note, body };
    notifyDraft();
  };
  const submit = async (
    onSubmit?: (note: Note) => Promise<void>,
    githubDraft = false,
  ) => {
    const entry = current.current;
    if (!entry?.note.body.trim()) return;
    if (githubDraft && entry.note.anchor?.textSelection)
      throw new Error("Text selections are AI-only.");
    let note = await flush();
    if (!note || current.current !== entry) return;
    if (githubDraft) {
      // Finish queued saves before converting the same note in place.
      note = await api.note({ ...note, githubDraft: true });
      entry.note = note;
      onNote(note);
      if (current.current !== entry) return;
    }
    const next = newNote(note.snapshotId, note.anchor, "");
    current.current = { note: next, savedBody: null };
    setDraft(next);
    notifyDraft();
    if (onSubmit) await onSubmit(note);
  };
  const close = async () => {
    await flush();
    current.current = null;
    setDraft(null);
    notifyDraft();
  };
  return {
    draft,
    focus,
    start,
    change,
    submit,
    close,
    flush,
    subscribeDraft,
    getDraft,
  };
}
export type NoteComposerState = ReturnType<typeof useNoteComposer>;
