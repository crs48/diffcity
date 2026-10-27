import { useEffect, useState, type RefObject } from "react";
import { Dialog, Popover } from "react-aria-components";
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
  models: initialModels,
  connection: initialConnection,
  purpose = "default",
  triggerRef,
  onSave,
  onRefresh,
  onClose,
}: {
  preference: ModelPreference;
  purpose?: "default" | "guide";
  triggerRef?: RefObject<HTMLButtonElement | null>;
  models: Model[];
  connection: Connection;
  onSave: (preference: ModelPreference) => Promise<void>;
  onRefresh: (provider: string) => Promise<ModelCatalog>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(preference);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(
    preference.provider === "codex"
      ? { models: initialModels, connection: initialConnection }
      : null,
  );
  const [busy, setBusy] = useState<"save" | "refresh" | null>(
    preference.provider === "codex" ? null : "refresh",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const models = catalog?.models ?? [];
  const connection = catalog?.connection ?? {
    connected: false,
    identity: "",
    detail: "",
    executable: "",
  };
  const providerName = value.provider === "claude" ? "Claude" : "Codex";
  const title = purpose === "guide" ? "New guide" : "Default model";
  useEffect(() => {
    if (preference.provider === "codex") return;
    let cancelled = false;
    onRefresh(preference.provider)
      .then((next) => {
        if (!cancelled) setCatalog(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onRefresh, preference.provider]);
  const refresh = async (provider: string, changeProvider = false) => {
    setBusy("refresh");
    setError("");
    setNotice("");
    if (changeProvider) {
      setCatalog(null);
      setValue({
        provider,
        model: provider === "claude" ? "claude-fable-5" : "gpt-6-astra",
        reasoningEffort: provider === "claude" ? "high" : "xhigh",
      });
    }
    try {
      const next = await onRefresh(provider);
      setCatalog(next);
      setNotice(t("Model list refreshed."));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const selected = models.find((model) => model.id === value.model);
  const effort = selected?.reasoningEfforts.find(
    (option) => option.effort === value.reasoningEffort,
  );
  const supported =
    connection.connected &&
    !!selected &&
    (value.reasoningEffort === null || !!effort);

  const content = (
    <>
      <header>
        <Cpu size={19} aria-hidden="true" />
        <h2>{t(title)}</h2>
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
        <label>
          {t("Provider")}
          <select
            value={value.provider}
            disabled={!!busy}
            onChange={(event) => void refresh(event.target.value, true)}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        <div className="connection-card">
          <Cpu size={22} aria-hidden="true" />
          <div>
            <h3>{providerName}</h3>
            <p>
              {connection.connected
                ? t("Using your local {{provider}} login", {
                    provider:
                      value.provider === "claude" ? "Claude Code" : "Codex",
                  })
                : t("Sign in to {{provider}}, then refresh models.", {
                    provider: providerName,
                  })}
            </p>
          </div>
          <span
            className={`status-dot ${connection.connected ? "online" : ""}`}
            aria-hidden="true"
          />
        </div>
        {purpose === "guide" && (
          <p className="muted">
            {t(
              "The guide appears first. A background priority pass then inspects up to 6 important files with this model. You can stop it at any time; further enrichment requires your choice.",
            )}
          </p>
        )}
        <p className="muted" id="model-scope-help">
          {t(
            purpose === "guide"
              ? "Creates another guide for this revision. Your saved guides, comments, and default model stay available."
              : "Applies to new guides and conversations. Existing conversations keep their model.",
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
            t("Model availability follows your selected account.")}
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
        <button disabled={!!busy} onClick={() => void refresh(value.provider)}>
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
          {t(purpose === "guide" ? "Generate guide" : "Save default")}
        </button>
      </footer>
    </>
  );

  return triggerRef ? (
    <Popover
      isOpen
      triggerRef={triggerRef}
      placement="right bottom"
      offset={10}
      containerPadding={12}
      isKeyboardDismissDisabled={!!busy}
      shouldCloseOnInteractOutside={() => !busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      className="model-popover"
    >
      <Dialog
        id="model-settings"
        aria-label={t(title)}
        aria-busy={!!busy}
        className="modal model-popover-dialog outline-none"
      >
        {content}
      </Dialog>
    </Popover>
  ) : (
    <AppDialog label={t(title)} onClose={onClose} busy={!!busy}>
      {content}
    </AppDialog>
  );
}
