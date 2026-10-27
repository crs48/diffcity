import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const isDark = () => document.documentElement.dataset.theme === "dark";

export const MermaidDiagram = memo(function MermaidDiagram({
  source,
}: {
  source: string;
}) {
  const { t } = useTranslation();
  const [dark, setDark] = useState(isDark);
  const [result, setResult] = useState<{
    source: string;
    dark: boolean;
    url?: string;
    description?: string;
  } | null>(null);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void import("./mermaid")
      .then(({ renderDiagram }) => renderDiagram(source, dark))
      .then(
        (diagram) => {
          if (!cancelled) setResult({ source, dark, ...diagram });
        },
        () => {
          if (!cancelled) setResult({ source, dark });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [source, dark]);
  const current =
    result?.source === source && result.dark === dark ? result : null;
  return (
    <figure className="markdown-diagram">
      {current?.url ? (
        <img
          src={current.url}
          alt={current.description || t("Change flow diagram")}
        />
      ) : (
        <p className="muted" role="status">
          {current
            ? t("Diagram could not be rendered. Its source is available below.")
            : t("Rendering diagram…")}
        </p>
      )}
      <details open={current && !current.url ? true : undefined}>
        <summary>{t("Diagram source")}</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
});
