import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
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
  const [readingMode, setReadingMode] = useState(false);
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
          onDiscuss={onDiscuss}
          notes={w.notes}
          comments={w.comments.filter((c) => c.commit === w.snapshot.pull.head)}
          split={split}
          readingMode={readingMode}
        />
      )
    );
  };
  if (mode === "overview")
    return (
      <div className="reading-area overview">
        <div className="eyebrow">PULL REQUEST</div>
        <h2>{w.snapshot.pull.title}</h2>
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
        <div className="reading-controls">
          <label>
            <input
              type="checkbox"
              checked={readingMode}
              onChange={(e) => setReadingMode(e.target.checked)}
            />{" "}
            All lines for assistive reading
          </label>
        </div>
        <div className="file-tools">
          <input
            aria-label="Find a file"
            placeholder="Find a file…"
            value={fileQuery}
            onChange={(e) => setFileQuery(e.target.value)}
          />
          <Button className="secondary" onPress={() => setSplit(!split)}>
            {split ? "Unified" : "Split"} view
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
        <MenuTrigger>
          <Button
            className="outline-toggle"
            aria-label={`Review outline, step ${index + 1} of ${sections.length}`}
          >
            <span className="step-number">{index + 1}</span>
            <span>of {sections.length} steps</span>
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
          <Popover placement="bottom start" className="guide-outline">
            <Menu
              aria-label="Review steps"
              onAction={(id) => {
                const next = sections.find((s) => s.id === id);
                if (next) navigate(next);
              }}
            >
              {sections.map((s, i) => (
                <MenuItem
                  id={s.id}
                  key={s.id}
                  textValue={`${i + 1}. ${s.title}`}
                  className={i === index ? "selected" : ""}
                >
                  <span
                    className={`attention-dot ${s.attention}`}
                    aria-hidden="true"
                  />
                  <span className="outline-title">
                    <strong>
                      {i + 1}. {s.title}
                    </strong>
                    <small>
                      {labels[s.attention]} · {s.hunkIds.length} hunks
                      {s.hunkIds.length > 0 &&
                      s.hunkIds.every((id) => w.progress.reviewed.includes(id))
                        ? " · reviewed"
                        : ""}
                    </small>
                  </span>
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
        <div className="step-track">
          {sections.map((s, i) => (
            <Button
              key={s.id}
              aria-label={`Go to step ${i + 1}: ${s.title}, ${labels[s.attention]}`}
              aria-current={i === index ? "step" : undefined}
              className={`${s.attention} ${i === index ? "current" : ""} ${s.hunkIds.length && s.hunkIds.every((id) => w.progress.reviewed.includes(id)) ? "done" : ""}`}
              onPress={() => navigate(s)}
            />
          ))}
        </div>
        <Button
          className="icon-button"
          aria-label="Previous step"
          isDisabled={index === 0}
          onPress={() => navigate(sections[index - 1])}
        >
          <ArrowLeft size={17} />
        </Button>
        <Button
          className="icon-button"
          aria-label="Next step"
          isDisabled={index === sections.length - 1}
          onPress={() => navigate(sections[index + 1])}
        >
          <ArrowRight size={17} />
        </Button>
      </div>
      <p className="sr-only" role="status">
        Step {index + 1} of {sections.length}: {section.title}.{" "}
        {labels[section.attention]}.
      </p>
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
        <h2 className="section-title">{section.title}</h2>

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
            <Button
              className="secondary"
              onPress={() =>
                onProgress({
                  ...w.progress,
                  expanded: [...w.progress.expanded, section.id],
                })
              }
            >
              <Eye size={15} /> Expand all changes
            </Button>
            <Button
              className="text-button"
              onPress={() => mark("acknowledged", section)}
            >
              Acknowledge summary
            </Button>
          </div>
        ) : (
          <>
            <div className="reading-controls">
              <label>
                <input
                  type="checkbox"
                  checked={readingMode}
                  onChange={(e) => setReadingMode(e.target.checked)}
                />{" "}
                All lines for assistive reading
              </label>
            </div>
            <div className="code-toolbar">
              <span>
                <FileCode2 size={14} /> CODE CHANGES
              </span>
              <Button onPress={() => setSplit(!split)}>
                {split ? "Unified view" : "Split view"}
              </Button>
              <span className="muted">
                Drag line numbers · Shift-click or Shift + ↑/↓ for a range
              </span>
            </div>
            {section.hunkIds.map(renderHunk)}
          </>
        )}
        {section.findings.map((f, i) => (
          <Button
            className="finding"
            key={i}
            onPress={() => onDiscuss(f.anchor)}
          >
            <span className="badge high">{f.severity} finding</span>
            <strong>{f.title}</strong>
            <p>{f.body}</p>
            <code>
              {f.anchor.path}:{f.anchor.line}
            </code>
          </Button>
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
          <Button
            className={reviewed ? "reviewed-button" : "primary"}
            isDisabled={!section.hunkIds.length}
            onPress={() => mark("reviewed", section)}
          >
            <Check size={16} />
            {reviewed ? "Code reviewed" : "Mark code reviewed"}
          </Button>
          <Button
            className="secondary"
            onPress={() => mark("deferred", section)}
          >
            <ArrowDown size={15} /> Defer
          </Button>
          <div className="spacer" />
          {index < sections.length - 1 ? (
            <Button
              className="next-button"
              onPress={() => navigate(sections[index + 1])}
            >
              Next step <ArrowRight size={16} />
            </Button>
          ) : (
            <Button className="next-button" onPress={onFinish}>
              Finish review <ArrowRight size={16} />
            </Button>
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
