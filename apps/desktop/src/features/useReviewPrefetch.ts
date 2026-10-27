import { useEffect, useRef } from "react";
import { api, type PullRequest } from "../lib/api";
import { isSampleRepo, pinKey, requestedFrom, sameLogin } from "../lib/inbox";

export const prefetchFingerprint = (pull: PullRequest) =>
  `${pull.head}:${pull.base}:${pull.updatedAt}`;

export function prefetchCandidates(pulls: PullRequest[], login: string) {
  const priority = (pull: PullRequest) =>
    sameLogin(pull.author, login) ? 0 : requestedFrom(pull, login) ? 1 : 2;
  return [...new Map(pulls.map((pull) => [pinKey(pull), pull])).values()]
    .filter(
      (pull) =>
        pull.state === "open" &&
        !isSampleRepo(pull.repository) &&
        (sameLogin(pull.author, login) ||
          requestedFrom(pull, login) ||
          pull.assigned.some((name) => sameLogin(name, login))),
    )
    .sort(
      (a, b) =>
        priority(a) - priority(b) || b.updatedAt.localeCompare(a.updatedAt),
    );
}

/** Feed one low-priority download at a time from the full inbox, independent of filters. */
export function useReviewPrefetch(
  pulls: PullRequest[],
  login: string,
  enabled: boolean,
  paused: boolean,
  active: string | null,
) {
  const inFlight = useRef(false);
  const attempts = useRef(
    new Map<string, { fingerprint: string; retryAt: number }>(),
  );
  useEffect(() => {
    if (!enabled || paused) return;
    const candidates = prefetchCandidates(pulls, login);
    const tick = async () => {
      if (document.hidden || inFlight.current) return;
      const next = candidates.find((pull) => {
        if (pinKey(pull) === active) return false;
        const previous = attempts.current.get(pinKey(pull));
        return (
          !previous ||
          previous.fingerprint !== prefetchFingerprint(pull) ||
          previous.retryAt <= Date.now()
        );
      });
      if (!next) return;
      inFlight.current = true;
      let delay = 60_000;
      try {
        // false means an interactive open interrupted this download; retry shortly.
        delay = (await api.prefetch(next)) ? 300_000 : 2_000;
      } catch {
        // Background failures must not obscure an unrelated review. Back off and retry.
      } finally {
        attempts.current.set(pinKey(next), {
          fingerprint: prefetchFingerprint(next),
          retryAt: Date.now() + delay,
        });
        inFlight.current = false;
      }
    };
    // Let the inbox/selected review paint first, and leave breathing room between downloads.
    const timer = setInterval(() => void tick(), 1_000);
    return () => clearInterval(timer);
  }, [pulls, login, enabled, paused, active]);
}
