import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PullRequest } from "../lib/api";
import { key } from "../lib/review";

export function usePullHistory(
  repository: string | null,
  enabled: boolean,
  owner: string | null = null,
  repositoriesKey = "",
) {
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(
    async (page = 1) => {
      const id = ++request.current;
      setLoading(true);
      setError("");
      try {
        const result = await api.history(repository, page, owner);
        if (id !== request.current) return;
        setPulls((previous) => [
          ...new Map(
            [...(page === 1 ? [] : previous), ...result.pulls].map((p) => [
              key(p),
              p,
            ]),
          ).values(),
        ]);
        setNextPage(result.nextPage);
        setError(result.syncError ?? "");
      } catch (e) {
        if (id === request.current) setError(String(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [repository, owner],
  );
  useEffect(() => {
    if (!enabled) return;
    setPulls([]);
    setNextPage(null);
    void load();
    const generation = request;
    return () => {
      ++generation.current;
    };
  }, [load, enabled, repositoriesKey]);
  const update = (pull: PullRequest) =>
    setPulls((pulls) => pulls.map((p) => (key(p) === key(pull) ? pull : p)));
  return { pulls, nextPage, loading, error, load, update };
}
