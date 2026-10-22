// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, type ChangedFile, type DiffLine, type Hunk } from "../lib/api";
import { selectedCode } from "../lib/textSelection";
import { FileDiff } from "./FileDiff";
import { Diff } from "./Diff";
import { ContextGap } from "./ContextGap";
import "../i18n";

const hunks: Hunk[] = [1, 68].map((n) => ({
  id: String(n),
  fingerprint: String(n),
  path: "src/example.ts",
  header: `@@ -${n},2 +${n},2 @@`,
  lines: [n, n + 1].map((line) => ({
    kind: "context",
    old: line,
    new: line,
    text: `shown ${line}`,
  })),
}));
const file: ChangedFile = {
  path: hunks[0].path,
  previousPath: null,
  status: "modified",
  additions: 0,
  deletions: 0,
  unavailable: null,
  hunks,
};
const source: DiffLine[] = Array.from({ length: 65 }, (_, i) => ({
  kind: "context",
  old: i + 3,
  new: i + 3,
  text: `source ${i + 3}`,
}));
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("joins neighboring hunks into one gap and expands from both ends without duplicating lines", async () => {
  const user = userEvent.setup();
  const request = vi
    .spyOn(api, "context")
    .mockImplementation(async (_snapshot, _hunk, before, after) => ({
      before: before ? source.slice(-before) : [],
      after: source.slice(0, after),
      beforeRemaining: source.length - before,
      afterRemaining: source.length - after,
    }));
  const { container } = render(
    <FileDiff file={file} hunks={hunks} selection={null} snapshotId="snapshot">
      {hunks.map((hunk) => (
        <Diff
          key={hunk.id}
          hunk={hunk}
          selection={null}
          onSelect={vi.fn()}
          notes={[]}
          comments={[]}
          split={false}
          snapshotId="snapshot"
          hideFileHeader
          hideContext
        />
      ))}
    </FileDiff>,
  );
  expect(request).not.toHaveBeenCalled();
  expect(container.querySelectorAll(".file-bar")).toHaveLength(1);
  expect(
    container.querySelectorAll(".hunk-header, .range-toolbar"),
  ).toHaveLength(0);
  const gap = screen
    .getByText("65 hidden lines")
    .closest<HTMLElement>(".context-gap")!;
  const controls = within(gap);
  expect(controls.getAllByRole("button")).toHaveLength(2);
  await user.click(
    controls.getByRole("button", { name: "Show 25 lines below" }),
  );
  expect(controls.getByText("40 hidden lines")).toBeTruthy();
  expect(controls.getByText("source 3")).toBeTruthy();
  await user.click(
    controls.getByRole("button", { name: "Show 25 lines above" }),
  );
  expect(controls.getByText("15 hidden lines")).toBeTruthy();
  expect(controls.getByText("source 67")).toBeTruthy();
  await user.click(
    controls.getByRole("button", { name: "Show 15 lines below" }),
  );
  expect(
    [...gap.querySelectorAll("code")].map((code) => code.textContent),
  ).toEqual(source.map((line) => line.text));
  expect(controls.getAllByRole("button")).toHaveLength(1);
  expect(request.mock.calls).toEqual([
    ["snapshot", "1", 0, 25],
    ["snapshot", "68", 25, 0],
    ["snapshot", "1", 0, 40],
  ]);
  // Revealed context remains available to text-selection questions, never line comments.
  const code = controls.getByText("source 67");
  const range = document.createRange();
  range.selectNodeContents(code);
  expect(selectedCode(range, container)).toMatchObject({
    hunkId: "68",
    startLine: 67,
    line: 67,
    textSelection: { text: "source 67", snapshotId: "snapshot" },
  });
  await user.click(controls.getByRole("button", { name: "Collapse context" }));
  expect(controls.getByText("65 hidden lines")).toBeTruthy();
  expect(controls.queryByText("source 67")).toBeNull();
  expect(screen.getByText("shown 68")).toBeTruthy();
});

it("clamps a small gap to its actual count, including singular labels", async () => {
  const user = userEvent.setup();
  const request = vi.spyOn(api, "context").mockResolvedValue({
    before: [],
    after: [source[0]],
    beforeRemaining: 0,
    afterRemaining: 0,
  });
  render(
    <ContextGap
      gap={{ above: hunks[0], below: hunks[1], hidden: 1 }}
      snapshotId="snapshot"
      split={false}
    />,
  );
  expect(screen.getByText("1 hidden line")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show 1 line below" }));
  expect(request).toHaveBeenCalledWith("snapshot", "1", 0, 1);
  expect(screen.queryByText("1 hidden line")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Collapse context" }),
  );
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Show 1 line below" }),
  );
});

it("retains already revealed context when another expansion fails and permits retry", async () => {
  const user = userEvent.setup();
  const request = vi
    .spyOn(api, "context")
    .mockResolvedValueOnce({
      before: [],
      after: source.slice(0, 25),
      beforeRemaining: 0,
      afterRemaining: 40,
    })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({
      before: source.slice(-25),
      after: [],
      beforeRemaining: 40,
      afterRemaining: 0,
    });
  render(
    <ContextGap
      gap={{ above: hunks[0], below: hunks[1], hidden: 65 }}
      snapshotId="snapshot"
      split={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Show 25 lines below" }));
  await user.click(screen.getByRole("button", { name: "Show 25 lines above" }));
  expect(screen.getByRole("alert").textContent).toContain("Offline");
  expect(screen.getByText("source 3")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show 25 lines above" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("15 hidden lines")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(3);
});
