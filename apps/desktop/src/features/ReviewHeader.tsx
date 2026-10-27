import { useTranslation } from "react-i18next";
import { GitPullRequest } from "lucide-react";
import type { ReviewWorkspace } from "../lib/api";

/** PR details belong to the document and scroll away with the review. */
export function ReviewHeader({ workspace }: { workspace: ReviewWorkspace }) {
  const { t } = useTranslation();
  const { pull, files } = workspace.snapshot;
  return (
    <div className="pr-heading">
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
    </div>
  );
}
