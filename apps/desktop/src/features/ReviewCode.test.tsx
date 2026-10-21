// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewCode } from "./ReviewCode";
import { useVirtualReview } from "./reviewRendering";
import type { ChangedFile } from "../lib/api";
import "../i18n";

const files: ChangedFile[] = [
  {
    path: "file.ts",
    previousPath: null,
    status: "added",
    additions: 3000,
    deletions: 0,
    unavailable: null,
    hunks: [
      {
        id: "hunk",
        fingerprint: "fp",
        path: "file.ts",
        header: "@@ -0,0 +1,3000 @@",
        lines: Array.from({ length: 3000 }, (_, index) => ({
          kind: "addition",
          old: null,
          new: index + 1,
          text: `needle ${index}`,
        })),
      },
    ],
  },
];
function Mode() {
  return <span>{useVirtualReview() ? "Windowed code" : "Full code"}</span>;
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("offers and persists full-document reading for large reviews", async () => {
  const user = userEvent.setup();
  const example = (
    <ReviewCode files={files} onSelect={vi.fn()} onReveal={vi.fn()}>
      <Mode />
    </ReviewCode>
  );
  const view = render(example);
  expect(screen.getByText("Windowed code")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Render all code" }));
  expect(screen.getByText("Full code")).toBeTruthy();
  view.unmount();
  render(example);
  expect(screen.getByText("Full code")).toBeTruthy();
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Render all code",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});

it("finds every captured line, wraps backward, and focuses search with Cmd+F", async () => {
  const user = userEvent.setup();
  const select = vi.fn(),
    reveal = vi.fn();
  render(
    <ReviewCode files={files} onSelect={select} onReveal={reveal}>
      <Mode />
    </ReviewCode>,
  );
  fireEvent.keyDown(document, { key: "f", metaKey: true });
  const input = screen.getByRole("searchbox", { name: "Find in code" });
  expect(document.activeElement).toBe(input);
  await user.type(input, "needle");
  await user.click(screen.getByRole("button", { name: "Previous code match" }));
  expect(select).toHaveBeenLastCalledWith(
    expect.objectContaining({ line: 3000, side: "RIGHT" }),
  );
  await user.click(screen.getByRole("button", { name: "Next code match" }));
  expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ line: 1 }));
  expect(reveal).toHaveBeenCalledTimes(2);
});

it("leaves small reviews fully mounted without a rendering setting", () => {
  render(
    <ReviewCode files={[]} onSelect={vi.fn()} onReveal={vi.fn()}>
      <Mode />
    </ReviewCode>,
  );
  expect(screen.getByText("Full code")).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", { name: "Render all code" }),
  ).toBeNull();
});
