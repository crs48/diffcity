// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { CommentMarkdown } from "./CommentMarkdown";
import { renderDiagram } from "./mermaid";

vi.mock("./mermaid", () => ({ renderDiagram: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  delete document.documentElement.dataset.theme;
});

it("renders opted-in fences, preserves ordinary code, and adapts to theme changes", async () => {
  vi.mocked(renderDiagram).mockResolvedValue({
    url: "data:image/svg+xml,<svg/>",
    description: "Request enters the store",
  });
  const body =
    "```mermaid\nflowchart TD\n A --> B\n```\n\n```ts\nconst x = 1\n```";
  const { container, rerender } = render(
    <CommentMarkdown body={body} diagrams />,
  );
  await screen.findByRole("img", { name: "Request enters the store" });
  expect(container.querySelector("pre code.language-ts")).toBeTruthy();
  expect(container.querySelector("pre figure")).toBeNull();
  expect(renderDiagram).toHaveBeenLastCalledWith(
    "flowchart TD\n A --> B",
    false,
  );
  await act(async () => {
    document.documentElement.dataset.theme = "dark";
  });
  await waitFor(() =>
    expect(renderDiagram).toHaveBeenLastCalledWith(
      "flowchart TD\n A --> B",
      true,
    ),
  );
  rerender(<CommentMarkdown body={body} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelector("code.language-mermaid")).toBeTruthy();
});

it("keeps malformed diagram source readable and ignores stale results", async () => {
  let finish!: (value: { url: string; description: string }) => void;
  vi.mocked(renderDiagram)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("parse"));
  const { rerender, container } = render(
    <CommentMarkdown body={"```mermaid\nold\n```"} diagrams />,
  );
  await waitFor(() => expect(renderDiagram).toHaveBeenCalled());
  rerender(<CommentMarkdown body={"```mermaid\ninvalid\n```"} diagrams />);
  await screen.findByText(
    "Diagram could not be rendered. Its source is available below.",
  );
  expect(container.querySelector("details")?.open).toBe(true);
  expect(container.querySelector("pre code")?.textContent).toBe("invalid");
  await act(async () => {
    finish({ url: "data:image/svg+xml,<svg/>", description: "Stale" });
  });
  expect(screen.queryByRole("img")).toBeNull();
});
