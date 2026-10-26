// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyText } from "./clipboard";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it("uses the native write-only clipboard bridge inside Tauri", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(writeText).mockResolvedValue(undefined);
  await copyText("Native Markdown");
  expect(writeText).toHaveBeenCalledExactlyOnceWith("Native Markdown");
});

it("uses the browser clipboard in previews and propagates denied writes", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const write = vi.fn().mockRejectedValue(new Error("Denied"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  await expect(copyText("Browser Markdown")).rejects.toThrow("Denied");
  expect(write).toHaveBeenCalledExactlyOnceWith("Browser Markdown");
});
