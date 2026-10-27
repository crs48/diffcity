import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { LoaderCircle, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelPreference, PullRequest } from "../lib/api";
import { effortLabel } from "../lib/models";
import {
  guideJobKey,
  guideProviders,
  pullGuideStatus,
  type GuideInventory,
  type GuideProvider,
} from "../lib/pull-guides";
import { type AiRun, isActiveRun } from "./useAiRuns";

export type PullGuideActions = {
  inventory: GuideInventory;
  loading: boolean;
  error: string;
  fallback: ModelPreference;
  runs: AiRun[];
  starting: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  generate: (pull: PullRequest, provider: GuideProvider) => void;
  retry: () => void;
};

export function PullGuideButtons({
  pull,
  actions,
}: {
  pull: PullRequest;
  actions: PullGuideActions;
}) {
  const { t, i18n } = useTranslation();
  const modelLabel = (preference: ModelPreference) =>
    `${preference.model}${preference.reasoningEffort ? ` · ${t(effortLabel(preference.reasoningEffort))}` : ""}`;
  return (
    <div
      className="pull-guide-buttons"
      role="group"
      aria-label={t("AI guides")}
    >
      {guideProviders.map((provider) => {
        const { guide, preference, state } = pullGuideStatus(
          actions.inventory,
          pull,
          provider,
          actions.fallback,
        );
        const jobKey = guideJobKey(pull, provider);
        const run = actions.runs.find(
          (run) =>
            run.kind === "guide" && run.pullKey === jobKey && isActiveRun(run),
        );
        const failed = [...actions.runs]
          .reverse()
          .find(
            (run) =>
              run.kind === "guide" &&
              run.pullKey === jobKey &&
              run.phase === "error",
          );
        const busy = actions.starting.has(jobKey) || !!run;
        const error =
          actions.error || actions.errors[jobKey] || (!busy && failed?.text);
        const name = provider === "codex" ? "Codex" : "Claude";
        const status = busy
          ? "Generating guide…"
          : actions.loading
            ? "Loading guide status…"
            : error
              ? "Guide unavailable"
              : state === "current"
                ? "Guide up to date"
                : state === "stale"
                  ? "Guide out of date"
                  : "No guide yet";
        const label = `${name} · ${t(status)} · ${modelLabel(run?.preference ?? guide?.preference ?? preference)}`;
        return (
          <TooltipTrigger key={provider} delay={250}>
            <Button
              className={`pull-guide-button guide-${error ? "error" : state}`}
              aria-label={label}
              isPending={busy || actions.loading}
              onPress={() => {
                if (busy || actions.loading) return;
                if (actions.error) actions.retry();
                else actions.generate(pull, provider);
              }}
            >
              <span
                className={`provider-mark provider-${provider}`}
                aria-hidden
              />
              {busy ? (
                <LoaderCircle
                  className="guide-run-spinner spin"
                  size={25}
                  aria-hidden
                />
              ) : error ? (
                <CircleAlert
                  className="guide-status-mark"
                  size={11}
                  aria-hidden
                />
              ) : (
                <span className="guide-status-dot" aria-hidden />
              )}
            </Button>
            <Tooltip
              placement="top"
              className="rail-tooltip pull-guide-tooltip"
            >
              <strong>
                {name} · {t(status)}
              </strong>
              <span>
                {modelLabel(run?.preference ?? guide?.preference ?? preference)}
              </span>
              {guide && (
                <span>
                  {t("Generated {{date}}", {
                    date: new Date(guide.generatedAt).toLocaleString(
                      i18n.language,
                    ),
                  })}
                </span>
              )}
              {error && <span>{error}</span>}
              <span>
                {busy
                  ? run?.text || t("Loading the latest PR revision…")
                  : actions.loading
                    ? t("Loading guide status…")
                    : actions.error
                      ? t("Click to retry")
                      : t("Generate with {{model}}", {
                          model: modelLabel(preference),
                        })}
              </span>
            </Tooltip>
          </TooltipTrigger>
        );
      })}
    </div>
  );
}
