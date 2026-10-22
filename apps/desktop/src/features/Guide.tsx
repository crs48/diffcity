import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import { useMemo, useState } from "react";
import { FileCode2, GitBranch } from "lucide-react";
import { Diff } from "./Diff";
import { GuideFlow } from "./GuideFlow";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import type {
  Anchor,
  GuideAnnotation,
  ReviewProgress,
  ReviewWorkspace,
} from "../lib/api";
import { ReviewCode } from "./ReviewCode";
import { FileDiff } from "./FileDiff";

const NO_ANNOTATIONS: GuideAnnotation[] = [];

export function GuideView({
  workspace: w,
  selection,
  onSelect,
  onDiscuss,
  onProgress,
  onFinish,
  mode,
}: {
  workspace: ReviewWorkspace;
  selection: Anchor | null;
  onSelect: (a: Anchor) => void;
  onDiscuss: (a: Anchor) => void;
  onProgress: (p: ReviewProgress) => void;
  onFinish: () => void;
  mode: "guide" | "files" | "overview";
}) {
  const { t } = useTranslation();
  const [split, setSplit] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const hunks = useMemo(
    () =>
      new Map(
        w.snapshot.files.flatMap((file) =>
          file.hunks.map((hunk) => [hunk.id, { hunk, file }] as const),
        ),
      ),
    [w.snapshot.files],
  );
  const annotationsByHunk = useMemo(() => {
    const result = new Map<string, GuideAnnotation[]>();
    if (mode === "guide")
      for (const section of w.guide.sections)
        for (const note of section.annotations ?? []) {
          const notes = result.get(note.anchor.hunkId) ?? [];
          notes.push(note);
          result.set(note.anchor.hunkId, notes);
        }
    return result;
  }, [w.guide.sections, mode]);
  const comments = useMemo(
    () => w.comments.filter((c) => c.commit === w.snapshot.pull.head),
    [w.comments, w.snapshot.pull.head],
  );
  const renderHunk = (id: string) => {
    const entry = hunks.get(id);
    const hunk = entry?.hunk;
    return (
      hunk && (
        <Diff
          key={id}
          hunk={hunk}
          annotations={annotationsByHunk.get(id) ?? NO_ANNOTATIONS}
          file={entry?.file}
          selection={selection}
          onSelect={onSelect}
          onDiscuss={onDiscuss}
          notes={w.notes}
          comments={comments}
          split={split}
          snapshotId={w.snapshot.id}
          hideFileHeader
          hideContext
        />
      )
    );
  };
  const renderHunks = (ids: string[]) => {
    // Only group adjacent entries: the guide may revisit a file for a different concern.
    const groups = ids.reduce<
      Array<{ file: (typeof w.snapshot.files)[number]; ids: string[] }>
    >((result, id) => {
      const entry = hunks.get(id);
      if (!entry) return result;
      if (result.at(-1)?.file.path === entry.file.path)
        result.at(-1)!.ids.push(id);
      else result.push({ file: entry.file, ids: [id] });
      return result;
    }, []);
    return groups.map((group) => (
      <FileDiff
        key={group.ids[0]}
        file={group.file}
        hunks={group.ids.map((id) => hunks.get(id)!.hunk)}
        selection={selection}
        snapshotId={w.snapshot.id}
        split={split}
      >
        {group.ids.map((id) => renderHunk(id))}
      </FileDiff>
    ));
  };
  if (mode === "overview")
    return (
      <div className="reading-area overview">
        <div className="eyebrow">{t("PULL REQUEST")} </div>
        <h2>{w.snapshot.pull.title}</h2>
        <CommentMarkdown
          body={w.snapshot.pull.body || "No description provided."}
        />
        <div className="overview-grid">
          <div>
            <GitBranch size={18} />
            <h3>{t("Revision")} </h3>
            <p>
              {w.snapshot.pull.headRef} → {w.snapshot.pull.baseRef}
            </p>
            <code>{w.snapshot.pull.head.slice(0, 8)}</code>
          </div>
          <div>
            <FileCode2 size={18} />
            <h3>{t("Changes")} </h3>
            <p>{t("{{count}} files", { count: w.snapshot.files.length })}</p>
            <span className="added">+{w.snapshot.pull.additions}</span>{" "}
            <span className="removed">−{w.snapshot.pull.deletions}</span>
          </div>
        </div>
        <h3>{t("GitHub discussion")} </h3>
        {w.comments.length ? (
          w.comments.map((c) => (
            <article className="remote-comment" key={c.id}>
              <strong>{c.author}</strong>
              <CommentMarkdown body={c.body} />
              {c.path && (
                <code>
                  {c.path}:{c.line}
                </code>
              )}
            </article>
          ))
        ) : (
          <p className="muted">{t("No GitHub comments yet.")} </p>
        )}
      </div>
    );
  if (mode === "files")
    return (
      <ReviewCode
        files={w.snapshot.files}
        onSelect={onSelect}
        onReveal={() => setFileQuery("")}
      >
        <div className="reading-area">
          <div className="file-tools">
            <input
              aria-label={t("Find a file")}
              placeholder={t("Find a file…")}
              value={fileQuery}
              onChange={(e) => setFileQuery(e.target.value)}
            />
            <Button className="secondary" onPress={() => setSplit(!split)}>
              {split ? t("Unified view") : t("Split view")}
            </Button>
          </div>
          {w.snapshot.files
            .filter((f) =>
              f.path.toLowerCase().includes(fileQuery.toLowerCase()),
            )
            .map((f) => (
              <div key={f.path} className="file-group">
                {renderHunks(f.hunks.map((h) => h.id))}
                {f.unavailable && (
                  <div className="callout">
                    <FileCode2 size={16} />
                    <div>
                      <strong>
                        {f.previousPath && <>{f.previousPath} → </>}
                        {f.path} · {t(f.status)}
                      </strong>
                      <p>{f.unavailable}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      </ReviewCode>
    );
  return (
    <ReviewCode
      files={w.snapshot.files}
      onSelect={onSelect}
      onReveal={() => setFileQuery("")}
    >
      <GuideFlow
        key={w.guide.id ?? w.guide.generatedAt}
        workspace={w}
        selection={selection}
        onDiscuss={onDiscuss}
        onProgress={onProgress}
        onFinish={onFinish}
        renderHunks={renderHunks}
        split={split}
        onSplit={() => setSplit(!split)}
      />
    </ReviewCode>
  );
}
