import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Eye,
  FileCode2,
  Flag,
  GitBranch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Diff } from "./Diff";
import { labels, countProgress, sectionHasDiscussion } from "../lib/review";
import type {
  Anchor,
  GuideSection,
  ReviewProgress,
  ReviewWorkspace,
} from "../lib/api";

export function GuideView({
  workspace: w,
  selection,
  onSelect,
  onProgress,
  onFinish,
  mode,
}: {
  workspace: ReviewWorkspace;
  selection: Anchor | null;
  onSelect: (a: Anchor) => void;
  onProgress: (p: ReviewProgress) => void;
  onFinish: () => void;
  mode: "guide" | "files" | "overview";
}) {
  const [outline, setOutline] = useState(false);
  const [split, setSplit] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const sections = w.guide.sections;
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === w.progress.activeSection),
  );
  const section = sections[index];
  const allHunks = w.snapshot.files.flatMap((f) => f.hunks);
  const counts = countProgress(w);
  const navigate = (s: GuideSection) => {
    onProgress({ ...w.progress, activeSection: s.id });
    setOutline(false);
  };
  const mark = (
    kind: "reviewed" | "acknowledged" | "deferred",
    s: GuideSection,
  ) => {
    const next = {
      ...w.progress,
      [kind]: [...new Set([...w.progress[kind], ...s.hunkIds])],
    };
    if (kind === "reviewed")
      next.deferred = next.deferred.filter((id) => !s.hunkIds.includes(id));
    onProgress(next);
  };
  const renderHunk = (id: string) => {
    const hunk = allHunks.find((h) => h.id === id);
    return (
      hunk && (
        <Diff
          key={id}
          hunk={hunk}
          selection={selection}
          onSelect={onSelect}
          notes={w.notes}
          comments={w.comments.filter((c) => c.commit === w.snapshot.pull.head)}
          split={split}
        />
      )
    );
  };
  if (mode === "overview")
    return (
      <div className="reading-area overview">
        <div className="eyebrow">PULL REQUEST</div>
        <h1>{w.snapshot.pull.title}</h1>
        <p className="intro">
          {w.snapshot.pull.body || "No description provided."}
        </p>
        <div className="overview-grid">
          <div>
            <GitBranch size={18} />
            <h3>Revision</h3>
            <p>
              {w.snapshot.pull.headRef} → {w.snapshot.pull.baseRef}
            </p>
            <code>{w.snapshot.pull.head.slice(0, 8)}</code>
          </div>
          <div>
            <FileCode2 size={18} />
            <h3>Changes</h3>
            <p>{w.snapshot.files.length} files</p>
            <span className="added">+{w.snapshot.pull.additions}</span>{" "}
            <span className="removed">−{w.snapshot.pull.deletions}</span>
          </div>
        </div>
        <h3>GitHub discussion</h3>
        {w.comments.length ? (
          w.comments.map((c) => (
            <article className="remote-comment" key={c.id}>
              <strong>{c.author}</strong>
              <p>{c.body}</p>
              {c.path && (
                <code>
                  {c.path}:{c.line}
                </code>
              )}
            </article>
          ))
        ) : (
          <p className="muted">No GitHub comments yet.</p>
        )}
      </div>
    );
  if (mode === "files")
    return (
      <div className="reading-area">
        <div className="file-tools">
          <input
            aria-label="Find a file"
            placeholder="Find a file…"
            value={fileQuery}
            onChange={(e) => setFileQuery(e.target.value)}
          />
          <button className="secondary" onClick={() => setSplit(!split)}>
            {split ? "Unified" : "Split"} view
          </button>
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
                    <strong>{f.path}</strong>
                    <p>{f.unavailable}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    );
  if (!section)
    return (
      <div className="empty">
        <FileCode2 size={30} />
        <h2>No reviewable text changes</h2>
        <p>Check the PR overview for details and capture limitations.</p>
      </div>
    );
  const expanded =
    !section.foldable ||
    w.progress.expanded.includes(section.id) ||
    sectionHasDiscussion(section, w) ||
    (!!selection && section.hunkIds.includes(selection.hunkId));
  const reviewed =
    section.hunkIds.length > 0 &&
    section.hunkIds.every((id) => w.progress.reviewed.includes(id));
  return (
    <div className="guide-root">
      <div className="guide-navigation">
        <button className="outline-toggle" onClick={() => setOutline(!outline)}>
          <span className="step-number">{index + 1}</span>
          <span>of {sections.length} steps</span>
          <ChevronDown size={14} />
        </button>
        <div className="step-track">
          {sections.map((s, i) => (
            <button
              key={s.id}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              title={s.title}
              className={`${s.attention} ${i === index ? "current" : ""} ${s.hunkIds.length && s.hunkIds.every((id) => w.progress.reviewed.includes(id)) ? "done" : ""}`}
              onClick={() => navigate(s)}
            />
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="Previous step"
          disabled={index === 0}
          onClick={() => navigate(sections[index - 1])}
        >
          <ArrowLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Next step"
          disabled={index === sections.length - 1}
          onClick={() => navigate(sections[index + 1])}
        >
          <ArrowRight size={17} />
        </button>
      </div>
      {outline && (
        <div className="guide-outline">
          {sections.map((s, i) => (
            <button
              key={s.id}
              className={i === index ? "selected" : ""}
              onClick={() => navigate(s)}
            >
              <span className={`attention-dot ${s.attention}`} />
              <span className="outline-title">
                <strong>
                  {i + 1}. {s.title}
                </strong>
                <small>
                  {labels[s.attention]} · {s.hunkIds.length} hunks
                </small>
              </span>
              {s.hunkIds.length > 0 &&
                s.hunkIds.every((id) => w.progress.reviewed.includes(id)) && (
                  <Check size={15} />
                )}
            </button>
          ))}
        </div>
      )}
      <div className="reading-area" key={section.id}>
        <div className="section-meta">
          <span className={`badge ${section.attention}`}>
            {section.attention === "high" && <Flag size={12} />}{" "}
            {labels[section.attention]}
          </span>
          <span>{section.category}</span>
          <span className="meta-end">
            {section.assessed
              ? w.guide.source === "sample"
                ? "Sample assessment"
                : "Assessed by Codex"
              : "Provisional"}
          </span>
        </div>
        <h1 className="section-title">{section.title}</h1>
        <p className="intro">{section.summary}</p>
        <div
          className={`callout ${section.attention === "high" ? "attention-callout" : ""}`}
        >
          <ShieldAlert size={18} />
          <div>
            <strong>
              {section.attention === "high"
                ? "Why this needs your attention"
                : "Review context"}
            </strong>
            <p>{section.reason}</p>
          </div>
        </div>
        {section.questions.length > 0 && (
          <div className="review-questions">
            <span className="eyebrow">AS YOU REVIEW</span>
            {section.questions.map((q) => (
              <p key={q}>
                <span>↳</span> {q}
              </p>
            ))}
          </div>
        )}
        {!expanded ? (
          <div className="fold-card">
            <div className="fold-icon">
              <ChevronsUpDown size={23} />
            </div>
            <h3>Routine changes, kept together</h3>
            <p>
              {section.hunkIds.length} hunks ·{" "}
              {
                new Set(
                  allHunks
                    .filter((h) => section.hunkIds.includes(h.id))
                    .map((h) => h.path),
                ).size
              }{" "}
              files
            </p>
            <p className="muted">
              Read the summary, or expand to inspect every line.
            </p>
            <button
              className="secondary"
              onClick={() =>
                onProgress({
                  ...w.progress,
                  expanded: [...w.progress.expanded, section.id],
                })
              }
            >
              <Eye size={15} /> Expand all changes
            </button>
            <button
              className="text-button"
              onClick={() => mark("acknowledged", section)}
            >
              Acknowledge summary
            </button>
          </div>
        ) : (
          <>
            <div className="code-toolbar">
              <span>
                <FileCode2 size={14} /> CODE CHANGES
              </span>
              <button onClick={() => setSplit(!split)}>
                {split ? "Unified view" : "Split view"}
              </button>
              <span className="muted">
                Select a line to discuss · Shift-click for a range
              </span>
            </div>
            {section.hunkIds.map(renderHunk)}
          </>
        )}
        {section.findings.map((f, i) => (
          <button
            className="finding"
            key={i}
            onClick={() => onSelect(f.anchor)}
          >
            <span className="badge high">{f.severity} finding</span>
            <strong>{f.title}</strong>
            <p>{f.body}</p>
            <code>
              {f.anchor.path}:{f.anchor.line}
            </code>
          </button>
        ))}
        {section.unavailablePaths.map((path) => (
          <div className="callout" key={path}>
            <FileCode2 size={17} />
            <div>
              <strong>{path}</strong>
              <p>
                {w.snapshot.files.find((f) => f.path === path)?.unavailable}
              </p>
            </div>
          </div>
        ))}
        <div className="section-actions">
          <button
            className={reviewed ? "reviewed-button" : "primary"}
            disabled={!section.hunkIds.length}
            onClick={() => mark("reviewed", section)}
          >
            <Check size={16} />
            {reviewed ? "Code reviewed" : "Mark code reviewed"}
          </button>
          <button
            className="secondary"
            onClick={() => mark("deferred", section)}
          >
            <ArrowDown size={15} /> Defer
          </button>
          <div className="spacer" />
          {index < sections.length - 1 ? (
            <button
              className="next-button"
              onClick={() => navigate(sections[index + 1])}
            >
              Next step <ArrowRight size={16} />
            </button>
          ) : (
            <button className="next-button" onClick={onFinish}>
              Finish review <ArrowRight size={16} />
            </button>
          )}
        </div>
        <div className="guide-footer">
          <Sparkles size={14} />
          <span>
            {w.guide.source === "codex"
              ? `Reviewed with ${w.guide.model}`
              : w.guide.source === "sample"
                ? "Sample guide · illustrative data"
                : "Run Codex for a guided code review"}
          </span>
          <span>
            {counts.reviewed}/{counts.total} hunks reviewed ·{" "}
            {counts.acknowledged} summaries acknowledged
          </span>
        </div>
        {w.guide.limitations.length > 0 && (
          <details className="limitations">
            <summary>
              Coverage and limitations ({w.guide.limitations.length})
            </summary>
            {w.guide.limitations.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
