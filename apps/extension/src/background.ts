import identity from "../identity.json";
import { inlineSession, type InlineView } from "./inlineSession";
import {
  pullFromUrl,
  safeContext,
  trustedPage,
  RPC_COMMANDS,
  type PullContext,
} from "./protocol";

const origin = chrome.runtime.getURL("/").replace(/\/$/, "");
const clients = new Set<chrome.runtime.Port>();
const inlineClients = new Map<
  chrome.runtime.Port,
  ReturnType<typeof inlineSession>
>();
const inlineSessions = new Map<string, ReturnType<typeof inlineSession>>();
const inlineTabs = new Map<string, number>();
type InlineGrant = {
  context: PullContext;
  tabId: number;
  createdAt: number;
  view?: InlineView;
};
async function inlineGrant(
  sender: chrome.runtime.MessageSender | undefined,
  id: string,
): Promise<InlineGrant> {
  if (
    !/^[\da-f-]{36}$/.test(id) ||
    sender?.url !== `${origin}/inline.html?id=${id}` ||
    !sender.tab?.id ||
    !sender.frameId ||
    !sender.tab.url
  )
    throw new Error("Invalid inline frame");
  const key = `inline:${id}`;
  const stored = (await chrome.storage.session.get(key))[key] as
    InlineGrant | undefined;
  if (
    !stored ||
    stored.tabId !== sender.tab.id ||
    Date.now() - stored.createdAt > 24 * 60 * 60 * 1000 ||
    !safeContext(stored.context, sender.tab.url)
  )
    throw new Error(
      "This inline conversation has expired. Open it again from GitHub.",
    );
  return stored;
}
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
      if (message.event === "codex-run")
        for (const session of inlineSessions.values())
          session.event(message.payload);
      for (const client of clients) {
        const scope = inlineClients.get(client);
        if (!scope || scope.acceptsEvent(message)) client.postMessage(message);
      }
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
  if (client.name.startsWith("diffcity-inline:")) {
    const id = client.name.slice("diffcity-inline:".length);
    const scope = inlineGrant(client.sender, id).then((grant) => {
      let session = inlineSessions.get(id);
      if (!session) {
        session = inlineSession(grant.context, rpc, {
          view: grant.view,
          persist: async (view) => {
            if (!inlineTabs.has(id)) return;
            await chrome.storage.session.set({
              [`inline:${id}`]: { ...grant, view },
            });
          },
          changed: (payload) => {
            for (const [port, scope] of inlineClients)
              if (scope === inlineSessions.get(id))
                port.postMessage({ event: "inline-state", payload });
          },
        });
        inlineSessions.set(id, session);
        inlineTabs.set(id, grant.tabId);
      }
      inlineClients.set(client, session);
      clients.add(client);
      return session;
    });
    let disconnected = false;
    void scope.then(
      () => {
        if (disconnected) {
          clients.delete(client);
          inlineClients.delete(client);
        }
      },
      () => client.disconnect(),
    );
    client.onDisconnect.addListener(() => {
      disconnected = true;
      clients.delete(client);
      inlineClients.delete(client);
    });
    client.onMessage.addListener((message) => {
      if (typeof message.id !== "string" || typeof message.command !== "string")
        return;
      void scope
        .then((session) => session.invoke(message.command, message.args ?? {}))
        .then(
          (result) => {
            if (!disconnected) client.postMessage({ id: message.id, result });
          },
          (error) => {
            if (!disconnected)
              client.postMessage({ id: message.id, error: String(error) });
          },
        );
    });
    return;
  }
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
// Frames disappear on scroll, but their sessions live until the tab closes.
// Native jobs finish independently and keep their results in the desktop DB.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, owner] of inlineTabs) {
    if (owner !== tabId) continue;
    const session = inlineSessions.get(id);
    for (const [port, scope] of inlineClients) {
      if (scope !== session) continue;
      inlineClients.delete(port);
      clients.delete(port);
      port.disconnect();
    }
    inlineSessions.delete(id);
    inlineTabs.delete(id);
  }
  void chrome.storage.session.get(null).then((stored) => {
    const keys = Object.entries(stored)
      .filter(
        ([key, value]) =>
          key.startsWith("inline:") &&
          typeof value === "object" &&
          value !== null &&
          "tabId" in value &&
          value.tabId === tabId,
      )
      .map(([key]) => key);
    if (keys.length) return chrome.storage.session.remove(keys);
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
    if (!inlineClients.has(client))
      client.postMessage({ event: "review-context", payload: entry });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "inline-panel" && typeof message.id === "string") {
    // Open while the extension-frame click still carries its user gesture.
    if (
      sender.url !== `${origin}/inline.html?id=${message.id}` ||
      !sender.tab?.id ||
      !sender.frameId
    ) {
      respond({ error: "Invalid inline frame" });
      return;
    }
    const opening = chrome.sidePanel.open({ tabId: sender.tab.id });
    void Promise.all([inlineGrant(sender, message.id), opening])
      .then(async ([grant]) => {
        await remember(grant.context, grant.tabId);
        respond({ ok: true });
      })
      .catch((error) => respond({ error: String(error) }));
    return true;
  }
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
    if (message.type === "create-inline") {
      if (
        !context.selection &&
        !context.line &&
        !context.commentUrl?.includes("#discussion_r")
      ) {
        respond({ error: "Inline conversations need code context" });
        return;
      }
      const id = crypto.randomUUID();
      void chrome.storage.session
        .set({ [`inline:${id}`]: { context, tabId, createdAt: Date.now() } })
        .then(
          () =>
            respond({ id, url: chrome.runtime.getURL(`inline.html?id=${id}`) }),
          (error) => respond({ error: String(error) }),
        );
      return true;
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
  void chrome.tabs
    .sendMessage(tab.id, {
      type: "open-inline-selection",
      text: info.selectionText,
    })
    .catch(() => undefined);
});
