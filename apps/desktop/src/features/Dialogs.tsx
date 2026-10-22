import { useTranslation } from "react-i18next";
import "../i18n";
import { languages } from "../i18n";
import { AppDialog } from "../ui/AppDialog";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { useState } from "react";
import {
  Check,
  ExternalLink,
  Github,
  LoaderCircle,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  type Bootstrap,
  type Note,
  type ReviewWorkspace,
  type Settings,
  type PublishResult,
} from "../lib/api";
import { isSampleRepo } from "../lib/inbox";
import { countProgress } from "../lib/review";

export function Connections({
  data,
  onSave,
  onClose,
}: {
  data: Bootstrap;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(data.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AppDialog label={t("Connections")} onClose={onClose} busy={busy}>
      <header>
        <Settings2 size={18} />
        <h2>{t("Connections")} </h2>
        <button
          className="icon-button"
          aria-label={t("Close connections")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">
        <div className="connection-card">
          <Github size={20} />
          <div>
            <h3>GitHub</h3>
            <p>
              {data.github.connected
                ? `Connected as ${data.github.identity}`
                : data.github.detail}
            </p>
          </div>
          <span
            className={`status-dot ${data.github.connected ? "online" : ""}`}
          />
        </div>
        <label>
          {t("GitHub CLI path")}{" "}
          <input
            placeholder={data.github.executable || "/opt/homebrew/bin/gh"}
            value={settings.ghPath ?? ""}
            onChange={(e) =>
              setSettings({ ...settings, ghPath: e.target.value || null })
            }
          />
        </label>
        <div className="connection-card">
          <Sparkles size={20} />
          <div>
            <h3>Codex</h3>
            <p>
              {data.codex.connected ? data.codex.identity : data.codex.detail}
            </p>
            <small>{data.codex.connected && data.codex.detail}</small>
          </div>
          <span
            className={`status-dot ${data.codex.connected ? "online" : ""}`}
          />
        </div>
        <label>
          {t("Codex executable")}{" "}
          <input
            placeholder={data.codex.executable || "Path to OpenAI Codex"}
            value={settings.codexPath ?? ""}
            onChange={(e) =>
              setSettings({ ...settings, codexPath: e.target.value || null })
            }
          />
        </label>
        <label>
          {t("Language")}{" "}
          <select
            value={settings.locale || "en"}
            onChange={(e) =>
              setSettings({ ...settings, locale: e.target.value })
            }
          >
            {languages.map((language) => (
              <option key={language.id} value={language.id}>
                {language.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Appearance")}{" "}
          <select
            value={settings.theme}
            onChange={(e) =>
              setSettings({ ...settings, theme: e.target.value })
            }
          >
            <option value="system">{t("System")} </option>
            <option value="light">{t("Light")} </option>
            <option value="dark">{t("Dark")} </option>
          </select>
        </label>
        <p className="muted">
          {t(
            "Reviews use your Codex login. Selected source is sent to its configured service. Notes stay on this computer until you explicitly publish them.",
          )}{" "}
        </p>
        <details>
          <summary>{t("Local storage")} </summary>
          <code>{data.dataDirectory}</code>
          <p>
            {t("Database schema:")} {data.schemaVersion}
          </p>
        </details>
        {error && (
          <p className="error-text" role="alert">
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
              await onSave(settings);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Check size={15} />
          )}{" "}
          {t("Save and reconnect")}{" "}
        </button>
      </footer>
    </AppDialog>
  );
}

export function Finish({
  workspace: w,
  login,
  onPublished,
  onCheckpoint,
  onClose,
}: {
  workspace: ReviewWorkspace;
  login: string;
  onPublished: (r: PublishResult) => Promise<void>;
  onCheckpoint: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const drafts = w.notes.filter(
    (n) => n.githubDraft && !n.publishedUrl && !n.anchor?.textSelection,
  );
  const [selected, setSelected] = useState(drafts.map((n) => n.id));
  const summaryKey = `diffcity.review-summary.${w.snapshot.id}`;
  const [body, setBody] = useState(
    () => localStorage.getItem(summaryKey) || "",
  );
  const [event, setEvent] = useState("COMMENT");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState("");
  const counts = countProgress(w);
  const renderDraft = (n: Note) => (
    <div className="draft-preview" key={n.id}>
      <input
        type="checkbox"
        aria-label={t("Include draft {{number}}", {
          number: drafts.indexOf(n) + 1,
        })}
        checked={selected.includes(n.id)}
        onChange={() =>
          setSelected((ids) =>
            ids.includes(n.id)
              ? ids.filter((id) => id !== n.id)
              : [...ids, n.id],
          )
        }
      />
      <div>
        {n.anchor && (
          <code>
            {n.anchor.path}:{n.anchor.startLine}
            {n.anchor.startLine !== n.anchor.line && `–${n.anchor.line}`}
          </code>
        )}
        <CommentMarkdown body={n.body} />
      </div>
    </div>
  );
  return (
    <AppDialog label={t("Finish review")} onClose={onClose} busy={busy} wide>
      <header>
        <Check size={18} />
        <h2>{t("Finish review")} </h2>
        <button
          className="icon-button"
          aria-label={t("Close finish review")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">
        <p className="muted">
          {w.snapshot.pull.repository} #{w.snapshot.pull.number}
          {t("· revision")} <code>{w.snapshot.pull.head.slice(0, 8)}</code>
        </p>
        <div className="coverage-grid">
          <div>
            <strong>
              {counts.reviewed}/{counts.total}
            </strong>
            <span>{t("Hunks reviewed")} </span>
          </div>
          <div>
            <strong>{counts.acknowledged}</strong>
            <span>{t("Summaries acknowledged")} </span>
          </div>
          <div>
            <strong>{counts.deferred}</strong>
            <span>{t("Deferred")} </span>
          </div>
          <div>
            <strong>{counts.unassessed}</strong>
            <span>{t("Need assessment")} </span>
          </div>
        </div>
        {counts.highRemaining > 0 && (
          <p className="attention-note">
            {counts.highRemaining}
            {t(
              "high-attention steps remain. You can return to the guide or submit a partial review.",
            )}{" "}
          </p>
        )}
        <div className="checkpoint-explanation">
          <h3>{t("Keep a private review checkpoint")}</h3>
          <p>
            {t(
              "Save this revision as your comparison point for the next update. This stays on your computer, leaves your notes and progress intact, and does not mark unread code as reviewed.",
            )}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.checkpoint(w.snapshot.id);
                onCheckpoint();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check size={15} />
            {t("Save review checkpoint")}
          </button>
        </div>
        <h3>{t("Selected GitHub drafts")} </h3>
        {drafts.length ? (
          drafts.map(renderDraft)
        ) : (
          <p className="muted">
            {t(
              "No drafts selected. Private notes and Codex conversations are not included.",
            )}{" "}
          </p>
        )}
        <label>
          {t("Review summary")}{" "}
          <textarea
            aria-label={t("GitHub review summary")}
            placeholder={t("Summarize your review…")}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              localStorage.setItem(summaryKey, e.target.value);
            }}
          />
        </label>
        <label>
          {t("Review action")}{" "}
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="COMMENT">{t("Comment")} </option>
            <option value="APPROVE" disabled={w.snapshot.pull.author === login}>
              {t("Approve")}{" "}
              {w.snapshot.pull.author === login
                ? " · unavailable on your own PR"
                : ""}
            </option>
            <option
              value="REQUEST_CHANGES"
              disabled={w.snapshot.pull.author === login}
            >
              {t("Request changes")}{" "}
              {w.snapshot.pull.author === login
                ? " · unavailable on your own PR"
                : ""}
            </option>
          </select>
        </label>
        <p className="muted">
          {t("Publishing as")} <strong>{login || "your GitHub account"}</strong>
          {t(". Only this summary and checked drafts will be sent.")}{" "}
        </p>
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div
            className={`callout ${result.state === "published" ? "success" : ""}`}
          >
            <div>
              <strong>{result.message}</strong>
              {result.url && (
                <button
                  className="text-button"
                  onClick={() => void api.external(result.url)}
                >
                  {t("View in GitHub")} <ExternalLink size={13} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <footer>
        <button className="secondary" disabled={busy} onClick={onClose}>
          {t("Back to guide")}{" "}
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            w.snapshot.pull.state !== "open" ||
            result?.state === "published" ||
            (!body.trim() && !selected.length && event === "COMMENT") ||
            isSampleRepo(w.snapshot.pull.repository)
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await api.publish({
                snapshotId: w.snapshot.id,
                noteIds: selected,
                body,
                event,
              });
              setResult(r);
              if (r.state === "published") {
                localStorage.removeItem(summaryKey);
                await onPublished(r);
              }
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Github size={15} />
          )}{" "}
          {t("Publish review")}{" "}
        </button>
      </footer>
    </AppDialog>
  );
}
