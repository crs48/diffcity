import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Anchor, Note } from "../lib/api";
import { anchorKey } from "../lib/diffRows";
import { isAiReply, readReplies } from "../lib/readReplies";
import { isActiveRun, type AiRun } from "./useAiRuns";

export type ReplyActivity = { unread: number; working: number; queued: number };
export const emptyActivity: ReplyActivity = {
  unread: 0,
  working: 0,
  queued: 0,
};
export const replyThreadKey = (anchor: Anchor | null) =>
  anchor ? anchorKey(anchor) : "pr-chat";
export function replyActivity(
  notes: Note[],
  runs: AiRun[],
  snapshotId: string,
  read: ReadonlySet<string>,
) {
  const activity = new Map<string, ReplyActivity>();
  const add = (anchor: Anchor | null, kind: keyof ReplyActivity) => {
    const key = replyThreadKey(anchor);
    const previous = activity.get(key) ?? emptyActivity;
    activity.set(key, { ...previous, [kind]: previous[kind] + 1 });
  };
  for (const note of notes)
    if (note.snapshotId === snapshotId && isAiReply(note) && !read.has(note.id))
      add(note.anchor, "unread");
  for (const run of runs)
    if (
      run.snapshotId === snapshotId &&
      run.kind === "question" &&
      run.question &&
      isActiveRun(run)
    )
      add(
        run.question.anchor,
        ["waiting", "queued"].includes(run.phase) ? "queued" : "working",
      );
  return activity;
}
export const combinedActivity = (items: ReplyActivity[]) =>
  items.reduce(
    (sum, item) => ({
      unread: sum.unread + item.unread,
      working: sum.working + item.working,
      queued: sum.queued + item.queued,
    }),
    emptyActivity,
  );
export function useReadReplies(scope: string) {
  const store = readReplies(scope);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/** A mounted/overscanned reply is not read until it stays visible in an active tab. */
export function useReplyReceipt(scope: string) {
  const nodes = useRef(new Set<HTMLElement>());
  const observer = useRef<IntersectionObserver | null>(null);
  const cancel = useRef<(node: HTMLElement) => void>(() => {});
  const track = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    nodes.current.add(node);
    observer.current?.observe(node);
    return () => {
      nodes.current.delete(node);
      observer.current?.unobserve(node);
      cancel.current(node);
    };
  }, []);
  useEffect(() => {
    if (!scope || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const store = readReplies(scope);
    const clear = (node: HTMLElement) => {
      clearTimeout(timers.get(node));
      timers.delete(node);
    };
    cancel.current = (node) => {
      clear(node);
      visible.delete(node);
    };
    const schedule = (node: HTMLElement) => {
      const id = node.dataset.noteId;
      if (
        !id ||
        timers.has(node) ||
        store.getSnapshot().has(id) ||
        document.visibilityState === "hidden"
      )
        return;
      timers.set(
        node,
        setTimeout(() => {
          timers.delete(node);
          if (
            node.isConnected &&
            visible.has(node) &&
            document.visibilityState !== "hidden"
          )
            store.mark([id]);
        }, 750),
      );
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          if (
            entry.isIntersecting &&
            entry.intersectionRect.height > 0 &&
            entry.intersectionRect.height >=
              Math.min(24, entry.boundingClientRect.height)
          ) {
            visible.add(node);
            schedule(node);
          } else {
            visible.delete(node);
            clear(node);
          }
        }
      },
      { threshold: [0, 0.01, 0.1, 0.25, 0.5, 1] },
    );
    observer.current = io;
    nodes.current.forEach((node) => io.observe(node));
    const visibility = () => {
      if (document.visibilityState === "hidden")
        timers.forEach((_, node) => clear(node));
      else visible.forEach(schedule);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      io.disconnect();
      observer.current = null;
      timers.forEach((_, node) => clear(node));
      cancel.current = () => {};
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scope]);
  return track;
}
