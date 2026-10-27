// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuideReadyNotice, type ReadyGuide } from "./GuideReadyNotice";
import "../i18n";

afterEach(cleanup);
const notice: ReadyGuide = {
  id: "claude-guide",
  snapshotId: "revision",
  repository: "owner/repo",
  number: 42,
  title: "Add a review queue",
  model: "Claude · claude-fable-5",
};

it("keeps simultaneous completions available without stacking cards or stealing focus", async () => {
  const view = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [notices, setNotices] = useState<ReadyGuide[]>([]);
    return (
      <>
        <button
          onClick={() =>
            setNotices([
              notice,
              { ...notice, id: "codex-guide", model: "Codex · gpt-6-astra" },
            ])
          }
        >
          Complete guides
        </button>
        <GuideReadyNotice
          notices={notices}
          disabled={false}
          opening={false}
          onView={view}
          onDismiss={(id) =>
            setNotices((items) => items.filter((item) => item.id !== id))
          }
        />
      </>
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Complete guides" });
  await user.click(trigger);
  expect(document.activeElement).toBe(trigger);
  expect(screen.getAllByRole("heading", { name: "Guide ready" })).toHaveLength(
    1,
  );
  expect(screen.getByText("1 more guide ready")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "owner/repo#42: Codex · gpt-6-astra",
  );
  await user.click(
    screen.getByRole("button", { name: "Dismiss guide notification" }),
  );
  expect(screen.getByText(notice.model)).toBeTruthy();
  expect(screen.queryByText("1 more guide ready")).toBeNull();
  screen.getByRole("button", { name: "View guide" }).focus();
  await user.keyboard("{Enter}");
  expect(view).toHaveBeenCalledWith(notice);
});

it("keeps an unsuccessful navigation actionable and disables duplicate opens", async () => {
  const view = vi
    .fn()
    .mockRejectedValue(new Error("Saved revision is unavailable"));
  const props = {
    notices: [notice],
    disabled: false,
    opening: false,
    onView: view,
    onDismiss: vi.fn(),
  };
  const { rerender } = render(<GuideReadyNotice {...props} />);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "View guide" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Saved revision is unavailable",
  );
  rerender(<GuideReadyNotice {...props} opening />);
  const region = within(
    screen.getByRole("region", { name: "Guide notifications" }),
  );
  expect(
    (
      region.getByRole("button", {
        name: "Opening guide…",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      region.getByRole("button", {
        name: "Dismiss guide notification",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
