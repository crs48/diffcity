// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import App from "../App";
import { SAMPLE_REPO } from "../lib/inbox";
import type {
  Bootstrap,
  PullRequest,
  ReviewWorkspace,
  Settings,
  RepositoryDirectory,
  InboxResult,
  Pins,
  PullGuide,
  Guide,
} from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const workspace = fixture as ReviewWorkspace;
let settings: Settings;
let livePulls: PullRequest[];
let connected: boolean;
let discovered: RepositoryDirectory;
let pins: Pins;
let historyPulls: PullRequest[];
let pinFailure: boolean;
const discoveryRequest = vi.fn();
const historyRequest = vi.fn();
const ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
const samples: PullRequest[] = [
  {
    ...workspace.snapshot.pull,
    repository: SAMPLE_REPO,
    number: 101,
    title: "My draft",
    author: "me",
    draft: true,
  },
  {
    ...workspace.snapshot.pull,
    repository: SAMPLE_REPO,
    number: 105,
    title: "Requested PR",
    author: "alex",
    draft: false,
    requested: ["me"],
  },
  {
    ...workspace.snapshot.pull,
    repository: SAMPLE_REPO,
    number: 120,
    title: "Completed four days ago",
    author: "me",
    state: "merged",
    mergedAt: ago(4),
    closedAt: ago(4),
  },
  {
    ...workspace.snapshot.pull,
    repository: SAMPLE_REPO,
    number: 122,
    title: "Another author's merged PR",
    author: "alex",
    state: "merged",
    mergedAt: ago(1),
    closedAt: ago(1),
  },
];
beforeEach(() => {
  localStorage.clear();
  livePulls = [];
  pins = { repositories: [], pulls: [] };
  historyPulls = [];
  pinFailure = false;
  connected = false;
  discovered = { repositories: [], organizations: [], syncError: null };
  discoveryRequest.mockReset();
  historyRequest.mockReset();
  settings = {
    repositories: ["owner/repo"],
    ghPath: null,
    codexPath: null,
    model: null,
    theme: "light",
    locale: "en",
    completedDays: 2,
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  mockWindows("main");
  Object.assign(window, {
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
  });
  mockIPC(
    (command, args) => {
      const payload = args as Record<string, unknown>;
      if (command === "bootstrap")
        return {
          settings,
          github: {
            connected,
            identity: "me",
            executable: "",
            detail: "Fixture",
          },
          codex: {
            connected: false,
            identity: "",
            executable: "",
            detail: "Fixture",
          },
          models: [],
          modelPreference: {
            provider: "codex",
            model: "gpt-6-astra",
            reasoningEffort: "xhigh",
          },
          pulls: connected ? [] : livePulls,
          pins: structuredClone(pins),
          directory: {
            repositories: settings.repositories.map((fullName) => ({
              id: fullName,
              fullName,
              private: true,
              description: "",
              updatedAt: null,
              pushedAt: null,
            })),
            organizations: [],
            syncError: null,
          },
          schemaVersion: 3,
          dataDirectory: "fixture",
        } satisfies Bootstrap;
      if (command === "list_pull_history") {
        historyRequest(payload);
        return { pulls: historyPulls, nextPage: null, syncError: null };
      }
      if (command === "refresh_directory") {
        discoveryRequest();
        return discovered;
      }
      if (command === "sample_inbox") return structuredClone(samples);
      if (command === "pull_guides") return [];
      if (command === "open_pull" || command === "sync_pull")
        return {
          ...structuredClone(workspace),
          snapshot: {
            ...workspace.snapshot,
            id: `sample-${payload.number}`,
            pull: samples.find((p) => p.number === payload.number),
          },
        };
      if (command === "pin_repository") {
        if (pinFailure) throw Error("Could not save pin");
        const repo = payload.repository as string;
        pins.repositories = [
          ...pins.repositories.filter((p) => p !== repo),
          ...(payload.pinned ? [repo] : []),
        ];
        return structuredClone(pins);
      }
      if (command === "pin_pull") {
        if (pinFailure) throw Error("Could not save pin");
        const pull = payload.pull as PullRequest;
        pins.pulls = [
          ...pins.pulls.filter(
            (p) => p.repository !== pull.repository || p.number !== pull.number,
          ),
          ...(payload.pinned ? [pull] : []),
        ];
        return structuredClone(pins);
      }
      if (command === "save_settings") {
        settings = payload.settings as Settings;
        return settings;
      }
      if (command === "save_progress") return payload.progress;
      if (command === "refresh_inbox")
        return { pulls: livePulls, syncError: null };
      throw Error(`Unexpected command: ${command}`);
    },
    { shouldMockEvents: true },
  );
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  clearMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("generates provider guides in the background using the latest revision and remembered model, with retry and no duplicate runs", async () => {
  const user = userEvent.setup();
  const pull = {
    ...workspace.snapshot.pull,
    repository: "owner/repo",
    title: "Background guide target",
  };
  livePulls = [pull];
  const preference = {
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "high",
  };
  const metadata: PullGuide = {
    repository: pull.repository,
    number: pull.number,
    head: "old-head",
    base: pull.base,
    snapshotId: "old-snapshot",
    generatedAt: "2026-10-23T09:00:00Z",
    preference,
  };
  let inventory = [metadata];
  vi.spyOn(api, "pullGuides").mockImplementation(async () => inventory);
  const opened = {
    ...structuredClone(workspace),
    snapshot: {
      ...workspace.snapshot,
      id: "reading",
      pull: { ...pull, title: "The review I am reading" },
    },
  };
  vi.spyOn(api, "sample").mockResolvedValue(opened);
  const fresh = {
    ...structuredClone(workspace),
    snapshot: {
      ...workspace.snapshot,
      id: "fresh-snapshot",
      pull: { ...pull, head: "latest-head" },
    },
  };
  const sync = vi.spyOn(api, "sync").mockResolvedValue(fresh);
  let finish!: (guide: Guide) => void;
  const analyze = vi.spyOn(api, "analyze").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Try a guided review" }),
  );
  await screen.findByRole("heading", { name: "The review I am reading" });
  const target = screen.getByRole("button", {
    name: /Background guide target/,
  });
  const card = within(target.parentElement!);
  const stale = card.getByRole("button", {
    name: /Claude · Guide out of date/,
  });
  expect(stale.className).toContain("guide-stale");
  expect(target.querySelector("button")).toBeNull();
  await user.click(stale);
  await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  expect(sync).toHaveBeenCalledWith(pull.repository, pull.number);
  expect(analyze).toHaveBeenLastCalledWith(
    "fresh-snapshot",
    expect.any(String),
    preference,
  );
  const generating = card.getByRole("button", {
    name: /Claude · Generating guide/,
  });
  expect(generating.getAttribute("aria-disabled")).toBe("true");
  await user.click(generating);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("heading", { name: "The review I am reading" }),
  ).toBeTruthy();

  // A different provider remains independently actionable while Claude is busy.
  analyze.mockRejectedValueOnce(new Error("Codex temporarily unavailable"));
  const codex = card.getByRole("button", { name: /Codex · No guide yet/ });
  codex.focus();
  await user.keyboard("{Enter}");
  await card.findByRole("button", { name: /Codex · Guide unavailable/ });
  expect(screen.queryByRole("button", { name: "View guide" })).toBeNull();
  expect(analyze).toHaveBeenLastCalledWith(
    "fresh-snapshot",
    expect.any(String),
    {
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    },
  );
  expect(
    card.getByRole("button", { name: /Claude · Generating guide/ }),
  ).toBeTruthy();
  inventory = [
    { ...metadata, head: "latest-head", snapshotId: "fresh-snapshot" },
  ];
  const focusBeforeCompletion = document.activeElement;
  await act(async () =>
    finish({
      ...workspace.guide,
      id: "new-guide",
      source: "claude",
      model: "claude-fable-5",
      snapshotId: "fresh-snapshot",
      sections: [],
    }),
  );
  const current = await card.findByRole("button", {
    name: /Claude · Guide up to date/,
  });
  expect(current.className).toContain("guide-current");
  expect(current.getAttribute("aria-label")).toContain("claude-fable-5 · High");
  expect(
    screen.getByRole("heading", { name: "The review I am reading" }),
  ).toBeTruthy();
  const notice = within(
    screen.getByRole("region", { name: "Guide notifications" }),
  );
  expect(notice.getByRole("heading", { name: "Guide ready" })).toBeTruthy();
  expect(notice.getByText("Claude · claude-fable-5")).toBeTruthy();
  expect(document.activeElement).toBe(focusBeforeCompletion);

  analyze.mockResolvedValueOnce({ ...workspace.guide, sections: [] });
  await user.click(
    card.getByRole("button", { name: /Codex · Guide unavailable/ }),
  );
  await waitFor(() => expect(analyze).toHaveBeenCalledTimes(3));
  await card.findByRole("button", { name: /Codex · No guide yet/ });

  const selected = {
    ...fresh,
    guide: {
      ...fresh.guide,
      id: "new-guide",
      snapshotId: "fresh-snapshot",
      model: "claude-fable-5",
      summary: "The completed guide overview",
    },
  };
  const select = vi
    .spyOn(api, "selectGuide")
    .mockRejectedValueOnce(new Error("Could not load saved guide"))
    .mockResolvedValue(selected);
  await user.click(notice.getByRole("button", { name: "View guide" }));
  expect(await notice.findByRole("alert")).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "The review I am reading" }),
  ).toBeTruthy();
  await user.click(notice.getByRole("button", { name: "View guide" }));
  expect(select).toHaveBeenLastCalledWith("fresh-snapshot", "new-guide");
  await screen.findByRole("heading", { name: "Background guide target" });
  expect(screen.queryByRole("button", { name: "View guide" })).toBeNull();
  expect(screen.getByText("The completed guide overview")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      document.getElementById("review-workspace"),
    ),
  );
});

it.each(["view", "dismiss"])(
  "lets the reader %s a completed guide while looking at files",
  async (action) => {
    const user = userEvent.setup();
    const pull = {
      ...workspace.snapshot.pull,
      repository: "owner/repo",
      title: "Current review",
    };
    livePulls = [pull];
    const review = {
      ...structuredClone(workspace),
      snapshot: { ...workspace.snapshot, pull },
    };
    const guide = {
      ...review.guide,
      id: "completed-guide",
      model: "claude-fable-5",
      summary: "New guide overview",
    };
    vi.spyOn(api, "open").mockResolvedValue(review);
    vi.spyOn(api, "sync").mockResolvedValue(review);
    vi.spyOn(api, "analyze").mockResolvedValue(guide);
    const select = vi
      .spyOn(api, "selectGuide")
      .mockResolvedValue({ ...review, guide });
    render(<App />);
    const target = await screen.findByRole("button", {
      name: /Current review/,
    });
    await user.click(target);
    await screen.findByRole("heading", { name: "Current review" });
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(
      within(target.parentElement!).getByRole("button", {
        name: /Claude · No guide yet/,
      }),
    );
    await screen.findByRole("button", { name: "View guide" });
    expect(
      screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected"),
    ).toBe("true");
    await user.click(
      screen.getByRole("button", {
        name: action === "view" ? "View guide" : "Dismiss guide notification",
      }),
    );
    if (action === "view") {
      await screen.findByText("New guide overview");
      expect(select).toHaveBeenCalledWith(review.snapshot.id, guide.id);
      expect(
        screen
          .getByRole("tab", { name: "Guide" })
          .getAttribute("aria-selected"),
      ).toBe("true");
    } else {
      expect(select).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole("tab", { name: "Files" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      // Dismissing the toast does not discard the saved guide's existing activity action.
      await user.click(screen.getByRole("button", { name: /Review activity/ }));
      expect(
        screen.getByRole("button", { name: /Open updated guide/ }),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "View guide" })).toBeNull();
  },
);

it("does not jump back when a different PR is opened while a ready guide is loading", async () => {
  const user = userEvent.setup();
  const pull = {
    ...workspace.snapshot.pull,
    repository: "owner/repo",
    number: 1,
    title: "Ready guide PR",
  };
  const other = { ...pull, number: 2, title: "Later navigation wins" };
  livePulls = [pull, other];
  const ready = {
    ...structuredClone(workspace),
    snapshot: { ...workspace.snapshot, id: "ready-revision", pull },
  };
  vi.spyOn(api, "sync").mockResolvedValue(ready);
  const guide = {
    ...ready.guide,
    id: "ready-guide",
    snapshotId: ready.snapshot.id,
    sections: [],
  };
  vi.spyOn(api, "analyze").mockResolvedValue(guide);
  let finish!: (value: ReviewWorkspace) => void;
  const select = vi.spyOn(api, "selectGuide").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.spyOn(api, "open").mockResolvedValue({
    ...ready,
    snapshot: { ...ready.snapshot, id: "other-revision", pull: other },
  });
  render(<App />);
  const target = await screen.findByRole("button", { name: /Ready guide PR/ });
  await user.click(
    within(target.parentElement!).getByRole("button", {
      name: /Claude · No guide yet/,
    }),
  );
  await user.click(await screen.findByRole("button", { name: "View guide" }));
  await waitFor(() =>
    expect(select).toHaveBeenCalledWith("ready-revision", "ready-guide"),
  );
  await user.click(
    screen.getByRole("button", { name: /Later navigation wins/ }),
  );
  await screen.findByRole("heading", { name: "Later navigation wins" });
  await act(async () => finish({ ...ready, guide }));
  expect(
    screen.getByRole("heading", { name: "Later navigation wins" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "View guide" })).toBeTruthy();
});
it("moves a sample review down and back up without publishing or changing real inbox data", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Sample inbox" }));
  await user.click(await screen.findByRole("button", { name: /Requested PR/ }));
  await user.click(
    await screen.findByRole("button", { name: "Simulate submitted review" }),
  );
  const reviewed = screen.getByRole("region", { name: "Reviewed" });
  expect(
    within(reviewed).getByRole("button", { name: /Requested PR/ }).className,
  ).toContain("pull-muted");
  await user.click(
    screen.getByRole("button", { name: "Simulate review request" }),
  );
  expect(
    within(screen.getByRole("region", { name: "Needs your review" })).getByRole(
      "button",
      { name: /Review requested again/ },
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open in GitHub" })).toBeNull();
  await user.click(screen.getAllByRole("button", { name: "Finish review" })[0]);
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Review summary"),
    "Local sample only",
  );
  expect(
    within(dialog)
      .getByRole("button", { name: "Publish review" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("persists display choices and keeps older and other-author completions in History", async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  await user.click(await screen.findByRole("button", { name: "Sample inbox" }));
  expect(
    screen.queryByRole("button", { name: /Completed four days ago/ }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Display settings" }));
  await user.selectOptions(
    screen.getByLabelText("Show your completed PRs"),
    "7",
  );
  await user.click(
    screen.getByRole("button", { name: "Save display settings" }),
  );
  await screen.findByRole("button", { name: /Completed four days ago/ });
  expect(settings.completedDays).toBe(7);
  expect(
    screen.queryByRole("button", { name: /Another author's merged PR/ }),
  ).toBeNull();
  view.unmount();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Sample inbox" }));
  await screen.findByRole("button", { name: /Completed four days ago/ });
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("button", { name: /Another author's merged PR/ });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Local samples · fictional authors and review states"),
    ).toBeNull(),
  );
});

it("hides other account avatars for captures and restores them when disabled", async () => {
  settings.repositories = ["acme/api", "me/api"];
  const user = userEvent.setup();
  const view = render(<App />);
  await user.click(await screen.findByRole("button", { name: "me" }));
  await user.click(screen.getByRole("button", { name: "Display settings" }));
  await user.click(screen.getByLabelText("Hide other account avatars"));
  await user.click(
    screen.getByRole("button", { name: "Close display settings" }),
  );
  const accounts = screen.getByRole("navigation", {
    name: "Choose an organization or account",
  });
  expect(within(accounts).getByRole("button", { name: "me" })).toBeTruthy();
  expect(
    within(accounts).queryByRole("button", { name: "acme", hidden: true }),
  ).toBeNull();
  expect(accounts.querySelectorAll("img")).toHaveLength(1);
  view.unmount();
  render(<App />);
  await screen.findByRole("button", { name: "me" });
  expect(
    screen.queryByRole("button", { name: "acme", hidden: true }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Display settings" }));
  await user.click(screen.getByLabelText("Hide other account avatars"));
  await user.click(
    screen.getByRole("button", { name: "Close display settings" }),
  );
  expect(
    screen.getByRole("button", { name: /Show inactive accounts/ }),
  ).toBeTruthy();
});

it("filters all accounts to an account then a repo, preserving search and history scope", async () => {
  settings.repositories = ["acme/api", "acme/web", "me/api"];
  livePulls = settings.repositories.map((repository, index) => ({
    ...workspace.snapshot.pull,
    repository,
    number: index + 1,
    title: `Update ${repository}`,
  }));
  const user = userEvent.setup();
  render(<App />);
  const acme = await screen.findByRole("button", { name: "acme" });
  const image = acme.querySelector("img")!;
  fireEvent.error(image);
  expect(acme.querySelector("img")).toBeNull();
  expect(acme.textContent).toBe("AC");
  acme.focus();
  await user.keyboard("{Enter}");
  expect(acme.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /Update acme\/api/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Update me\/api/ })).toBeNull();
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "All repos",
    "api",
    "web",
  ]);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Repo" }),
    "acme/web",
  );
  expect(screen.queryByRole("button", { name: /Update acme\/api/ })).toBeNull();
  await user.type(
    screen.getByRole("textbox", { name: "Search pull requests" }),
    "Update",
  );
  await user.click(screen.getByRole("button", { name: "me" }));
  expect(
    (screen.getByRole("combobox", { name: "Repo" }) as HTMLSelectElement).value,
  ).toBe("");
  expect(screen.getByRole("button", { name: /Update me\/api/ })).toBeTruthy();
  expect(
    (
      screen.getByRole("textbox", {
        name: "Search pull requests",
      }) as HTMLInputElement
    ).value,
  ).toBe("Update");
  await user.click(screen.getByRole("button", { name: "History" }));
  await waitFor(() =>
    expect(historyRequest).toHaveBeenLastCalledWith({
      repository: null,
      owner: "me",
      page: 1,
    }),
  );
  await user.click(screen.getByRole("button", { name: "acme" }));
  await waitFor(() =>
    expect(historyRequest).toHaveBeenLastCalledWith({
      repository: null,
      owner: "acme",
      page: 1,
    }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Repo" }),
    "acme/api",
  );
  await waitFor(() =>
    expect(historyRequest).toHaveBeenLastCalledWith({
      repository: "acme/api",
      owner: "acme",
      page: 1,
    }),
  );
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await waitFor(() =>
    expect(historyRequest).toHaveBeenLastCalledWith({
      repository: null,
      owner: null,
      page: 1,
    }),
  );
});

it("discovers orgs, repos and PRs automatically without adding or saving repositories", async () => {
  connected = true;
  discovered = {
    organizations: ["example-org", "empty-org"],
    syncError: null,
    repositories: ["example-org/api", "example-org/ui", "me/personal"].map(
      (fullName) => ({
        id: fullName,
        fullName,
        private: true,
        description: "",
        updatedAt: null,
        pushedAt: null,
      }),
    ),
  };
  livePulls = discovered.repositories.map((repo, index) => ({
    ...workspace.snapshot.pull,
    repository: repo.fullName,
    number: index + 1,
    title: `Automatic ${repo.fullName}`,
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "example-org" }));
  await screen.findByRole("button", { name: /Automatic example-org\/api/ });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "All repos",
    "api",
    "ui",
  ]);
  expect(screen.queryByRole("button", { name: "Add repos" })).toBeNull();
  expect(settings.repositories).toEqual(["owner/repo"]);
  expect(discoveryRequest).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole("button", { name: "Show inactive accounts (1)" }),
  );
  await user.click(screen.getByRole("button", { name: "empty-org" }));
  expect(
    screen
      .getByRole("button", { name: "empty-org" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await screen.findByRole("button", { name: /Automatic me\/personal/ });
  expect(screen.getAllByRole("option")).toHaveLength(4);
});

it("reorders accounts after PR activity without changing the selected repo or keyboard focus", async () => {
  connected = true;
  discovered = {
    repositories: ["alpha/api", "zeta/api"].map((fullName, index) => ({
      id: fullName,
      fullName,
      private: true,
      description: "",
      updatedAt: ago(index + 2),
      pushedAt: null,
    })),
    organizations: ["alpha", "zeta", "empty"],
    syncError: null,
  };
  const user = userEvent.setup();
  render(<App />);
  const rail = await screen.findByRole("navigation", {
    name: "Choose an organization or account",
  });
  const order = () =>
    within(rail)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"))
      .map((b) => b.getAttribute("aria-label"));
  await waitFor(() => expect(order()).toEqual(["me", "alpha", "zeta"]));
  const selectedAccount = within(rail).getByRole("button", { name: "alpha" });
  await user.click(selectedAccount);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Repo" }),
    "alpha/api",
  );
  selectedAccount.focus();
  await act(async () => {
    await emit("inbox-sync", {
      completed: 2,
      total: 2,
      pulls: [
        {
          ...workspace.snapshot.pull,
          repository: "zeta/api",
          updatedAt: ago(0),
        },
      ],
    });
  });
  await waitFor(() => expect(order()).toEqual(["me", "zeta", "alpha"]));
  expect(selectedAccount.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(selectedAccount);
  expect(
    (screen.getByRole("combobox", { name: "Repo" }) as HTMLSelectElement).value,
  ).toBe("alpha/api");
});

it("folds inactive accounts with a keyboard disclosure while retaining inbox contents and selection", async () => {
  connected = true;
  discovered = {
    organizations: ["fresh", "old", "unknown"],
    syncError: null,
    repositories: ["fresh/api", "old/api"].map((fullName, index) => ({
      id: fullName,
      fullName,
      private: true,
      description: "",
      updatedAt: ago(index ? 45 : 1),
      pushedAt: null,
    })),
  };
  const oldPull = {
    ...workspace.snapshot.pull,
    repository: "old/api",
    title: "Still open in an inactive account",
    updatedAt: ago(45),
  };
  livePulls = [oldPull];
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", {
    name: /Still open in an inactive account/,
  });
  expect(screen.queryByRole("button", { name: "old" })).toBeNull();
  expect(screen.queryByRole("button", { name: "unknown" })).toBeNull();
  expect(screen.getByRole("button", { name: "me" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "fresh" })).toBeTruthy();
  const disclosure = screen.getByRole("button", {
    name: "Show inactive accounts (2)",
  });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  const controls = disclosure.getAttribute("aria-controls")!.split(" ");
  expect(controls.every((id) => document.getElementById(id)?.hidden)).toBe(
    true,
  );
  disclosure.focus();
  await user.keyboard("{Enter}");
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  await user.tab();
  const oldAccount = screen.getByRole("button", { name: "old" });
  expect(document.activeElement).toBe(oldAccount);
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(oldAccount);
  expect(oldAccount.getAttribute("aria-pressed")).toBe("true");
  await user.click(
    screen.getByRole("button", { name: "Hide inactive accounts (1)" }),
  );
  expect(screen.getByRole("button", { name: "old" })).toBe(oldAccount);
  expect(screen.queryByRole("button", { name: "unknown" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  expect(screen.queryByRole("button", { name: "old" })).toBeNull();
  expect(
    screen.getByRole("button", { name: /Still open in an inactive account/ }),
  ).toBeTruthy();
  // A new update brings a folded account back without a manual expansion.
  await act(async () => {
    await emit("inbox-sync", {
      completed: 2,
      total: 2,
      pulls: [{ ...oldPull, updatedAt: ago(0) }],
    });
  });
  await screen.findByRole("button", { name: "old" });
  expect(
    screen
      .getByRole("button", { name: "Show inactive accounts (1)" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("shows incremental PR batches and preserves them when a sync is partial", async () => {
  connected = true;
  discovered = {
    repositories: ["owner/repo", "owner/other"].map((fullName) => ({
      id: fullName,
      fullName,
      private: true,
      description: "",
      updatedAt: null,
      pushedAt: null,
    })),
    organizations: ["owner"],
    syncError: null,
  };
  const pull = {
    ...workspace.snapshot.pull,
    repository: "owner/repo",
    title: "First discovered PR",
  };
  let finish!: (value: InboxResult) => void;
  vi.spyOn(api, "inbox").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  await waitFor(() => expect(api.inbox).toHaveBeenCalled());
  await act(async () => {
    await emit("inbox-sync", { completed: 1, total: 2, pulls: [pull] });
  });
  expect(
    await screen.findByRole("button", { name: /First discovered PR/ }),
  ).toBeTruthy();
  expect(screen.getByText("Syncing repos 1 / 2")).toBeTruthy();
  await act(async () => {
    finish({
      pulls: [pull],
      syncError: "One repo unavailable; saved results retained",
    });
  });
  expect(
    await screen.findByText("One repo unavailable; saved results retained"),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /First discovered PR/ }),
  ).toBeTruthy();
  expect(screen.queryByText(/^Synced /)).toBeNull();
});

it("persists repo shortcuts, groups selector options, and respects account scope", async () => {
  settings.repositories = ["acme/api", "acme/web", "other/api"];
  const user = userEvent.setup();
  const view = render(<App />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Repo" }),
    "acme/web",
  );
  await user.click(screen.getByRole("button", { name: "Pin repo acme/web" }));
  const shortcuts = await screen.findByRole("navigation", {
    name: "Pinned repos",
  });
  expect(
    within(shortcuts)
      .getByRole("button", { name: "Show pinned repo acme/web" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value),
  ).toEqual(["", "acme/web", "acme/api", "other/api"]);
  await user.click(
    screen.getByRole("button", { name: "Show inactive accounts (2)" }),
  );
  await user.click(screen.getByRole("button", { name: "other" }));
  expect(screen.queryByRole("navigation", { name: "Pinned repos" })).toBeNull();
  view.unmount();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Show pinned repo acme/web" }),
  );
  expect(
    (screen.getByRole("combobox", { name: "Repo" }) as HTMLSelectElement).value,
  ).toBe("acme/web");
  await user.click(screen.getByRole("button", { name: "Unpin repo acme/web" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Pinned repos" }),
    ).toBeNull(),
  );
  expect(settings.repositories).toEqual(["acme/api", "acme/web", "other/api"]);
});

it("pins a PR without opening it, restores keyboard focus, and survives remount", async () => {
  livePulls = [
    {
      ...workspace.snapshot.pull,
      repository: "owner/repo",
      number: 1,
      title: "My PR",
      author: "me",
    },
    {
      ...workspace.snapshot.pull,
      repository: "owner/repo",
      number: 2,
      title: "Review this PR",
      author: "alex",
      requested: ["me"],
    },
  ];
  const openRequest = vi.spyOn(api, "open");
  const user = userEvent.setup();
  const view = render(<App />);
  (
    await screen.findByRole("button", { name: "Pin pull request owner/repo#2" })
  ).focus();
  await user.keyboard("{Enter}");
  const pinnedGroup = await screen.findByRole("region", {
    name: "Pinned pull requests",
  });
  expect(
    within(pinnedGroup).getByRole("button", { name: /Review this PR/ }),
  ).toBeTruthy();
  expect(
    document.querySelector(".pull-list section")?.getAttribute("aria-label"),
  ).toBe("Pinned pull requests");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Unpin pull request owner/repo#2" }),
    ),
  );
  expect(openRequest).not.toHaveBeenCalled();
  view.unmount();
  render(<App />);
  await screen.findByRole("region", { name: "Pinned pull requests" });
  await user.click(
    screen.getByRole("button", { name: "Unpin pull request owner/repo#2" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Pinned pull requests" }),
    ).toBeNull(),
  );
  expect(
    within(screen.getByRole("region", { name: "Needs your review" })).getByRole(
      "button",
      { name: /Review this PR/ },
    ),
  ).toBeTruthy();
});

it("keeps an old pinned completion in the inbox, honors filters, and preserves pins after a failed save", async () => {
  settings.repositories = ["owner/repo", "other/repo"];
  settings.completedDays = 0;
  historyPulls = [
    {
      ...workspace.snapshot.pull,
      repository: "owner/repo",
      number: 3,
      title: "Old merged work",
      state: "merged",
      author: "alex",
      closedAt: ago(40),
      mergedAt: ago(40),
    },
  ];
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "History" }));
  await user.click(
    await screen.findByRole("button", {
      name: "Pin pull request owner/repo#3",
    }),
  );
  await screen.findByRole("region", { name: "Pinned pull requests" });
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  expect(screen.getByRole("button", { name: /Old merged work/ })).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Show inactive accounts (2)" }),
  );
  await user.click(screen.getByRole("button", { name: "other" }));
  expect(screen.queryByRole("button", { name: /Old merged work/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.type(
    screen.getByRole("textbox", { name: "Search pull requests" }),
    "unrelated",
  );
  expect(
    screen.queryByRole("region", { name: "Pinned pull requests" }),
  ).toBeNull();
  await user.clear(
    screen.getByRole("textbox", { name: "Search pull requests" }),
  );
  pinFailure = true;
  await user.click(
    screen.getByRole("button", { name: "Unpin pull request owner/repo#3" }),
  );
  await screen.findByText(/Could not save pin/);
  expect(
    screen.getByRole("region", { name: "Pinned pull requests" }),
  ).toBeTruthy();
  pinFailure = false;
  await user.click(
    screen.getByRole("button", { name: "Unpin pull request owner/repo#3" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /Old merged work/ }),
    ).toBeNull(),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Search pull requests" }),
    ),
  );
});

it("opens cached reviews immediately while GitHub is slow and ignores late updates after switching", async () => {
  connected = true;
  const first = {
    ...workspace.snapshot.pull,
    repository: "owner/repo",
    number: 201,
    title: "Cached first review",
    author: "me",
    state: "open",
  };
  const second = { ...first, number: 202, title: "Cached second review" };
  livePulls = [first, second];
  discovered.repositories = [
    {
      id: "owner/repo",
      fullName: "owner/repo",
      private: true,
      description: "",
      updatedAt: null,
      pushedAt: null,
    },
  ];
  let finishFirst: (value: ReviewWorkspace) => void = () => {};
  let finishSecond: (value: ReviewWorkspace) => void = () => {};
  const cached = (pull: PullRequest) => ({
    ...structuredClone(workspace),
    snapshot: { ...workspace.snapshot, id: `cached-${pull.number}`, pull },
  });
  const open = vi
    .spyOn(api, "open")
    .mockImplementation(async (_repo, number) =>
      cached(number === 201 ? first : second),
    );
  const sync = vi
    .spyOn(api, "sync")
    .mockImplementation(async (_repo, number) => {
      return new Promise((resolve) => {
        if (number === 201) finishFirst = resolve;
        else finishSecond = resolve;
      });
    });
  vi.spyOn(api, "prefetch").mockResolvedValue(true);
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: /Cached first review/ }),
  );
  expect(
    await screen.findByRole("heading", { name: first.title }),
  ).toBeTruthy();
  expect(open).toHaveBeenCalledWith("owner/repo", 201, false);
  await waitFor(() => expect(sync).toHaveBeenCalledWith("owner/repo", 201));
  await user.click(
    screen.getByRole("button", { name: /Cached second review/ }),
  );
  expect(
    await screen.findByRole("heading", { name: second.title }),
  ).toBeTruthy();
  const newerFirst = cached({ ...first, head: "changed-head" });
  newerFirst.snapshot.id = "newer-first";
  await act(async () => finishFirst(newerFirst));
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Load new revision/ }),
  ).toBeNull();
  const newerSecond = cached({ ...second, head: "changed-head" });
  newerSecond.snapshot.id = "newer-second";
  await act(async () => finishSecond(newerSecond));
  await screen.findByText("New code is available");
  const activity = screen.getByRole("button", { name: "Review activity" });
  expect(activity.querySelector(".review-tool-dot")).toBeTruthy();
  await user.click(activity);
  expect(
    await screen.findByRole("button", { name: /Load new revision/ }),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  // The current code remains pinned until that explicit action.
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("restores a saved review before directory discovery finishes", async () => {
  connected = true;
  localStorage.setItem(
    "diffcity.lastPr",
    "https://github.com/owner/repo/pull/201",
  );
  vi.spyOn(api, "directory").mockReturnValue(new Promise(() => {}));
  const cached = {
    ...structuredClone(workspace),
    snapshot: {
      ...workspace.snapshot,
      pull: {
        ...workspace.snapshot.pull,
        repository: "owner/repo",
        number: 201,
        title: "Restored before discovery",
      },
    },
  };
  vi.spyOn(api, "open").mockImplementation((_repo, _number, refresh) =>
    refresh ? new Promise(() => {}) : Promise.resolve(cached),
  );
  vi.spyOn(api, "sync").mockReturnValue(new Promise(() => {}));
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Restored before discovery" }),
  ).toBeTruthy();
});

it("keeps review progress and saved private notes when background metadata arrives", async () => {
  connected = true;
  const pull = {
    ...workspace.snapshot.pull,
    repository: "owner/repo",
    number: 201,
    title: "Review with private progress",
    author: "me",
    state: "open",
  };
  livePulls = [pull];
  discovered.repositories = [
    {
      id: "owner/repo",
      fullName: "owner/repo",
      private: true,
      description: "",
      updatedAt: null,
      pushedAt: null,
    },
  ];
  const cached: ReviewWorkspace = {
    ...structuredClone(workspace),
    snapshot: { ...workspace.snapshot, pull },
    notes: [
      {
        id: "private-note",
        snapshotId: workspace.snapshot.id,
        anchor: null,
        body: "Keep this private context",
        role: "user",
        parentId: null,
        githubDraft: false,
        publishedUrl: null,
        createdAt: "2026-10-21T00:00:00Z",
      },
    ],
  };
  vi.spyOn(api, "open").mockResolvedValue(cached);
  let finish: (value: ReviewWorkspace) => void = () => {};
  vi.spyOn(api, "sync").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.spyOn(api, "prefetch").mockResolvedValue(true);
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: /Review with private progress/ }),
  );
  await user.click(
    (await screen.findAllByRole("button", { name: "Mark code reviewed" }))[0],
  );
  expect(screen.getByRole("button", { name: "Code reviewed" })).toBeTruthy();
  await act(async () =>
    finish({
      ...cached,
      notes: [],
      progress: structuredClone(workspace.progress),
      checks: "All checks passed",
    }),
  );
  expect(screen.getByRole("button", { name: "Code reviewed" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^PR chat/ }));
  expect(
    await screen.findByText("Keep this private context", {
      selector: ".message p",
    }),
  ).toBeTruthy();
});
