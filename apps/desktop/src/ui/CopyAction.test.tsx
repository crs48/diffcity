// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { CopyAction } from "./CopyAction";
import { copyText } from "../lib/clipboard";
import "../i18n";

vi.mock("../lib/clipboard", () => ({ copyText: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("builds the export only on click and announces success only after the clipboard write completes", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  vi.mocked(copyText).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const getText = vi.fn(() => "**Markdown response**");
  render(<CopyAction label="Copy response" getText={getText} />);
  expect(getText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
  expect(copyText).toHaveBeenCalledWith("**Markdown response**");
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("");
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Copied");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("button", { name: "Copy response" })).toBeTruthy();
});

it("keeps clipboard failures retryable", async () => {
  vi.mocked(copyText)
    .mockRejectedValueOnce(new Error("Clipboard unavailable"))
    .mockResolvedValue(undefined);
  render(<CopyAction label="Copy response" getText={() => "Body"} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
  const retry = await screen.findByRole("button", {
    name: "Could not copy. Try again.",
  });
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});
