// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { renderDiagram } from "./mermaid";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

it("isolates diagrams as images, caches by theme, and cleans up after failures", async () => {
  vi.mocked(mermaid.render).mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title><desc>A to B</desc></svg>',
    diagramType: "flowchart",
  });
  const source = "flowchart TD\nA --> B";
  const first = await renderDiagram(source, false);
  expect(first.description).toBe("Flow. A to B");
  expect(first.url).toMatch(/^data:image\/svg\+xml/);
  expect(mermaid.initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      securityLevel: "strict",
      htmlLabels: false,
      maxEdges: 150,
      suppressErrorRendering: true,
    }),
  );
  expect(await renderDiagram(source, false)).toBe(first);
  expect(mermaid.render).toHaveBeenCalledTimes(1);
  await renderDiagram(source, true);
  expect(mermaid.render).toHaveBeenCalledTimes(2);
  vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("invalid"));
  await expect(renderDiagram("invalid diagram", false)).rejects.toThrow();
  expect(document.body.children).toHaveLength(0);
  await expect(
    renderDiagram("flowchart LR\nC --> D", false),
  ).resolves.toBeTruthy();
});

it("rejects oversized diagrams, configuration overrides and remote-resource syntax before rendering", async () => {
  const calls = vi.mocked(mermaid.render).mock.calls.length;
  for (const source of [
    "x".repeat(20_001),
    "---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\nA --> B",
    '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA --> B',
    'flowchart TD\nA@{img: "https://example.com/image"}',
    'flowchart TD\nA[<img src="https://example.com/image">]',
    "flowchart TD\nstyle A fill:url(https://example.com/image)",
  ])
    await expect(renderDiagram(source, false)).rejects.toThrow();
  expect(mermaid.render).toHaveBeenCalledTimes(calls);
});
