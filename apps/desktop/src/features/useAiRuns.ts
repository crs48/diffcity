import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type Anchor,
  type ModelPreference,
  type Note,
  type RunEvent,
  type Guide,
} from "../lib/api";
import { sameAnchor } from "../lib/selection";

export type AiRun = {
  id: string;
  snapshotId: string;
  kind: "guide" | "question" | "enrichment";
  guideId?: string;
  question?: Note;
  preference: ModelPreference;
  phase: "queued" | "working" | "cancelling" | "error" | "cancelled";
  text: string;
  stream: string;
};
export const isActiveRun = (run: AiRun) =>
  !["error", "cancelled"].includes(run.phase);
export const threadRuns = (
  runs: AiRun[],
  snapshotId: string,
  anchor: Anchor | null,
) =>
  runs.filter(
    (r) =>
      r.question?.snapshotId === snapshotId &&
      sameAnchor(r.question.anchor, anchor),
  );
export const threadModel = (
  notes: Note[],
  anchor: Anchor | null,
  fallback: ModelPreference,
) =>
  notes
    .filter(
      (n) =>
        n.role === "assistant" &&
        !n.githubDraft &&
        n.model &&
        sameAnchor(n.anchor, anchor),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)?.model ?? fallback;

export function useAiRuns() {
  const [runs, setRuns] = useState<AiRun[]>([]);
  const current = useRef<AiRun[]>([]);
  const progress = useRef(new Map<string, (guide: Guide) => void>());
  const ready = useRef<Promise<unknown>>(Promise.resolve());
  const update = useCallback((change: (runs: AiRun[]) => AiRun[]) => {
    current.current = change(current.current);
    setRuns(current.current);
  }, []);
  useEffect(() => {
    let disposed = false;
    const subscription = listen<RunEvent>("codex-run", ({ payload: event }) => {
      if (disposed) return;
      const active = current.current.find(
        (run) =>
          run.id === event.runId &&
          run.snapshotId === event.snapshotId &&
          isActiveRun(run),
      );
      if (
        active &&
        event.guide &&
        active.guideId === event.guide.id &&
        event.guide.snapshotId === event.snapshotId
      )
        progress.current.get(active.id)?.(event.guide);
      update((runs) =>
        runs.map((run) => {
          if (
            run.id !== event.runId ||
            run.snapshotId !== event.snapshotId ||
            !isActiveRun(run) ||
            run.phase === "cancelling"
          )
            return run;
          return event.phase === "stream"
            ? { ...run, phase: "working", stream: run.stream + event.text }
            : {
                ...run,
                phase: event.phase === "queued" ? "queued" : "working",
                text: event.text,
              };
        }),
      );
    });
    ready.current = subscription;
    // Attach a handler immediately even before a request is made.
    void subscription.catch(() => {});
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [update]);
  const dismiss = useCallback(
    (id: string) => update((runs) => runs.filter((r) => r.id !== id)),
    [update],
  );
  const start = async <T>(
    details: Pick<
      AiRun,
      "snapshotId" | "kind" | "question" | "preference" | "guideId"
    >,
    task: (id: string) => Promise<T>,
    onGuide?: (guide: Guide) => void,
  ): Promise<T | undefined> => {
    if (
      current.current.some(
        (r) =>
          isActiveRun(r) &&
          r.snapshotId === details.snapshotId &&
          r.kind === details.kind &&
          (r.kind === "question"
            ? sameAnchor(r.question!.anchor, details.question!.anchor)
            : r.kind === "enrichment"
              ? r.guideId === details.guideId
              : JSON.stringify(r.preference) ===
                JSON.stringify(details.preference)),
      )
    )
      return;
    const id = crypto.randomUUID();
    if (onGuide) progress.current.set(id, onGuide);
    update((runs) => [
      ...runs,
      {
        ...details,
        id,
        phase: "queued",
        text: "Waiting for an AI slot…",
        stream: "",
      },
    ]);
    try {
      await ready.current;
      if (current.current.find((r) => r.id === id)?.phase === "cancelling") {
        dismiss(id);
        return;
      }
      const result = await task(id);
      dismiss(id);
      return result;
    } catch (error) {
      update((runs) =>
        runs.map((r) =>
          r.id === id
            ? {
                ...r,
                phase: r.phase === "cancelling" ? "cancelled" : "error",
                text: String(error),
                stream: "",
              }
            : r,
        ),
      );
    } finally {
      progress.current.delete(id);
    }
  };
  const cancel = async (id: string) => {
    update((runs) =>
      runs.map((r) =>
        r.id === id ? { ...r, phase: "cancelling", text: "Cancelling…" } : r,
      ),
    );
    try {
      await api.cancel(id);
    } catch (error) {
      update((runs) =>
        runs.map((r) =>
          r.id === id ? { ...r, phase: "working", text: String(error) } : r,
        ),
      );
    }
  };
  return { runs, start, cancel, dismiss };
}
