import { expect, it } from "vitest";
import { normalizeGuideMarkdown } from "./guideMarkdown";

const overview = [
  "The change preserves existing records.",
  "",
  "### Reading path",
  "",
  "- Review the migration first.",
  "- Check the caller next.",
  "",
  "```mermaid",
  "flowchart TD",
  "  accTitle: Review reading path",
  "  A[Migration] --> B[Caller]",
  "```",
  "",
  "### Evidence",
  "",
  "| Before | After |",
  "| --- | --- |",
  "| Optional | Required |",
].join("\n");

it.each(["\\n", "\\r\\n"])(
  "recovers saved guide block structure with %s breaks",
  (separator) => {
    expect(normalizeGuideMarkdown(overview.replaceAll("\n", separator))).toBe(
      overview,
    );
  },
);

it("leaves valid Markdown and ordinary escape examples unchanged", () => {
  for (const body of [
    overview,
    "Use `\\n` to insert a newline.",
    "Use \\n or \\r\\n as a separator.",
    '```js\nconst newline = "\\n";\n```',
  ])
    expect(normalizeGuideMarkdown(body)).toBe(body);
});

it("preserves literal escapes inside inline code, code strings, regexes, and paths", () => {
  const body = [
    "### Escapes",
    'Use `\\n`, ``"\\n"``, and `C:\\new\\notes` as literal examples.',
    "```js",
    'const newline = "\\n";',
    "const pattern = /\\\\n/;",
    "```",
  ].join("\n");
  const escaped = body.replaceAll("\n", "\\n");
  expect(normalizeGuideMarkdown(escaped)).toBe(body);
});

it("supports tilde fences and is idempotent", () => {
  const body = "### Flow\n\n~~~mermaid\nflowchart LR\n  A --> B\n~~~";
  const repaired = normalizeGuideMarkdown(body.replaceAll("\n", "\\n"));
  expect(repaired).toBe(body);
  expect(normalizeGuideMarkdown(repaired)).toBe(repaired);
});
