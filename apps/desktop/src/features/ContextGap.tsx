import { useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { ArrowDown, ArrowUp, ChevronsDownUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type DiffLine } from "../lib/api";
import type { ContextGap as Gap } from "../lib/contextGaps";
import { ContextLines } from "./ContextLines";

/** A single omitted span, revealed from either edge without repeating source lines. */
export function ContextGap({
  gap,
  snapshotId,
  split,
}: {
  gap: Gap;
  snapshotId: string;
  split: boolean;
}) {
  const { t } = useTranslation();
  const [head, setHead] = useState<DiffLine[]>([]);
  const [tail, setTail] = useState<DiffLine[]>([]);
  const [total, setTotal] = useState(gap.hidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const controls = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<{
    element: Element;
    direction?: "before" | "after";
  } | null>(null);
  const remaining =
    total === null ? null : Math.max(0, total - head.length - tail.length);
  const expanded = head.length + tail.length > 0;
  const count = Math.min(25, remaining ?? 25);
  useLayoutEffect(() => {
    const focus = restoreFocus.current;
    if (busy || !focus) return;
    restoreFocus.current = null;
    // Keep keyboard focus when revealing the last lines replaces arrows with
    // Collapse context, without stealing focus if the reader moved elsewhere.
    if (
      document.activeElement !== focus.element &&
      document.activeElement !== document.body
    )
      return;
    const preferred =
      focus.direction &&
      controls.current?.querySelector<HTMLButtonElement>(
        `[data-direction="${focus.direction}"]`,
      );
    (
      preferred || controls.current?.querySelector<HTMLButtonElement>("button")
    )?.focus({ preventScroll: true });
  }, [busy, remaining, expanded]);
  const expand = async (direction: "before" | "after") => {
    const hunk = direction === "before" ? gap.below : gap.above;
    if (!hunk || pending.current || count === 0) return;
    if (
      document.activeElement &&
      controls.current?.contains(document.activeElement)
    )
      restoreFocus.current = { element: document.activeElement, direction };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.context(
        snapshotId,
        hunk.id,
        direction === "before" ? tail.length + count : 0,
        direction === "after" ? head.length + count : 0,
      );
      const lines = direction === "before" ? result.before : result.after;
      const left =
        direction === "before" ? result.beforeRemaining : result.afterRemaining;
      setTotal(lines.length + left);
      if (direction === "before") setTail(lines);
      else setHead(lines);
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const source = (hunk = gap.below ?? gap.above!) => ({
    "data-hunk-id": hunk.id,
    "data-source-path": hunk.path,
    "data-source-snapshot": snapshotId,
  });
  if (remaining === 0 && !expanded && !error) return null;
  return (
    <div className="context-gap">
      <div {...source(gap.above)}>
        <ContextLines
          lines={head}
          split={split}
          path={(gap.above ?? gap.below)!.path}
        />
      </div>
      <div ref={controls} className="context-controls" aria-busy={busy}>
        {remaining !== 0 && (
          <>
            <div className="context-directions">
              {gap.above && (
                <TooltipTrigger delay={300}>
                  <Button
                    className="context-expand"
                    data-direction="after"
                    aria-label={t("Show {{count}} lines below", { count })}
                    isDisabled={busy}
                    onPress={() => void expand("after")}
                  >
                    <ArrowDown size={15} aria-hidden />
                  </Button>
                  <Tooltip className="rail-tooltip" placement="top">
                    {t("Show {{count}} lines below", { count })}
                  </Tooltip>
                </TooltipTrigger>
              )}
              {gap.below && (
                <TooltipTrigger delay={300}>
                  <Button
                    className="context-expand"
                    data-direction="before"
                    aria-label={t("Show {{count}} lines above", { count })}
                    isDisabled={busy}
                    onPress={() => void expand("before")}
                  >
                    <ArrowUp size={15} aria-hidden />
                  </Button>
                  <Tooltip className="rail-tooltip" placement="top">
                    {t("Show {{count}} lines above", { count })}
                  </Tooltip>
                </TooltipTrigger>
              )}
            </div>
            <span className="context-count" role="status">
              {busy
                ? t("Loading surrounding code…")
                : remaining === null
                  ? t("More unchanged lines")
                  : t("{{count}} hidden lines", { count: remaining })}
            </span>
          </>
        )}
        {expanded && (
          <Button
            className="context-collapse"
            isDisabled={busy}
            onPress={() => {
              if (
                document.activeElement &&
                controls.current?.contains(document.activeElement)
              )
                restoreFocus.current = { element: document.activeElement };
              setHead([]);
              setTail([]);
              setError("");
            }}
          >
            <ChevronsDownUp size={14} aria-hidden />
            {t("Collapse context")}
          </Button>
        )}
      </div>
      {error && (
        <p className="context-error error-text" role="alert">
          {error}
        </p>
      )}
      <div {...source(gap.below)}>
        <ContextLines
          lines={tail}
          split={split}
          path={(gap.below ?? gap.above)!.path}
        />
      </div>
    </div>
  );
}
