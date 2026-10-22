import { useTranslation } from "react-i18next";
import type { DiffLine } from "../lib/api";
import { DiffChunks } from "./DiffChunks";
import { codeTextProps } from "../lib/textSelection";

export function ContextLines({
  lines,
  split,
}: {
  lines: DiffLine[];
  split: boolean;
}) {
  const { t } = useTranslation();
  if (!lines.length) return null;
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
            className="diff-line context"
            data-map-line={index}
            key={`${line.old}/${line.new}`}
          >
            <span className="line-comment-placeholder" aria-hidden="true" />
            <span className="line-number">{line.old}</span>
            <span className="line-number">{line.new}</span>
            <span className="diff-sign" aria-hidden="true">
              {" "}
            </span>
            {split ? (
              <>
                <code
                  className="split-code old"
                  {...codeTextProps(line, "LEFT")}
                >
                  {line.text || " "}
                </code>
                <code
                  className="split-code new"
                  {...codeTextProps(line, "RIGHT")}
                >
                  {line.text || " "}
                </code>
              </>
            ) : (
              <code {...codeTextProps(line)}>{line.text || " "}</code>
            )}
          </div>
        )}
      />
    </div>
  );
}
