import { Button } from "react-aria-components";
import {
  GitPullRequest,
  GitPullRequestDraft,
  GitMerge,
  GitPullRequestClosed,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PinToggle } from "../ui/PinToggle";
import type { PullRequest } from "../lib/api";
import { key } from "../lib/review";
import {
  completedAt,
  pinKey,
  pullPinId,
  inboxGroup,
  inboxGroups,
  reviewLabel,
} from "../lib/inbox";

export function PullList({
  pulls,
  selected,
  login,
  history,
  onOpen,
  pinned,
  saving,
  onPin,
}: {
  pulls: PullRequest[];
  selected?: PullRequest;
  login: string;
  history: boolean;
  onOpen: (pull: PullRequest) => void;
  pinned: ReadonlySet<string>;
  saving: boolean;
  onPin: (pull: PullRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const groups = [
    "Pinned pull requests",
    ...(history ? ["Closed and merged pull requests"] : inboxGroups),
  ];
  return groups.map((group) => {
    const items = pulls.filter((p) => {
      const isPinned = pinned.has(pinKey(p));
      if (group === "Pinned pull requests") return isPinned;
      return !isPinned && (history || inboxGroup(p, login) === group);
    });
    return items.length ? (
      <section key={group} aria-label={t(group)}>
        <h2>
          {t(group)}
          <span>{items.length}</span>
        </h2>
        {items.map((p) => {
          const muted = group === "Reviewed" || p.state !== "open";
          const Icon =
            p.state === "merged"
              ? GitMerge
              : p.state === "closed"
                ? GitPullRequestClosed
                : p.draft
                  ? GitPullRequestDraft
                  : GitPullRequest;
          const date = completedAt(p);
          return (
            <div className="pull-card-row" key={key(p)}>
              <Button
                className={`pull-card ${muted ? "pull-muted" : ""} ${selected && key(p) === key(selected) ? "active" : ""}`}
                aria-current={
                  selected && key(p) === key(selected) ? "true" : undefined
                }
                onPress={() => onOpen(p)}
              >
                <div>
                  <Icon size={15} aria-hidden="true" />
                  <span>#{p.number}</span>
                  <small>{t(reviewLabel(p, login))}</small>
                </div>
                <strong>{p.title}</strong>
                <footer>
                  {p.repository.split("/")[1]}
                  <span>·</span>
                  {p.author}
                </footer>
                {p.state !== "open" && date && (
                  <time dateTime={date}>
                    {new Date(date).toLocaleDateString(i18n.language, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                )}
              </Button>
              <PinToggle
                id={pullPinId(p)}
                label={t(
                  pinned.has(pinKey(p))
                    ? "Unpin pull request {{name}}"
                    : "Pin pull request {{name}}",
                  { name: `${p.repository}#${p.number}` },
                )}
                pinned={pinned.has(pinKey(p))}
                disabled={saving}
                onPress={() => onPin(p)}
              />
            </div>
          );
        })}
      </section>
    ) : null;
  });
}
