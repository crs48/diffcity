// Loaded only for Mermaid fences. Serialize rendering because Mermaid owns global config.
import mermaid from "mermaid";

let queue: Promise<unknown> = Promise.resolve();
let serial = 0;
const cache = new Map<string, Promise<{ url: string; description: string }>>();

export function renderDiagram(source: string, dark: boolean) {
  const key = `${dark}/${source}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = queue.then(async () => {
    // Markdown is data, not renderer configuration or external resource requests.
    if (
      source.length > 20_000 ||
      /^\s*---|%%\{|<\/?(?:script|img|image|iframe|style|link|object|foreignObject)\b|@\s*import|url\s*\(|@\{[^}]*\b(?:img|icon)\s*:/im.test(
        source,
      )
    )
      throw new Error("Unsupported diagram configuration or resource");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 20_000,
      maxEdges: 150,
      htmlLabels: false,
      theme: "base",
      fontFamily: "system-ui, sans-serif",
      themeVariables: {
        darkMode: dark,
        background: dark ? "#101010" : "#ffffff",
        primaryColor: dark ? "#242424" : "#f5f5f5",
        primaryTextColor: dark ? "#eeeeee" : "#171717",
        primaryBorderColor: dark ? "#888888" : "#666666",
        lineColor: dark ? "#aaaaaa" : "#555555",
        secondaryColor: dark ? "#303030" : "#eeeeee",
        tertiaryColor: dark ? "#181818" : "#fafafa",
      },
    });
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden;pointer-events:none";
    host.setAttribute("aria-hidden", "true");
    document.body.append(host);
    try {
      const { svg } = await mermaid.render(
        `guide-diagram-${++serial}`,
        source,
        host,
      );
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const description = [
        parsed.querySelector("title")?.textContent,
        parsed.querySelector("desc")?.textContent,
      ]
        .filter(Boolean)
        .join(". ");
      const size = parsed.documentElement
        .getAttribute("viewBox")
        ?.split(/\s+/)
        .map(Number);
      if (size?.length === 4 && size[2] > 0 && size[3] > 0) {
        parsed.documentElement.setAttribute("width", String(size[2]));
        parsed.documentElement.setAttribute("height", String(size[3]));
      }
      // An SVG image cannot run scripts, bind clicks, or style the surrounding review.
      return {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(parsed))}`,
        description,
      };
    } finally {
      host.remove();
    }
  });
  queue = result.catch(() => {});
  cache.set(key, result);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return result;
}
