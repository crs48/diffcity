import { useRef, useState } from "react";
import { api, type HunkContext } from "../lib/api";

export function useHunkContext(snapshotId: string | undefined, hunkId: string) {
  const [context, setContext] = useState<HunkContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const expand = async (direction: "before" | "after") => {
    if (!snapshotId || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      setContext(
        await api.context(
          snapshotId,
          hunkId,
          (context?.before.length ?? 0) + (direction === "before" ? 25 : 0),
          (context?.after.length ?? 0) + (direction === "after" ? 25 : 0),
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    context,
    busy,
    error,
    expand,
    collapse: () => {
      setContext(null);
      setError("");
    },
  };
}
