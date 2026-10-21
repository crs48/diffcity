import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { usePullHistory } from "./features/usePullHistory";
import { Button, Tabs, TabList, Tab, TabPanel } from "react-aria-components";
import { ThemeSwitcher } from "./ui/ThemeSwitcher";
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
  type InboxSync,
} from "./lib/api";
import { newNote, parsePullUrl } from "./lib/review";
import { GuideView } from "./features/Guide";
import { Discussion } from "./features/Discussion";
import { ConversationContext } from "./features/conversation";
import { useNoteComposer } from "./features/useNoteComposer";
import { Connections, Finish } from "./features/Dialogs";
import { DisplaySettings } from "./features/DisplaySettings";
import { AccountNavigation, RepoFilter } from "./features/AccountNavigation";
import { PullList } from "./features/PullList";
import {
  SAMPLE_REPO,
  isSampleRepo,
  sameLogin,
  requestedFrom,
  visiblePulls,
  accountOwners,
  repositoriesForOwner,
  resolveScope,
  type InboxScope,
} from "./lib/inbox";
import "./styles.css";

export default function App() {
  const { t } = useTranslation();
  const [inboxView, setInboxView] = useState<"open" | "history">("open");
  const [data, setData] = useState<Bootstrap | null>(null);
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [scope, setScope] = useState<InboxScope>({
    owner: null,
    repository: null,
  });
  const repositories =
    data?.directory.repositories.map((repo) => repo.fullName) ?? [];
  const owners = accountOwners(
    repositories,
    data?.directory.organizations ?? [],
    data?.github.identity ?? "",
  );
  const { owner, repository: repo } = resolveScope(scope, repositories, owners);
  const scopedRepositories = repositoriesForOwner(repositories, owner);
  const history = usePullHistory(
    repo,
    inboxView === "history" && repo !== SAMPLE_REPO && !!data,
    owner,
    scopedRepositories.join(","),
  );
  const [samplePulls, setSamplePulls] = useState<PullRequest[]>([]);
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [discussion, setDiscussion] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<Note | null>(null);
  const selecting = useRef(0);
  const [mode, setMode] = useState<"guide" | "files" | "overview">("guide");
  const [dialog, setDialog] = useState<
    "connections" | "finish" | "display" | null
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
  const [syncing, setSyncing] = useState(false);
  const syncBusy = useRef(false);
  const [syncProgress, setSyncProgress] = useState<InboxSync | null>(null);
  const [syncError, setSyncError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const setInboxOpen = (open: boolean) => {
    setInboxVisible(open);
    if (matchMedia("(max-width: 1000px)").matches) {
      requestAnimationFrame(() => {
        const target = open
          ? document.getElementById("pull-search")
          : document.getElementById("review-workspace");
        target?.focus();
      });
    }
  };
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
  const inline = useNoteComposer(onNote, onError);
  const chat = useNoteComposer(onNote, onError);
  const flushInline = inline.flush;
  const flushChat = chat.flush;
  const flush = useCallback(async () => {
    await Promise.all([flushInline(), flushChat()]);
  }, [flushInline, flushChat]);
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
        await flush();
        await getCurrentWindow().destroy();
      } catch (e) {
        onError(e);
      }
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [onError, flush]);
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
  useEffect(() => {
    const subscription = listen<InboxSync>("inbox-sync", (event) => {
      setSyncProgress(event.payload);
      setPulls(event.payload.pulls);
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
  const refresh = useCallback(async () => {
    if (syncBusy.current) return;
    syncBusy.current = true;
    setSyncing(true);
    setSyncProgress(null);
    try {
      const result = await api.inbox();
      setPulls(result.pulls);
      setSyncError(result.syncError ?? "");
      if (!result.syncError)
        setLastSync(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
    } finally {
      syncBusy.current = false;
      setSyncing(false);
    }
  }, []);
  const discover = useCallback(async () => {
    setDirectoryLoading(true);
    try {
      const directory = await api.directory();
      setData((current) => (current ? { ...current, directory } : current));
    } finally {
      setDirectoryLoading(false);
    }
  }, []);
  const refreshWorkspace = async () => {
    if (!data?.github.connected) {
      setDialog("connections");
      return;
    }
    if (directoryLoading || syncing) return;
    try {
      await discover();
      await refresh();
    } catch (e) {
      onError(e);
    }
  };
  const boot = useCallback(async () => {
    const result = await api.bootstrap();
    setData(result);
    await i18n.changeLanguage(result.settings.locale || "en");
    setPulls(result.pulls);
    setStatus("");
    if (result.github.connected) {
      await discover().catch(onError);
      void refresh().catch(onError);
    }
    return result;
  }, [discover, refresh, onError]);
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
        if (++tick % 30 === 0) await discover();
        if (tick % 3 === 0) void refresh().catch(onError);
        const w = current.current;
        if (
          w &&
          w.snapshot.pull.state === "open" &&
          !isSampleRepo(w.snapshot.pull.repository)
        ) {
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
                  snapshot: { ...current.snapshot, pull: fresh.snapshot.pull },
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
  }, [data?.github.connected, discover, refresh, onError]);
  const open = async (repository: string, number: number, force = true) => {
    const request = ++opening.current;
    setLoading(true);
    setError("");
    try {
      await flush();
      const w = await api.open(repository, number, force);
      const samplePull = samplePulls.find((p) => p.number === number);
      if (repository === SAMPLE_REPO && samplePull)
        w.snapshot.pull = samplePull;
      if (request !== opening.current) return;
      setWorkspace(w);
      if (matchMedia("(max-width: 1000px)").matches) setInboxOpen(false);
      setStream("");
      setSelection(null);
      setDiscussion(false);
      setMode("guide");
      setPendingGuide(null);
      setNewRevision(false);
      if (!isSampleRepo(repository))
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
      if (matchMedia("(max-width: 1000px)").matches) setInboxOpen(false);
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
      if (matchMedia("(max-width: 1000px)").matches) setInboxOpen(false);
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
  const select = async (
    anchor: Anchor,
    openDiscussion = false,
    jumpToCode = false,
  ) => {
    const request = ++selecting.current;
    const snapshotId = workspace?.snapshot.id;
    try {
      if (openDiscussion) await inline.start(snapshotId!, anchor);
      if (
        request !== selecting.current ||
        current.current?.snapshot.id !== snapshotId
      )
        return;
      setSelection(anchor);
      if (jumpToCode) {
        // A chat reference may point into another section or a filtered file.
        const section = workspace?.guide.sections.find((s) =>
          s.hunkIds.includes(anchor.hunkId),
        );
        setMode("guide");
        if (section && workspace)
          progress({ ...workspace.progress, activeSection: section.id });
      }
    } catch (e) {
      onError(e);
    }
  };
  const openChat = async (anchor: Anchor | null) => {
    if (!workspace) return;
    try {
      await chat.start(workspace.snapshot.id, anchor);
      setDiscussion(true);
    } catch (e) {
      onError(e);
    }
  };
  const prepare = async (note: Note) => {
    const draft = await api.note({
      ...newNote(note.snapshotId, note.anchor, note.body),
      githubDraft: true,
      parentId: note.id,
    });
    onNote(draft);
  };
  const edit = async (note: Note, inCode: boolean) => {
    if (inCode && note.anchor)
      await inline.start(note.snapshotId, note.anchor, note);
    else {
      await chat.start(note.snapshotId, note.anchor, note);
      setDiscussion(true);
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
    setActiveQuestion(note);
    setStream("");
    setRunText("Asking Codex…");
    setError("");
    try {
      await flush();
      onNote(await api.ask(note.snapshotId, note.id, id));
    } catch (e) {
      onError(e);
    } finally {
      setRun(null);
      setStream("");
      setActiveQuestion(null);
    }
  };
  const login = data?.github.identity || "you";
  const samples = repo === SAMPLE_REPO;
  const visible = visiblePulls(
    samples ? samplePulls : inboxView === "open" ? pulls : history.pulls,
    {
      login,
      repository: repo,
      owner,
      query,
      history: inboxView === "history",
      completedDays: data?.settings.completedDays ?? 2,
    },
  );
  const exploreInbox = async () => {
    try {
      setSamplePulls(await api.sampleInbox());
      setScope({ owner: null, repository: SAMPLE_REPO });
      setInboxView("open");
      setQuery("");
      setInboxOpen(true);
    } catch (e) {
      onError(e);
    }
  };
  const simulateReview = (p: PullRequest) => {
    const next = requestedFrom(p, login)
      ? {
          ...p,
          requested: [],
          viewerReview: {
            state: "COMMENTED",
            submittedAt: new Date().toISOString(),
          },
        }
      : { ...p, requested: [login] };
    setSamplePulls((current) =>
      current.map((item) => (item.number === p.number ? next : item)),
    );
    setWorkspace((current) =>
      current?.snapshot.pull.repository === SAMPLE_REPO &&
      current.snapshot.pull.number === p.number
        ? { ...current, snapshot: { ...current.snapshot, pull: next } }
        : current,
    );
  };
  const pull = workspace?.snapshot.pull;
  return (
    <div className={`app ${inboxVisible ? "" : "inbox-hidden"}`}>
      <a
        className="skip-link"
        href="#review-workspace"
        onClick={() => setInboxOpen(false)}
      >
        {t("Skip to review")}{" "}
      </a>
      <AccountNavigation
        owners={owners}
        owner={owner}
        samples={samples}
        data={data}
        onOwner={(owner) => {
          setScope({ owner, repository: null });
          setInboxOpen(true);
        }}
        onRefresh={() => void refreshWorkspace()}
        onSamples={() => void exploreInbox()}
        onExample={() => void sample()}
        onConnections={() => setDialog("connections")}
      />
      {inboxVisible && (
        <aside className="inbox-pane" aria-label={t("Pull request inbox")}>
          <header data-tauri-drag-region>
            <span className="inbox-account" title={owner || undefined}>
              {samples ? t("Sample inbox") : owner || t("All accounts")}
            </span>
            <Button
              className="icon-button close-inbox"
              aria-label={t("Close pull request list")}
              onPress={() => setInboxOpen(false)}
            >
              <X size={16} />
            </Button>
            <Button
              className="icon-button"
              aria-label={t("Display settings")}
              isDisabled={!data}
              onPress={() => setDialog("display")}
            >
              <Settings2 size={15} />
            </Button>
            <Button
              className="icon-button"
              aria-label={t("Refresh inbox")}
              isDisabled={
                loading || syncing || (!samples && !data?.github.connected)
              }
              onPress={() =>
                samples
                  ? void exploreInbox()
                  : inboxView === "history"
                    ? void history.load()
                    : void refresh().catch(onError)
              }
            >
              <RefreshCw size={15} />
            </Button>
          </header>
          {!samples && (
            <RepoFilter
              repositories={scopedRepositories}
              owner={owner}
              repository={repo}
              onChange={(repository) => setScope({ owner, repository })}
            />
          )}
          <div className="search-box inbox-search">
            <Search size={14} />
            <input
              id="pull-search"
              aria-label={t("Search pull requests")}
              placeholder={t("Search pull requests")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {!samples && data?.directory.syncError && (
            <div className="history-status" role="alert">
              {data.directory.syncError}
              <Button
                className="text-button"
                onPress={() => void refreshWorkspace()}
              >
                {t("Retry")}
              </Button>
            </div>
          )}
          {!samples && syncError && (
            <div className="history-status" role="alert">
              {syncError}
            </div>
          )}
          <div
            className="inbox-scope"
            role="group"
            aria-label={t("Pull request scope")}
          >
            <Button
              className="scope-button"
              aria-pressed={inboxView === "open"}
              onPress={() => setInboxView("open")}
            >
              {t("Inbox")}
            </Button>
            <Button
              className="scope-button"
              aria-pressed={inboxView === "history"}
              onPress={() => setInboxView("history")}
            >
              {t("History")}
            </Button>
          </div>
          {samples && (
            <div className="sample-inbox-banner" role="status">
              {t("Local samples · fictional authors and review states")}
            </div>
          )}
          {inboxView === "history" && (
            <div className="history-status" role="status">
              {t("Closed and merged pull requests")}
              {history.loading && ` · ${t("Loading…")}`}
            </div>
          )}
          {!samples && inboxView === "history" && history.error && (
            <div className="history-status" role="alert">
              {history.error}
              <Button
                className="text-button"
                onPress={() => void history.load()}
                isDisabled={history.loading}
              >
                {t("Retry")}
              </Button>
            </div>
          )}
          <div className="pull-list">
            <PullList
              pulls={visible}
              selected={pull}
              login={login}
              history={inboxView === "history"}
              onOpen={(p) => void open(p.repository, p.number, false)}
            />
            {!visible.length && (
              <div className="inbox-empty">
                <GitPullRequest size={25} />
                <p>
                  {status ||
                    (syncing || directoryLoading
                      ? t("Loading your GitHub workspace…")
                      : "") ||
                    (query
                      ? t("No matching pull requests")
                      : inboxView === "history"
                        ? t("No closed or merged pull requests loaded.")
                        : t("No pull requests in this inbox."))}
                </p>
                <Button
                  className="text-button"
                  onPress={() => void refreshWorkspace()}
                >
                  {t("Refresh GitHub")} <ArrowRight size={13} />
                </Button>
              </div>
            )}
          </div>
          {!samples && inboxView === "history" && history.nextPage && (
            <Button
              className="secondary history-more"
              isDisabled={history.loading}
              onPress={() => void history.load(history.nextPage!)}
            >
              {t("Load older pull requests")}
            </Button>
          )}
          <Button
            className="open-pr-button"
            onPress={() => setShowLink(!showLink)}
          >
            <Plus size={14} />
            {t("Open a PR by URL")}{" "}
          </Button>
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
                aria-label={t("GitHub pull request URL")}
                autoFocus
                placeholder="https://github.com/…/pull/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button className="primary" type="submit">
                {t("Open")}{" "}
              </Button>
            </form>
          )}
          <div className="sync-label" role="status">
            <span className="status-dot online" />
            {directoryLoading
              ? t("Discovering your repos…")
              : syncing
                ? syncProgress
                  ? t("Syncing repos {{completed}} / {{total}}", syncProgress)
                  : t("Loading pull requests…")
                : syncError
                  ? t("Some results may be out of date")
                  : lastSync
                    ? t("Synced {{time}} · {{count}} repos", {
                        time: lastSync,
                        count: repositories.length,
                      })
                    : t("Local workspace")}
          </div>
        </aside>
      )}
      <main className="workspace" id="review-workspace" tabIndex={-1}>
        {pull?.repository === SAMPLE_REPO && (
          <div className="sample-workspace-banner">
            <span>
              {t(
                "Local sample · shared invitation code, fictional PR metadata",
              )}
            </span>
            {pull.state === "open" &&
              !sameLogin(pull.author, login) &&
              !pull.draft && (
                <Button
                  className="secondary"
                  onPress={() => simulateReview(pull)}
                >
                  {t(
                    requestedFrom(pull, login)
                      ? "Simulate submitted review"
                      : "Simulate review request",
                  )}
                </Button>
              )}
          </div>
        )}
        <header className="workspace-topbar" data-tauri-drag-region>
          <Button
            className="icon-button"
            aria-label={t("Toggle pull request list")}
            aria-expanded={inboxVisible}
            onPress={() => setInboxOpen(!inboxVisible)}
          >
            <PanelLeftClose size={17} />
          </Button>
          <div className="breadcrumb">
            {pull ? (
              <>
                <span>{pull.repository}</span>
                <ChevronRight size={13} />
                <strong>#{pull.number}</strong>
                {pull.state !== "open" ? (
                  <span className="badge">
                    {pull.state === "merged" ? t("Merged") : t("Closed")}
                  </span>
                ) : (
                  pull.draft && <span className="badge">{t("Draft")}</span>
                )}
              </>
            ) : (
              <span>{t("Your review workspace")} </span>
            )}
          </div>
          <div className="spacer" />
          <ThemeSwitcher
            value={data?.settings.theme || "system"}
            disabled={!data}
            onChange={(theme) => {
              if (!data) return;
              void api
                .settings({ ...data.settings, theme })
                .then((settings) => {
                  setData((current) =>
                    current ? { ...current, settings } : current,
                  );
                })
                .catch(onError);
            }}
          />
          {pull && (
            <>
              {!isSampleRepo(pull.repository) && (
                <Button
                  className="icon-button"
                  aria-label={t("Open in GitHub")}
                  onPress={() => void api.external(pull.url)}
                >
                  <ExternalLink size={16} />
                </Button>
              )}
              <Button
                className="secondary finish-button"
                onPress={async () => {
                  try {
                    await flush();
                    setDialog("finish");
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <Check size={14} />
                {t("Finish review")}{" "}
              </Button>
            </>
          )}
        </header>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <Button
              className="icon-button"
              aria-label={t("Dismiss error")}
              onPress={() => setError("")}
            >
              <X size={14} />
            </Button>
          </div>
        )}
        {loading && (
          <div className="loading-banner" role="status">
            <LoaderCircle size={15} className="spin" />
            {t("Loading review…")}{" "}
          </div>
        )}
        {workspace && pull ? (
          <Tabs
            className="review-tabs"
            selectedKey={mode}
            onSelectionChange={(key) => setMode(key as typeof mode)}
          >
            <div className="pr-heading">
              <div>
                <div className="eyebrow">
                  <GitPullRequest size={13} />
                  {pull.author} <span>·</span> {workspace.checks}
                </div>
                <h1>{pull.title}</h1>
                <div className="pr-meta">
                  <span>
                    {t("{{count}} files", {
                      count: workspace.snapshot.files.length,
                    })}
                  </span>
                  <span className="added">+{pull.additions}</span>
                  <span className="removed">−{pull.deletions}</span>
                  <span className="mono">{pull.head.slice(0, 8)}</span>
                  {workspace.guide.source === "sample" && (
                    <span className="badge">{t("Sample")} </span>
                  )}
                </div>
              </div>
              <Button
                className="primary analyze-button"
                isDisabled={loading || !!run || !data?.codex.connected}
                onPress={() => void analyze()}
              >
                <Sparkles size={15} />
                {workspace.guide.source === "codex"
                  ? t("Review again")
                  : t("Review with Codex")}
              </Button>
            </div>
            {pull?.state !== "open" && (
              <div className="history-status">
                {t(
                  "Historical review: code, private comments, and Codex are available. GitHub publication requires an open PR.",
                )}
              </div>
            )}
            <div className="workspace-tabs">
              <TabList aria-label={t("Review views")}>
                {(["guide", "files", "overview"] as const).map((tab) => (
                  <Tab id={tab} key={tab}>
                    {tab === "guide" ? (
                      <BookOpen size={14} />
                    ) : tab === "files" ? (
                      <FileCode2 size={14} />
                    ) : (
                      <CircleDot size={14} />
                    )}{" "}
                    {tab === "guide"
                      ? t("Guide")
                      : tab === "files"
                        ? t("Files")
                        : t("Overview")}
                  </Tab>
                ))}
              </TabList>
              <Button
                className="text-button"
                onPress={async () => {
                  try {
                    if (discussion) {
                      await chat.flush();
                      setDiscussion(false);
                    } else if (chat.draft?.snapshotId === workspace.snapshot.id)
                      setDiscussion(true);
                    else await openChat(null);
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <MessageSquare size={14} />
                {t("PR chat")} <span>{workspace.notes.length}</span>
              </Button>
            </div>
            {run && (
              <div className="run-banner">
                <LoaderCircle size={14} className="spin" />
                <span>{runText}</span>
                <Button
                  className="text-button"
                  onPress={() => void api.cancel()}
                >
                  {t("Cancel")}{" "}
                </Button>
              </div>
            )}
            {pendingGuide?.snapshotId === workspace.snapshot.id && (
              <div className="update-banner">
                <Sparkles size={15} />
                <span>{t("Your guided review is ready.")} </span>
                <Button
                  onPress={() => {
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
                  {t("Open updated guide")} <ArrowRight size={13} />
                </Button>
              </div>
            )}
            {newRevision && (
              <div className="update-banner">
                <GitPullRequest size={15} />
                <span>
                  {t(
                    "New code is available. Your current review is preserved.",
                  )}{" "}
                </span>
                <Button onPress={() => void open(pull.repository, pull.number)}>
                  {t("Load new revision")} <ArrowRight size={13} />
                </Button>
              </div>
            )}
            {workspace.previousSnapshotId && (
              <div className="update-banner">
                <span>
                  {t(
                    "Earlier notes and progress remain saved with their original code.",
                  )}{" "}
                </span>
                <Button
                  onPress={() => void saved(workspace.previousSnapshotId!)}
                >
                  {t("Open previous revision")}{" "}
                </Button>
              </div>
            )}
            {workspace.syncError && (
              <div className="sync-warning">
                {t("Showing saved content ·")} {workspace.syncError}
              </div>
            )}
            {workspace.changedHunks.length > 0 && (
              <div className="update-banner">
                {workspace.changedHunks.length}
                {t(
                  "hunks changed since your previous revision. Unchanged reviewed code was preserved.",
                )}{" "}
              </div>
            )}
            <ConversationContext.Provider
              value={{
                workspace,
                inline,
                chat,
                busy: !!run,
                activeQuestion,
                stream,
                ask,
                prepare,
                edit,
                openInline: (a) => void select(a, true, true),
                openChat: (a) => void openChat(a),
                onError,
              }}
            >
              <div className="review-body">
                <TabPanel id={mode} className="review-panel">
                  <GuideView
                    key={workspace.snapshot.id}
                    workspace={workspace}
                    selection={selection}
                    onSelect={(a) => void select(a)}
                    onDiscuss={(a) => void select(a, true)}
                    onProgress={progress}
                    onFinish={() => void finish()}
                    mode={mode}
                  />
                </TabPanel>
                {discussion && (
                  <Discussion
                    onClose={() => {
                      void chat
                        .flush()
                        .then(() => setDiscussion(false))
                        .catch(onError);
                    }}
                  />
                )}
              </div>
            </ConversationContext.Provider>
          </Tabs>
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
            <div className="eyebrow">
              {t("LESS SCROLLING. MORE UNDERSTANDING.")}{" "}
            </div>
            <h1>
              {t("Find the story")} <br />
              {t("inside the diff.")}{" "}
            </h1>
            <p>
              {t("Review the changes that matter first.")} <br />
              {t("A guided path from pull request to confident feedback.")}{" "}
            </p>
            <div className="welcome-actions">
              <Button
                className="primary"
                onPress={() => void refreshWorkspace()}
              >
                <FolderGit2 size={16} />
                {t("Refresh GitHub")}{" "}
              </Button>
              <Button className="secondary" onPress={() => void sample()}>
                {t("Try a guided review")} <ArrowRight size={16} />
              </Button>
            </div>
            {status && (
              <div className="welcome-status" role="status">
                <LoaderCircle size={14} className="spin" />
                {status}
              </div>
            )}
            <div className="welcome-details">
              <span>
                <ShieldIcon />
                {t("Consequential code first")}{" "}
              </span>
              <span>
                <MessageSquare size={14} />
                {t("Think alongside Codex")}{" "}
              </span>
              <span>
                <Github size={14} />
                {t("Stay in sync with GitHub")}{" "}
              </span>
            </div>
          </div>
        )}
      </main>
      {dialog === "display" && data && (
        <DisplaySettings
          days={data.settings.completedDays ?? 2}
          onClose={() => setDialog(null)}
          onSave={async (completedDays) => {
            const settings = await api.settings({
              ...data.settings,
              completedDays,
            });
            setData((current) =>
              current ? { ...current, settings } : current,
            );
            if (data.github.connected) await refresh();
          }}
        />
      )}
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
      {dialog === "finish" && workspace && (
        <Finish
          workspace={workspace}
          login={data?.github.identity || ""}
          onClose={() => setDialog(null)}
          onPublished={async () => {
            await refresh();
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
