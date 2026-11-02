import type { ReviewTransport } from "../../desktop/src/lib/transport";

const callbacks = new Map<string, Set<(event: { payload: unknown }) => void>>();
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let port: chrome.runtime.Port | undefined;
function connect() {
  if (port) return port;
  port = chrome.runtime.connect({ name: "diffcity-ui" });
  port.onMessage.addListener((message) => {
    if (message.event) {
      for (const receive of callbacks.get(message.event) ?? [])
        receive({ payload: message.payload });
      return;
    }
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.result);
  });
  port.onDisconnect.addListener(() => {
    const detail =
      chrome.runtime.lastError?.message ??
      "Browser connection closed. Retry to reconnect.";
    port = undefined;
    for (const task of pending.values()) task.reject(new Error(detail));
    pending.clear();
  });
  return port;
}
export const transport: ReviewTransport = {
  invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (command === "open_external") {
      const url = new URL(String(args.url));
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return Promise.reject(new Error("Only web links can be opened"));
      return chrome.tabs.create({ url: url.href }).then(() => undefined as T);
    }
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        connect().postMessage({ id, command, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  },
  async listen<T>(name: string, receive: (event: { payload: T }) => void) {
    connect();
    const listener = receive as (event: { payload: unknown }) => void;
    const listeners = callbacks.get(name) ?? new Set();
    listeners.add(listener);
    callbacks.set(name, listeners);
    return () => {
      listeners.delete(listener);
    };
  },
};
