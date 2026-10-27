//! Immutable review-to-head comparisons, isolated from full-PR captures and progress.
use crate::{contracts::*, domain, fixtures, github, service::Service, text_diff};
use anyhow::{Context, Result, ensure};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Serialize, Deserialize)]
struct CachedReview {
    checkpoint: Option<ReviewCheckpoint>,
    checked_at: String,
}
fn valid_sha(sha: &str) -> bool {
    sha.len() == 40 && sha.bytes().all(|c| c.is_ascii_hexdigit())
}
fn date(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}
fn latest(a: Option<ReviewCheckpoint>, b: Option<ReviewCheckpoint>) -> Option<ReviewCheckpoint> {
    a.into_iter()
        .chain(b)
        .filter(|c| date(&c.reviewed_at).is_some())
        .max_by_key(|c| date(&c.reviewed_at))
}
fn submitted_review(reviews: &[Value], login: &str) -> Option<ReviewCheckpoint> {
    reviews
        .iter()
        .filter(|v| {
            v["user"]["login"]
                .as_str()
                .is_some_and(|l| l.eq_ignore_ascii_case(login))
                && matches!(
                    v["state"].as_str(),
                    Some("APPROVED" | "CHANGES_REQUESTED" | "COMMENTED")
                )
                && v["commit_id"].as_str().is_some_and(valid_sha)
        })
        .filter_map(|v| {
            let reviewed_at = v["submitted_at"].as_str()?;
            date(reviewed_at)?;
            Some(ReviewCheckpoint {
                head: github::string(v, "commit_id"),
                reviewed_at: reviewed_at.into(),
                source: "github".into(),
            })
        })
        .max_by_key(|c| date(&c.reviewed_at))
}
fn comparison_id(snapshot: &Snapshot, baseline: &ReviewCheckpoint) -> String {
    domain::hash(&format!(
        "review-comparison-v1/{}/{}/{}/{}",
        snapshot.pull.repository.to_lowercase(),
        snapshot.pull.number,
        baseline.head,
        snapshot.pull.head
    ))
}
fn parsed_files(value: &Value, baseline: &str, head: &str, id: &str) -> Result<Vec<ChangedFile>> {
    ensure!(
        value["merge_base_commit"]["sha"] == baseline,
        "Your reviewed commit is not an ancestor of this captured revision. The history may have been rewritten, or your review is newer than this capture. Refresh the PR or use Full PR."
    );
    ensure!(
        value["commits"].is_array() && value["base_commit"]["sha"] == baseline,
        "GitHub did not return the requested review revision. Use Full PR or retry."
    );
    // A paginated comparison's commits list need not contain the head; the immutable URL pins it.
    ensure!(valid_sha(head), "Invalid current revision");
    let files = value["files"]
        .as_array()
        .context("GitHub did not return a changed-file list")?;
    ensure!(
        files.len() < 300,
        "GitHub's comparison limit of 300 files was reached. Use Full PR to avoid missing changes."
    );
    files
        .iter()
        .map(|v| {
            let path = v["filename"]
                .as_str()
                .filter(|s| !s.is_empty())
                .context("Comparison file has no path")?
                .to_string();
            let additions = v["additions"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .context("Comparison file has no addition count")?;
            let deletions = v["deletions"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .context("Comparison file has no deletion count")?;
            let hunks = v["patch"]
                .as_str()
                .and_then(|p| domain::parse_patch(&path, p, id).ok())
                .filter(|h| !h.is_empty() && text_diff::matches_counts(h, additions, deletions));
            Ok(ChangedFile {
                path,
                previous_path: v["previous_filename"].as_str().map(str::to_string),
                status: github::string(v, "status"),
                additions,
                deletions,
                unavailable: hunks.is_none().then(|| {
                    "No complete text patch (binary, metadata-only, or oversized file).".into()
                }),
                hunks: hunks.unwrap_or_default(),
            })
        })
        .collect()
}
impl Service {
    pub(crate) fn checkpoint_key(&self, snapshot: &Snapshot) -> Result<String> {
        let login = self
            .store
            .get::<String>("identity", "github")?
            .unwrap_or_else(|| "local".into());
        Ok(format!(
            "{}/{}/{}",
            login.to_lowercase(),
            snapshot.pull.repository.to_lowercase(),
            snapshot.pull.number
        ))
    }
    pub fn save_review_checkpoint(&self, id: &str) -> Result<ReviewCheckpoint> {
        let snapshot: Snapshot = self
            .store
            .get("snapshot", id)?
            .context("Save a checkpoint from the full PR revision")?;
        let checkpoint = ReviewCheckpoint {
            head: snapshot.pull.head.clone(),
            reviewed_at: chrono::Utc::now().to_rfc3339(),
            source: "local".into(),
        };
        self.store.put(
            "review-checkpoint",
            &self.checkpoint_key(&snapshot)?,
            &checkpoint,
        )?;
        Ok(checkpoint)
    }
    pub async fn review_baseline(&self, id: &str, refresh: bool) -> Result<ReviewBaseline> {
        let snapshot = self.snapshot(id)?;
        let key = self.checkpoint_key(&snapshot)?;
        let local = self.store.get("review-checkpoint", &key)?;
        if fixtures::is_sample_repo(&snapshot.pull.repository) {
            return Ok(ReviewBaseline {
                checkpoint: local.or_else(|| Some(sample_checkpoint())),
                sync_error: None,
            });
        }
        let cached = self
            .store
            .get::<CachedReview>("github-review-checkpoint", &key)?;
        let fresh = cached
            .as_ref()
            .and_then(|c| date(&c.checked_at))
            .is_some_and(|d| chrono::Utc::now().signed_duration_since(d).num_seconds() < 60);
        let mut remote = cached.and_then(|c| c.checkpoint);
        let mut sync_error = None;
        if refresh && !fresh {
            match self.github.login().await {
                Ok(login) if !login.is_empty() => match self.github.reviews(&snapshot.pull).await {
                    Ok(reviews) => {
                        remote = submitted_review(&reviews, &login);
                        self.store.put("github-review-checkpoint", &key, &CachedReview { checkpoint: remote.clone(), checked_at: chrono::Utc::now().to_rfc3339() })?;
                    }
                    Err(e) => sync_error = Some(format!("Could not check your GitHub reviews: {e}. Saved review history is still available.")),
                },
                _ => sync_error = Some("Connect GitHub to check your submitted reviews. Saved checkpoints are available offline.".into()),
            }
        }
        Ok(ReviewBaseline {
            checkpoint: latest(remote, local),
            sync_error,
        })
    }
    pub async fn compare_review(
        &self,
        id: &str,
        baseline: ReviewCheckpoint,
    ) -> Result<ReviewComparison> {
        let current: Snapshot = self
            .store
            .get("snapshot", id)?
            .context("Open the full PR revision first")?;
        ensure!(date(&baseline.reviewed_at).is_some(), "Invalid review date");
        let sample = fixtures::is_sample_repo(&current.pull.repository);
        ensure!(
            sample
                || (valid_sha(&baseline.head)
                    && valid_sha(&current.pull.head)
                    && domain::valid_repo(&current.pull.repository)),
            "Invalid comparison revision"
        );
        let comparison_id = comparison_id(&current, &baseline);
        if let Some(snapshot) = self.store.get("comparison-snapshot", &comparison_id)? {
            return Ok(ReviewComparison { baseline, snapshot });
        }
        let mut snapshot = current.clone();
        snapshot.id = comparison_id;
        snapshot.captured_at = chrono::Utc::now().to_rfc3339();
        snapshot.limitations = vec![];
        snapshot.files = if baseline.head == current.pull.head {
            vec![]
        } else if sample {
            self.sample_comparison(&snapshot)?
        } else {
            let v = self
                .github
                .request(
                    Method::GET,
                    &format!(
                        "/repos/{}/compare/{}...{}?per_page=1",
                        current.pull.repository, baseline.head, current.pull.head
                    ),
                    None,
                    true,
                )
                .await?;
            let mut files = parsed_files(&v, &baseline.head, &current.pull.head, &snapshot.id)?;
            let mut budget = 16 * 1024 * 1024;
            for (index, file) in files
                .iter_mut()
                .filter(|f| f.unavailable.is_some() && f.additions + f.deletions > 0)
                .enumerate()
            {
                if index >= 20 || budget == 0 {
                    break;
                }
                match self
                    .github
                    .reconstruct_file(
                        &current.pull.repository,
                        &baseline.head,
                        &current.pull.head,
                        file,
                        &snapshot.id,
                        &mut budget,
                    )
                    .await
                {
                    Ok(hunks) => {
                        file.hunks = hunks;
                        file.unavailable = None;
                    }
                    Err(e) => file.unavailable = Some(format!("Text capture unavailable: {e}")),
                }
            }
            files
        };
        snapshot.pull.base = baseline.head.clone();
        snapshot.pull.additions = snapshot.files.iter().map(|f| f.additions).sum();
        snapshot.pull.deletions = snapshot.files.iter().map(|f| f.deletions).sum();
        snapshot.pull.changed_files = snapshot.files.len() as u32;
        self.store.batch(&[
            ("context-base", &snapshot.id, json!(baseline.head)),
            (
                "comparison-snapshot",
                &snapshot.id,
                serde_json::to_value(&snapshot)?,
            ),
        ])?;
        Ok(ReviewComparison { baseline, snapshot })
    }
    fn sample_comparison(&self, snapshot: &Snapshot) -> Result<Vec<ChangedFile>> {
        // Previous iteration: one-day expiry, no admin check, an old locale name,
        // and a temporary document later removed. Current sources match the full sample.
        let mut files = Vec::new();
        for (path, previous_path, old, new, status) in sample_sources(snapshot) {
            if old == new {
                continue;
            }
            let patch = similar::TextDiff::from_lines(&old, &new)
                .unified_diff()
                .context_radius(3)
                .to_string();
            let hunks = domain::parse_patch(&path, &patch, &snapshot.id)?;
            let additions = hunks
                .iter()
                .flat_map(|h| &h.lines)
                .filter(|l| l.kind == LineKind::Addition)
                .count() as u32;
            let deletions = hunks
                .iter()
                .flat_map(|h| &h.lines)
                .filter(|l| l.kind == LineKind::Deletion)
                .count() as u32;
            self.store.put(
                "context-source",
                &format!("{}/{}", snapshot.id, domain::hash(&path)),
                &json!({"old":old,"new":new}),
            )?;
            files.push(ChangedFile {
                path,
                previous_path,
                status,
                additions,
                deletions,
                hunks,
                unavailable: None,
            });
        }
        Ok(files)
    }
}
fn sample_checkpoint() -> ReviewCheckpoint {
    ReviewCheckpoint {
        head: "demo-reviewed-v0".into(),
        reviewed_at: "2026-10-19T16:00:00Z".into(),
        source: "sample".into(),
    }
}
type SampleSource = (String, Option<String>, String, String, String);
fn sample_sources(snapshot: &Snapshot) -> Vec<SampleSource> {
    let mut sources = snapshot
        .files
        .iter()
        .filter_map(|file| {
            let new: String = file
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .filter(|l| l.new.is_some())
                .map(|l| format!("{}\n", l.text))
                .collect();
            let (old, previous_path, status) = match file.path.as_str() {
                "src/auth/invitations.ts" => (
                    new.lines()
                        .filter(|l| !l.contains("actor.roles"))
                        .map(|l| format!("{l}\n"))
                        .collect(),
                    None,
                    "modified",
                ),
                "src/invitations.ts" => (new.replace("7 * 24", "1 * 24"), None, "modified"),
                "tests/invitations.test.ts" => (
                    new.replace("seven", "one")
                        .replace("2026-01-08", "2026-01-02"),
                    None,
                    "modified",
                ),
                "locales/en.json" => (
                    new.replace("Invite a teammate", "Invite"),
                    Some("locales/en-US.json".into()),
                    "renamed",
                ),
                "locales/fr.json" => (String::new(), None, "added"),
                _ => return None,
            };
            Some((file.path.clone(), previous_path, old, new, status.into()))
        })
        .collect::<Vec<_>>();
    sources.push(("docs/invitation-draft.md".into(), None, "# Invitation draft\nTemporary notes from the first iteration.\nInvitations expire after one day.\n".into(), String::new(), "removed".into()));
    sources
}

#[cfg(test)]
mod tests {
    use super::*;
    fn review(login: &str, state: &str, day: u32, sha: &str) -> Value {
        json!({"user":{"login":login},"state":state,"submitted_at":format!("2026-10-{day:02}T10:00:00Z"),"commit_id":sha})
    }
    #[test]
    fn uses_latest_submitted_review_by_viewer_not_pending_dismissed_or_other_users() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let reviews = vec![
            review("Me", "APPROVED", 12, &a),
            review("me", "COMMENTED", 14, &b),
            review("me", "PENDING", 15, &a),
            review("other", "APPROVED", 16, &a),
            review("me", "DISMISSED", 17, &a),
            review("me", "CHANGES_REQUESTED", 18, "bad"),
        ];
        let result = submitted_review(&reviews, "ME").unwrap();
        assert_eq!(result.head, b);
        assert_eq!(result.source, "github");
        assert!(submitted_review(&reviews, "nobody").is_none());
    }
    #[test]
    fn orders_dates_as_instants_including_timezone_offsets() {
        let a = ReviewCheckpoint {
            head: "a".into(),
            reviewed_at: "2026-10-20T12:00:00-07:00".into(),
            source: "local".into(),
        };
        let b = ReviewCheckpoint {
            head: "b".into(),
            reviewed_at: "2026-10-20T18:00:00Z".into(),
            source: "github".into(),
        };
        assert_eq!(latest(Some(b), Some(a.clone())), Some(a));
    }
    #[test]
    fn comparison_rejects_divergent_and_truncated_results_and_marks_missing_patches() {
        let base = "a".repeat(40);
        let head = "b".repeat(40);
        let mut v = json!({"merge_base_commit":{"sha":base},"base_commit":{"sha":base},"commits":[],"files":[{"filename":"gone.ts","status":"removed","additions":0,"deletions":1,"patch":"@@ -1 +0,0 @@\n-old"},{"filename":"renamed.png","previous_filename":"old.png","status":"renamed","additions":0,"deletions":0}]});
        let files = parsed_files(&v, &base, &head, "test").unwrap();
        assert_eq!(files[0].hunks[0].lines[0].kind, LineKind::Deletion);
        assert_eq!(files[1].previous_path.as_deref(), Some("old.png"));
        assert!(files[1].unavailable.is_some());
        v["files"] = json!(vec![v["files"][0].clone(); 300]);
        assert!(
            parsed_files(&v, &base, &head, "test")
                .unwrap_err()
                .to_string()
                .contains("300 files")
        );
        v["files"] = json!([]);
        v["merge_base_commit"]["sha"] = json!(head);
        assert!(parsed_files(&v, &base, &head, "test").is_err());
    }
    #[tokio::test]
    async fn sample_compares_actual_revisions_and_preserves_full_review_state() {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        let (snapshot, _) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service
            .store
            .put("latest", "diffcity/demo#42", &snapshot.id)
            .unwrap();
        let baseline = service
            .review_baseline(&snapshot.id, true)
            .await
            .unwrap()
            .checkpoint
            .unwrap();
        let comparison = service
            .compare_review(&snapshot.id, baseline.clone())
            .await
            .unwrap();
        let files = &comparison.snapshot.files;
        assert_eq!(files.len(), 6);
        assert!(
            files
                .iter()
                .any(|f| f.status == "removed"
                    && !snapshot.files.iter().any(|old| old.path == f.path))
        );
        assert!(files.iter().any(|f| f.status == "renamed"));
        assert!(!files.iter().any(|f| f.path.starts_with("db/")));
        let expiry = files
            .iter()
            .find(|f| f.path == "src/invitations.ts")
            .unwrap();
        assert_eq!((expiry.additions, expiry.deletions), (1, 1));
        assert!(
            expiry.hunks[0]
                .lines
                .iter()
                .any(|l| l.kind == LineKind::Deletion && l.text.contains("1 * 24"))
        );
        assert_eq!(
            service
                .store
                .get::<String>("latest", "diffcity/demo#42")
                .unwrap()
                .unwrap(),
            snapshot.id
        );
        assert!(
            service
                .store
                .get::<Snapshot>("snapshot", &comparison.snapshot.id)
                .unwrap()
                .is_none()
        );
        assert!(
            service
                .store
                .get::<ReviewProgress>("progress", &snapshot.id)
                .unwrap()
                .is_none()
        );
        // Context expansion uses the reviewed sources, not the original PR base.
        let context = service
            .hunk_context(&comparison.snapshot.id, &expiry.hunks[0].id, 20, 20)
            .await
            .unwrap();
        assert_eq!(context.after.len(), 0);
        let cached = service
            .compare_review(&snapshot.id, baseline)
            .await
            .unwrap();
        assert_eq!(cached.snapshot.captured_at, comparison.snapshot.captured_at);
        let checkpoint = service.save_review_checkpoint(&snapshot.id).unwrap();
        assert_eq!(checkpoint.head, snapshot.pull.head);
        assert_eq!(
            service
                .review_baseline(&snapshot.id, false)
                .await
                .unwrap()
                .checkpoint
                .unwrap(),
            checkpoint
        );
        let empty = service
            .compare_review(&snapshot.id, checkpoint)
            .await
            .unwrap();
        assert!(empty.snapshot.files.is_empty());
    }
    #[tokio::test]
    async fn ordinary_capture_is_not_a_review_and_offline_failure_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        let (mut snapshot, _) = fixtures::sample().unwrap();
        snapshot.pull.repository = "owner/repo".into();
        snapshot.pull.head = "a".repeat(40);
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let status = service.review_baseline(&snapshot.id, true).await.unwrap();
        assert!(status.checkpoint.is_none());
        assert!(status.sync_error.is_some());
        let checkpoint = service.save_review_checkpoint(&snapshot.id).unwrap();
        let status = service.review_baseline(&snapshot.id, true).await.unwrap();
        assert_eq!(status.checkpoint, Some(checkpoint));
        assert!(status.sync_error.is_some());
        // Switching identity never adopts another viewer's review boundary.
        service
            .store
            .put("identity", "github", &"someone-else")
            .unwrap();
        assert!(
            service
                .review_baseline(&snapshot.id, false)
                .await
                .unwrap()
                .checkpoint
                .is_none()
        );
    }
}
