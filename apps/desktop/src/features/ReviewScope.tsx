import { useEffect, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { CheckCheck, GitCompareArrows, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  api,
  type Anchor,
  type ReviewBaseline,
  type ReviewComparison,
  type ReviewWorkspace,
} from "../lib/api";
import { fullReviewAnchor } from "../lib/reviewComparison";
import { GuideView } from "./Guide";

export function ReviewScope({
  workspace,
  refreshKey,
  onDiscuss,
  onFinish,
  children,
}: {
  workspace: ReviewWorkspace;
  refreshKey: number;
  onDiscuss: (anchor: Anchor) => void;
  onFinish: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [history, setHistory] = useState<ReviewBaseline | null>(null);
  const [checking, setChecking] = useState(true);
  const [scope, setScope] = useState<"full" | "since">("full");
  const [comparison, setComparison] = useState<ReviewComparison | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [commentNotice, setCommentNotice] = useState("");
  const snapshotId = workspace.snapshot.id;
  const baseline = history?.checkpoint;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setChecking(true);
      try {
        const cached = await api.baseline(snapshotId);
        if (!cancelled) setHistory(cached);
        const fresh = await api.baseline(snapshotId, true);
        if (!cancelled) setHistory(fresh);
      } catch (e) {
        if (!cancelled)
          setHistory((old) => ({
            checkpoint: old?.checkpoint ?? null,
            syncError: String(e),
          }));
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, refreshKey, retry]);
  // Fetch only on demand. Immutable revision pairs are cached by the backend.
  useEffect(() => {
    if (scope !== "since" || !baseline) return;
    let cancelled = false;
    setError("");
    setComparison(null);
    setSelection(null);
    void api
      .compare(snapshotId, baseline)
      .then((result) => {
        if (!cancelled) setComparison(result);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [scope, snapshotId, baseline, retry]);
  const since = scope === "since" && !!baseline;
  const result =
    comparison?.baseline.head === baseline?.head ? comparison : null;
  const reviewedAt = baseline
    ? new Date(baseline.reviewedAt).toLocaleString(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
  const changeScope = (next: "full" | "since") => {
    setScope(next);
    setCommentNotice("");
  };
  const discuss = (anchor: Anchor) => {
    const mapped = fullReviewAnchor(anchor, workspace.snapshot);
    if (mapped) {
      changeScope("full");
      onDiscuss(mapped);
    } else {
      setCommentNotice(
        t(
          "This range is outside the full PR diff. Open Full PR to choose a comment location; earlier-revision line numbers cannot be published to GitHub.",
        ),
      );
    }
  };
  return (
    <>
      <section className="review-scope" aria-label={t("Review comparison")}>
        <div className="review-scope-toolbar">
          <div
            className="review-scope-options"
            role="group"
            aria-label={t("Changes to show")}
          >
            <Button aria-pressed={!since} onPress={() => changeScope("full")}>
              {t("Full PR")}
            </Button>
            <Button
              aria-pressed={since}
              isDisabled={!baseline}
              onPress={() => changeScope("since")}
            >
              <GitCompareArrows size={15} />
              {t("Since your last review")}
              {baseline && baseline.head !== workspace.snapshot.pull.head && (
                <span
                  className="review-scope-dot"
                  aria-label={t("New revision")}
                />
              )}
            </Button>
          </div>
          <Button className="text-button" onPress={onFinish}>
            <CheckCheck size={14} />
            {t("Save review checkpoint")}
          </Button>
        </div>
        <div className="review-scope-detail" aria-live="polite">
          {baseline ? (
            <>
              <span>
                {baseline.source === "sample"
                  ? t("Sample review")
                  : baseline.source === "github"
                    ? t("Your GitHub review")
                    : t("Your saved checkpoint")}
              </span>
              <time dateTime={baseline.reviewedAt}>{reviewedAt}</time>
              <code title={baseline.head}>{baseline.head.slice(0, 8)}</code>
              <span aria-hidden="true">→</span>
              <code title={workspace.snapshot.pull.head}>
                {workspace.snapshot.pull.head.slice(0, 8)}
              </code>
              {baseline.head === workspace.snapshot.pull.head && (
                <span>{t("No new commits")}</span>
              )}
            </>
          ) : (
            <span>
              {checking
                ? t("Checking your review history…")
                : t(
                    "No previous review yet. Save a checkpoint or submit a GitHub review to compare the next update.",
                  )}
            </span>
          )}
          {checking && baseline && (
            <LoaderCircle
              size={12}
              className="spin"
              aria-label={t("Checking review history")}
            />
          )}
        </div>
        {history?.syncError && (
          <div className="review-scope-warning" role="status">
            {history.syncError}{" "}
            <Button
              className="text-button"
              onPress={() => setRetry((n) => n + 1)}
            >
              {t("Retry")}
            </Button>
          </div>
        )}
      </section>
      {!since ? (
        children
      ) : (
        <div className="since-review">
          <div className="since-review-heading">
            <div className="eyebrow">{t("REVIEW UPDATES")}</div>
            <h2>{t("Changes since your last review")}</h2>
            <p className="muted">
              {t(
                "Only the changes between your reviewed revision and this revision. Unchanged code is left out. Comments open at the matching line in Full PR.",
              )}
            </p>
            {result && (
              <p className="since-review-counts">
                <strong>
                  {t("{{count}} files", {
                    count: result.snapshot.files.length,
                  })}
                </strong>
                <span className="added">+{result.snapshot.pull.additions}</span>
                <span className="removed">
                  −{result.snapshot.pull.deletions}
                </span>
              </p>
            )}
            {commentNotice && (
              <div role="status" className="attention-note">
                {commentNotice}{" "}
                <Button
                  className="text-button"
                  onPress={() => changeScope("full")}
                >
                  {t("Open Full PR")}
                </Button>
              </div>
            )}
            {error && (
              <div role="alert" className="attention-note">
                {error}{" "}
                <Button
                  className="text-button"
                  onPress={() => setRetry((n) => n + 1)}
                >
                  {t("Retry comparison")}
                </Button>{" "}
                <Button
                  className="text-button"
                  onPress={() => changeScope("full")}
                >
                  {t("Open Full PR")}
                </Button>
              </div>
            )}
            {!error && !result && (
              <p role="status">
                <LoaderCircle size={16} className="spin" />{" "}
                {t("Comparing the two revisions…")}
              </p>
            )}
            {result && result.snapshot.files.length === 0 && (
              <div className="comparison-empty">
                <CheckCheck size={24} />
                <h3>{t("You're up to date")}</h3>
                <p>
                  {t(
                    "No file changes since this review. Your full PR guide and notes are still available.",
                  )}
                </p>
                <Button
                  className="secondary"
                  onPress={() => changeScope("full")}
                >
                  {t("Return to Full PR")}
                </Button>
              </div>
            )}
          </div>
          {result && result.snapshot.files.length > 0 && (
            <GuideView
              key={result.snapshot.id}
              workspace={{
                ...workspace,
                snapshot: result.snapshot,
                notes: workspace.notes,
                comments: [],
                changedHunks: [],
                previousSnapshotId: null,
              }}
              mode="files"
              selection={selection}
              onSelect={setSelection}
              onDiscuss={discuss}
              onProgress={() => {}}
              onFinish={onFinish}
            />
          )}
        </div>
      )}
    </>
  );
}
