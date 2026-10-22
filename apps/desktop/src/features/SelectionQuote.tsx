import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import type { Anchor } from "../lib/api";

export function SelectionQuote({
  anchor,
  compact = false,
}: {
  anchor: Anchor;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!anchor.textSelection) return null;
  const text = anchor.textSelection.text;
  const preview = compact
    ? Array.from(text.split("\n").slice(0, 3).join("\n")).slice(0, 180).join("")
    : text;
  return (
    <div className="selection-quote">
      <div className="selection-quote-label">
        <Sparkles size={12} />
        {t("Selected text · AI only")}
      </div>
      <pre>
        <code>
          {preview}
          {preview.length < text.length ? "…" : ""}
        </code>
      </pre>
    </div>
  );
}
