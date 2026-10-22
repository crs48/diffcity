import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "react-aria-components";
import { GitPullRequest, Sparkles } from "lucide-react";
import type { ReviewWorkspace } from "../lib/api";

/** Keep scroll-driven changes local so the review document does not rerender. */
export function ReviewHeader({
  workspace,
  viewport,
  disabled,
  onAnalyze,
}: {
  workspace: ReviewWorkspace;
  viewport: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  onAnalyze: () => void;
}) {
  const { t } = useTranslation();
  const header = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = header.current;
    const scroll = viewport.current;
    if (!element || !scroll) return;
    let collapsed = false;
    let expandedHeight = element.offsetHeight;
    let frame = 0;
    const update = () => {
      frame = 0;
      // The compact header is 48px tall. Reserve enough scroll distance that
      // the larger viewport cannot clamp a short review back to the top and
      // repeatedly expand/collapse the header. A separate exit threshold avoids jitter.
      const collapseAt = Math.max(64, expandedHeight - 48 + 32);
      const next = collapsed
        ? scroll.scrollTop > 16
        : scroll.scrollTop > collapseAt;
      if (next !== collapsed) {
        collapsed = next;
        setCompact(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(() => {
      if (!collapsed) expandedHeight = element.offsetHeight;
      schedule();
    });
    resize.observe(element);
    scroll.addEventListener("scroll", schedule, { passive: true });
    schedule(); // Include restored guide positions and section jumps.
    return () => {
      resize.disconnect();
      scroll.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [viewport]);
  const { pull, files } = workspace.snapshot;
  return (
    <div className="pr-heading" data-compact={compact} ref={header}>
      <div>
        <div className="eyebrow">
          <GitPullRequest size={13} />
          {pull.author} <span>·</span> {workspace.checks}
        </div>
        <h1 title={pull.title}>{pull.title}</h1>
        <div className="pr-meta">
          <span>{t("{{count}} files", { count: files.length })}</span>
          <span className="added">+{pull.additions}</span>
          <span className="removed">−{pull.deletions}</span>
          <span className="mono">{pull.head.slice(0, 8)}</span>
          {workspace.guide.source === "sample" && (
            <span className="badge">{t("Sample")}</span>
          )}
        </div>
      </div>
      <Button
        className="primary analyze-button"
        isDisabled={disabled}
        onPress={onAnalyze}
      >
        <Sparkles size={15} />
        <span>{t("New guide")}</span>
      </Button>
    </div>
  );
}
