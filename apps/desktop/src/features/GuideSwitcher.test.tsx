// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuideSwitcher } from "./GuideSwitcher";
import { api, type Guide, type GuideVersion } from "../lib/api";
import "../i18n";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const version: GuideVersion = {
  id: "astra-1",
  source: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "xhigh",
  generatedAt: "2026-10-22T16:00:00Z",
  sectionCount: 5,
};
const guide: Guide = {
  ...version,
  reasoningEffort: version.reasoningEffort ?? undefined,
  snapshotId: "revision-1",
  sections: [],
  summary: "Overview",
  limitations: [],
  policyVersion: 3,
};
it("lists multiple runs, including repeated models, and selects the exact saved guide", async () => {
  vi.spyOn(api, "guides").mockResolvedValue([
    version,
    { ...version, id: "fable-1", source: "claude", model: "claude-fable-5" },
    { ...version, id: "astra-2", generatedAt: "2026-10-22T17:00:00Z" },
  ]);
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(
    <GuideSwitcher
      guide={guide}
      disabled={false}
      onSelect={onSelect}
      pendingId="astra-2"
    />,
  );
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
  await userEvent
    .setup()
    .selectOptions(
      screen.getByRole("combobox", { name: "Saved guide" }),
      "fable-1",
    );
  expect(onSelect).toHaveBeenCalledWith("fable-1");
  expect(
    screen.getByRole("option", { name: /Claude · claude-fable-5/ }),
  ).toBeTruthy();
  expect(screen.getByRole("option", { name: /New$/ })).toBeTruthy();
});
it("keeps the active guide visible when loading history fails and allows retry", async () => {
  vi.spyOn(api, "guides")
    .mockRejectedValueOnce(new Error("Offline database"))
    .mockResolvedValue([version]);
  render(<GuideSwitcher guide={guide} disabled={false} onSelect={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Offline database"),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "astra-1",
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
