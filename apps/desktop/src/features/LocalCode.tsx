import { useEffect, useState } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import {
  FolderGit2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppDialog } from "../ui/AppDialog";
import {
  api,
  type LocalCodeDirectory,
  type RepositoryContext,
} from "../lib/api";

export function RepositoryContextButton({
  repository,
  head,
  version,
  onOpen,
}: {
  repository: string;
  head: string;
  version: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [context, setContext] = useState<RepositoryContext | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .repositoryContext(repository, head)
      .then((value) => {
        if (active) {
          setContext(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setContext(null);
          setError(String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [repository, head, version]);
  const label = context?.path
    ? t("Local code connected")
    : t("Connect local code");
  return (
    <TooltipTrigger delay={300}>
      <Button
        className={`icon-button repository-context-button ${context?.path ? "connected" : ""}`}
        onPress={onOpen}
        aria-label={label}
      >
        <FolderGit2 size={14} aria-hidden />
      </Button>
      <Tooltip className="rail-tooltip" placement="bottom">
        <strong>{label}</strong>
        <span>{context?.path}</span>
        <span>
          {error ||
            context?.detail ||
            t("Choose a local checkout for deeper code questions.")}
        </span>
      </Tooltip>
    </TooltipTrigger>
  );
}

export function LocalCode({
  repository,
  head,
  onClose,
  onChange,
}: {
  repository?: string;
  head?: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState<LocalCodeDirectory | null>(null);
  const [context, setContext] = useState<RepositoryContext | null>(null);
  const [root, setRoot] = useState("");
  const [checkout, setCheckout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      api.localRepositories(),
      repository ? api.repositoryContext(repository, head) : null,
    ])
      .then(([data, current]) => {
        if (active) {
          setDirectory(data);
          setContext(current);
          setCheckout(current?.path ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [repository, head]);
  const act = async (operation: () => Promise<LocalCodeDirectory | null>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await operation();
      if (!data) return;
      setDirectory(data);
      if (repository) {
        const current = await api.repositoryContext(repository, head);
        setContext(current);
        setCheckout(current.path ?? "");
      }
      setNotice(t("Local code settings saved."));
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const addRoot = (path: string) =>
    act(async () => {
      const data = await api.saveCodeRoots([
        ...(directory?.settings.roots ?? []),
        path,
      ]);
      setRoot("");
      return data;
    });
  return (
    <AppDialog label={t("Local code")} onClose={onClose} busy={busy}>
      <header>
        <FolderGit2 size={18} />
        <h2>{t("Local code")}</h2>
        <Button
          className="icon-button"
          aria-label={t("Close local code")}
          isDisabled={busy}
          onPress={onClose}
        >
          <X size={18} />
        </Button>
      </header>
      <div className="modal-content local-code-settings">
        <p className="muted">
          {t(
            "Connect your checkouts so Claude and Codex can read files, search the repository, and inspect local Git history while reviewing a PR.",
          )}
        </p>
        <section aria-labelledby="code-directories-heading">
          <h3 id="code-directories-heading">{t("Code directories")}</h3>
          <p className="muted">
            {t(
              "Add a folder that contains your repositories. Diff City matches GitHub remotes, even when the folder name is different.",
            )}
          </p>
          <ul className="code-roots">
            {directory?.settings.roots.map((path) => (
              <li key={path}>
                <FolderOpen size={16} aria-hidden />
                <code>{path}</code>
                <Button
                  className="icon-button"
                  aria-label={`${t("Remove code directory")} ${path}`}
                  isDisabled={busy}
                  onPress={() =>
                    void act(() =>
                      api.saveCodeRoots(
                        directory.settings.roots.filter((p) => p !== path),
                      ),
                    )
                  }
                >
                  <X size={14} />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="code-path-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (root.trim()) void addRoot(root);
            }}
          >
            <label className="sr-only" htmlFor="code-root">
              {t("Code directory path")}
            </label>
            <input
              id="code-root"
              placeholder="~/Code"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              disabled={busy || !directory}
            />
            <Button
              type="submit"
              isDisabled={busy || !directory || !root.trim()}
            >
              {t("Add directory")}
            </Button>
            <Button
              isDisabled={busy}
              onPress={() =>
                void act(async () => {
                  const path = await api.chooseCodeFolder();
                  return path
                    ? api.saveCodeRoots([
                        ...(directory?.settings.roots ?? []),
                        path,
                      ])
                    : null;
                })
              }
            >
              <FolderOpen size={15} />
              {t("Browse…")}
            </Button>
          </form>
        </section>
        {repository && (
          <section
            className="local-checkout-section"
            aria-labelledby="local-checkout-heading"
          >
            <h3 id="local-checkout-heading">{t("Checkout for this PR")}</h3>
            <code>{repository}</code>
            <p className="muted">{context?.detail}</p>
            {context?.path && (
              <div className="local-checkout-status">
                <strong>{t("Connected")}</strong>
                <code>{context.path}</code>
                <span>
                  {context.branch ?? t("Detached HEAD")} ·{" "}
                  {context.head?.slice(0, 8)}
                  {context.dirty ? ` · ${t("Uncommitted changes")}` : ""}
                </span>
              </div>
            )}
            {context && context.candidates.length > 1 && (
              <label>
                {t("Available checkouts")}
                <select
                  value={context.path ?? ""}
                  disabled={busy || !directory}
                  onChange={(e) => {
                    if (e.target.value)
                      void act(() =>
                        api.bindLocalRepository(repository, e.target.value),
                      );
                  }}
                >
                  <option value="">{t("Choose a checkout…")}</option>
                  {context.candidates.map((path) => (
                    <option value={path} key={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form
              className="code-path-input"
              onSubmit={(e) => {
                e.preventDefault();
                if (checkout.trim())
                  void act(() => api.bindLocalRepository(repository, checkout));
              }}
            >
              <label className="sr-only" htmlFor="local-checkout">
                {t("Repository folder path")}
              </label>
              <input
                id="local-checkout"
                placeholder="/path/to/repository"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                disabled={busy || !directory}
              />
              <Button
                type="submit"
                isDisabled={busy || !directory || !checkout.trim()}
              >
                {t("Use folder")}
              </Button>
              <Button
                isDisabled={busy || !directory}
                onPress={() =>
                  void act(async () => {
                    const path = await api.chooseCodeFolder();
                    return path
                      ? api.bindLocalRepository(repository, path)
                      : null;
                  })
                }
              >
                <FolderOpen size={15} />
                {t("Browse…")}
              </Button>
            </form>
            {directory?.settings.overrides[repository.toLowerCase()] && (
              <Button
                className="text-button"
                isDisabled={busy}
                onPress={() =>
                  void act(() => api.bindLocalRepository(repository, null))
                }
              >
                {t("Use automatic discovery")}
              </Button>
            )}
          </section>
        )}
        <section aria-labelledby="discovered-code-heading">
          <div className="local-code-heading">
            <h3 id="discovered-code-heading">
              {t("Discovered repositories")}{" "}
              {directory && `(${directory.index.checkouts.length})`}
            </h3>
            <Button
              className="text-button"
              isDisabled={busy}
              onPress={() => void act(() => api.localRepositories(true))}
            >
              <RefreshCw size={14} />
              {t("Rescan")}
            </Button>
          </div>
          <ul className="local-repository-list">
            {directory?.index.checkouts.map((c) => (
              <li key={`${c.repository}:${c.path}`}>
                <strong>{c.repository}</strong>
                <code>{c.path}</code>
              </li>
            ))}
          </ul>
          {directory && !directory.index.checkouts.length && (
            <p className="muted">
              {t(
                "No repositories found yet. Add a code directory or choose a checkout directly.",
              )}
            </p>
          )}
          {directory?.index.warnings.map((message) => (
            <p className="muted" key={message}>
              {message}
            </p>
          ))}
        </section>
        <p className="muted local-code-scope">
          {t(
            "Chat access controls whether the agent can edit this checkout and use configured integrations. Choose Limited, Ask before actions, or Full access beside the message box. Guides only read code.",
          )}
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <p className="muted" role="status">
          {busy ? (
            <>
              <LoaderCircle size={14} className="spin" />{" "}
              {t("Finding repositories…")}
            </>
          ) : (
            notice
          )}
        </p>
      </div>
      <footer>
        <Button onPress={onClose} isDisabled={busy}>
          {t("Done")}
        </Button>
      </footer>
    </AppDialog>
  );
}
