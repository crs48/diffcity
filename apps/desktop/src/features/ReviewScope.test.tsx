// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  api,
  type ReviewCheckpoint,
  type ReviewComparison,
  type ReviewWorkspace,
} from "../lib/api";
import { ReviewScope } from "./ReviewScope";
import { Finish } from "./Dialogs";
import fixture from "../../../../tests/fixtures/review-workspace.json";

vi.mock("./Guide", () => ({
  GuideView: ({
    workspace,
    onDiscuss,
  }: {
    workspace: ReviewWorkspace;
    onDiscuss: (anchor: object) => void;
  }) => (
    <div>
      <p>Focused files: {workspace.snapshot.files.length}</p>
      <button
        onClick={() =>
          onDiscuss({
            hunkId: "delta",
            path: workspace.snapshot.files[1].path,
            side: "RIGHT",
            startLine: 2,
            line: 4,
          })
        }
      >
        Comment on update
      </button>
    </div>
  ),
}));
const workspace = fixture as ReviewWorkspace;
const baseline: ReviewCheckpoint = {
  head: "reviewed-head",
  reviewedAt: "2026-10-20T12:00:00Z",
  source: "github",
};
const comparison: ReviewComparison = {
  baseline,
  snapshot: {
    ...workspace.snapshot,
    id: "comparison",
    files: workspace.snapshot.files.slice(0, 2),
  },
};
const renderScope = (onDiscuss = vi.fn()) =>
  render(
    <ReviewScope
      workspace={workspace}
      refreshKey={0}
      onDiscuss={onDiscuss}
      onFinish={vi.fn()}
    >
      <p>Original guide and private notes</p>
    </ReviewScope>,
  );
beforeEach(() => {
  vi.spyOn(api, "baseline").mockResolvedValue({
    checkpoint: baseline,
    syncError: null,
  });
  vi.spyOn(api, "compare").mockResolvedValue(comparison);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("makes the baseline discoverable and switches back without changing notes or progress", async () => {
  const user = userEvent.setup();
  renderScope();
  expect(await screen.findByText("Your GitHub review")).toBeTruthy();
  expect(api.compare).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: /Since your last review/ }),
  );
  expect(await screen.findByText("Focused files: 2")).toBeTruthy();
  expect(screen.queryByText("Original guide and private notes")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Full PR" }));
  expect(screen.getByText("Original guide and private notes")).toBeTruthy();
});
it("offers an honest empty state at the same revision", async () => {
  vi.mocked(api.compare).mockResolvedValue({
    ...comparison,
    snapshot: { ...comparison.snapshot, files: [] },
  });
  renderScope();
  await screen.findByText("Your GitHub review");
  await userEvent.click(
    screen.getByRole("button", { name: /Since your last review/ }),
  );
  expect(await screen.findByText("You're up to date")).toBeTruthy();
});
it("keeps the full PR usable when comparison fails, then retries", async () => {
  vi.mocked(api.compare).mockRejectedValueOnce(
    "History rewritten; use Full PR",
  );
  renderScope();
  await screen.findByText("Your GitHub review");
  await userEvent.click(
    screen.getByRole("button", { name: /Since your last review/ }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("History rewritten"),
  );
  expect(screen.queryByText("You're up to date")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry comparison" }),
  );
  expect(await screen.findByText("Focused files: 2")).toBeTruthy();
});
it("opens comment ranges using the full PR hunk at the same head", async () => {
  const onDiscuss = vi.fn();
  renderScope(onDiscuss);
  await screen.findByText("Your GitHub review");
  await userEvent.click(
    screen.getByRole("button", { name: /Since your last review/ }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Comment on update" }),
  );
  expect(onDiscuss).toHaveBeenCalledWith({
    path: workspace.snapshot.files[1].path,
    hunkId: workspace.snapshot.files[1].hunks[0].id,
    side: "RIGHT",
    startLine: 2,
    line: 4,
  });
  expect(screen.getByText("Original guide and private notes")).toBeTruthy();
});
it("explains first-review availability instead of inventing a baseline", async () => {
  vi.mocked(api.baseline).mockResolvedValue({
    checkpoint: null,
    syncError: null,
  });
  renderScope();
  expect(await screen.findByText(/No previous review yet/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: /Since your last review/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(api.compare).not.toHaveBeenCalled();
});
it("ignores late comparison results after leaving the focused view", async () => {
  let resolve!: (v: ReviewComparison) => void;
  vi.mocked(api.compare).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  renderScope();
  await screen.findByText("Your GitHub review");
  await userEvent.click(
    screen.getByRole("button", { name: /Since your last review/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Full PR" }));
  resolve(comparison);
  await waitFor(() =>
    expect(screen.getByText("Original guide and private notes")).toBeTruthy(),
  );
  expect(screen.queryByText("Focused files: 2")).toBeNull();
});
it("saves a private checkpoint without publishing or marking unread code", async () => {
  const checkpoint = vi.spyOn(api, "checkpoint").mockResolvedValue(baseline);
  const publish = vi.spyOn(api, "publish");
  const progress = vi.spyOn(api, "progress");
  const onCheckpoint = vi.fn();
  render(
    <Finish
      workspace={workspace}
      login="viewer"
      onPublished={vi.fn()}
      onCheckpoint={onCheckpoint}
      onClose={vi.fn()}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save review checkpoint" }),
  );
  expect(checkpoint).toHaveBeenCalledWith(workspace.snapshot.id);
  expect(onCheckpoint).toHaveBeenCalledOnce();
  expect(publish).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
});
