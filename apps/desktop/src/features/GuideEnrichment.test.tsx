// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Guide } from "../lib/api";
import { GuideEnrichment } from "./GuideEnrichment";
import { GuideCodeNotes } from "./GuideCodeNotes";
import { useState } from "react";
import fixture from "../../../../tests/fixtures/review-workspace.json";
import "../i18n";
vi.mock("../ui/MermaidDiagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <figure aria-label="Code diagram">{source}</figure>
  ),
}));
afterEach(cleanup);
const makeGuide = (): Guide => ({
  ...(structuredClone(fixture.guide) as Guide),
  id: "guide",
  source: "claude",
  enrichment: {
    dismissed: false,
    files: [
      {
        path: "migration.sql",
        tier: "priority",
        status: "complete",
        detail: "2 notes",
      },
      { path: "helper.ts", tier: "further", status: "pending", detail: null },
    ],
  },
});
it("offers further exploration only on explicit click and remembers dismissal", async () => {
  const user = userEvent.setup();
  const start = vi.fn(),
    dismiss = vi.fn();
  const props = {
    guide: makeGuide(),
    runs: [],
    onStart: start,
    onDismiss: dismiss,
    onCancel: vi.fn(),
    onDismissRun: vi.fn(),
  };
  const { rerender } = render(<GuideEnrichment {...props} />);
  expect(screen.getByText("Priority pass finished")).toBeTruthy();
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Explore further/ }));
  expect(start).toHaveBeenCalledExactlyOnceWith("further");
  await user.click(screen.getByRole("button", { name: "Not now" }));
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(true);
  rerender(
    <GuideEnrichment
      {...props}
      guide={{
        ...props.guide,
        enrichment: { ...props.guide.enrichment!, dismissed: true },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: /Explore further/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show options" }));
  expect(dismiss).toHaveBeenLastCalledWith(false);
});
it("keeps priority retries ahead of further work, and cancels just its own active job", async () => {
  const guide = makeGuide();
  guide.enrichment!.files[0].status = "interrupted";
  const start = vi.fn(),
    cancel = vi.fn();
  const props = {
    guide,
    onStart: start,
    onCancel: cancel,
    onDismiss: vi.fn(),
    onDismissRun: vi.fn(),
  };
  const { rerender } = render(<GuideEnrichment {...props} runs={[]} />);
  expect(screen.queryByRole("button", { name: /Explore further/ })).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /Resume priority pass/ }));
  expect(start).toHaveBeenCalledExactlyOnceWith("priority");
  rerender(
    <GuideEnrichment
      {...props}
      runs={[
        {
          id: "background",
          kind: "enrichment",
          guideId: "guide",
          snapshotId: guide.snapshotId,
          phase: "working",
          text: "Reading migration.sql",
          stream: "",
          preference: {
            provider: "claude",
            model: "claude-fable-5",
            reasoningEffort: "high",
          },
        },
      ]}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Stop enrichment" }));
  expect(cancel).toHaveBeenCalledExactlyOnceWith("background");
});
it("defers rich note rendering until opened and keeps it in the document", async () => {
  const guide = makeGuide();
  const notes = [
    {
      id: "note",
      title: "Rollout",
      body: "Verify the deadline.",
      details:
        "- **Existing rows.** Backfill first.\n\n```mermaid\nflowchart LR\n A --> B\n```",
      anchor: {
        hunkId: guide.sections[0].hunkIds[0],
        path: "migration.sql",
        side: "RIGHT" as const,
        startLine: 1,
        line: 1,
      },
    },
  ];
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <GuideCodeNotes
        notes={notes}
        open={open}
        onOpen={setOpen}
        request={null}
      />
    );
  }
  render(<Example />);
  expect(screen.queryByRole("figure")).toBeNull();
  await userEvent.setup().click(screen.getByText("Read all code notes (1)"));
  expect(
    await screen.findByRole("figure", { name: "Code diagram" }),
  ).toBeTruthy();
  expect(screen.getByRole("listitem").textContent).toContain("Existing rows.");
});
