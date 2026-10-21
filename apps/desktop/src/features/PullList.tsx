import { Button } from "react-aria-components";
import {
  GitPullRequest,
  GitPullRequestDraft,
  GitMerge,
  GitPullRequestClosed,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PullRequest } from "../lib/api";
import { key } from "../lib/review";
import {
  completedAt,
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
}: {
  pulls: PullRequest[];
  selected?: PullRequest;
  login: string;
  history: boolean;
  onOpen: (pull: PullRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const groups = history ? ["Closed and merged pull requests"] : inboxGroups;
  return groups.map((group) => {
    const items = history
      ? pulls
      : pulls.filter((p) => inboxGroup(p, login) === group);
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
            <Button
              className={`pull-card ${muted ? "pull-muted" : ""} ${selected && key(p) === key(selected) ? "active" : ""}`}
              aria-current={
                selected && key(p) === key(selected) ? "true" : undefined
              }
              key={key(p)}
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
          );
        })}
      </section>
    ) : null;
  });
}
