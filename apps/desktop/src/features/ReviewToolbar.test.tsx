// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "react-aria-components";
import { ReviewActivity, ReviewPopover } from "./ReviewToolbar";
import type { Guide } from "../lib/api";
import type { AiRun } from "./useAiRuns";
import fixture from "../../../../tests/fixtures/review-workspace.json";
import "../i18n";

afterEach(cleanup);
const guide = fixture.guide as Guide;
const run: AiRun = {
  id: "guide-run",
  snapshotId: guide.snapshotId,
  kind: "guide",
  preference: {
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "high",
  },
  phase: "working",
  text: "Reading code",
  stream: "",
};
it("opens secondary controls with the keyboard and restores focus on Escape", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPopover label="Saved guides" detail="Claude" icon={<span>G</span>}>
      <label>
        Saved guide
        <select defaultValue="one">
          <option value="one">First guide</option>
          <option value="two">Second guide</option>
        </select>
      </label>
    </ReviewPopover>,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
  await user.tab();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Saved guides" });
  await user.selectOptions(within(dialog).getByRole("combobox"), "two");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Saved guides" }),
    ),
  );
});
it("signals background work and pending results without inserting a banner into the document", async () => {
  const user = userEvent.setup();
  const cancel = vi.fn();
  const props = {
    guide,
    runs: [run],
    pending: false,
    newRevision: false,
    syncError: null,
  };
  const { rerender } = render(
    <ReviewActivity {...props}>
      <Button onPress={cancel}>Cancel guide</Button>
    </ReviewActivity>,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Guide generation in progress",
  );
  expect(screen.queryByRole("button", { name: "Cancel guide" })).toBeNull();
  const trigger = screen.getByRole("button", { name: "Review activity" });
  expect(trigger.querySelector(".spin")).toBeTruthy();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Cancel guide" }));
  expect(cancel).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  rerender(
    <ReviewActivity {...props} runs={[]} pending>
      <Button>Open updated guide</Button>
    </ReviewActivity>,
  );
  expect(trigger.querySelector(".review-tool-dot")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "Your guided review is ready.",
  );
  await user.click(trigger);
  expect(
    screen.getByRole("button", { name: "Open updated guide" }),
  ).toBeTruthy();
});
it("keeps sync failures and further-enrichment choices discoverable", () => {
  const enriched = {
    ...guide,
    enrichment: {
      dismissed: false,
      files: [
        {
          path: "migration.sql",
          tier: "priority" as const,
          status: "complete" as const,
          detail: null,
        },
        {
          path: "helper.ts",
          tier: "further" as const,
          status: "pending" as const,
          detail: null,
        },
      ],
    },
  };
  const props = {
    guide: enriched,
    runs: [],
    pending: false,
    newRevision: false,
    syncError: null,
  };
  const { rerender } = render(
    <ReviewActivity {...props}>Enrichment options</ReviewActivity>,
  );
  expect(screen.getByRole("status").textContent).toBe("Priority pass finished");
  expect(
    screen
      .getByRole("button", { name: "Review activity" })
      .querySelector(".review-tool-dot"),
  ).toBeTruthy();
  rerender(
    <ReviewActivity {...props} syncError="Offline">
      Retry
    </ReviewActivity>,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Review sync needs attention",
  );
});
