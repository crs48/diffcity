import { afterEach, beforeEach, expect, it, vi } from "vitest";
import identity from "../identity.json";
import { indexedWorkspace } from "../../desktop/src/lib/guideIndex.fixture";

const origin = `chrome-extension://${identity.id}`;
const event = () => ({ addListener: vi.fn() });
const port = (url: string) => ({
  name: "diffcity-ui",
  sender: {
    url,
    frameId: 0,
    tab: undefined as { id: number; url: string } | undefined,
  },
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
  tabs: {
    create: ReturnType<typeof vi.fn>;
    onRemoved: ReturnType<typeof event>;
  };
  sidePanel: { open: ReturnType<typeof vi.fn> };
  storage: {
    session: {
      set: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };
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
    tabs: { create: vi.fn().mockResolvedValue({}), onRemoved: event() },
    sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
    storage: {
      session: {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
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

it.each([
  "https://github.com/example/repo/pull/1",
  "https://github.com/example/repo/pull/1/files?diff=split#diff-abc",
  "https://github.com/example/repo/pull/2",
  "https://github.com/example/repo/pulls",
])(
  "uses the current PR after same-document navigation from %s",
  async (url) => {
    const currentUrl = "https://github.com/example/repo/pull/1#discussion_r1";
    const sender = { url, frameId: 0, tab: { id: 1, url: currentUrl } };
    const context = {
      repository: "example/repo",
      number: 1,
      commentUrl: currentUrl,
    };
    const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
    const respond = vi.fn();
    send({ type: "ask", context }, sender, respond);
    // The panel must still open in the original click's synchronous call stack.
    expect(browser.sidePanel.open).toHaveBeenCalledWith({ tabId: 1 });
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }));
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      reviewContext: { context, tabId: 1, nonce: expect.any(String) },
    });
    expect(browser.runtime.connectNative).not.toHaveBeenCalled();
  },
);

it("creates and reuses a comment conversation after a GitHub URL change", async () => {
  const w = indexedWorkspace();
  const url = `https://github.com/${w.snapshot.pull.repository}/pull/${w.snapshot.pull.number}`;
  w.comments.forEach((comment) => {
    comment.url = `${url}#discussion_r${comment.id === "root" ? 1 : 2}`;
  });
  const context = {
    repository: w.snapshot.pull.repository,
    number: w.snapshot.pull.number,
    commentUrl: `${url}#discussion_r1`,
  };
  const sender = {
    url: "https://github.com/example/repo/pulls",
    frameId: 0,
    tab: { id: 1, url: `${url}/files#discussion_r1` },
  };
  const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
  const respond = vi.fn();
  for (let attempt = 0; attempt < 2; attempt++) {
    respond.mockClear();
    expect(send({ type: "create-inline", context }, sender, respond)).toBe(
      true,
    );
    const request = native.postMessage.mock.calls.at(-1)![0];
    expect(request).toMatchObject({
      command: "open_pull",
      args: {
        repository: context.repository,
        number: context.number,
        refresh: true,
      },
    });
    native.onMessage.addListener.mock.calls[0][0]({
      message: crypto.randomUUID(),
      chunk: JSON.stringify({ id: request.id, result: w }),
      last: true,
    });
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    const stored = browser.storage.session.set.mock.calls[0][0];
    const id = Object.keys(stored)[0].slice("inline:".length);
    expect(respond).toHaveBeenCalledWith({
      id,
      key: expect.any(String),
      url: `${origin}/inline.html?id=${id}`,
    });
    browser.storage.session.get.mockResolvedValue(stored);
  }
  expect(browser.storage.session.set).toHaveBeenCalledTimes(1);
});

it("rejects foreign, embedded, inactive, or stale-PR messages after navigation", () => {
  const url = "https://github.com/example/repo/pull/1";
  const context = { repository: "example/repo", number: 1 };
  const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
  for (const sender of [
    {
      url: "https://github.com.attacker.test/",
      frameId: 0,
      tab: { id: 1, url },
    },
    { url: "http://github.com/", frameId: 0, tab: { id: 1, url } },
    { url: "https://token@github.com/", frameId: 0, tab: { id: 1, url } },
    { url, frameId: 1, tab: { id: 1, url } },
    { url, frameId: 0, documentLifecycle: "cached", tab: { id: 1, url } },
    { url, frameId: 0, tab: { id: 1, url: `${url}0` } },
    {
      url,
      frameId: 0,
      tab: { id: 1, url: "https://github.com/other/repo/pull/1" },
    },
    {
      url,
      frameId: 0,
      tab: { id: 1, url: "https://github.com/example/repo/issues/1" },
    },
    { url, frameId: 0, tab: { id: 1 } },
    { url, tab: { id: 1, url } },
  ]) {
    const respond = vi.fn();
    send(
      {
        type: "create-inline",
        context: { ...context, commentUrl: `${url}#discussion_r1` },
      },
      sender,
      respond,
    );
    expect(respond).toHaveBeenCalledWith({ error: expect.any(String) });
  }
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
  expect(browser.storage.session.set).not.toHaveBeenCalled();
  expect(browser.sidePanel.open).not.toHaveBeenCalled();
});

it.each(["outdated", "outside-diff", "unknown"])(
  "handles %s comments without inventing a current code anchor",
  async (kind) => {
    const w = indexedWorkspace();
    const url = `https://github.com/${w.snapshot.pull.repository}/pull/${w.snapshot.pull.number}`;
    const commentUrl = `${url}#discussion_r1`;
    w.comments = [
      {
        ...w.comments[1],
        url: kind === "unknown" ? `${url}#discussion_r2` : commentUrl,
        commit: kind === "outdated" ? "previous-commit" : w.snapshot.pull.head,
        line: kind === "outside-diff" ? 999999 : 1,
      },
    ];
    const respond = vi.fn();
    browser.runtime.onMessage.addListener.mock.calls[0][0](
      {
        type: "create-inline",
        context: {
          repository: w.snapshot.pull.repository,
          number: w.snapshot.pull.number,
          commentUrl,
        },
      },
      { url, frameId: 0, tab: { id: 1, url: commentUrl } },
      respond,
    );
    const request = native.postMessage.mock.calls[0][0];
    native.onMessage.addListener.mock.calls[0][0]({
      message: crypto.randomUUID(),
      chunk: JSON.stringify({ id: request.id, result: w }),
      last: true,
    });
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith(
      kind === "unknown"
        ? { error: expect.any(String) }
        : { fallback: "comment-panel" },
    );
    expect(browser.storage.session.set).not.toHaveBeenCalled();
    expect(browser.sidePanel.open).not.toHaveBeenCalled();
    expect(JSON.stringify(respond.mock.calls)).not.toContain(
      w.comments[0].body,
    );
  },
);

it("restricts embedded frames to a saved grant on the same tab and PR", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const url = "https://github.com/example/repo/pull/1/files";
  browser.storage.session.get.mockResolvedValue({
    [`inline:${id}`]: {
      tabId: 1,
      createdAt: Date.now(),
      context: {
        repository: "example/repo",
        number: 1,
        line: { path: "a.ts", line: 1, side: "RIGHT" },
      },
    },
  });
  for (const [tabId, tabUrl, frameId] of [
    [2, url, 1],
    [1, url.replace("/1/files", "/2/files"), 1],
    [1, url, 0],
  ] as const) {
    const client = port(`${origin}/inline.html?id=${id}`);
    client.name = `diffcity-inline:${id}`;
    client.sender = {
      url: client.sender.url,
      frameId,
      tab: { id: tabId, url: tabUrl },
    };
    browser.runtime.onConnect.addListener.mock.calls[0][0](client);
    await vi.waitFor(() => expect(client.disconnect).toHaveBeenCalled());
  }
  const valid = port(`${origin}/inline.html?id=${id}`);
  valid.name = `diffcity-inline:${id}`;
  valid.sender = { url: valid.sender.url, frameId: 1, tab: { id: 1, url } };
  browser.runtime.onConnect.addListener.mock.calls[0][0](valid);
  valid.onMessage.addListener.mock.calls[0][0]({
    id: "1",
    command: "publish_review",
    args: {},
  });
  await vi.waitFor(() =>
    expect(valid.postMessage).toHaveBeenCalledWith({
      id: "1",
      error:
        "Error: This action is only available in the full Diff City review.",
    }),
  );
  expect(valid.disconnect).not.toHaveBeenCalled();
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
});

it("releases closed-tab inline state without clearing other tabs or saved conversations", async () => {
  browser.storage.session.get.mockResolvedValue({
    "inline:closed": { tabId: 7 },
    "inline:other": { tabId: 8 },
    reviewContext: { tabId: 7 },
  });
  browser.tabs.onRemoved.addListener.mock.calls[0][0](7);
  await vi.waitFor(() =>
    expect(browser.storage.session.remove).toHaveBeenCalledWith([
      "inline:closed",
    ]),
  );
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
});

it("restores only this PR's saved inline locations, reusing drafts without leaking chat content to GitHub", async () => {
  const w = indexedWorkspace();
  const context = {
    repository: w.snapshot.pull.repository,
    number: w.snapshot.pull.number,
  };
  const url = `https://github.com/${context.repository}/pull/${context.number}/files`;
  const id = "12345678-1234-1234-1234-123456789abc";
  const anchor = w.notes[0].anchor!;
  const grant = {
    context: {
      ...context,
      line: { path: anchor.path, side: anchor.side, line: anchor.line },
    },
    anchor,
    tabId: 1,
    createdAt: Date.now(),
    view: {
      collapsed: true,
      draft: { noteId: null, body: "Unsent private text" },
    },
  };
  browser.storage.session.get.mockResolvedValue({ [`inline:${id}`]: grant });
  const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
  const respond = vi.fn();
  const sender = {
    url: "https://github.com/example/repo/pulls",
    frameId: 0,
    tab: { id: 1, url },
  };
  send(
    {
      type: "restore-inline",
      context: { ...context, repository: "other/repo" },
    },
    sender,
    respond,
  );
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
  respond.mockClear();
  send({ type: "restore-inline", context }, sender, respond);
  const request = native.postMessage.mock.calls[0][0];
  expect(request).toMatchObject({
    command: "open_pull",
    args: { ...context, refresh: false },
  });
  native.onMessage.addListener.mock.calls[0][0]({
    message: "response",
    chunk: JSON.stringify({ id: request.id, result: w }),
    last: true,
  });
  await vi.waitFor(() => expect(respond).toHaveBeenCalled());
  expect(respond.mock.calls[0][0].threads).toHaveLength(1);
  expect(respond.mock.calls[0][0].threads[0]).toMatchObject({
    id,
    placement: { kind: "code", line: anchor.line },
  });
  expect(JSON.stringify(respond.mock.calls)).not.toContain("private text");
  expect(JSON.stringify(respond.mock.calls)).not.toContain(w.notes[0].body);
  expect(browser.storage.session.set).toHaveBeenCalledWith({
    [`inline:${id}`]: expect.objectContaining({
      view: { collapsed: false, draft: grant.view.draft },
    }),
  });
});

it("restores resolved threads compactly and reuses them when the user clicks their line", async () => {
  const w = indexedWorkspace();
  w.comments.forEach((c) => {
    c.resolved = true;
  });
  const context = {
    repository: w.snapshot.pull.repository,
    number: w.snapshot.pull.number,
  };
  const url = `https://github.com/${context.repository}/pull/${context.number}/files`;
  const sender = { url, frameId: 0, tab: { id: 1, url } };
  const send = browser.runtime.onMessage.addListener.mock.calls[0][0];
  const respond = vi.fn();
  send({ type: "restore-inline", context }, sender, respond);
  const reply = () => {
    const request = native.postMessage.mock.calls.at(-1)![0];
    native.onMessage.addListener.mock.calls[0][0]({
      message: crypto.randomUUID(),
      chunk: JSON.stringify({ id: request.id, result: w }),
      last: true,
    });
  };
  reply();
  await vi.waitFor(() => expect(respond).toHaveBeenCalled());
  const stored = browser.storage.session.set.mock.calls[0][0];
  const grant = Object.values(stored)[0] as {
    view: { collapsed: boolean };
    context: unknown;
  };
  expect(grant.view.collapsed).toBe(true);
  browser.storage.session.get.mockResolvedValue(stored);
  const restored = respond.mock.calls[0][0].threads[0];
  respond.mockClear();
  send({ type: "create-inline", context: grant.context }, sender, respond);
  reply();
  await vi.waitFor(() => expect(respond).toHaveBeenCalled());
  expect(respond.mock.calls[0][0]).toMatchObject({
    id: restored.id,
    key: restored.key,
  });
  expect(browser.storage.session.set).toHaveBeenCalledTimes(1);
});
