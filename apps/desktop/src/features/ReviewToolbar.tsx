import type { ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { Activity, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Guide } from "../lib/api";
import { enrichmentRemaining } from "../lib/enrichment";
import { isActiveRun, type AiRun } from "./useAiRuns";

/** Secondary controls share one small, keyboard-accessible toolbar affordance. */
export function ReviewPopover({
  label,
  detail,
  icon,
  attention = false,
  children,
}: {
  label: string;
  detail?: string;
  icon: ReactNode;
  attention?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const { t } = useTranslation();
  return (
    <DialogTrigger>
      <TooltipTrigger delay={300}>
        <Button className="icon-button review-tool" aria-label={label}>
          {icon}
          {attention && <span className="review-tool-dot" aria-hidden />}
        </Button>
        <Tooltip className="rail-tooltip" placement="bottom">
          <strong>{label}</strong>
          {detail && <span>{detail}</span>}
        </Tooltip>
      </TooltipTrigger>
      <Popover className="review-tools-popover" placement="bottom end">
        <Dialog aria-label={label}>
          {({ close }) => (
            <>
              <header>
                <strong>{label}</strong>
                <Button
                  className="icon-button"
                  aria-label={t("Close {{panel}}", { panel: label })}
                  onPress={close}
                >
                  <X size={15} aria-hidden />
                </Button>
              </header>
              {typeof children === "function" ? children(close) : children}
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function ReviewActivity({
  guide,
  runs,
  pending,
  newRevision,
  syncError,
  children,
}: {
  guide: Guide;
  runs: AiRun[];
  pending: boolean;
  newRevision: boolean;
  syncError: string | null | undefined;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const { t } = useTranslation();
  const requests = runs.filter((run) => run.prompt && isActiveRun(run));
  const work = runs.filter(
    (run) => run.snapshotId === guide.snapshotId && run.kind !== "question",
  );
  const active = work.some(isActiveRun);
  const failed = work.some((run) => !isActiveRun(run));
  const files = guide.enrichment?.files ?? [];
  const further =
    !guide.enrichment?.dismissed &&
    files.some((f) => f.tier === "priority" && f.status === "complete") &&
    !files.some((f) => f.tier === "priority" && enrichmentRemaining(f)) &&
    files.some((f) => f.tier === "further" && enrichmentRemaining(f));
  const detail = requests.length
    ? t("Agent needs your response")
    : syncError
      ? t("Review sync needs attention")
      : newRevision
        ? t("New code is available")
        : pending
          ? t("Your guided review is ready.")
          : failed
            ? t("Review activity needs attention")
            : active
              ? t("Guide generation in progress")
              : further
                ? t("Priority pass finished")
                : t("Guide generation and enrichment");
  const attention =
    requests.length > 0 ||
    !!syncError ||
    newRevision ||
    pending ||
    failed ||
    further;
  return (
    <>
      <span className="sr-only" role="status">
        {detail}
      </span>
      <ReviewPopover
        label={t("Review activity")}
        detail={detail}
        attention={attention}
        icon={
          active ? (
            <LoaderCircle size={16} className="spin" aria-hidden />
          ) : (
            <Activity size={16} aria-hidden />
          )
        }
      >
        {(close) => (
          <>
            <p className="review-activity-summary">{detail}</p>
            {typeof children === "function" ? children(close) : children}
          </>
        )}
      </ReviewPopover>
    </>
  );
}
