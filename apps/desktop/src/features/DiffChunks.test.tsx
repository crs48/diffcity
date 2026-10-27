// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DIFF_CHUNK_SIZE, DiffChunks, rowAtOffset } from "./DiffChunks";
import { diffRows, type DiffRow } from "../lib/diffRows";
import type { Hunk } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("preserves later row identity and focus when a discussion is inserted", () => {
  const hunk: Hunk = {
    ...fixture.snapshot.files[0].hunks[0],
    lines: Array.from({ length: 130 }, (_, index) => ({
      kind: "addition",
      old: null,
      new: index + 1,
      text: "code",
    })),
  };
  const view = (rows: DiffRow[]) => (
    <DiffChunks
      items={rows}
      itemKey={(row) => row.key}
      startsChunk={(row) =>
        row.kind === "code" && row.codeIndex % DIFF_CHUNK_SIZE === 0
      }
      render={(row) => (
        <div key={row.key}>
          {row.kind === "code" ? (
            <button>Line {row.codeIndex + 1}</button>
          ) : (
            <textarea aria-label="Discussion" />
          )}
        </div>
      )}
    />
  );
  const { rerender } = render(view(diffRows(hunk, [], [], null)));
  const button = screen.getByRole("button", { name: "Line 65" });
  button.focus();
  rerender(
    view(
      diffRows(hunk, [], [], {
        hunkId: hunk.id,
        path: hunk.path,
        side: "RIGHT",
        startLine: 1,
        line: 1,
      }),
    ),
  );
  expect(screen.getByRole("textbox", { name: "Discussion" })).toBeTruthy();
  expect(document.activeElement).toBe(button);
  expect(screen.getByRole("button", { name: "Line 65" })).toBe(button);
  expect(screen.getAllByRole("button")).toHaveLength(130);
});

it("finds wrapped rows and discussion gaps across blocks after viewport scrolling", () => {
  const { container } = render(
    <div data-testid="diff">
      <div>
        <div data-testid="wrapped" />
        <div data-testid="thread" />
      </div>
      <div>
        <div data-testid="following" />
      </div>
    </div>,
  );
  const root = container.firstElementChild as HTMLElement;
  const bounds = (element: Element, top: number, bottom: number) =>
    vi
      .spyOn(element, "getBoundingClientRect")
      .mockReturnValue({ top, bottom, height: bottom - top } as DOMRect);
  bounds(root, -100, 375);
  bounds(root.children[0], -100, 350);
  bounds(root.children[1], 350, 375);
  bounds(screen.getByTestId("wrapped"), -100, -25);
  bounds(screen.getByTestId("thread"), -25, 350);
  bounds(screen.getByTestId("following"), 350, 375);
  expect(rowAtOffset(root, 50)).toBe(screen.getByTestId("wrapped"));
  expect(rowAtOffset(root, 75)).toBe(screen.getByTestId("thread"));
  expect(rowAtOffset(root, 449)).toBe(screen.getByTestId("thread"));
  expect(rowAtOffset(root, 450)).toBe(screen.getByTestId("following"));
  expect(rowAtOffset(root, 475)).toBeNull();
  expect(rowAtOffset(root, -1)).toBeNull();
});
