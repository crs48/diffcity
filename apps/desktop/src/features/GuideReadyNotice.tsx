import { useState } from "react";
import { Button } from "react-aria-components";
import { ArrowRight, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ReadyGuide = {
  id: string;
  snapshotId: string;
  repository: string;
  number: number;
  title: string;
  model: string;
};

/** Completions stay available until opened or dismissed; no timer or focus stealing. */
export function GuideReadyNotice({
  notices,
  disabled,
  opening,
  onView,
  onDismiss,
}: {
  notices: ReadyGuide[];
  disabled: boolean;
  opening: boolean;
  onView: (notice: ReadyGuide) => Promise<void>;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const notice = notices.at(-1);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  return (
    <section
      className="guide-notifications"
      aria-label={t("Guide notifications")}
    >
      <div className="sr-only" role="status" aria-atomic="true">
        {notice
          ? t(
              "Guide ready for {{pull}}: {{model}}. Choose View guide to open it.",
              {
                pull: `${notice.repository}#${notice.number}`,
                model: notice.model,
              },
            )
          : ""}
      </div>
      {notice && (
        <div className="guide-ready-toast" key={notice.id}>
          <header>
            <CheckCircle2
              size={20}
              className="guide-ready-icon"
              aria-hidden="true"
            />
            <h2>{t("Guide ready")}</h2>
            <Button
              className="icon-button"
              aria-label={t("Dismiss guide notification")}
              isDisabled={opening}
              onPress={() => {
                onDismiss(notice.id);
                requestAnimationFrame(() => {
                  if (document.activeElement === document.body)
                    (
                      document.querySelector<HTMLElement>(
                        ".guide-ready-toast button",
                      ) ?? document.getElementById("review-workspace")
                    )?.focus({ preventScroll: true });
                });
              }}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </header>
          <p className="guide-ready-pull">
            {notice.repository} <span>#{notice.number}</span>
          </p>
          <p className="guide-ready-title" title={notice.title}>
            {notice.title}
          </p>
          <p className="guide-ready-model">{notice.model}</p>
          {error?.id === notice.id && (
            <p role="alert" className="error-text">
              {error.message}
            </p>
          )}
          <footer>
            <span className="muted">
              {notices.length > 1
                ? t("{{count}} more guides ready", {
                    count: notices.length - 1,
                  })
                : ""}
            </span>
            <Button
              className="primary"
              isDisabled={disabled || opening}
              onPress={async () => {
                setError(null);
                try {
                  await onView(notice);
                } catch (cause) {
                  setError({ id: notice.id, message: String(cause) });
                }
              }}
            >
              {opening ? (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              ) : null}
              {t(opening ? "Opening guide…" : "View guide")}
              {!opening && <ArrowRight size={15} aria-hidden="true" />}
            </Button>
          </footer>
        </div>
      )}
    </section>
  );
}
