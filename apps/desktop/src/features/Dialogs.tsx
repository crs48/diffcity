import { useState } from "react";
import {
  Check,
  ExternalLink,
  Github,
  LoaderCircle,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  type Bootstrap,
  type Note,
  type Repository,
  type ReviewWorkspace,
  type Settings,
  type PublishResult,
} from "../lib/api";
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
  const [settings, setSettings] = useState(data.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Connections"
        className="modal"
      >
        <header>
          <Settings2 size={18} />
          <h2>Connections</h2>
          <button
            className="icon-button"
            aria-label="Close connections"
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
            GitHub CLI path
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
            Codex executable
            <input
              placeholder={data.codex.executable || "Path to OpenAI Codex"}
              value={settings.codexPath ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, codexPath: e.target.value || null })
              }
            />
          </label>
          <label>
            Review model
            <select
              value={settings.model ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value || null })
              }
            >
              <option value="">Codex account default</option>
              {data.models.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                  {m.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Appearance
            <select
              value={settings.theme}
              onChange={(e) =>
                setSettings({ ...settings, theme: e.target.value })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <p className="muted">
            Reviews use your Codex login. Selected source is sent to its
            configured service. Notes stay on this computer until you explicitly
            publish them.
          </p>
          <details>
            <summary>Local storage</summary>
            <code>{data.dataDirectory}</code>
          </details>
          {error && <p className="error-text">{error}</p>}
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
            Save and reconnect
          </button>
        </footer>
      </section>
    </div>
  );
}

export function Projects({
  selected,
  onChange,
  onClose,
}: {
  selected: string[];
  onChange: (repos: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    try {
      setRepos(await api.repositories());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (name: string) =>
    setChosen((current) =>
      current.includes(name)
        ? current.filter((r) => r !== name)
        : [...current, name],
    );
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose projects"
      >
        <header>
          <Github size={18} />
          <h2>Your projects</h2>
          <button
            className="icon-button"
            aria-label="Close projects"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-content">
          <p>Choose the repositories you want in your review inbox.</p>
          <div className="search-box">
            <Search size={15} />
            <input
              aria-label="Search repositories"
              placeholder="Search or enter owner/repository"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query.includes("/") && !repos.some((r) => r.fullName === query) && (
            <button
              className="secondary"
              onClick={() => {
                toggle(query.trim());
                setQuery("");
              }}
            >
              Add {query.trim()}
            </button>
          )}
          <div className="repo-options">
            {[...new Set([...chosen, ...repos.map((r) => r.fullName)])]
              .filter((name) =>
                name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(name)}
                    onChange={() => toggle(name)}
                  />
                  <span>{name}</span>
                  <small>
                    {repos.find((r) => r.fullName === name)?.private
                      ? "Private"
                      : ""}
                  </small>
                </label>
              ))}
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Github size={14} />
            )}{" "}
            Load repositories from GitHub
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
        <footer>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onChange(chosen);
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save {chosen.length} projects
          </button>
        </footer>
      </section>
    </div>
  );
}

export function Finish({
  workspace: w,
  login,
  onPublished,
  onClose,
}: {
  workspace: ReviewWorkspace;
  login: string;
  onPublished: (r: PublishResult) => Promise<void>;
  onClose: () => void;
}) {
  const drafts = w.notes.filter((n) => n.githubDraft && !n.publishedUrl);
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
    <label className="draft-preview" key={n.id}>
      <input
        type="checkbox"
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
        <p>{n.body}</p>
      </div>
    </label>
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal finish-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Finish review"
      >
        <header>
          <Check size={18} />
          <h2>Finish review</h2>
          <button
            className="icon-button"
            aria-label="Close finish review"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-content">
          <p className="muted">
            {w.snapshot.pull.repository} #{w.snapshot.pull.number} · revision{" "}
            <code>{w.snapshot.pull.head.slice(0, 8)}</code>
          </p>
          <div className="coverage-grid">
            <div>
              <strong>
                {counts.reviewed}/{counts.total}
              </strong>
              <span>Hunks reviewed</span>
            </div>
            <div>
              <strong>{counts.acknowledged}</strong>
              <span>Summaries acknowledged</span>
            </div>
            <div>
              <strong>{counts.deferred}</strong>
              <span>Deferred</span>
            </div>
            <div>
              <strong>{counts.unassessed}</strong>
              <span>Need assessment</span>
            </div>
          </div>
          {counts.highRemaining > 0 && (
            <p className="attention-note">
              {counts.highRemaining} high-attention steps remain. You can return
              to the guide or submit a partial review.
            </p>
          )}
          <h3>Selected GitHub drafts</h3>
          {drafts.length ? (
            drafts.map(renderDraft)
          ) : (
            <p className="muted">
              No drafts selected. Private notes and Codex conversations are not
              included.
            </p>
          )}
          <label>
            Review summary
            <textarea
              aria-label="GitHub review summary"
              placeholder="Summarize your review…"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                localStorage.setItem(summaryKey, e.target.value);
              }}
            />
          </label>
          <label>
            Review action
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="COMMENT">Comment</option>
              <option
                value="APPROVE"
                disabled={w.snapshot.pull.author === login}
              >
                Approve
                {w.snapshot.pull.author === login
                  ? " · unavailable on your own PR"
                  : ""}
              </option>
              <option
                value="REQUEST_CHANGES"
                disabled={w.snapshot.pull.author === login}
              >
                Request changes
                {w.snapshot.pull.author === login
                  ? " · unavailable on your own PR"
                  : ""}
              </option>
            </select>
          </label>
          <p className="muted">
            Publishing as <strong>{login || "your GitHub account"}</strong>.
            Only this summary and checked drafts will be sent.
          </p>
          {error && <div className="error-text">{error}</div>}
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
                    View in GitHub <ExternalLink size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <footer>
          <button className="secondary" disabled={busy} onClick={onClose}>
            Back to guide
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              result?.state === "published" ||
              (!body.trim() && !selected.length && event === "COMMENT") ||
              w.snapshot.pull.repository === "diffcity/demo"
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
            Publish review
          </button>
        </footer>
      </section>
    </div>
  );
}
