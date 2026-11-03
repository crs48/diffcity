import type { Note, PullRequest } from "./api";

const prefix = "diffcity.read-ai.v1:";
export const replyScope = (pull: Pick<PullRequest, "repository" | "number">) =>
  pull.repository && pull.number ? `${pull.repository}#${pull.number}` : "";
export const isAiReply = (note: Note) =>
  note.role === "assistant" && !note.githubDraft && !note.publishedUrl;

const load = (key: string): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id) => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

/** Read receipts contain opaque note IDs only, never conversation text. */
export function createReadReplies(scope: string) {
  const key = prefix + scope;
  let read: ReadonlySet<string> = new Set(load(key));
  const listeners = new Set<() => void>();
  const merge = (ids: string[]) => {
    if (ids.every((id) => read.has(id))) return false;
    read = new Set([...read, ...ids]);
    listeners.forEach((listener) => listener());
    return true;
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key) merge(load(key));
  };
  return {
    getSnapshot: () => read,
    subscribe(listener: () => void) {
      if (!listeners.size) {
        merge(load(key));
        window.addEventListener("storage", storage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener("storage", storage);
      };
    },
    mark(ids: string[]) {
      if (!scope || !ids.length) return;
      if (!merge([...load(key), ...ids])) return;
      try {
        localStorage.setItem(key, JSON.stringify([...read]));
      } catch {
        // Keep receipts for this session if browser storage is unavailable.
      }
    },
  };
}

const stores = new Map<string, ReturnType<typeof createReadReplies>>();
export function readReplies(scope: string) {
  let store = stores.get(scope);
  if (!store) {
    store = createReadReplies(scope);
    stores.set(scope, store);
  }
  return store;
}
