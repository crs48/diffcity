// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../i18n";
import { PullCard } from "./PullCard";
import type { PullRequest } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
afterEach(cleanup);
it("exposes status text, full repo identity and time without inventing unavailable diff counts", async () => {
  const pull: PullRequest = {
    ...fixture.snapshot.pull,
    repository: "team/api",
    title: "Refresh the API",
    headRef: "feature/api",
    baseRef: "main",
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    status: {
      mergeable: "CONFLICTING",
      mergeState: "DIRTY",
      checks: "FAILURE",
    },
  };
  const onOpen = vi.fn();
  const onPin = vi.fn();
  render(
    <PullCard
      pull={pull}
      login="me"
      selected={false}
      muted={false}
      pinned={false}
      saving={false}
      onOpen={onOpen}
      onPin={onPin}
    />,
  );
  const card = screen.getByRole("button", { name: /Refresh the API/ });
  expect(within(card).getByText("Checks failed")).toBeTruthy();
  expect(within(card).getByText("Merge conflicts")).toBeTruthy();
  expect(within(card).getByText("team/api")).toBeTruthy();
  expect(card.querySelector("time")?.getAttribute("dateTime")).toBe(
    pull.updatedAt,
  );
  expect(card.querySelector(".pull-card-stats")).toBeNull();
  expect(card.querySelector("button")).toBeNull();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: `Pin pull request team/api#${pull.number}`,
    }),
  );
  expect(onPin).toHaveBeenCalledWith(pull);
  expect(onOpen).not.toHaveBeenCalled();
  card.focus();
  await user.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith(pull);
});
