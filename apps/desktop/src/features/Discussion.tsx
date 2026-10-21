import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Check, Github, MessageSquare, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, type Anchor, type Note, type ReviewWorkspace } from "../lib/api";
import { newNote } from "../lib/review";
export type DiscussionHandle = { flush: () => Promise<Note | null> };

export const Discussion = forwardRef<
  DiscussionHandle,
  {
    workspace: ReviewWorkspace;
    selection: Anchor | null;
    onNote: (n: Note) => void;
    onAsk: (n: Note) => Promise<void>;
    onClose: () => void;
    onError: (e: unknown) => void;
    busy: boolean;
    stream: string;
  }
>(function Discussion(
  { workspace: w, selection, onNote, onAsk, onClose, onError, busy, stream },
  ref,
) {
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const latest = useRef(newNote(w.snapshot.id, selection, ""));
  const queue = useRef<Promise<Note | null>>(Promise.resolve(null));
  const flush = useCallback(() => {
    const text = latest.current.body;
    if (!text.trim()) return Promise.resolve(null);
    queue.current = queue.current
      .catch(() => null)
      .then(async () => {
        const pending = { ...latest.current, body: text };
        const note = await api.note(pending);
        latest.current = { ...note, body: latest.current.body };
        onNote(note);
        if (latest.current.body === text) setSaved(true);
        return note;
      });
    return queue.current;
  }, [onNote]);
  useImperativeHandle(ref, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!body.trim()) return;
    const timer = setTimeout(() => {
      void flush().catch(onError);
    }, 400);
    return () => clearTimeout(timer);
  }, [body, flush, onError]);
  const saveAndReset = async (ask: boolean) => {
    try {
      const note = await flush();
      if (!note) return;
      latest.current = newNote(w.snapshot.id, selection, "");
      setBody("");
      setSaved(false);
      setEditingDraft(false);
      if (ask) await onAsk(note);
    } catch (e) {
      onError(e);
    }
  };
  const notes = w.notes.filter((n) =>
    selection ? n.anchor?.hunkId === selection.hunkId : !n.anchor,
  );
  const remote = w.comments.filter((c) =>
    selection ? c.path === selection.path : !c.path,
  );
  const toDraft = async (note: Note) => {
    try {
      const draft = await api.note({
        ...newNote(w.snapshot.id, note.anchor, note.body),
        githubDraft: true,
        parentId: note.id,
      });
      onNote(draft);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <aside className="discussion" aria-label="Review notes">
      <header>
        <MessageSquare size={16} />
        <strong>Review notes</strong>
        <button
          className="icon-button"
          aria-label="Close discussion"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="discussion-context">
        {selection ? (
          <>
            <code>{selection.path}</code>
            <span>
              {selection.side === "LEFT" ? "Old" : "New"} lines{" "}
              {selection.startLine}
              {selection.startLine !== selection.line && `–${selection.line}`}
            </span>
          </>
        ) : (
          <span>Pull request discussion</span>
        )}
      </div>
      <div className="messages">
        {!notes.length && !remote.length && (
          <div className="discussion-empty">
            <Sparkles size={22} />
            <h3>Think it through.</h3>
            <p>
              Ask about this code or leave yourself a note. Your conversation
              stays private until you prepare and publish a GitHub draft.
            </p>
          </div>
        )}
        {notes.map((n) => (
          <article className={`message ${n.role}`} key={n.id}>
            <div className="message-label">
              {n.role === "assistant" ? (
                <Sparkles size={12} />
              ) : (
                <MessageSquare size={12} />
              )}{" "}
              {n.role === "assistant" ? "Codex" : "You"}
              {n.githubDraft && <span className="draft-tag">GitHub draft</span>}
              {n.publishedUrl && <span className="draft-tag">Published</span>}
            </div>
            <ReactMarkdown
              components={{
                img: () => null,
                a: ({ children }) => <span>{children}</span>,
              }}
            >
              {n.body}
            </ReactMarkdown>
            {n.githubDraft && !n.publishedUrl && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await flush();
                    latest.current = { ...n };
                    setBody(n.body);
                    setEditingDraft(true);
                    setSaved(true);
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                Edit draft
              </button>
            )}
            {!n.githubDraft && !n.publishedUrl && (
              <button
                className="text-button"
                disabled={w.notes.some(
                  (other) =>
                    other.parentId === n.id &&
                    (other.githubDraft || !!other.publishedUrl),
                )}
                onClick={() => void toDraft(n)}
              >
                <Github size={12} /> Prepare GitHub draft
              </button>
            )}
          </article>
        ))}
        {remote.map((c) => (
          <article className="message remote" key={c.id}>
            <div className="message-label">
              <Github size={13} />
              {c.author} · GitHub
              {c.commit && c.commit !== w.snapshot.pull.head && (
                <span className="draft-tag">Earlier revision</span>
              )}
            </div>
            <p>{c.body}</p>
          </article>
        ))}
        {busy && stream && (
          <article className="message assistant">
            <div className="message-label">
              <Sparkles size={12} />
              Codex
            </div>
            <p>{stream}</p>
          </article>
        )}
      </div>
      <div className="composer">
        <textarea
          aria-label="Review note or Codex question"
          placeholder="Ask Codex or leave a private note…"
          value={body}
          onChange={(e) => {
            latest.current.body = e.target.value;
            setBody(e.target.value);
            setSaved(false);
          }}
        />
        <div className="composer-status">
          {saved ? (
            <>
              <Check size={12} /> Saved locally
            </>
          ) : editingDraft ? (
            "GitHub draft · not published"
          ) : (
            "Private · selected code only"
          )}
        </div>
        <div className="composer-actions">
          <button
            className="secondary"
            disabled={!body.trim()}
            onClick={() => void saveAndReset(false)}
          >
            {editingDraft ? "Save draft" : "Save note"}
          </button>
          <button
            className="primary"
            disabled={busy || editingDraft || !body.trim()}
            onClick={() => void saveAndReset(true)}
          >
            <Send size={13} /> Ask Codex
          </button>
        </div>
      </div>
    </aside>
  );
});
