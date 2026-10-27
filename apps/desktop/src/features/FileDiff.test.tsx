// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileDiff } from "./FileDiff";
import type { Anchor, ChangedFile } from "../lib/api";
import "../i18n";

beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const file: ChangedFile = {
  path: "src/example.ts",
  previousPath: "src/old.ts",
  status: "renamed",
  additions: 2,
  deletions: 0,
  unavailable: null,
  hunks: [1, 2].map((n) => ({
    id: String(n),
    path: "src/example.ts",
    fingerprint: String(n),
    header: `@@ -${n},0 +${n},1 @@`,
    lines: [{ kind: "addition", old: null, new: n, text: "new code" }],
  })),
};
it("collapses all hunks together and reopens for a fresh request at the same line", async () => {
  const user = userEvent.setup();
  const anchor: Anchor = {
    path: file.path,
    hunkId: "2",
    side: "RIGHT",
    startLine: 2,
    line: 2,
  };
  const view = (selection: Anchor) => (
    <FileDiff file={file} hunks={file.hunks} selection={selection}>
      <p>First hunk</p>
      <p>Second hunk</p>
    </FileDiff>
  );
  const { rerender } = render(view(anchor));
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: `Collapse file ${file.path}` }),
  );
  expect(screen.queryByText("First hunk")).toBeNull();
  expect(screen.queryByText("Second hunk")).toBeNull();
  rerender(view({ ...anchor }));
  expect(screen.getByText("First hunk")).toBeTruthy();
  expect(screen.getByText("Second hunk")).toBeTruthy();
  expect(screen.getByTitle("src/old.ts → src/example.ts")).toBeTruthy();
});
