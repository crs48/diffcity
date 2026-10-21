// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentMarkdown } from "./CommentMarkdown";
import { ReviewMessages } from "../features/ReviewMessages";
import type { Conversation } from "../features/conversation";
import { api, type Note, type ReviewWorkspace } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";
import "../i18n";

const body = `## Review findings

First line
Second line with **important** and ~~obsolete~~ text.

- [x] Backfill existing rows
- [ ] Add a regression test

1. Deploy the migration
2. Deploy the application

> Preserve existing records.

| Change | Risk |
| :--- | ---: |
| \`schema\` | High |

\`\`\`sql
ALTER TABLE invitations
  ADD COLUMN expires_at TIMESTAMP;
\`\`\`

Read https://docs.example.com/migrations and [the PR](https://github.com/crs48/diffcity/pull/2).

Check the rollout[^rollout].

[^rollout]: Deploy in two stages.
`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GitHub flavored comment Markdown", () => {
  it("renders semantic tables, tasks, lists, quotes, code, and GitHub comment line breaks", () => {
    const { container } = render(<CommentMarkdown body={body} />);
    expect(
      screen.getByRole("heading", { name: "Review findings" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("table")).getByRole("cell", { name: "High" }),
    ).toBeTruthy();
    const done = screen.getByRole("checkbox", {
      name: "Backfill existing rows",
    }) as HTMLInputElement;
    expect(done.checked).toBe(true);
    expect(done.disabled).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Add a regression test",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(container.querySelector("del")?.textContent).toBe("obsolete");
    expect(container.querySelector("strong")?.textContent).toBe("important");
    expect(container.querySelector("p br")).toBeTruthy();
    expect(container.querySelector("blockquote")?.textContent).toContain(
      "Preserve existing records.",
    );
    expect(container.querySelector("ol > li")?.textContent).toBe(
      "Deploy the migration",
    );
    expect(container.querySelector("pre code.language-sql")?.textContent).toBe(
      "ALTER TABLE invitations\n  ADD COLUMN expires_at TIMESTAMP;\n",
    );
  });

  it("opens web links with the native browser command and reports failures", async () => {
    const external = vi.spyOn(api, "external").mockResolvedValue();
    const user = userEvent.setup();
    render(<CommentMarkdown body={body} />);
    const link = screen.getByRole("link", {
      name: "https://docs.example.com/migrations",
    });
    link.focus();
    await user.keyboard("{Enter}");
    expect(external).toHaveBeenCalledExactlyOnceWith(
      "https://docs.example.com/migrations",
    );
    external.mockRejectedValueOnce(new Error("Browser unavailable"));
    await user.click(screen.getByRole("link", { name: "the PR" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Browser unavailable",
    );
  });

  it("keeps HTML inert, blocks executable links and remote image loads, and preserves code literally", async () => {
    const external = vi.spyOn(api, "external").mockResolvedValue();
    const { container } = render(
      <CommentMarkdown
        body={
          '<script>alert(1)</script>\n\n<img src="https://tracking.example/pixel" onerror="alert(1)">\n\n[danger](javascript:alert%281%29) [local](file:///etc/passwd) [credentials](https://user:password@example.com/)\n\n![Screenshot description](https://tracking.example/image)\n\n```html\n<script>example()</script>\n```'
        }
      />,
    );
    expect(container.querySelector("script, img, iframe")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Screenshot description")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "<script>example()</script>\n",
    );
    await userEvent.setup().click(screen.getByText("danger"));
    expect(external).not.toHaveBeenCalled();
  });

  it("namespaces footnotes across mirrored comments and keeps navigation in its own copy", async () => {
    const external = vi.spyOn(api, "external").mockResolvedValue();
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = render(
      <>
        <CommentMarkdown body={body} />
        <CommentMarkdown body={body} />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const copies = container.querySelectorAll(".comment-markdown");
    for (const copy of copies) {
      const ref = copy.querySelector(
        "[data-footnote-ref]",
      ) as HTMLAnchorElement;
      const label = document.getElementById(
        ref.getAttribute("aria-describedby")!,
      );
      expect(copy.contains(label)).toBe(true);
      await userEvent.setup().click(ref);
      expect(document.activeElement?.id).toBe(
        ref.getAttribute("href")!.slice(1),
      );
      expect(copy.contains(document.activeElement)).toBe(true);
      await userEvent
        .setup()
        .click(copy.querySelector("[data-footnote-backref]") as HTMLElement);
      expect(document.activeElement).toBe(ref);
      expect(ref.tabIndex).toBe(0);
    }
    expect(external).not.toHaveBeenCalled();
  });

  it("renders local, GitHub, and streaming replies consistently without changing saved text", async () => {
    const workspace = structuredClone(fixture) as ReviewWorkspace;
    const note: Note = {
      id: "markdown-note",
      snapshotId: workspace.snapshot.id,
      role: "user",
      body,
      anchor: null,
      parentId: null,
      githubDraft: false,
      publishedUrl: null,
      createdAt: "2026-10-21T00:00:00Z",
    };
    const ask = vi.fn().mockResolvedValue(undefined);
    const conversation = {
      workspace,
      busy: false,
      stream: body,
      ask,
      onError: vi.fn(),
    } as unknown as Conversation;
    const remote = {
      id: "remote-markdown",
      author: "reviewer",
      body,
      path: null,
      line: null,
      side: null,
      commit: null,
      url: "https://github.com/crs48/diffcity/pull/2#issuecomment-1",
      createdAt: "2026-10-21T00:01:00Z",
    };
    const { rerender } = render(
      <ReviewMessages
        notes={[note]}
        remote={[remote]}
        conversation={conversation}
        streaming
      />,
    );
    expect(screen.getAllByRole("table")).toHaveLength(3);
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Ask Codex about this comment" }),
      );
    await waitFor(() => expect(ask).toHaveBeenCalledExactlyOnceWith(note));
    expect(note.body).toBe(body);
    rerender(
      <ReviewMessages
        notes={[note]}
        remote={[remote]}
        conversation={{ ...conversation, stream: "```sql\nSELECT *" }}
        streaming
      />,
    );
    expect(
      screen
        .getByLabelText("Codex response in progress")
        .querySelector("pre code")?.textContent,
    ).toBe("SELECT *\n");
  });
});
