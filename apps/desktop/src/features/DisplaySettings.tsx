import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { AppDialog } from "../ui/AppDialog";
export function DisplaySettings({
  days,
  hideOtherAccounts,
  onHideOtherAccounts,
  onSave,
  onClose,
}: {
  days: number;
  hideOtherAccounts: boolean;
  onHideOtherAccounts: (hidden: boolean) => void;
  onSave: (days: number) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(days);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AppDialog label={t("Display settings")} onClose={onClose} busy={busy}>
      <header>
        <h2>{t("Display settings")}</h2>
        <button
          className="icon-button"
          aria-label={t("Close display settings")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideOtherAccounts}
            onChange={(event) => onHideOtherAccounts(event.target.checked)}
            aria-describedby="account-visibility-help"
          />
          {t("Hide other account avatars")}
        </label>
        <p id="account-visibility-help" className="muted">
          {t(
            "Keep only the selected account in the sidebar, or your personal account when viewing all accounts. For screenshots, also filter the inbox to the repo you want to share.",
          )}
        </p>
        <label>
          {t("Show your completed PRs")}
          <select
            aria-label={t("Show your completed PRs")}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            aria-describedby="completed-help"
          >
            {[
              [0, "Hide from inbox"],
              [1, "Last 24 hours"],
              [2, "Last 2 days"],
              [7, "Last week"],
              [30, "Last month"],
            ].map(([n, label]) => (
              <option value={n} key={n}>
                {t(String(label))}
              </option>
            ))}
          </select>
        </label>
        <p id="completed-help" className="muted">
          {t(
            "Your recently merged and closed PRs appear below open work. History always includes older PRs from every author.",
          )}
        </p>
        <p className="muted">
          {t(
            "Submitted reviews move down the list until someone requests your review again. Private notes and reading progress do not count as a GitHub review.",
          )}
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(value);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={15} />
          {t("Save display settings")}
        </button>
      </footer>
    </AppDialog>
  );
}
