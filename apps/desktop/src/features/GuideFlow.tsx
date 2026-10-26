import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Eye,
  FileCode2,
  Flag,
  Sparkles,
  Tag,
} from "lucide-react";
import type {
  Anchor,
  GuideSection,
  ReviewProgress,
  ReviewWorkspace,
} from "../lib/api";
import { countProgress, labels, sectionHasDiscussion } from "../lib/review";
import { anchorKey } from "../lib/diffRows";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { useConversation } from "./conversation";
import { useGuideScroll } from "./useGuideScroll";

import { GuideMargin } from "./GuideMargin";
import { orderedAnnotations } from "../lib/guideAnnotations";
import { GuideCodeNotes } from "./GuideCodeNotes";
import { Walkthrough } from "./Walkthrough";
import { NamingDecisions, NamingOverview } from "./GuideNaming";
import { GuideIndex } from "./GuideIndex";
import { GuideJumpContext, useGuideJump, type GuideJump } from "./guideJump";
import { GUIDE_OVERVIEW, findingTarget } from "../lib/guideIndex";

const OVERVIEW = GUIDE_OVERVIEW;

type Props = {
  workspace: ReviewWorkspace;
  selection: Anchor | null;
  onDiscuss: (anchor: Anchor) => void;
  onProgress: (progress: ReviewProgress) => void;
  onFinish: () => void;
  renderHunks: (ids: string[]) => ReactNode;
  split: boolean;
  onSplit: () => void;
};
export function GuideFlow(props: Props) {
  const { workspace: w, onProgress, onFinish } = props;
  const { t } = useTranslation();
  const conversation = useConversation();
  const root = useRef<HTMLDivElement>(null);
  const [indexJump, setIndexJump] = useState<GuideJump | null>(null);
  const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(
    null,
  );
  useLayoutEffect(() => {
    setNavigationHost(
      (
        root.current?.closest(".review-tabs") ??
        root.current?.closest(".review-document")
      )?.querySelector<HTMLElement>("#review-guide-navigation") ?? null,
    );
  }, []);
  const sections = w.guide.sections;
  const index = sections.findIndex((s) => s.id === w.progress.activeSection);
  const navigate = useGuideScroll(
    root,
    [OVERVIEW, ...sections.map((s) => s.id)].join("/"),
    w.progress.activeSection ?? OVERVIEW,
    (id) =>
      onProgress({ ...w.progress, activeSection: id === OVERVIEW ? null : id }),
    !!navigationHost,
  );
  const counts = countProgress(w);
  useLayoutEffect(() => {
    if (!indexJump) return;
    const entry = indexJump.entry;
    if (entry.chat) {
      const body = root.current?.closest(".review-body");
      if (!body) return;
      const locate = () => {
        const messages = body.querySelector<HTMLElement>(
          ".discussion .messages",
        );
        const message = [
          ...(messages?.querySelectorAll<HTMLElement>(
            "[data-note-id], [data-remote-comment-id]",
          ) ?? []),
        ].find((el) =>
          entry.chat?.local
            ? el.dataset.noteId === entry.chat.local
            : el.dataset.remoteCommentId === entry.chat?.remote,
        );
        if (!message || !messages) return false;
        messages.scrollTop +=
          message.getBoundingClientRect().top -
          messages.getBoundingClientRect().top -
          12;
        message.tabIndex = -1;
        message.focus({ preventScroll: true });
        return true;
      };
      if (locate()) return;
      const observer = new MutationObserver(() => {
        if (locate()) observer.disconnect();
      });
      observer.observe(body, { childList: true, subtree: true });
      const timeout = setTimeout(() => observer.disconnect(), 5000);
      return () => {
        observer.disconnect();
        clearTimeout(timeout);
      };
    }
    if (entry.kind === "section" || entry.kind === "overview") {
      navigate(entry.sectionId);
      return;
    }
    navigate(entry.sectionId, () => {
      const target = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          "[data-guide-index-target]",
        ) ?? []),
      ].find((el) => el.dataset.guideIndexTarget === entry.target);
      if (!target) return null;
      const fileHeader = target
        .closest(".diff-file-group")
        ?.querySelector<HTMLElement>(".file-bar");
      return {
        element: target,
        inset: 16 + (fileHeader?.getBoundingClientRect().height ?? 0),
      };
    });
  }, [indexJump, navigate]);
  const navigation = (
    <nav
      className={`guide-navigation${navigationHost ? " docked" : ""}`}
      aria-label={t("Guide navigation")}
    >
      <MenuTrigger>
        <Button
          className="outline-toggle"
          aria-label={
            index < 0
              ? t("Review outline, overview")
              : t("Review outline, {{current}} of {{total}} sections", {
                  current: index + 1,
                  total: sections.length,
                })
          }
        >
          <span className="step-number">
            {index < 0 ? <BookOpen size={16} aria-hidden /> : index + 1}
          </span>{" "}
          <span>
            {index < 0 ? (
              t("Overview")
            ) : (
              <>
                {t("of")} {sections.length}{" "}
                <span className="section-count-label">{t("sections")}</span>
              </>
            )}
          </span>
          <ChevronDown size={14} aria-hidden />
        </Button>
        <Popover placement="bottom start" className="guide-outline">
          <Menu
            aria-label={t("Review outline")}
            onAction={(id) => {
              // React Aria first restores the menu trigger; then focus the destination heading.
              requestAnimationFrame(() => navigate(String(id)));
            }}
          >
            <MenuItem
              id={OVERVIEW}
              textValue={t("PR overview")}
              className={index < 0 ? "selected" : ""}
            >
              <BookOpen size={16} aria-hidden />
              <span className="outline-title">
                <strong>{t("PR overview")}</strong>
                <small>{t("The story of this change")}</small>
              </span>
            </MenuItem>
            {sections.map((s, i) => (
              <MenuItem
                id={s.id}
                key={s.id}
                textValue={`${i + 1}. ${s.title}`}
                className={i === index ? "selected" : ""}
              >
                <span className={`attention-dot ${s.attention}`} aria-hidden />
                <span className="outline-title">
                  <strong>
                    {i + 1}. {s.title}
                  </strong>
                  <small>
                    {t(labels[s.attention])} · {s.hunkIds.length} {t("hunks")}
                    {s.hunkIds.length > 0 &&
                    s.hunkIds.every((id) => w.progress.reviewed.includes(id))
                      ? ` · ${t("Code reviewed")}`
                      : ""}
                  </small>
                </span>
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
      <span className="guide-current-title" aria-hidden>
        {index < 0 ? w.snapshot.pull.title : sections[index].title}
      </span>
      <Button
        className="icon-button"
        aria-label={t("Previous section")}
        isDisabled={index < 0}
        onPress={() =>
          navigate(index === 0 ? OVERVIEW : sections[index - 1].id)
        }
      >
        <ArrowUp size={17} />
      </Button>
      <Button
        className="icon-button"
        aria-label={t("Next section")}
        isDisabled={index === sections.length - 1}
        onPress={() => navigate(sections[index + 1].id)}
      >
        <ArrowDown size={17} />
      </Button>
    </nav>
  );
  return (
    <GuideJumpContext.Provider value={indexJump}>
      <div className="guide-root" ref={root}>
        {navigationHost ? createPortal(navigation, navigationHost) : navigation}
        <GuideIndex
          workspace={w}
          root={root}
          activeSection={w.progress.activeSection ?? OVERVIEW}
          onJump={(entry) => {
            if (entry.chat) conversation?.openChat(entry.anchor ?? null, false);
            setIndexJump((previous) => ({
              entry,
              sequence: (previous?.sequence ?? 0) + 1,
            }));
          }}
        />
        <section
          className="guide-introduction"
          data-guide-section={OVERVIEW}
          aria-labelledby="guide-overview-heading"
        >
          <div className="eyebrow">{t("The story of this change")}</div>
          <h2 id="guide-overview-heading" tabIndex={-1}>
            {t("PR overview")}
          </h2>
          <NamingOverview sections={sections} onNavigate={navigate} />
          {w.guide.source === "provisional" ? (
            <>
              <h3>{t("Guide not generated yet")}</h3>
              <p>
                {t(
                  "Choose New guide for an overview of the changes and a guided walkthrough. The PR description below is provided by its author.",
                )}
              </p>
              <CommentMarkdown
                body={w.snapshot.pull.body || t("No description provided.")}
                diagrams
              />
            </>
          ) : (
            <CommentMarkdown
              body={
                w.guide.summary ||
                w.snapshot.pull.body ||
                t("No description provided.")
              }
              diagrams
            />
          )}
          {["codex", "claude"].includes(w.guide.source) &&
            w.guide.policyVersion < 3 && (
              <p className="muted">
                {t(
                  "This saved guide uses the earlier brief format. Choose New guide for a full overview with diagrams where helpful.",
                )}
              </p>
            )}
          {["codex", "claude"].includes(w.guide.source) &&
            w.guide.policyVersion < 4 && (
              <p className="muted">
                {t(
                  "Choose New guide to add line-by-line explanations of the important passages.",
                )}
              </p>
            )}
          {["codex", "claude"].includes(w.guide.source) &&
            w.guide.policyVersion < 5 && (
              <p className="muted">
                {t(
                  "Choose New guide to highlight database names, API contracts, and important naming decisions.",
                )}
              </p>
            )}
          {w.guide.policyVersion >= 5 &&
            !sections.some((s) => s.namingDecisions?.length) && (
              <p className="muted">
                {t(
                  "No consequential naming decisions were identified in the supplied code.",
                )}
              </p>
            )}
          {sections.length > 0 && (
            <Button
              className="secondary overview-start"
              onPress={() => navigate(sections[0].id)}
            >
              {t("Start code walkthrough")} <ArrowDown size={16} aria-hidden />
            </Button>
          )}
        </section>
        {!sections.length && (
          <div className="empty">
            <FileCode2 size={30} />
            <h2>{t("No reviewable text changes")}</h2>
            <p>
              {t("Check the PR overview for details and capture limitations.")}
            </p>
          </div>
        )}
        <div className="guide-chapters">
          {sections.map((section, i) => (
            <GuideChapter
              {...props}
              key={section.id}
              section={section}
              index={i}
              total={sections.length}
            />
          ))}
        </div>
        <footer className="guide-completion">
          <Button className="primary" onPress={onFinish}>
            <Check size={15} />
            {t("Finish review")}
          </Button>
          <div className="guide-footer">
            <Sparkles size={14} />
            <span>
              {["codex", "claude"].includes(w.guide.source)
                ? `Reviewed with ${w.guide.model}`
                : w.guide.source === "sample"
                  ? "Sample guide · illustrative data"
                  : "Create a guide with Codex or Claude"}
            </span>
            <span>
              {counts.reviewed}/{counts.total} {t("hunks reviewed ·")}{" "}
              {counts.acknowledged} {t("summaries acknowledged")}
            </span>
          </div>
          {w.guide.limitations.length > 0 && (
            <details className="limitations">
              <summary>
                {t("Coverage and limitations (")} {w.guide.limitations.length})
              </summary>
              {w.guide.limitations.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </details>
          )}
        </footer>
      </div>
    </GuideJumpContext.Provider>
  );
}

function GuideChapter({
  workspace: w,
  section: s,
  index,
  total,
  selection,
  onDiscuss,
  onProgress,
  renderHunks,
  split,
  onSplit,
}: Props & {
  section: GuideSection;
  index: number;
  total: number;
}) {
  const { t } = useTranslation();
  const conversation = useConversation();
  const jump = useGuideJump(s.hunkIds);
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteRequest, setNoteRequest] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const readNote = (id: string) => {
    setNotesOpen(true);
    setNoteRequest((request) => ({
      id,
      sequence: (request?.sequence ?? 0) + 1,
    }));
  };
  useLayoutEffect(() => {
    if (jump?.entry.kind === "note") setNotesOpen(true);
  }, [jump]);
  const selected =
    selection && s.hunkIds.includes(selection.hunkId) ? selection : null;
  const editing = conversation?.inline.draft?.anchor;
  const editingHere = editing && s.hunkIds.includes(editing.hunkId);
  const expansionKey = `${editingHere ? conversation?.inline.focus : 0}/${selected ? anchorKey(selected) : ""}/${jump?.sequence ?? 0}`;
  const expanded =
    collapsedAt !== expansionKey &&
    (!s.foldable ||
      w.progress.expanded.includes(s.id) ||
      sectionHasDiscussion(s, w) ||
      !!selected ||
      !!jump ||
      !!editingHere);
  const reviewed =
    s.hunkIds.length > 0 &&
    s.hunkIds.every((id) => w.progress.reviewed.includes(id));
  const files = w.snapshot.files.filter(
    (f) =>
      s.unavailablePaths.includes(f.path) ||
      f.hunks.some((h) => s.hunkIds.includes(h.id)),
  );
  const annotations = useMemo(
    () =>
      orderedAnnotations(
        s,
        w.snapshot.files.flatMap((f) => f.hunks),
      ),
    [s, w.snapshot.files],
  );
  const titleId = `guide-title-${s.id}`;
  const contextId = `guide-context-${s.id}`;
  const mark = (kind: "reviewed" | "acknowledged" | "deferred") =>
    onProgress({
      ...w.progress,
      [kind]: [...new Set([...w.progress[kind], ...s.hunkIds])],
      ...(kind === "reviewed"
        ? {
            deferred: w.progress.deferred.filter(
              (id) => !s.hunkIds.includes(id),
            ),
          }
        : {}),
    });
  return (
    <section
      className="guide-chapter"
      data-guide-section={s.id}
      aria-labelledby={titleId}
    >
      <GuideMargin notes={annotations} title={s.title} onRead={readNote}>
        <div className="chapter-number">
          {t("Section {{current}} of {{total}}", { current: index + 1, total })}
        </div>
        <div className="section-meta">
          <span className={`badge ${s.attention}`}>
            {s.attention === "high" && <Flag size={12} />}{" "}
            {t(labels[s.attention])}
          </span>
          <span>
            {s.assessed
              ? w.guide.source === "sample"
                ? t("Sample assessment")
                : t("Assessed by AI")
              : t("Provisional")}
          </span>
        </div>
        <h2 id={titleId} className="section-title" tabIndex={-1}>
          {s.title}
        </h2>
        <div className="annotation-summary">
          <CommentMarkdown body={s.summary} />
        </div>
        <div className="annotation-reason">
          <strong>
            {t(
              s.attention === "high"
                ? "Why this needs your attention"
                : "Review context",
            )}
          </strong>
          <CommentMarkdown body={s.reason} />
        </div>
        <p className="annotation-counts">
          {t("{{count}} files", { count: files.length })} ·{" "}
          {t("{{count}} hunks", { count: s.hunkIds.length })}
        </p>
        {!!s.namingDecisions?.length && (
          <p className="naming-section-cue">
            <Tag size={14} aria-hidden />
            {t("{{count}} names to confirm", {
              count: s.namingDecisions.length,
            })}
          </p>
        )}
        <Button
          className="text-button"
          aria-expanded={contextOpen}
          aria-controls={contextOpen ? contextId : undefined}
          onPress={() => setContextOpen(!contextOpen)}
        >
          {t(contextOpen ? "Hide walkthrough" : "Show walkthrough")}
          <ChevronDown size={14} />
        </Button>
      </GuideMargin>
      <div className="guide-code">
        <NamingDecisions section={s} onDiscuss={onDiscuss} />
        {contextOpen && <Walkthrough id={contextId} section={s} />}
        {annotations.length > 0 && (
          <GuideCodeNotes
            sectionId={s.id}
            notes={annotations}
            open={notesOpen}
            onOpen={setNotesOpen}
            request={noteRequest}
          />
        )}
        {!expanded ? (
          <div className="fold-card">
            <ChevronsUpDown size={23} />
            <h3>
              {t(
                s.foldable
                  ? "Routine changes, kept together"
                  : "Changes collapsed",
              )}
            </h3>
            <p>
              {s.hunkIds.length} {t("hunks ·")} {files.length} {t("files")}
            </p>
            <p className="muted">
              {t("Read the summary, or expand to inspect every line.")}
            </p>
            <Button
              className="secondary"
              onPress={() => {
                setCollapsedAt(null);
                onProgress({
                  ...w.progress,
                  expanded: [...new Set([...w.progress.expanded, s.id])],
                });
              }}
            >
              <Eye size={15} />
              {t("Expand all changes")}
            </Button>
            <Button
              className="text-button"
              onPress={() => mark("acknowledged")}
            >
              {t("Acknowledge summary")}
            </Button>
          </div>
        ) : (
          <>
            <div className="code-toolbar">
              <span>
                <FileCode2 size={14} />
                {t("CODE CHANGES")}
              </span>
              <Button onPress={onSplit}>
                {t(split ? "Unified view" : "Split view")}
              </Button>
              <Button onPress={() => setCollapsedAt(expansionKey)}>
                {t("Collapse changes")}
              </Button>
            </div>
            {renderHunks(s.hunkIds)}
          </>
        )}
        {s.findings.map((f, i) => (
          <Button
            className="finding"
            data-guide-index-target={findingTarget(s.id, i)}
            key={i}
            onPress={() => onDiscuss(f.anchor)}
          >
            <span className="badge high">
              {f.severity} {t("finding")}
            </span>
            <strong>{f.title}</strong>
            <p>{f.body}</p>
            <code>
              {f.anchor.path}:{f.anchor.line}
            </code>
          </Button>
        ))}
        {s.unavailablePaths.map((path) => (
          <div className="callout" key={path}>
            <FileCode2 size={17} />
            <div>
              <strong>{path}</strong>
              <p>{files.find((f) => f.path === path)?.unavailable}</p>
            </div>
          </div>
        ))}
        <div className="section-actions">
          <Button
            className={reviewed ? "reviewed-button" : "primary"}
            isDisabled={!s.hunkIds.length}
            onPress={() => mark("reviewed")}
          >
            <Check size={16} />
            {t(reviewed ? "Code reviewed" : "Mark code reviewed")}
          </Button>
          <Button className="secondary" onPress={() => mark("deferred")}>
            <ArrowDown size={15} />
            {t("Defer")}
          </Button>
        </div>
      </div>
    </section>
  );
}
