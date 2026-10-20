import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitPullRequest,
  Github,
  Inbox,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  type Anchor,
  type Bootstrap,
  type Guide,
  type Note,
  type PullRequest,
  type ReviewProgress,
  type ReviewWorkspace,
  type RunEvent,
} from "./lib/api";
import { bucket, key, parsePullUrl } from "./lib/review";
import { GuideView } from "./features/Guide";
import { Discussion, type DiscussionHandle } from "./features/Discussion";
import { Connections, Finish, Projects } from "./features/Dialogs";
import "./styles.css";

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [discussion, setDiscussion] = useState(false);
  const [mode, setMode] = useState<"guide" | "files" | "overview">("guide");
  const [dialog, setDialog] = useState<
    "connections" | "projects" | "finish" | null
  >(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting your workspace…");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [inboxVisible, setInboxVisible] = useState(true);
  const [run, setRun] = useState<string | null>(null);
  const [runText, setRunText] = useState("");
  const [stream, setStream] = useState("");
  const [pendingGuide, setPendingGuide] = useState<Guide | null>(null);
  const [newRevision, setNewRevision] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const panel = useRef<DiscussionHandle>(null);
  const current = useRef(workspace);
  current.current = workspace;
  const booted = useRef(false);
  const opening = useRef(0);
  const polling = useRef(false);
  const onError = useCallback((e: unknown) => setError(String(e)), []);
  const onNote = useCallback(
    (note: Note) =>
      setWorkspace((w) =>
        w?.snapshot.id === note.snapshotId
          ? { ...w, notes: [...w.notes.filter((n) => n.id !== note.id), note] }
          : w,
      ),
    [],
  );
  const flush = async () => {
    await panel.current?.flush();
  };
  const finish = async () => {
    try {
      await flush();
      setDialog("finish");
    } catch (e) {
      onError(e);
    }
  };
  useEffect(() => {
    const subscription = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await panel.current?.flush();
        await getCurrentWindow().destroy();
      } catch (e) {
        onError(e);
      }
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [onError]);
  useEffect(() => {
    const preference = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = data?.settings.theme || "system";
      document.documentElement.dataset.theme =
        theme === "system" ? (preference.matches ? "dark" : "light") : theme;
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [data?.settings.theme]);
  const refresh = useCallback(async () => {
    const p = await api.inbox();
    setPulls(p);
    setLastSync(
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
  }, []);
  const boot = useCallback(async () => {
    const result = await api.bootstrap();
    setData(result);
    setPulls(result.pulls);
    setStatus("");
    if (result.github.connected) await refresh().catch(onError);
    return result;
  }, [refresh, onError]);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void boot()
      .then(async () => {
        const last = localStorage.getItem("diffcity.lastPr");
        if (last && opening.current === 0) {
          try {
            const p = parsePullUrl(last);
            if (p) {
              const restored = await api.open(p.repository, p.number, false);
              if (opening.current === 0) setWorkspace(restored);
            }
          } catch {
            /* the inbox remains usable if the prior PR lost access */
          }
        }
      })
      .catch((e) => {
        onError(e);
        setStatus("");
      });
  }, [boot, onError]);
  useEffect(() => {
    let removed = false;
    const subscription = listen<RunEvent>("codex-run", (event) => {
      if (
        event.payload.runId !== run ||
        event.payload.snapshotId !== current.current?.snapshot.id
      )
        return;
      if (event.payload.phase === "stream")
        setStream((text) => text + event.payload.text);
      else setRunText(event.payload.text);
    });
    void subscription.then((unlisten) => {
      if (removed) unlisten();
    });
    return () => {
      removed = true;
      void subscription.then((unlisten) => unlisten());
    };
  }, [run]);
  useEffect(() => {
    if (!data?.github.connected) return;
    let tick = 0;
    const timer = setInterval(async () => {
      if (document.hidden || polling.current) return;
      polling.current = true;
      try {
        if (++tick % 3 === 0) await refresh();
        const w = current.current;
        if (w && w.snapshot.pull.repository !== "diffcity/demo") {
          const p = w.snapshot.pull;
          const latest = await api.check(p.repository, p.number);
          if (
            current.current?.snapshot.id === w.snapshot.id &&
            (latest.head !== p.head || latest.base !== p.base)
          )
            setNewRevision(true);
          const fresh = await api.open(p.repository, p.number, false);
          setWorkspace((current) =>
            current?.snapshot.id === fresh.snapshot.id
              ? {
                  ...current,
                  comments: fresh.comments,
                  checks: fresh.checks,
                  syncError: fresh.syncError,
                }
              : current,
          );
          setLastSync(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          );
        }
      } catch (e) {
        setWorkspace((w) => (w ? { ...w, syncError: String(e) } : w));
      } finally {
        polling.current = false;
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [data?.github.connected, refresh]);
  const open = async (repository: string, number: number, force = true) => {
    const request = ++opening.current;
    setLoading(true);
    setError("");
    try {
      await flush();
      const w = await api.open(repository, number, force);
      if (request !== opening.current) return;
      setWorkspace(w);
      setStream("");
      setSelection(null);
      setDiscussion(false);
      setMode("guide");
      setPendingGuide(null);
      setNewRevision(false);
      localStorage.setItem("diffcity.lastPr", w.snapshot.pull.url);
    } catch (e) {
      onError(e);
    } finally {
      if (request === opening.current) setLoading(false);
    }
  };
  const sample = async () => {
    const request = ++opening.current;
    setLoading(true);
    try {
      await flush();
      const w = await api.sample();
      if (request !== opening.current) return;
      setWorkspace(w);
      setStream("");
      setMode("guide");
      setSelection(null);
      setDiscussion(false);
      setPendingGuide(null);
      setNewRevision(false);
    } catch (e) {
      onError(e);
    } finally {
      if (request === opening.current) setLoading(false);
    }
  };
  const saved = async (snapshotId: string) => {
    const request = ++opening.current;
    setLoading(true);
    try {
      await flush();
      const w = await api.saved(snapshotId);
      if (request !== opening.current) return;
      setWorkspace(w);
      setSelection(null);
      setDiscussion(false);
      setPendingGuide(null);
      setNewRevision(true);
      setMode("guide");
      setStream("");
    } catch (e) {
      onError(e);
    } finally {
      if (request === opening.current) setLoading(false);
    }
  };
  const select = async (anchor: Anchor) => {
    try {
      await flush();
      setSelection(anchor);
      setDiscussion(true);
    } catch (e) {
      onError(e);
    }
  };
  const progress = (p: ReviewProgress) => {
    if (!workspace) return;
    setWorkspace((w) => (w ? { ...w, progress: p } : w));
    void api.progress(workspace.snapshot.id, p).catch(onError);
  };
  const analyze = async () => {
    if (!workspace) return;
    const id = crypto.randomUUID();
    setRun(id);
    setRunText("Starting Codex review…");
    setStream("");
    setError("");
    try {
      await flush();
      const guide = await api.analyze(workspace.snapshot.id, id);
      if (current.current?.snapshot.id === guide.snapshotId)
        setPendingGuide(guide);
    } catch (e) {
      onError(e);
    } finally {
      setRun(null);
    }
  };
  const ask = async (note: Note) => {
    const id = crypto.randomUUID();
    setRun(id);
    setStream("");
    setRunText("Asking Codex…");
    setError("");
    try {
      onNote(await api.ask(note.snapshotId, note.id, id));
    } catch (e) {
      onError(e);
    } finally {
      setRun(null);
      setStream("");
    }
  };
  const visible = pulls.filter(
    (p) =>
      (!project || p.repository === project) &&
      `${p.title} ${p.number} ${p.author}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const groups = [
    "My pull requests",
    "Review requested",
    "Assigned to me",
    "Other pull requests",
  ];
  const pull = workspace?.snapshot.pull;
  return (
    <div className={`app ${inboxVisible ? "" : "inbox-hidden"}`}>
      <aside className="project-rail">
        <div className="traffic-spacer" data-tauri-drag-region />
        <div className="brand">
          <div className="brand-mark">
            <i />
            <i />
            <i />
          </div>
          <strong>diffcity</strong>
          <span>alpha</span>
        </div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <button
          className={`rail-item ${!project ? "active" : ""}`}
          onClick={() => {
            setProject(null);
            setInboxVisible(true);
          }}
        >
          <Inbox size={17} />
          <span>All pull requests</span>
          <small>{pulls.length}</small>
        </button>
        <div className="rail-heading">
          PROJECTS
          <button
            className="icon-button"
            aria-label="Add projects"
            onClick={() => setDialog("projects")}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav>
          {data?.settings.repositories.map((repo) => (
            <button
              className={`rail-item ${project === repo ? "active" : ""}`}
              title={repo}
              key={repo}
              onClick={() => {
                setProject(repo);
                setInboxVisible(true);
              }}
            >
              <FolderGit2 size={16} />
              <span>{repo.split("/")[1]}</span>
              <small>{pulls.filter((p) => p.repository === repo).length}</small>
            </button>
          ))}
        </nav>
        <button
          className="rail-item add-project"
          onClick={() => setDialog("projects")}
        >
          <Plus size={15} />
          <span>Add project</span>
        </button>
        <div className="rail-bottom">
          <button className="rail-item" onClick={() => void sample()}>
            <BookOpen size={16} />
            <span>Explore a sample</span>
          </button>
          <button
            className="rail-item"
            onClick={() => setDialog("connections")}
          >
            <Settings2 size={16} />
            <span>Connections</span>
          </button>
          <div className="connection-summary">
            <span
              className={`status-dot ${data?.github.connected ? "online" : ""}`}
            />
            <span>{data?.github.identity || "GitHub disconnected"}</span>
            <Github size={13} />
          </div>
          <div className="connection-summary">
            <span
              className={`status-dot ${data?.codex.connected ? "online" : ""}`}
            />
            <span>
              {data?.codex.connected ? "Codex connected" : "Codex disconnected"}
            </span>
            <Sparkles size={13} />
          </div>
        </div>
      </aside>
      {inboxVisible && (
        <aside className="inbox-pane">
          <header data-tauri-drag-region>
            <span>{project?.split("/")[1] || "Pull requests"}</span>
            <button
              className="icon-button"
              aria-label="Refresh inbox"
              disabled={loading || !data?.github.connected}
              onClick={() => void refresh().catch(onError)}
            >
              <RefreshCw size={15} />
            </button>
          </header>
          <div className="search-box inbox-search">
            <Search size={14} />
            <input
              aria-label="Search pull requests"
              placeholder="Search pull requests"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="pull-list">
            {groups.map((group) => {
              const items = visible.filter(
                (p) => bucket(p, data?.github.identity || "") === group,
              );
              return items.length ? (
                <section key={group}>
                  <h3>
                    {group}
                    <span>{items.length}</span>
                  </h3>
                  {items.map((p) => (
                    <button
                      className={`pull-card ${pull && key(p) === key(pull) ? "active" : ""}`}
                      key={key(p)}
                      onClick={() => void open(p.repository, p.number, false)}
                    >
                      <div>
                        <GitPullRequest size={15} />
                        <span>#{p.number}</span>
                        {p.draft && <small>Draft</small>}
                      </div>
                      <strong>{p.title}</strong>
                      <footer>
                        {p.repository.split("/")[1]}
                        <span>·</span>
                        {p.author}
                      </footer>
                    </button>
                  ))}
                </section>
              ) : null;
            })}
            {!visible.length && (
              <div className="inbox-empty">
                <GitPullRequest size={25} />
                <p>
                  {status ||
                    (query
                      ? "No matching pull requests"
                      : "No open pull requests in these projects.")}
                </p>
                <button
                  className="text-button"
                  onClick={() => setDialog("projects")}
                >
                  Choose projects <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
          <button
            className="open-pr-button"
            onClick={() => setShowLink(!showLink)}
          >
            <Plus size={14} /> Open a PR by URL
          </button>
          {showLink && (
            <form
              className="pr-url-form"
              onSubmit={(e) => {
                e.preventDefault();
                const p = parsePullUrl(link);
                if (p) {
                  void open(p.repository, p.number);
                  setShowLink(false);
                } else setError("Enter a GitHub pull request URL.");
              }}
            >
              <input
                aria-label="GitHub pull request URL"
                autoFocus
                placeholder="https://github.com/…/pull/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button className="primary" type="submit">
                Open
              </button>
            </form>
          )}
          <div className="sync-label">
            <span className="status-dot online" />
            {lastSync ? `Synced ${lastSync}` : "Local workspace"}
          </div>
        </aside>
      )}
      <main className="workspace">
        <header className="workspace-topbar" data-tauri-drag-region>
          <button
            className="icon-button"
            title="Toggle pull request list"
            aria-label="Toggle pull request list"
            onClick={() => setInboxVisible(!inboxVisible)}
          >
            <PanelLeftClose size={17} />
          </button>
          <div className="breadcrumb">
            {pull ? (
              <>
                <span>{pull.repository}</span>
                <ChevronRight size={13} />
                <strong>#{pull.number}</strong>
                {pull.draft && <span className="badge">Draft</span>}
              </>
            ) : (
              <span>Your review workspace</span>
            )}
          </div>
          <div className="spacer" />
          {pull && (
            <>
              <button
                className="icon-button"
                aria-label="Open in GitHub"
                onClick={() => void api.external(pull.url)}
              >
                <ExternalLink size={16} />
              </button>
              <button
                className="secondary finish-button"
                onClick={async () => {
                  try {
                    await flush();
                    setDialog("finish");
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <Check size={14} /> Finish review
              </button>
            </>
          )}
        </header>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {loading && (
          <div className="loading-banner">
            <LoaderCircle size={15} className="spin" />
            Loading review…
          </div>
        )}
        {workspace && pull ? (
          <>
            <div className="pr-heading">
              <div>
                <div className="eyebrow">
                  <GitPullRequest size={13} />
                  {pull.author} <span>·</span> {workspace.checks}
                </div>
                <h2>{pull.title}</h2>
                <div className="pr-meta">
                  <span>{workspace.snapshot.files.length} files</span>
                  <span className="added">+{pull.additions}</span>
                  <span className="removed">−{pull.deletions}</span>
                  <span className="mono">{pull.head.slice(0, 8)}</span>
                  {workspace.guide.source === "sample" && (
                    <span className="badge">Sample</span>
                  )}
                </div>
              </div>
              <button
                className="primary analyze-button"
                disabled={loading || !!run || !data?.codex.connected}
                onClick={() => void analyze()}
              >
                <Sparkles size={15} />
                {workspace.guide.source === "codex"
                  ? "Review again"
                  : "Review with Codex"}
              </button>
            </div>
            <div className="workspace-tabs">
              <nav>
                {(["guide", "files", "overview"] as const).map((tab) => (
                  <button
                    className={mode === tab ? "active" : ""}
                    key={tab}
                    onClick={() => setMode(tab)}
                  >
                    {tab === "guide" ? (
                      <BookOpen size={14} />
                    ) : tab === "files" ? (
                      <FileCode2 size={14} />
                    ) : (
                      <CircleDot size={14} />
                    )}{" "}
                    {tab === "guide"
                      ? "Guide"
                      : tab === "files"
                        ? "Files"
                        : "Overview"}
                  </button>
                ))}
              </nav>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await flush();
                    setSelection(null);
                    setDiscussion(!discussion);
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <MessageSquare size={14} /> Notes{" "}
                <span>{workspace.notes.length}</span>
              </button>
            </div>
            {run && (
              <div className="run-banner">
                <LoaderCircle size={14} className="spin" />
                <span>{runText}</span>
                <button
                  className="text-button"
                  onClick={() => void api.cancel()}
                >
                  Cancel
                </button>
              </div>
            )}
            {pendingGuide?.snapshotId === workspace.snapshot.id && (
              <div className="update-banner">
                <Sparkles size={15} />
                <span>Your guided review is ready.</span>
                <button
                  onClick={() => {
                    const currentSection =
                      workspace.guide.sections.find(
                        (s) => s.id === workspace.progress.activeSection,
                      ) || workspace.guide.sections[0];
                    const nextSection =
                      pendingGuide.sections.find((s) =>
                        s.hunkIds.some((id) =>
                          currentSection?.hunkIds.includes(id),
                        ),
                      ) || pendingGuide.sections[0];
                    setWorkspace({
                      ...workspace,
                      guide: pendingGuide,
                      progress: {
                        ...workspace.progress,
                        activeSection: nextSection?.id ?? null,
                      },
                    });
                    setPendingGuide(null);
                  }}
                >
                  Open updated guide <ArrowRight size={13} />
                </button>
              </div>
            )}
            {newRevision && (
              <div className="update-banner">
                <GitPullRequest size={15} />
                <span>
                  New code is available. Your current review is preserved.
                </span>
                <button onClick={() => void open(pull.repository, pull.number)}>
                  Load new revision <ArrowRight size={13} />
                </button>
              </div>
            )}
            {workspace.previousSnapshotId && (
              <div className="update-banner">
                <span>
                  Earlier notes and progress remain saved with their original
                  code.
                </span>
                <button
                  onClick={() => void saved(workspace.previousSnapshotId!)}
                >
                  Open previous revision
                </button>
              </div>
            )}
            {workspace.syncError && (
              <div className="sync-warning">
                Showing saved content · {workspace.syncError}
              </div>
            )}
            {workspace.changedHunks.length > 0 && (
              <div className="update-banner">
                {workspace.changedHunks.length} hunks changed since your
                previous revision. Unchanged reviewed code was preserved.
              </div>
            )}
            <div className="review-body">
              <GuideView
                key={workspace.snapshot.id}
                workspace={workspace}
                selection={selection}
                onSelect={(a) => void select(a)}
                onProgress={progress}
                onFinish={() => void finish()}
                mode={mode}
              />
              {discussion && (
                <Discussion
                  key={`${workspace.snapshot.id}/${selection?.hunkId ?? "overall"}/${selection?.startLine}/${selection?.line}`}
                  ref={panel}
                  workspace={workspace}
                  selection={selection}
                  onNote={onNote}
                  onAsk={ask}
                  onClose={() => {
                    void flush()
                      .then(() => setDiscussion(false))
                      .catch(onError);
                  }}
                  onError={onError}
                  busy={!!run}
                  stream={stream}
                />
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-art">
              <div className="city-block b1" />
              <div className="city-block b2">
                <span>+</span>
              </div>
              <div className="city-block b3">
                <span>−</span>
              </div>
              <div className="city-ground" />
            </div>
            <div className="eyebrow">LESS SCROLLING. MORE UNDERSTANDING.</div>
            <h1>
              Find the story
              <br />
              inside the diff.
            </h1>
            <p>
              Review the changes that matter first.
              <br />A guided path from pull request to confident feedback.
            </p>
            <div className="welcome-actions">
              <button className="primary" onClick={() => setDialog("projects")}>
                <FolderGit2 size={16} /> Choose your projects
              </button>
              <button className="secondary" onClick={() => void sample()}>
                Try a guided review <ArrowRight size={16} />
              </button>
            </div>
            {status && (
              <div className="welcome-status">
                <LoaderCircle size={14} className="spin" />
                {status}
              </div>
            )}
            <div className="welcome-details">
              <span>
                <ShieldIcon /> Consequential code first
              </span>
              <span>
                <MessageSquare size={14} /> Think alongside Codex
              </span>
              <span>
                <Github size={14} /> Stay in sync with GitHub
              </span>
            </div>
          </div>
        )}
      </main>
      {dialog === "connections" && data && (
        <Connections
          data={data}
          onClose={() => setDialog(null)}
          onSave={async (settings) => {
            await api.settings(settings);
            await boot();
          }}
        />
      )}
      {dialog === "projects" && data && (
        <Projects
          selected={data.settings.repositories}
          onClose={() => setDialog(null)}
          onChange={async (repositories) => {
            const settings = await api.settings({
              ...data.settings,
              repositories,
            });
            setData({ ...data, settings });
            await refresh();
          }}
        />
      )}
      {dialog === "finish" && workspace && (
        <Finish
          workspace={workspace}
          login={data?.github.identity || ""}
          onClose={() => setDialog(null)}
          onPublished={async () => {
            const w = await api.open(
              workspace.snapshot.pull.repository,
              workspace.snapshot.pull.number,
              false,
            );
            setWorkspace((current) =>
              current?.snapshot.id === w.snapshot.id
                ? { ...current, notes: w.notes, comments: w.comments }
                : current,
            );
          }}
        />
      )}
    </div>
  );
}
function ShieldIcon() {
  return <Check size={14} />;
}
