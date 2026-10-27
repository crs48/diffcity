import { useTranslation } from "react-i18next";
import type { DiffLine, Side } from "../lib/api";
import { DiffChunks } from "./DiffChunks";
import { codeTextProps } from "../lib/textSelection";
import { CodeText } from "../ui/CodeText";

export function ContextLines({
  lines,
  split,
  path = "",
}: {
  lines: DiffLine[];
  split: boolean;
  path?: string;
}) {
  const { t } = useTranslation();
  if (!lines.length) return null;
  const cell = (line: DiffLine, side?: Side) => (
    <div key={side} className="diff-line context">
      <span className="line-comment-placeholder" aria-hidden="true" />
      {(!side || side === "LEFT") && (
        <span className="line-number">{line.old}</span>
      )}
      {(!side || side === "RIGHT") && (
        <span className="line-number">{line.new}</span>
      )}
      {!side && (
        <span className="diff-sign" aria-hidden="true">
          {" "}
        </span>
      )}
      <code {...codeTextProps(line, side)}>
        <CodeText text={line.text} path={path} />
      </code>
    </div>
  );
  return (
    <div
      className="expanded-context"
      role="region"
      aria-label={t("Unchanged surrounding code")}
    >
      <DiffChunks
        items={lines}
        minimapLines={lines}
        itemKey={(line) => `${line.old}/${line.new}`}
        render={(line, index) => (
          <div
            data-map-line={index}
            key={`${line.old}/${line.new}`}
            className={split ? "split-row" : undefined}
          >
            {split ? (
              <>
                {cell(line, "LEFT")}
                {cell(line, "RIGHT")}
              </>
            ) : (
              cell(line)
            )}
          </div>
        )}
      />
    </div>
  );
}
