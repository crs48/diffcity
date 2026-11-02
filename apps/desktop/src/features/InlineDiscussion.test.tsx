// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineDiscussion } from "./InlineDiscussion";
import { ConversationContext, type Conversation } from "./conversation";
import { indexedWorkspace } from "../lib/guideIndex.fixture";

vi.mock("./ReviewMessages", () => ({
  ReviewMessages: ({ notes }: { notes: { body: string }[] }) => (
    <div>
      {notes.map((n, i) => (
        <p key={i}>{n.body}</p>
      ))}
    </div>
  ),
}));
afterEach(cleanup);

function Example({
  resolved,
  focus = 0,
}: {
  resolved?: boolean;
  focus?: number;
}) {
  const w = indexedWorkspace();
  const c = {
    workspace: w,
    inline: { draft: null, focus },
    runs: [],
  } as unknown as Conversation;
  return (
    <ConversationContext.Provider value={c}>
      <InlineDiscussion
        thread={{
          anchor: w.notes[0].anchor!,
          notes: w.notes.slice(0, 2),
          remote: w.comments.map((c) => ({ ...c, resolved })),
        }}
      />
    </ConversationContext.Provider>
  );
}

it("shows saved questions and replies on first render and reload without clicking a line", () => {
  const view = render(<Example />);
  expect(screen.getByText("What about existing invitations?")).toBeTruthy();
  expect(screen.getByText("Backfill before setting NOT NULL.")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse inline discussion" }),
  );
  expect(screen.queryByText("What about existing invitations?")).toBeNull();
  view.unmount();
  render(<Example />);
  expect(screen.getByText("What about existing invitations?")).toBeTruthy();
});

it("keeps resolved conversations visible as expandable headers and ignores another composer's focus", () => {
  const view = render(<Example resolved />);
  expect(screen.getByText("Invitation migration rollout")).toBeTruthy();
  expect(screen.getByText(/Resolved/)).toBeTruthy();
  expect(screen.queryByText("What about existing invitations?")).toBeNull();
  view.rerender(<Example resolved focus={5} />);
  expect(screen.queryByText("What about existing invitations?")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Expand inline discussion" }),
  );
  expect(screen.getByText("What about existing invitations?")).toBeTruthy();
});
