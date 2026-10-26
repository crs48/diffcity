import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GuideAnnotation } from "../lib/api";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { annotationLine } from "../lib/guideAnnotations";
import { noteTarget } from "../lib/guideIndex";

export function NoteDetails({ body }: { body: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <details
      className="code-note-details"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t("Read deeper")}</summary>
      {open && <CommentMarkdown body={body} />}
    </details>
  );
}

export function GuideCodeNotes({
  notes,
  open,
  onOpen,
  request,
  sectionId,
}: {
  notes: GuideAnnotation[];
  open: boolean;
  onOpen: (open: boolean) => void;
  request: { id: string; sequence: number } | null;
  sectionId: string;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (!open || !request) return;
    const target = [
      ...(root.current?.querySelectorAll<HTMLElement>("[data-note-detail]") ??
        []),
    ].find((element) => element.dataset.noteDetail === request.id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  }, [open, request]);
  return (
    <details
      className="chapter-code-notes"
      ref={root}
      open={open}
      onToggle={(e) => onOpen(e.currentTarget.open)}
    >
      <summary>
        {t("Read all code notes ({{count}})", { count: notes.length })}
      </summary>
      {open &&
        (notes.length ? (
          notes.map((note) => (
            <article
              key={note.id}
              data-note-detail={note.id}
              data-guide-index-target={noteTarget(sectionId, note.id)}
              tabIndex={-1}
            >
              <h3>{note.title}</h3>
              <code>
                {note.anchor.path} · {annotationLine(note, t("Old"), t("New"))}
              </code>
              <CommentMarkdown body={note.body} />
              {note.details && (
                <div className="code-note-rich">
                  <CommentMarkdown body={note.details} />
                </div>
              )}
            </article>
          ))
        ) : (
          <p className="muted">
            {t(
              "Useful code notes will appear here as the priority pass finishes each file.",
            )}
          </p>
        ))}
    </details>
  );
}
