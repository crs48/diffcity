import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import {
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  GitPullRequestArrow,
  RotateCw,
  UserRoundCheck,
  Check,
  MessageSquareWarning,
  MessageSquareCheck,
  Eye,
  CircleCheck,
  CircleX,
  Clock3,
  CircleDashed,
  CircleMinus,
  CircleHelp,
  GitCompareArrows,
  ArrowDownToLine,
  LockKeyhole,
  Webhook,
  TriangleAlert,
  FolderGit2,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import type { PullRequest } from "../lib/api";
import { completedAt, pullPinId } from "../lib/inbox";
import {
  pullSignals,
  relativePullTime,
  type PullSignal,
} from "../lib/pull-status";
import { PinToggle } from "../ui/PinToggle";
import { PullGuideButtons, type PullGuideActions } from "./PullGuideButtons";

const lifecycleIcons = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
};
const signalIcons = {
  requested: GitPullRequestArrow,
  requestedAgain: RotateCw,
  assigned: UserRoundCheck,
  approved: Check,
  changes: MessageSquareWarning,
  reviewed: MessageSquareCheck,
  awaiting: Eye,
  passed: CircleCheck,
  failed: CircleX,
  pending: Clock3,
  expected: CircleDashed,
  noChecks: CircleMinus,
  unknownChecks: CircleHelp,
  conflicts: GitCompareArrows,
  behind: ArrowDownToLine,
  blocked: LockKeyhole,
  mergeable: GitMerge,
  hooks: Webhook,
  unstable: TriangleAlert,
};
function SignalBadge({ signal }: { signal: PullSignal }) {
  const { t } = useTranslation();
  const Icon = signalIcons[signal.kind];
  return (
    <span className={`pull-signal signal-${signal.tone}`}>
      <Icon size={12} aria-hidden="true" />
      <span>{t(signal.label)}</span>
    </span>
  );
}

export function PullCard({
  pull: p,
  login,
  selected,
  muted,
  pinned,
  saving,
  onOpen,
  onPin,
  guides,
}: {
  pull: PullRequest;
  login: string;
  selected: boolean;
  muted: boolean;
  pinned: boolean;
  saving: boolean;
  onOpen: (pull: PullRequest) => void;
  onPin: (pull: PullRequest) => void;
  guides?: PullGuideActions;
}) {
  const { t, i18n } = useTranslation();
  const { lifecycle, badges, emphasis } = pullSignals(p, login);
  const Icon = lifecycleIcons[lifecycle.kind];
  const Overlay = emphasis ? signalIcons[emphasis.kind] : null;
  const date = p.state === "open" ? p.updatedAt : completedAt(p);
  const relative = date ? relativePullTime(date, i18n.language) : null;
  const dateLabel =
    p.state === "merged"
      ? "Merged {{time}}"
      : p.state === "closed"
        ? "Closed {{time}}"
        : "Updated {{time}}";
  return (
    <div className={`pull-card-row ${guides ? "has-guide-buttons" : ""}`}>
      <Button
        className={`pull-card ${muted ? "pull-muted" : ""} ${selected ? "active" : ""}`}
        aria-current={selected ? "true" : undefined}
        onPress={() => onOpen(p)}
      >
        <span className="pull-card-top">
          <span
            className={`pull-lifecycle-icon signal-${lifecycle.tone}`}
            aria-hidden="true"
          >
            <Icon size={20} strokeWidth={1.8} />
            {Overlay && emphasis && (
              <span className={`pull-icon-overlay signal-${emphasis.tone}`}>
                <Overlay size={11} strokeWidth={2.4} />
              </span>
            )}
          </span>
          <span className="pull-number">#{p.number}</span>
          <span className="pull-author" title={p.author}>
            <span>{p.author}</span>
          </span>
          <span className={`pull-lifecycle-label signal-${lifecycle.tone}`}>
            {t(lifecycle.label)}
          </span>
        </span>
        <strong>{p.title}</strong>
        <span className="pull-card-repo" title={p.repository}>
          <FolderGit2 size={12} aria-hidden="true" />
          <span>{p.repository}</span>
        </span>
        {badges.length > 0 && (
          <span className="pull-card-signals">
            {badges.map((badge) => (
              <SignalBadge key={badge.kind} signal={badge} />
            ))}
          </span>
        )}
        <span className="pull-card-footer">
          {p.headRef && p.baseRef && (
            <span
              className="pull-card-branches"
              title={`${p.headRef} → ${p.baseRef}`}
            >
              <GitBranch size={12} aria-hidden="true" />
              <span className="pull-head-branch">{p.headRef}</span>
              <ArrowRight size={11} aria-hidden="true" />
              <span className="sr-only">{t("into branch")}</span>
              <span className="pull-base-branch">{p.baseRef}</span>
            </span>
          )}
          {relative && date && (
            <time
              dateTime={date}
              title={new Date(date).toLocaleString(i18n.language)}
            >
              <span className="sr-only">
                {t(dateLabel, { time: relative })}
              </span>
              <span aria-hidden="true">{relative}</span>
            </time>
          )}
        </span>
        {p.changedFiles > 0 && (
          <span className="pull-card-stats">
            <span>
              <span className="sr-only">
                {t("{{added}} additions and {{removed}} deletions", {
                  added: p.additions,
                  removed: p.deletions,
                })}
              </span>
              <span className="diff-count-added" aria-hidden="true">
                +{p.additions.toLocaleString(i18n.language)}
              </span>{" "}
              <span className="diff-count-removed" aria-hidden="true">
                −{p.deletions.toLocaleString(i18n.language)}
              </span>
            </span>
            <span>{t("{{count}} files", { count: p.changedFiles })}</span>
          </span>
        )}
      </Button>
      {guides && <PullGuideButtons pull={p} actions={guides} />}
      <PinToggle
        id={pullPinId(p)}
        label={t(
          pinned ? "Unpin pull request {{name}}" : "Pin pull request {{name}}",
          { name: `${p.repository}#${p.number}` },
        )}
        pinned={pinned}
        disabled={saving}
        onPress={() => onPin(p)}
      />
    </div>
  );
}
