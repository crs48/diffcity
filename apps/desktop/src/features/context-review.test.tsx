// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Diff } from "./Diff";
import { api, type Hunk, type HunkContext } from "../lib/api";

const hunk: Hunk = {
  id: "context-hunk",
  fingerprint: "context-fingerprint",
  path: "src/review.ts",
  header: "@@ -100,1 +100,1 @@",
  lines: [
    { kind: "deletion", old: 100, new: null, text: "oldValue" },
    { kind: "addition", old: null, new: 100, text: "newValue" },
  ],
};
const renderDiff = (value = hunk) =>
  render(
    <Diff
      hunk={value}
      snapshotId="snapshot"
      notes={[]}
      comments={[]}
      split={false}
      selection={null}
      onSelect={vi.fn()}
    />,
  );
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("expanded review code", () => {
  it("renders a whole large hunk and allows complete collapse and expansion", async () => {
    const user = userEvent.setup();
    renderDiff({
      ...hunk,
      lines: Array.from({ length: 1000 }, (_, i) => ({
        kind: "addition",
        old: null,
        new: i + 1,
        text: `added ${i + 1}`,
      })),
    });
    expect(document.querySelectorAll("[data-code-index]")).toHaveLength(1000);
    expect(screen.getByText("added 1000")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Collapse diff src/review.ts" }),
    );
    expect(document.querySelectorAll("[data-code-index]")).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: "Expand diff src/review.ts" }),
    );
    expect(document.querySelectorAll("[data-code-index]")).toHaveLength(1000);
  });

  it("expands both sides cumulatively without creating review anchors outside the diff", async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(api, "context")
      .mockImplementation(
        async (_snapshot, _hunk, before, after): Promise<HunkContext> => ({
          before: Array.from({ length: before }, (_, i) => ({
            kind: "context",
            old: 100 - before + i,
            new: 100 - before + i,
            text: `before ${100 - before + i}`,
          })),
          after: Array.from({ length: after }, (_, i) => ({
            kind: "context",
            old: 101 + i,
            new: 101 + i,
            text: `after ${101 + i}`,
          })),
          beforeRemaining: 99 - before,
          afterRemaining: 50 - after,
        }),
      );
    renderDiff();
    await user.click(
      screen.getByRole("button", { name: "Show 25 lines above" }),
    );
    expect(await screen.findByText("before 75")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show 25 lines below" }),
    );
    expect(await screen.findByText("after 125")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show 25 lines above" }),
    );
    expect(await screen.findByText("before 50")).toBeTruthy();
    expect(request.mock.calls).toEqual([
      ["snapshot", hunk.id, 25, 0],
      ["snapshot", hunk.id, 25, 25],
      ["snapshot", hunk.id, 50, 25],
    ]);
    for (const context of screen.getAllByRole("region", {
      name: "Unchanged surrounding code",
    }))
      expect(within(context).queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Select src/review.ts line 100" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Collapse context" }));
    expect(screen.queryByText("before 50")).toBeNull();
    expect(screen.getByText("newValue")).toBeTruthy();
  });

  it("shows context errors inline and allows a retry without losing the diff", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "context")
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({
        before: [],
        after: [],
        beforeRemaining: 0,
        afterRemaining: 0,
      });
    renderDiff();
    await user.click(
      screen.getByRole("button", { name: "Show 25 lines above" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Offline");
    expect(screen.getByText("newValue")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show 25 lines above" }),
    );
    expect(
      await screen.findByText("No more unchanged lines above this hunk."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Show 25 lines below",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
