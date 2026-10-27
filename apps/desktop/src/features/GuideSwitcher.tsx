import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { api, type Guide, type GuideVersion } from "../lib/api";
import { effortLabel } from "../lib/models";

export function guideLabel(
  guide: Pick<
    GuideVersion,
    "source" | "model" | "reasoningEffort" | "generatedAt"
  >,
) {
  if (guide.source === "sample") return "Sample guide";
  if (guide.source === "provisional") return "Initial walkthrough";
  const provider = guide.source === "claude" ? "Claude" : "Codex";
  const date = new Date(guide.generatedAt);
  return [
    provider,
    guide.model,
    guide.reasoningEffort ? effortLabel(guide.reasoningEffort) : null,
    Number.isNaN(date.getTime())
      ? null
      : date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function GuideSwitcher({
  guide,
  pendingId,
  disabled,
  onSelect,
}: {
  guide: Guide;
  pendingId?: string;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<GuideVersion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .guides(guide.snapshotId)
      .then((items) => {
        if (!cancelled) {
          setVersions(items);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [guide.snapshotId, guide.id, pendingId, retry]);
  const current = versions.find((v) => v.id === guide.id);
  return (
    <div className="guide-switcher">
      <BookOpen size={14} aria-hidden="true" />
      <label>
        <span className="sr-only">{t("Saved guide")}</span>
        <select
          value={guide.id ?? ""}
          disabled={disabled || busy || versions.length < 2}
          title={t(
            "Switch guides for this revision. Comments and reviewed code are shared.",
          )}
          onChange={async (event) => {
            setBusy(true);
            setError("");
            try {
              await onSelect(event.target.value);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!current && (
            <option value={guide.id ?? ""}>
              {t(
                guideLabel({
                  ...guide,
                  reasoningEffort: guide.reasoningEffort ?? null,
                }),
              )}
            </option>
          )}
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {t(guideLabel(v))}
              {v.id === pendingId ? ` · ${t("New")}` : ""}
            </option>
          ))}
        </select>
      </label>
      <span className="muted guide-count">
        {t("{{count}} saved guides", { count: versions.length || 1 })}
      </span>
      {error && (
        <span role="alert" className="error-text">
          {error}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>{t("Retry")}</button>
        </span>
      )}
    </div>
  );
}
