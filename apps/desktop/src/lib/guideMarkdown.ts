/** Recover double-escaped line breaks in generated, single-line Markdown only.
 * Saved guides may contain literal \\n after their JSON has already been decoded.
 * Leave normal Markdown, inline code, and quoted code literals unchanged.
 */
export function normalizeGuideMarkdown(body: string): string {
  if (/[\r\n]/.test(body) || !body.includes("\\n")) return body;

  const breaks = (text: string) =>
    text.replace(/\\(?:\\|r\\n|n)/g, (escape) =>
      escape === "\\\\" ? escape : "\n",
    );
  const candidate = body.replace(
    /(`+)([\s\S]*?)\1|(~{3,})([\s\S]*?)\3|\\(?:\\|r\\n|n)/g,
    (
      token,
      ticks: string | undefined,
      code: string,
      tildes: string | undefined,
      tildeCode: string,
    ) => {
      const fence = ticks || tildes;
      if (!fence) return breaks(token);
      if (fence.length < 3) return token;
      // Restore fence line boundaries without changing e.g. "\\n" in source code.
      const content = (ticks ? code : tildeCode).replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\\(?:\\|r\\n|n)/g,
        (part: string) => (/^["']/.test(part) ? part : breaks(part)),
      );
      return `${fence}${content}${fence}`;
    },
  );
  // Require clear document structure, not an isolated escape example in prose.
  return /\n[ \t]*(?:#{1,6} |`{3,}|~{3,}|[-*+] )/.test(candidate)
    ? candidate
    : body;
}
