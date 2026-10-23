import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type AgentAccess,
  type AgentPrompt,
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
  pullKey?: string;
  access?: AgentAccess;
  prompt?: AgentPrompt;
  question?: Note;
  preference: ModelPreference;
  phase:
    "waiting" | "queued" | "working" | "cancelling" | "error" | "cancelled";
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
  const pending = useRef(
    new Map<
      string,
      {
        question?: Note;
        done: Promise<void>;
        stopWaiting: () => void;
        dispatched: boolean;
      }
    >(),
  );
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
          if (event.phase === "approval") {
            try {
              return {
                ...run,
                phase: "working",
                text: "Waiting for your response…",
                prompt: JSON.parse(event.text) as AgentPrompt,
              };
            } catch {
              return {
                ...run,
                text: "Could not display the agent request. Cancel and retry.",
              };
            }
          }
          if (event.phase === "approval-resolved")
            return { ...run, prompt: undefined, text: event.text };
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
      | "snapshotId"
      | "kind"
      | "question"
      | "preference"
      | "guideId"
      | "access"
      | "pullKey"
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
            ? r.question!.id === details.question!.id
            : r.kind === "enrichment"
              ? r.guideId === details.guideId
              : JSON.stringify(r.preference) ===
                JSON.stringify(details.preference)),
      )
    )
      return;
    const id = crypto.randomUUID();
    const previous = details.question
      ? [...pending.current.values()]
          .reverse()
          .find(
            (entry) =>
              entry.question?.snapshotId === details.snapshotId &&
              sameAnchor(entry.question.anchor, details.question!.anchor),
          )
      : undefined;
    let release!: () => void;
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stopWaiting!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stopWaiting = resolve;
    });
    const entry = {
      question: details.question,
      // A removed question still waits for its predecessor before releasing the
      // next question. Otherwise removing the middle item would bypass FIFO.
      done: (previous?.done ?? Promise.resolve()).then(() => completed),
      stopWaiting,
      dispatched: false,
    };
    pending.current.set(id, entry);
    if (onGuide) progress.current.set(id, onGuide);
    update((runs) => [
      ...runs,
      {
        ...details,
        id,
        phase: previous ? "waiting" : "queued",
        text: previous
          ? "Waiting for earlier replies…"
          : "Waiting for an AI slot…",
        stream: "",
      },
    ]);
    try {
      if (previous) await Promise.race([previous.done, stopped]);
      await Promise.race([ready.current, stopped]);
      const run = current.current.find((r) => r.id === id);
      if (!run || !isActiveRun(run) || run.phase === "cancelling") return;
      entry.dispatched = true;
      update((runs) =>
        runs.map((r) =>
          r.id === id
            ? { ...r, phase: "queued", text: "Waiting for an AI slot…" }
            : r,
        ),
      );
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
                prompt: undefined,
              }
            : r,
        ),
      );
    } finally {
      progress.current.delete(id);
      release();
      void entry.done.then(() => pending.current.delete(id));
    }
  };
  const cancel = async (id: string) => {
    const entry = pending.current.get(id);
    if (!entry?.dispatched) {
      update((runs) =>
        runs.map((r) =>
          r.id === id
            ? {
                ...r,
                phase: "cancelled",
                text: r.question
                  ? "Removed from queue · saved as a private note"
                  : "Cancelled",
              }
            : r,
        ),
      );
      entry?.stopWaiting();
      return;
    }
    update((runs) =>
      runs.map((r) =>
        r.id === id
          ? {
              ...r,
              prompt: undefined,
              phase: "cancelling",
              text: "Cancelling…",
            }
          : r,
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
