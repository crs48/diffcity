// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import App from "../App";
import { SAMPLE_REPO } from "../lib/inbox";
import type {
  Bootstrap,
  PullRequest,
  ReviewWorkspace,
  Settings,
} from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
const workspace = fixture as ReviewWorkspace;
let settings: Settings;
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
            connected: false,
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
          pulls: [],
          schemaVersion: 3,
          dataDirectory: "fixture",
        } satisfies Bootstrap;
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
      if (command === "save_settings") {
        settings = payload.settings as Settings;
        return settings;
      }
      if (command === "save_progress") return payload.progress;
      if (command === "refresh_inbox") return [];
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
  await user.click(
    screen.getByRole("button", { name: "Finish review" }),
  );
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
  await user.click(
    screen.getByRole("button", { name: "History" }),
  );
  await screen.findByRole("button", { name: /Another author's merged PR/ });
  await user.click(screen.getByRole("button", { name: /All pull requests/ }));
  await waitFor(() =>
    expect(
      screen.queryByText("Local samples · fictional authors and review states"),
    ).toBeNull(),
  );
});
