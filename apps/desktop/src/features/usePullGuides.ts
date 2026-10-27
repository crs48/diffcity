import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PullGuide } from "../lib/api";
import { indexPullGuides } from "../lib/pull-guides";

/** One local metadata query for the entire inbox; never fetch PR bodies per card. */
export function usePullGuides() {
  const [guides, setGuides] = useState<PullGuide[] | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await api.pullGuides();
      if (id === request.current) {
        setGuides(next);
        setError("");
      }
    } catch (error) {
      if (id === request.current) setError(String(error));
    }
  }, []);
  useEffect(() => {
    const requests = request;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => {
      requests.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  const inventory = useMemo(() => indexPullGuides(guides ?? []), [guides]);
  return { inventory, loading: guides === null && !error, error, refresh };
}
