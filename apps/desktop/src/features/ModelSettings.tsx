import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Cpu, LoaderCircle, RefreshCw, X } from "lucide-react";
import { AppDialog } from "../ui/AppDialog";
import type {
  Connection,
  Model,
  ModelCatalog,
  ModelPreference,
} from "../lib/api";
import { chooseModel, effortLabel } from "../lib/models";

export function ModelSettings({
  preference,
  models,
  connection,
  onSave,
  onRefresh,
  onClose,
}: {
  preference: ModelPreference;
  models: Model[];
  connection: Connection;
  onSave: (preference: ModelPreference) => Promise<void>;
  onRefresh: () => Promise<ModelCatalog>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(preference);
  const [busy, setBusy] = useState<"save" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = models.find((model) => model.id === value.model);
  const effort = selected?.reasoningEfforts.find(
    (option) => option.effort === value.reasoningEffort,
  );
  const supported =
    connection.connected &&
    value.provider === "codex" &&
    !!selected &&
    (value.reasoningEffort === null || !!effort);

  return (
    <AppDialog label={t("Default model")} onClose={onClose} busy={!!busy}>
      <header>
        <Cpu size={19} aria-hidden="true" />
        <h2>{t("Default model")}</h2>
        <button
          className="icon-button"
          aria-label={t("Close model settings")}
          disabled={!!busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">
        <div className="connection-card">
          <Cpu size={22} aria-hidden="true" />
          <div>
            <h3>Codex</h3>
            <p>
              {t(
                connection.connected
                  ? "Using your local Codex login"
                  : "Connect Codex in Connections to choose a model.",
              )}
            </p>
          </div>
          <span
            className={`status-dot ${connection.connected ? "online" : ""}`}
            aria-hidden="true"
          />
        </div>
        <p className="muted" id="model-scope-help">
          {t(
            "Applies to guided walkthroughs, inline replies, and PR chat. Changes take effect on your next request.",
          )}
        </p>
        <label>
          {t("Model")}
          <select
            autoFocus
            value={value.model}
            disabled={!!busy || !connection.connected || !models.length}
            aria-describedby="model-scope-help model-description"
            onChange={(event) => {
              const model = models.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (!model) return;
              const next = chooseModel(value, model);
              setNotice(
                next.reasoningEffort !== value.reasoningEffort
                  ? t("Reasoning adjusted to match this model.")
                  : "",
              );
              setValue(next);
              setError("");
            }}
          >
            {!selected && (
              <option value={value.model}>
                {value.model} · {t("Unavailable")}
              </option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        <p id="model-description" className="muted">
          {selected?.description ||
            t("Model availability follows your Codex account.")}
        </p>
        <label>
          {t("Reasoning")}
          <select
            value={value.reasoningEffort ?? ""}
            disabled={!!busy || !connection.connected || !selected}
            aria-describedby="reasoning-description"
            onChange={(event) => {
              setValue({
                ...value,
                reasoningEffort: event.target.value || null,
              });
              setNotice("");
              setError("");
            }}
          >
            <option value="">
              {t("Model default")}
              {selected?.defaultReasoningEffort
                ? ` · ${t(effortLabel(selected.defaultReasoningEffort))}`
                : ""}
            </option>
            {value.reasoningEffort && !effort && (
              <option value={value.reasoningEffort}>
                {t(effortLabel(value.reasoningEffort))} · {t("Unavailable")}
              </option>
            )}
            {selected?.reasoningEfforts.map((option) => (
              <option key={option.effort} value={option.effort}>
                {t(effortLabel(option.effort))}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" id="reasoning-description">
          {effort?.description ||
            t(
              "Higher reasoning can take longer. Only levels supported by this model are listed.",
            )}
        </p>
        {!supported && connection.connected && (
          <p role="status" className="attention-note">
            {t(
              "This selection is unavailable. Refresh the models or choose a supported combination.",
            )}
          </p>
        )}
        <p role="status" className={notice ? "muted" : "sr-only"}>
          {notice}
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button
          disabled={!!busy}
          onClick={async () => {
            setBusy("refresh");
            setError("");
            try {
              await onRefresh();
              setNotice(t("Model list refreshed."));
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          <RefreshCw
            size={15}
            className={busy === "refresh" ? "spin" : ""}
            aria-hidden="true"
          />
          {t("Refresh models")}
        </button>
        <button
          className="primary"
          disabled={!!busy || !supported}
          onClick={async () => {
            setBusy("save");
            setError("");
            try {
              await onSave(value);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "save" ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : (
            <Check size={15} aria-hidden="true" />
          )}
          {t("Save default")}
        </button>
      </footer>
    </AppDialog>
  );
}
