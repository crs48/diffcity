import { useTranslation } from "react-i18next";
import "../i18n";
import { Button } from "react-aria-components";
import { useMemo, useState } from "react";
import { FileCode2, GitBranch } from "lucide-react";
import { Diff } from "./Diff";
import { GuideFlow } from "./GuideFlow";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import type { Anchor, ReviewProgress, ReviewWorkspace } from "../lib/api";

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
          file={entry?.file}
          selection={selection}
          onSelect={onSelect}
          onDiscuss={onDiscuss}
          notes={w.notes}
          comments={comments}
          split={split}
          snapshotId={w.snapshot.id}
        />
      )
    );
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
          .filter((f) => f.path.toLowerCase().includes(fileQuery.toLowerCase()))
          .map((f) => (
            <div key={f.path} className="file-group">
              {f.hunks.map((h) => renderHunk(h.id))}
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
    );
  return (
    <GuideFlow
      workspace={w}
      selection={selection}
      onDiscuss={onDiscuss}
      onProgress={onProgress}
      onFinish={onFinish}
      renderHunk={renderHunk}
      split={split}
      onSplit={() => setSplit(!split)}
    />
  );
}
