import { afterEach, beforeEach, expect, it, vi } from "vitest";
import identity from "../identity.json";

const origin = `chrome-extension://${identity.id}`;
const event = () => ({ addListener: vi.fn() });
const port = (url: string) => ({
  name: "diffcity-ui",
  sender: { url, frameId: 0 },
  onDisconnect: event(),
  onMessage: event(),
  disconnect: vi.fn(),
  postMessage: vi.fn(),
});
let native: ReturnType<typeof port>;
let browser: {
  runtime: {
    getURL: ReturnType<typeof vi.fn>;
    connectNative: ReturnType<typeof vi.fn>;
    onConnect: ReturnType<typeof event>;
    onMessage: ReturnType<typeof event>;
    onInstalled: ReturnType<typeof event>;
  };
  tabs: { create: ReturnType<typeof vi.fn> };
  sidePanel: { open: ReturnType<typeof vi.fn> };
  storage: { session: { set: ReturnType<typeof vi.fn> } };
  action: { onClicked: ReturnType<typeof event> };
  contextMenus: {
    create: ReturnType<typeof vi.fn>;
    onClicked: ReturnType<typeof event>;
  };
};
beforeEach(async () => {
  vi.resetModules();
  native = port("");
  browser = {
    runtime: {
      getURL: vi.fn((path: string) => `${origin}/${path.replace(/^\//, "")}`),
      connectNative: vi.fn(() => native),
      onConnect: event(),
      onMessage: event(),
      onInstalled: event(),
    },
    tabs: { create: vi.fn().mockResolvedValue({}) },
    sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
    storage: { session: { set: vi.fn().mockResolvedValue(undefined) } },
    action: { onClicked: event() },
    contextMenus: { create: vi.fn(), onClicked: event() },
  };
  vi.stubGlobal("chrome", browser);
  await import("./background");
});
afterEach(() => vi.unstubAllGlobals());

it("denies content-script and embedded-frame RPC ports before opening a native host", () => {
  const connect = browser.runtime.onConnect.addListener.mock.calls[0][0];
  for (const url of [
    "https://github.com/example/repo/pull/1",
    "chrome-extension://other/index.html",
    "data:text/html,hello",
  ]) {
    const client = port(url);
    connect(client);
    expect(client.disconnect).toHaveBeenCalledOnce();
  }
  const embedded = port(`${origin}/index.html`);
  embedded.sender.frameId = 1;
  connect(embedded);
  expect(embedded.disconnect).toHaveBeenCalledOnce();
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
});
it("rejects arbitrary commands even from the bundled UI", async () => {
  const client = port(`${origin}/index.html`);
  browser.runtime.onConnect.addListener.mock.calls[0][0](client);
  client.onMessage.addListener.mock.calls[0][0]({
    id: "1",
    command: "shell",
    args: { command: "secret" },
  });
  await vi.waitFor(() =>
    expect(client.postMessage).toHaveBeenCalledWith({
      id: "1",
      error: "Error: Unsupported companion command",
    }),
  );
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
});
it("assembles chunked Unicode responses and rejects pending requests on disconnect without retrying", async () => {
  const client = port(`${origin}/sidepanel.html`);
  browser.runtime.onConnect.addListener.mock.calls[0][0](client);
  const send = client.onMessage.addListener.mock.calls[0][0];
  send({ id: "1", command: "bootstrap" });
  const request = native.postMessage.mock.calls[0][0];
  const response = JSON.stringify({
    id: request.id,
    result: { text: "🦀".repeat(600000) },
  });
  const receive = native.onMessage.addListener.mock.calls[0][0];
  for (let start = 0; start < response.length; start += 50000)
    receive({
      message: "response",
      chunk: response.slice(start, start + 50000),
      last: start + 50000 >= response.length,
    });
  await vi.waitFor(() =>
    expect(client.postMessage).toHaveBeenCalledWith({
      id: "1",
      result: { text: "🦀".repeat(600000) },
    }),
  );
  send({ id: "2", command: "ask_codex" });
  native.onDisconnect.addListener.mock.calls[0][0]();
  await vi.waitFor(() =>
    expect(
      client.postMessage.mock.calls.some(
        ([message]) =>
          message.id === "2" && message.error.includes("disconnected"),
      ),
    ).toBe(true),
  );
  expect(browser.runtime.connectNative).toHaveBeenCalledTimes(1);
});
it("page messages can only navigate to the same PR and never dispatch an agent command", () => {
  const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
  const url = "https://github.com/example/repo/pull/1";
  const sender = { url, frameId: 0, tab: { id: 1, url } };
  const respond = vi.fn();
  send(
    { type: "open-guide", context: { repository: "private/repo", number: 1 } },
    sender,
    respond,
  );
  expect(browser.tabs.create).not.toHaveBeenCalled();
  send(
    {
      type: "open-guide",
      context: {
        repository: "example/repo",
        number: 1,
        command: "publish_review",
      },
    },
    sender,
    respond,
  );
  expect(browser.tabs.create).toHaveBeenCalledWith({
    url: `${origin}/index.html?repo=example%2Frepo&number=1`,
  });
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
});
