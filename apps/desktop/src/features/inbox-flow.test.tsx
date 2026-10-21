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
      if (command === "open_pull")
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
  await user.click(screen.getByRole("button", { name: "Finish review" }));
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
    repositories: ["example-org/sample-repo", "example-org/ui", "me/personal"].map(
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
  await screen.findByRole("button", { name: /Automatic example-org\/sample-repo/ });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "All repos",
    "sample-repo",
    "ui",
  ]);
  expect(screen.queryByRole("button", { name: "Add repos" })).toBeNull();
  expect(settings.repositories).toEqual(["owner/repo"]);
  expect(discoveryRequest).toHaveBeenCalledTimes(1);
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
      .map((b) => b.getAttribute("aria-label"));
  await waitFor(() =>
    expect(order()).toEqual(["me", "alpha", "zeta", "empty"]),
  );
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
  await waitFor(() =>
    expect(order()).toEqual(["me", "zeta", "alpha", "empty"]),
  );
  expect(selectedAccount.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(selectedAccount);
  expect(
    (screen.getByRole("combobox", { name: "Repo" }) as HTMLSelectElement).value,
  ).toBe("alpha/api");
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
