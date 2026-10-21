use crate::{contracts::*, domain, fixtures, service::Service};
use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Weak,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::sync::{Mutex, watch};

/// One speculative download at a time; an interactive open cancels it immediately.
/// Per-PR locks prevent an older capture from overwriting a newer capture.
pub(crate) struct ReviewLoads {
    pulls: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    background: Mutex<()>,
    interrupted: watch::Sender<u64>,
    foreground: AtomicUsize,
}
impl Default for ReviewLoads {
    fn default() -> Self {
        Self {
            pulls: Mutex::new(HashMap::new()),
            background: Mutex::new(()),
            interrupted: watch::channel(0).0,
            foreground: AtomicUsize::new(0),
        }
    }
}
struct Foreground<'a>(&'a ReviewLoads);
impl Drop for Foreground<'_> {
    fn drop(&mut self) {
        self.0.foreground.fetch_sub(1, Ordering::SeqCst);
    }
}
impl ReviewLoads {
    fn foreground(&self) -> Foreground<'_> {
        self.foreground.fetch_add(1, Ordering::SeqCst);
        self.interrupted.send_modify(|generation| *generation += 1);
        Foreground(self)
    }
    async fn pull(&self, key: &str) -> Arc<Mutex<()>> {
        let mut pulls = self.pulls.lock().await;
        pulls.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = pulls.get(key).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        pulls.insert(key.into(), Arc::downgrade(&lock));
        lock
    }
    async fn prefetch<T>(&self, work: impl Future<Output = T>) -> Option<T> {
        let _serial = self.background.try_lock().ok()?;
        let mut interrupted = self.interrupted.subscribe();
        if self.foreground.load(Ordering::SeqCst) != 0 {
            return None;
        }
        tokio::select! {
            biased;
            _ = interrupted.changed() => None,
            result = work => Some(result),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct CachedReview {
    checks: String,
    refreshed_at: i64,
}

impl Service {
    pub(crate) fn cached_checks(&self, id: &str) -> Result<String> {
        Ok(self
            .store
            .get::<CachedReview>("review-cache", id)?
            .map(|cache| cache.checks)
            .unwrap_or_else(|| "Checks not synced yet".into()))
    }
    fn cached_pull(&self, repo: &str, number: u32) -> Result<Option<ReviewWorkspace>> {
        self.store
            .get::<String>("latest", &format!("{repo}#{number}"))?
            .map(|id| self.saved(&id))
            .transpose()
    }
    /// With refresh=false, a disk hit never waits on GitHub or a network lock.
    /// Cold opens only capture code; comments/checks are hydrated after rendering.
    pub async fn open(&self, repo: &str, number: u32, refresh: bool) -> Result<ReviewWorkspace> {
        let workspace = self.fetch_review(repo, number, refresh).await?;
        self.activate_review(workspace)
    }
    pub async fn sync_pull(&self, repo: &str, number: u32) -> Result<ReviewWorkspace> {
        self.fetch_review(repo, number, true).await
    }
    fn activate_review(&self, mut workspace: ReviewWorkspace) -> Result<ReviewWorkspace> {
        let id = &workspace.snapshot.id;
        if self.store.get::<ReviewProgress>("progress", id)?.is_some() {
            return Ok(workspace);
        }
        // Prefetching must not freeze progress before the user actually opens the revision.
        // Skip intermediary prefetched revisions that were never reviewed.
        let mut previous = workspace.previous_snapshot_id.clone();
        let mut visited = std::collections::HashSet::from([id.clone()]);
        while let Some(previous_id) = previous {
            ensure!(
                visited.insert(previous_id.clone()),
                "Invalid saved revision history"
            );
            let old = self.snapshot(&previous_id)?;
            if let Some(progress) = self.store.get("progress", &previous_id)? {
                (workspace.progress, workspace.changed_hunks) =
                    domain::transfer_progress(&old, &workspace.snapshot, &progress);
                break;
            }
            previous = self.previous_snapshot(&old)?;
        }
        self.store.batch(&[
            ("progress", id, json!(workspace.progress)),
            ("changed-hunks", id, json!(workspace.changed_hunks)),
        ])?;
        Ok(workspace)
    }
    async fn fetch_review(
        &self,
        repo: &str,
        number: u32,
        refresh: bool,
    ) -> Result<ReviewWorkspace> {
        if repo == fixtures::INBOX_REPO {
            return self.sample_pull(number);
        }
        ensure!(
            domain::valid_repo(repo) && number > 0,
            "Invalid pull request"
        );
        let _foreground = self.review_loads.foreground();
        if !refresh && let Some(workspace) = self.cached_pull(repo, number)? {
            return Ok(workspace);
        }
        let started = chrono::Utc::now().timestamp_millis();
        let lock = self
            .review_loads
            .pull(&format!("{}#{number}", repo.to_lowercase()))
            .await;
        let _pull = lock.lock().await;
        if let Some(workspace) = self.cached_pull(repo, number)? {
            let cache = self
                .store
                .get::<CachedReview>("review-cache", &workspace.snapshot.id)?;
            // Another caller already completed this same refresh while we waited.
            if !refresh || cache.is_some_and(|cache| cache.refreshed_at >= started) {
                return Ok(workspace);
            }
        }
        self.load_review(repo, number, refresh).await
    }
    fn prefetch_fresh(&self, pull: &PullRequest) -> Result<bool> {
        let Some(id) = self
            .store
            .get::<String>("latest", &domain::pull_key(pull))?
        else {
            return Ok(false);
        };
        let Some(cache) = self.store.get::<CachedReview>("review-cache", &id)? else {
            return Ok(false);
        };
        if chrono::Utc::now().timestamp_millis() - cache.refreshed_at >= 300_000 {
            return Ok(false);
        }
        let snapshot = self.snapshot(&id)?;
        Ok(snapshot.pull.head == pull.head
            && snapshot.pull.base == pull.base
            && snapshot.pull.updated_at >= pull.updated_at)
    }
    pub async fn prefetch_pull(&self, pull: &PullRequest) -> Result<bool> {
        ensure!(
            domain::valid_repo(&pull.repository) && pull.number > 0,
            "Invalid pull request"
        );
        if pull.state != "open"
            || [fixtures::INBOX_REPO, "diffcity/demo"].contains(&pull.repository.as_str())
        {
            return Ok(true);
        }
        if self.prefetch_fresh(pull)? {
            return Ok(true);
        }
        self.review_loads
            .prefetch(async {
                let lock = self
                    .review_loads
                    .pull(&domain::pull_key(pull).to_lowercase())
                    .await;
                let _pull = lock.lock().await;
                if self.prefetch_fresh(pull)? {
                    return Ok(true);
                }
                let workspace = self
                    .load_review(&pull.repository, pull.number, true)
                    .await?;
                if let Some(error) = workspace.sync_error {
                    bail!(error);
                }
                Ok(true)
            })
            .await
            .unwrap_or(Ok(false))
    }
    async fn load_review(&self, repo: &str, number: u32, refresh: bool) -> Result<ReviewWorkspace> {
        let key = format!("{repo}#{number}");
        let old_id: Option<String> = self.store.get("latest", &key)?;
        let old = old_id.as_deref().map(|id| self.snapshot(id)).transpose()?;
        let capture = async {
            if let Some(old) = &old {
                let latest = self.github.pull(repo, number).await?;
                if latest.head == old.pull.head && latest.base == old.pull.base {
                    return Ok::<_, anyhow::Error>(Snapshot {
                        pull: latest,
                        ..old.clone()
                    });
                }
            }
            self.github.snapshot(repo, number).await
        }
        .await;
        let (snapshot, mut sync_error) = match capture {
            Ok(snapshot) => (snapshot, None),
            Err(error) => match &old {
                Some(snapshot) => (snapshot.clone(), Some(error.to_string())),
                None => return Err(error),
            },
        };
        let previous = match &old_id {
            Some(id) if id != &snapshot.id => Some(id.clone()),
            _ => self.previous_snapshot(&snapshot)?,
        };
        let documents = [
            ("snapshot", snapshot.id.as_str(), json!(snapshot)),
            ("latest", key.as_str(), json!(snapshot.id)),
            ("previous-snapshot", snapshot.id.as_str(), json!(previous)),
        ];
        // Expose a complete local code snapshot before slower discussion/status requests.
        self.store.batch(&documents)?;
        if refresh {
            match self.github.comments(&snapshot.pull).await {
                Ok(comments) => self.store.put("comments", &snapshot.id, &comments)?,
                Err(error) => {
                    sync_error.get_or_insert(error.to_string());
                }
            }
            let checks = match self.github.checks(&snapshot.pull).await {
                Ok(checks) => checks,
                Err(error) => {
                    sync_error.get_or_insert(error.to_string());
                    self.cached_checks(&snapshot.id)?
                }
            };
            self.store.put(
                "review-cache",
                &snapshot.id,
                &CachedReview {
                    checks,
                    refreshed_at: if sync_error.is_none() {
                        chrono::Utc::now().timestamp_millis()
                    } else {
                        0
                    },
                },
            )?;
        }
        let mut workspace = self.saved(&snapshot.id)?;
        workspace.sync_error = sync_error;
        Ok(workspace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn foreground_cancels_prefetch_and_blocks_new_speculation() {
        let loads = ReviewLoads::default();
        let (started, ready) = tokio::sync::oneshot::channel();
        let background = loads.prefetch(async {
            started.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        let foreground = async {
            ready.await.unwrap();
            let _active = loads.foreground();
            assert!(
                loads
                    .prefetch(async { panic!("must not start") })
                    .await
                    .is_none()
            );
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(background, foreground)
        })
        .await
        .unwrap();
        assert!(result.is_none());
        assert_eq!(loads.prefetch(async { 7 }).await, Some(7));
    }

    #[tokio::test]
    async fn prefetched_revisions_transfer_latest_progress_only_when_opened() {
        let directory = tempfile::tempdir().unwrap();
        let service = Service::new(directory.path()).unwrap();
        let (mut first, _) = fixtures::sample().unwrap();
        first.pull.repository = "owner/repo".into();
        first.id = "reviewed".into();
        let mut middle = first.clone();
        middle.id = "prefetched-only".into();
        let mut latest = first.clone();
        latest.id = "prefetched-latest".into();
        for snapshot in [&first, &middle, &latest] {
            service
                .store
                .put("snapshot", &snapshot.id, snapshot)
                .unwrap();
        }
        service
            .store
            .put("previous-snapshot", &first.id, &None::<String>)
            .unwrap();
        service
            .store
            .put("previous-snapshot", &middle.id, &Some(&first.id))
            .unwrap();
        service
            .store
            .put("previous-snapshot", &latest.id, &Some(&middle.id))
            .unwrap();
        service
            .store
            .put("latest", &domain::pull_key(&latest.pull), &latest.id)
            .unwrap();
        // User marks code after both later revisions have already been downloaded.
        let progress = ReviewProgress {
            reviewed: vec![first.files[0].hunks[0].id.clone()],
            ..Default::default()
        };
        service.store.put("progress", &first.id, &progress).unwrap();
        let opened = service
            .open("owner/repo", latest.pull.number, false)
            .await
            .unwrap();
        assert_eq!(opened.progress.reviewed, progress.reviewed);
        assert!(
            service
                .store
                .get::<ReviewProgress>("progress", &middle.id)
                .unwrap()
                .is_none()
        );
        // Once opened, its own progress is authoritative; reopening cannot reset it.
        service
            .store
            .put("progress", &latest.id, &ReviewProgress::default())
            .unwrap();
        let reopened = service
            .open("owner/repo", latest.pull.number, false)
            .await
            .unwrap();
        assert!(reopened.progress.reviewed.is_empty());
    }

    #[tokio::test]
    async fn cached_open_is_offline_and_does_not_wait_for_network_or_other_reviews() {
        let directory = tempfile::tempdir().unwrap();
        let service = Service::new(directory.path()).unwrap();
        let (mut snapshot, guide) = fixtures::sample().unwrap();
        snapshot.pull.repository = "owner/repo".into();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service
            .store
            .put("latest", &domain::pull_key(&snapshot.pull), &snapshot.id)
            .unwrap();
        service.store.put("guide", &snapshot.id, &guide).unwrap();
        service
            .store
            .put(
                "review-cache",
                &snapshot.id,
                &CachedReview {
                    checks: "All checks passed".into(),
                    refreshed_at: chrono::Utc::now().timestamp_millis(),
                },
            )
            .unwrap();
        let progress = ReviewProgress {
            active_section: Some(guide.sections[0].id.clone()),
            ..Default::default()
        };
        service
            .store
            .put("progress", &snapshot.id, &progress)
            .unwrap();
        // A corrupt unrelated snapshot used to break every open because all were decoded.
        service
            .store
            .put("snapshot", "unrelated", &json!({"unrelated":true}))
            .unwrap();
        let lock = service
            .review_loads
            .pull(&domain::pull_key(&snapshot.pull))
            .await;
        let _blocked_network = lock.lock().await;
        let w = tokio::time::timeout(
            Duration::from_millis(200),
            service.open("owner/repo", snapshot.pull.number, false),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(w.snapshot.id, snapshot.id);
        assert_eq!(w.progress.active_section, progress.active_section);
        assert_eq!(w.checks, "All checks passed");
        assert!(w.sync_error.is_none());
        assert!(service.prefetch_fresh(&snapshot.pull).unwrap());
        let mut changed = snapshot.pull.clone();
        changed.head = "new-head".into();
        assert!(!service.prefetch_fresh(&changed).unwrap());
        changed = snapshot.pull.clone();
        changed.updated_at = "2099-01-01T00:00:00Z".into();
        assert!(!service.prefetch_fresh(&changed).unwrap());
    }
}
