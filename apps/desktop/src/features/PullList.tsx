import { useTranslation } from "react-i18next";
import { PullCard } from "./PullCard";
import type { PullRequest } from "../lib/api";
import { key } from "../lib/review";
import { pinKey, inboxGroup, inboxGroups } from "../lib/inbox";

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
  const { t } = useTranslation();
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
        {items.map((p) => (
          <PullCard
            key={key(p)}
            pull={p}
            login={login}
            selected={!!selected && key(p) === key(selected)}
            muted={group === "Reviewed" || p.state !== "open"}
            pinned={pinned.has(pinKey(p))}
            saving={saving}
            onOpen={onOpen}
            onPin={onPin}
          />
        ))}
      </section>
    ) : null;
  });
}
