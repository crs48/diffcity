import identity from "../identity.json";
import {
  pullFromUrl,
  safeContext,
  trustedPage,
  RPC_COMMANDS,
  type PullContext,
} from "./protocol";

const origin = chrome.runtime.getURL("/").replace(/\/$/, "");
const clients = new Set<chrome.runtime.Port>();
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const chunks = new Map<string, string>();
let native: chrome.runtime.Port | undefined;
const connectionError =
  "Diff City is disconnected. Open the desktop app, enable Chrome connection in Connections, then retry.";
function connect() {
  if (native) return native;
  const port = chrome.runtime.connectNative(identity.host);
  native = port;
  port.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message;
    if (native === port) native = undefined;
    for (const task of pending.values())
      task.reject(
        new Error(`${connectionError}${detail ? ` (${detail})` : ""}`),
      );
    pending.clear();
    chunks.clear();
    for (const client of clients)
      client.postMessage({
        event: "bridge-disconnected",
        payload: connectionError,
      });
  });
  port.onMessage.addListener((frame) => {
    if (typeof frame.message !== "string" || typeof frame.chunk !== "string")
      return;
    const text = (chunks.get(frame.message) ?? "") + frame.chunk;
    if (text.length > 64 * 1024 * 1024) {
      port.disconnect();
      return;
    }
    if (!frame.last) {
      chunks.set(frame.message, text);
      return;
    }
    chunks.delete(frame.message);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.event) {
      for (const client of clients) client.postMessage(message);
      return;
    }
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.result);
  });
  return port;
}
function rpc(command: string, args: Record<string, unknown>) {
  return new Promise((resolve, reject) => {
    if (!RPC_COMMANDS.has(command)) {
      reject(new Error("Unsupported companion command"));
      return;
    }
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    try {
      connect().postMessage({ id, command, args });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
chrome.runtime.onConnect.addListener((client) => {
  // Content scripts can request navigation/context only. Never forward their RPC.
  if (
    client.name !== "diffcity-ui" ||
    !trustedPage(client.sender?.url, origin) ||
    (client.sender?.frameId ?? 0) !== 0
  ) {
    client.disconnect();
    return;
  }
  clients.add(client);
  client.onDisconnect.addListener(() => clients.delete(client));
  client.onMessage.addListener((message) => {
    if (typeof message.id !== "string" || typeof message.command !== "string")
      return;
    void rpc(message.command, message.args ?? {}).then(
      (result) => {
        if (clients.has(client)) client.postMessage({ id: message.id, result });
      },
      (error) => {
        if (clients.has(client))
          client.postMessage({ id: message.id, error: String(error) });
      },
    );
  });
});
function guideUrl(context: PullContext) {
  const url = new URL(chrome.runtime.getURL("index.html"));
  url.searchParams.set("repo", context.repository);
  url.searchParams.set("number", String(context.number));
  return url.href;
}
async function remember(context: PullContext, tabId: number) {
  const entry = { context, tabId, nonce: crypto.randomUUID() };
  await chrome.storage.session.set({ reviewContext: entry });
  for (const client of clients)
    client.postMessage({ event: "review-context", payload: entry });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const tabId = sender.tab?.id;
  if (
    tabId !== undefined &&
    sender.url &&
    sender.url === sender.tab?.url &&
    (sender.frameId ?? 0) === 0
  ) {
    const context = safeContext(message?.context, sender.url);
    if (!context) {
      respond({ error: "Invalid GitHub pull request context" });
      return;
    }
    if (message.type === "open-guide") {
      void chrome.tabs.create({ url: guideUrl(context) });
      respond({ ok: true });
      return;
    }
    if (message.type === "ask") {
      // Invoke immediately while Chrome still recognizes the click gesture.
      const opening = chrome.sidePanel.open({ tabId });
      void Promise.all([opening, remember(context, tabId)]).then(
        () => respond({ ok: true }),
        (error) => respond({ error: String(error) }),
      );
      return true;
    }
  }
  respond({ error: "Unsupported message" });
});
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id });
  const context = pullFromUrl(tab.url ?? "");
  if (context) void remember(context, tab.id);
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "diffcity-ask",
    title: "Ask Diff City about this selection",
    contexts: ["selection"],
    documentUrlPatterns: ["https://github.com/*/*/pull/*"],
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "diffcity-ask" || tab?.id === undefined) return;
  const pull = pullFromUrl(tab.url ?? "");
  const context =
    pull &&
    safeContext({ ...pull, selection: { text: info.selectionText } }, tab.url!);
  if (!context) return;
  void chrome.sidePanel.open({ tabId: tab.id });
  void remember(context, tab.id);
});
