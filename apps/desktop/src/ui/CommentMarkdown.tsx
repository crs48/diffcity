import { memo, useId, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Root, RootContent } from "hast";
import { api } from "../lib/api";
import { MermaidDiagram } from "./MermaidDiagram";

const plugins = [remarkGfm, remarkBreaks];
const components = {
  // Preserve attachment descriptions without fetching unsolicited remote images.
  img: ({ alt }: { alt?: string }) => <span>{alt}</span>,
};
const diagramComponents: Components = {
  ...components,
  pre: ({ node, children }) => {
    const code = node?.children[0];
    if (
      code?.type === "element" &&
      code.tagName === "code" &&
      Array.isArray(code.properties.className) &&
      code.properties.className.includes("language-mermaid")
    )
      return <MermaidDiagram source={textContent(code).trim()} />;
    return <pre>{children}</pre>;
  },
};

function safeUrl(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

const textContent = (node: RootContent): string =>
  node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(textContent).join("")
      : "";

function commentMarkup({ prefix, task }: { prefix: string; task: string }) {
  return (tree: Root) => {
    const visit = (node: Root | RootContent, taskLabel?: string) => {
      if (node.type === "element") {
        const p = node.properties;
        if (p.id) p.id = prefix + p.id;
        if (typeof p.href === "string" && p.href.startsWith("#"))
          p.href = `#${prefix}${p.href.slice(1)}`;
        if (Array.isArray(p.ariaDescribedBy))
          p.ariaDescribedBy = p.ariaDescribedBy.map((id) => prefix + id);
        if (node.tagName === "li")
          taskLabel = node.children
            .filter(
              (child) =>
                child.type !== "element" ||
                !["ul", "ol"].includes(child.tagName),
            )
            .map(textContent)
            .join("")
            .trim();
        if (node.tagName === "input" && p.type === "checkbox")
          p.ariaLabel = taskLabel || task;
      }
      if ("children" in node)
        node.children.forEach((child) => visit(child, taskLabel));
    };
    visit(tree);
  };
}

export const CommentMarkdown = memo(function CommentMarkdown({
  body,
  diagrams = false,
}: {
  body: string;
  diagrams?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [error, setError] = useState("");
  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest?.("a");
    if (!link || !event.currentTarget.contains(link)) return;
    event.preventDefault();
    if (event.button !== 0 && event.button !== 1) return;
    const href = link.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      const target = document.getElementById(href.slice(1));
      if (target && event.currentTarget.contains(target)) {
        if (target.tabIndex < 0) target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
      }
    } else if (safeUrl(href)) {
      setError("");
      void api.external(href).catch((reason) => setError(String(reason)));
    }
  };
  return (
    <div className="comment-markdown" onClick={openLink} onAuxClick={openLink}>
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={[
          [commentMarkup, { prefix: `comment-${id}-`, task: t("Task") }],
        ]}
        remarkRehypeOptions={{ footnoteLabel: t("Footnotes") }}
        components={diagrams ? diagramComponents : components}
        urlTransform={safeUrl}
        skipHtml
      >
        {body}
      </ReactMarkdown>
      {error && <p role="alert">{error}</p>}
    </div>
  );
});
