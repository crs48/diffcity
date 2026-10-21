import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Anchor, type Note } from "../lib/api";
import { newNote } from "../lib/review";
import { sameAnchor } from "../lib/selection";

// Workspace-owned state survives navigation and collapsing an editor.
export function useNoteComposer(
  onNote: (note: Note) => void,
  onError: (error: unknown) => void,
) {
  const [draft, setDraft] = useState<Note | null>(null);
  const [saved, setSaved] = useState(false);
  const [focus, setFocus] = useState(0);
  const current = useRef<{ note: Note; savedBody: string | null } | null>(null);
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
          setSaved(entry.note.body === body);
        }
        return note;
      });
    return queue.current;
  }, [onNote]);
  useEffect(() => {
    if (!draft?.body.trim() || saved) return;
    const timer = setTimeout(() => void flush().catch(onError), 400);
    return () => clearTimeout(timer);
  }, [draft?.body, saved, flush, onError]);
  const start = async (
    snapshotId: string,
    anchor: Anchor | null,
    editing?: Note,
  ) => {
    await flush();
    if (
      !editing &&
      current.current?.note.snapshotId === snapshotId &&
      sameAnchor(current.current.note.anchor, anchor)
    ) {
      setFocus((n) => n + 1);
      return;
    }
    const note = editing ?? newNote(snapshotId, anchor, "");
    current.current = { note, savedBody: editing ? note.body : null };
    setDraft(note);
    setSaved(!!editing);
    setFocus((n) => n + 1);
  };
  const change = (body: string) => {
    if (!current.current) return;
    current.current.note = { ...current.current.note, body };
    setDraft(current.current.note);
    setSaved(current.current.savedBody === body);
  };
  const submit = async (onSubmit?: (note: Note) => Promise<void>) => {
    const entry = current.current;
    if (!entry?.note.body.trim()) return;
    const note = await flush();
    if (!note || current.current !== entry) return;
    const next = newNote(note.snapshotId, note.anchor, "");
    current.current = { note: next, savedBody: null };
    setDraft(next);
    setSaved(false);
    if (onSubmit) await onSubmit(note);
  };
  const close = async () => {
    await flush();
    current.current = null;
    setDraft(null);
    setSaved(false);
  };
  return { draft, saved, focus, start, change, submit, close, flush };
}
export type NoteComposerState = ReturnType<typeof useNoteComposer>;
