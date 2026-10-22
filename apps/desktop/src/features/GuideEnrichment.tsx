import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EnrichmentTier, Guide } from "../lib/api";
import { enrichmentRemaining } from "../lib/enrichment";
import { isActiveRun, type AiRun } from "./useAiRuns";

export function GuideEnrichment({
  guide,
  runs,
  onStart,
  onCancel,
  onDismissRun,
  onDismiss,
}: {
  guide: Guide;
  runs: AiRun[];
  onStart: (tier: EnrichmentTier) => void;
  onCancel: (id: string) => void;
  onDismissRun: (id: string) => void;
  onDismiss: (dismissed: boolean) => void;
}) {
  const { t } = useTranslation();
  const state = guide.enrichment;
  if (!state?.files.length) return null;
  const run = runs.find(
    (r) => r.kind === "enrichment" && r.guideId === guide.id && isActiveRun(r),
  );
  const error = runs.find(
    (r) => r.kind === "enrichment" && r.guideId === guide.id && !isActiveRun(r),
  );
  const priority = state.files.filter((f) => f.tier === "priority");
  const priorityLeft = priority.filter(enrichmentRemaining).length;
  const furtherLeft = state.files.filter(
    (f) => f.tier === "further" && enrichmentRemaining(f),
  ).length;
  const left = priorityLeft || furtherLeft;
  const completed = state.files.filter((f) => f.status === "complete").length;
  const attempted = state.files.some((f) => f.status !== "pending");
  const title = run
    ? t("Adding deeper code notes")
    : priorityLeft
      ? t(attempted ? "Priority pass paused" : "Priority pass")
      : furtherLeft
        ? t("Priority pass finished")
        : t("Enrichment finished");
  return (
    <section className="guide-enrichment" aria-label={t("Guide enrichment")}>
      <div className="enrichment-summary">
        {run ? (
          <LoaderCircle size={14} className="spin" aria-hidden />
        ) : (
          <Sparkles size={14} aria-hidden />
        )}
        <span role="status">
          <strong>
            {state.dismissed && !run ? t("Code enrichment paused") : title}
          </strong>
          {run ? (
            <span className="muted enrichment-progress" title={run.text}>
              {t(run.text)}
            </span>
          ) : (
            <span className="muted">
              {t("{{count}} files inspected", { count: completed })}
            </span>
          )}
        </span>
        <div className="enrichment-actions">
          {run ? (
            <Button
              className="text-button"
              isDisabled={run.phase === "cancelling"}
              onPress={() => onCancel(run.id)}
            >
              {t("Stop enrichment")}
            </Button>
          ) : state.dismissed ? (
            <Button className="text-button" onPress={() => onDismiss(false)}>
              {t("Show options")}
            </Button>
          ) : (
            <>
              {!!left && (
                <Button
                  className="text-button"
                  onPress={() => onStart(priorityLeft ? "priority" : "further")}
                >
                  {t(
                    priorityLeft
                      ? attempted
                        ? "Resume priority pass"
                        : "Start priority pass"
                      : "Explore further",
                  )}
                  {" · "}
                  {t("{{count}} files", { count: Math.min(6, left) })}
                </Button>
              )}
              <Button className="text-button" onPress={() => onDismiss(true)}>
                {t(left ? "Not now" : "Dismiss")}
              </Button>
            </>
          )}
          {!state.dismissed && (
            <DialogTrigger>
              <Button className="text-button">{t("Scope and limits")}</Button>
              <Popover className="enrichment-popover" placement="bottom start">
                <Dialog aria-label={t("Scope and limits")}>
                  <p>
                    {t(
                      "One file at a time, up to 6 files per batch and 2 notes per file. Each request includes at most 24 KB of diff, with a three-minute time limit. Up to 24 notes per guide. No automatic retries or continuous re-analysis.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Priority pass covers code flagged for high attention. Explore further covers the remaining assessed implementation and tests. Routine and unassessed changes are excluded. Enrichment uses this guide’s model.",
                    )}
                  </p>
                  <ul>
                    {state.files.map((file) => (
                      <li key={file.path}>
                        <code>{file.path}</code>
                        <span>
                          {t(
                            file.status === "interrupted" &&
                              run?.text.endsWith(` · ${file.path}`)
                              ? "Reading"
                              : file.status,
                          )}
                          {file.detail ? ` · ${file.detail}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Dialog>
              </Popover>
            </DialogTrigger>
          )}
        </div>
      </div>
      {error && (
        <div className="enrichment-error" role="status">
          <span>{error.text}</span>
          <Button
            className="text-button"
            onPress={() => onDismissRun(error.id)}
          >
            {t("Dismiss error")}
          </Button>
        </div>
      )}
    </section>
  );
}
