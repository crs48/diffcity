//! Surrounding code is pinned to the captured head and merge base, never a moving branch.
use crate::{contracts::*, fixtures, service::Service, text_diff::MAX_FILE_BYTES};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Sources {
    old: String,
    new: String,
}

#[derive(Clone, Copy)]
struct Span {
    old: usize,
    new: usize,
    old_end: usize,
    new_end: usize,
}

fn span(hunk: &Hunk) -> Result<Span> {
    let re = regex::Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")?;
    let c = re
        .captures(&hunk.header)
        .context("Invalid captured hunk header")?;
    let old_count: usize = c.get(2).map_or("1", |m| m.as_str()).parse()?;
    let new_count: usize = c.get(4).map_or("1", |m| m.as_str()).parse()?;
    // A zero-length side names the line before the insertion/deletion boundary.
    let old = c[1]
        .parse::<usize>()?
        .saturating_sub(usize::from(old_count > 0));
    let new = c[3]
        .parse::<usize>()?
        .saturating_sub(usize::from(new_count > 0));
    Ok(Span {
        old,
        new,
        old_end: old + old_count,
        new_end: new + new_count,
    })
}

fn window(
    file: &ChangedFile,
    hunk_id: &str,
    sources: &Sources,
    before: u32,
    after: u32,
) -> Result<HunkContext> {
    ensure!(
        before <= 50_000 && after <= 50_000,
        "Context expansion exceeds the file limit"
    );
    ensure!(
        sources.old.len() <= MAX_FILE_BYTES && sources.new.len() <= MAX_FILE_BYTES,
        "File exceeds the 2 MiB context limit"
    );
    ensure!(
        !sources.old.contains('\0') && !sources.new.contains('\0'),
        "Binary content has no text context"
    );
    let old: Vec<_> = sources.old.lines().collect();
    let new: Vec<_> = sources.new.lines().collect();
    ensure!(
        old.len() <= 50_000 && new.len() <= 50_000,
        "File exceeds the 50,000-line context limit"
    );
    let index = file
        .hunks
        .iter()
        .position(|h| h.id == hunk_id)
        .context("Hunk is not in this revision")?;
    let spans = file.hunks.iter().map(span).collect::<Result<Vec<_>>>()?;
    for (hunk, s) in file.hunks.iter().zip(&spans) {
        ensure!(
            s.old_end <= old.len() && s.new_end <= new.len(),
            "Source does not match the captured diff"
        );
        for line in &hunk.lines {
            for (number, text) in [(line.old, &old), (line.new, &new)] {
                if let Some(number) = number {
                    ensure!(
                        number > 0 && text.get(number as usize - 1) == Some(&line.text.as_str()),
                        "Source does not match the captured diff"
                    );
                }
            }
        }
    }
    let s = spans[index];
    let previous = index.checked_sub(1).map(|i| spans[i]);
    let next = spans.get(index + 1);
    let before_available = s
        .old
        .saturating_sub(previous.map_or(0, |p| p.old_end))
        .min(s.new.saturating_sub(previous.map_or(0, |p| p.new_end)));
    let after_available = next
        .map_or(old.len(), |n| n.old)
        .saturating_sub(s.old_end)
        .min(next.map_or(new.len(), |n| n.new).saturating_sub(s.new_end));
    let above = (before as usize).min(before_available);
    let below = (after as usize).min(after_available);
    let lines = |left: usize, right: usize, count: usize| -> Result<Vec<DiffLine>> {
        (0..count)
            .map(|i| {
                ensure!(
                    old.get(left + i) == new.get(right + i) && old.get(left + i).is_some(),
                    "Additional context differs between revisions; refresh the PR capture"
                );
                Ok(DiffLine {
                    kind: LineKind::Context,
                    old: Some((left + i + 1) as u32),
                    new: Some((right + i + 1) as u32),
                    text: old[left + i].into(),
                })
            })
            .collect()
    };
    Ok(HunkContext {
        before: lines(s.old - above, s.new - above, above)?,
        after: lines(s.old_end, s.new_end, below)?,
        before_remaining: (before_available - above) as u32,
        after_remaining: (after_available - below) as u32,
    })
}

impl Service {
    pub async fn hunk_context(
        &self,
        snapshot_id: &str,
        hunk_id: &str,
        before: u32,
        after: u32,
    ) -> Result<HunkContext> {
        ensure!(
            before <= 50_000 && after <= 50_000,
            "Context expansion exceeds the file limit"
        );
        let snapshot = self.snapshot(snapshot_id)?;
        let file = snapshot
            .files
            .iter()
            .find(|f| f.hunks.iter().any(|h| h.id == hunk_id))
            .context("Hunk is not in this revision")?;
        let key = format!("{}/{}", snapshot.id, crate::domain::hash(&file.path));
        let sources = match self.store.get::<Sources>("context-source", &key)? {
            Some(sources) => sources,
            None => {
                let sources = if fixtures::is_sample_repo(&snapshot.pull.repository) {
                    // Bundled samples contain whole added files. No invented surrounding lines.
                    ensure!(
                        file.status == "added",
                        "Additional source is not included in this sample"
                    );
                    Sources {
                        old: String::new(),
                        new: file
                            .hunks
                            .iter()
                            .flat_map(|h| &h.lines)
                            .filter(|line| line.new.is_some())
                            .map(|line| format!("{}\n", line.text))
                            .collect(),
                    }
                } else {
                    let base = match self.store.get::<String>("context-base", &snapshot.id)? {
                        Some(base) => base,
                        None => {
                            let base = self.github.context_base(&snapshot.pull).await?;
                            self.store.put("context-base", &snapshot.id, &base)?;
                            base
                        }
                    };
                    let (old, new) = self
                        .github
                        .context_sources(&snapshot.pull, &base, file)
                        .await?;
                    Sources { old, new }
                };
                // Validate before persisting, so a bad response cannot poison offline context.
                window(file, hunk_id, &sources, before, after)?;
                self.store.put("context-source", &key, &sources)?;
                sources
            }
        };
        window(file, hunk_id, &sources, before, after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(old: &str, new: &str, radius: usize) -> ChangedFile {
        let patch = similar::TextDiff::from_lines(old, new)
            .unified_diff()
            .context_radius(radius)
            .to_string();
        ChangedFile {
            path: "renamed/日本語.txt".into(),
            previous_path: Some("old.txt".into()),
            status: "renamed".into(),
            additions: 0,
            deletions: 0,
            hunks: crate::domain::parse_patch("renamed/日本語.txt", &patch, "revision").unwrap(),
            unavailable: None,
        }
    }
    #[test]
    fn context_stops_at_adjacent_hunks_and_keeps_source_coordinates() {
        let old = (1..=80).map(|n| format!("line {n}\n")).collect::<String>();
        let new = old
            .replace("line 20\n", "changed 20\n")
            .replace("line 60\n", "changed 60\n");
        let f = file(&old, &new, 3);
        let sources = Sources { old, new };
        assert_eq!(f.hunks.len(), 2);
        let partial = window(&f, &f.hunks[0].id, &sources, 5, 5).unwrap();
        assert_eq!(partial.before[0].old, Some(12));
        assert_eq!(partial.after[0].new, Some(24));
        assert_eq!(partial.before_remaining, 11);
        let all = window(&f, &f.hunks[0].id, &sources, 50_000, 50_000).unwrap();
        assert_eq!(all.before.first().unwrap().new, Some(1));
        assert_eq!(all.after.last().unwrap().new, Some(56));
        assert_eq!(all.after_remaining, 0);
        assert!(!all.after.iter().any(|line| line.text.contains("changed")));
    }
    #[test]
    fn zero_length_insertions_and_deletions_use_the_correct_gap_boundary() {
        for (old, new) in [
            ("a\nb\nc\nd\n", "a\nb\ninserted\nc\nd\n"),
            ("a\nb\nremoved\nc\nd\n", "a\nb\nc\nd\n"),
        ] {
            let f = file(old, new, 0);
            let context = window(
                &f,
                &f.hunks[0].id,
                &Sources {
                    old: old.into(),
                    new: new.into(),
                },
                25,
                25,
            )
            .unwrap();
            assert_eq!(
                context
                    .before
                    .iter()
                    .map(|l| l.text.as_str())
                    .collect::<Vec<_>>(),
                vec!["a", "b"]
            );
            assert_eq!(
                context
                    .after
                    .iter()
                    .map(|l| l.text.as_str())
                    .collect::<Vec<_>>(),
                vec!["c", "d"]
            );
            assert_ne!(context.after[0].old, context.after[0].new);
        }
    }
    #[test]
    fn renamed_unicode_crlf_and_missing_final_newline_context_is_exact() {
        let old = "最初\r\n古い\r\n最後";
        let new = "最初\r\n新しい\r\n最後";
        let f = file(old, new, 0);
        let context = window(
            &f,
            &f.hunks[0].id,
            &Sources {
                old: old.into(),
                new: new.into(),
            },
            25,
            25,
        )
        .unwrap();
        assert_eq!(context.before[0].text, "最初");
        assert_eq!(context.after[0].text, "最後");
    }
    #[test]
    fn stale_mismatched_binary_or_over_budget_sources_are_rejected() {
        let f = file("a\nold\nz\n", "a\nnew\nz\n", 0);
        for sources in [
            Sources {
                old: "a\nold\nz\n".into(),
                new: "a\nstale\nz\n".into(),
            },
            Sources {
                old: "a\nold\nz\n".into(),
                new: "different\nnew\nz\n".into(),
            },
            Sources {
                old: "\0".into(),
                new: "\0".into(),
            },
            Sources {
                old: "x".repeat(MAX_FILE_BYTES + 1),
                new: String::new(),
            },
        ] {
            assert!(window(&f, &f.hunks[0].id, &sources, 25, 25).is_err());
        }
        assert!(
            window(
                &f,
                &f.hunks[0].id,
                &Sources {
                    old: String::new(),
                    new: String::new()
                },
                50_001,
                0
            )
            .is_err()
        );
    }
    #[tokio::test]
    async fn cached_context_survives_restart_without_changing_review_anchors() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (mut snapshot, _) = fixtures::sample().unwrap();
        let sources = Sources {
            old: "a\nold\nz\n".into(),
            new: "a\nnew\nz\n".into(),
        };
        snapshot.files = vec![file(&sources.old, &sources.new, 0)];
        let hunk_id = snapshot.files[0].hunks[0].id.clone();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let key = format!(
            "{}/{}",
            snapshot.id,
            crate::domain::hash(&snapshot.files[0].path)
        );
        service.store.put("context-source", &key, &sources).unwrap();
        drop(service);
        let restored = Service::new(root.path()).unwrap();
        let context = restored
            .hunk_context(&snapshot.id, &hunk_id, 25, 25)
            .await
            .unwrap();
        assert_eq!(context.before[0].new, Some(1));
        assert!(
            crate::domain::validate_anchor(
                &snapshot,
                &Anchor {
                    hunk_id: hunk_id.clone(),
                    path: snapshot.files[0].path.clone(),
                    side: Side::RIGHT,
                    start_line: 1,
                    line: 1
                }
            )
            .is_err()
        );
        assert!(
            restored
                .hunk_context(&snapshot.id, "wrong-hunk", 25, 25)
                .await
                .is_err()
        );
        assert!(restored.store.notes(&snapshot.id).unwrap().is_empty());
    }
    #[tokio::test]
    async fn complete_added_samples_have_no_invented_surrounding_context() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (snapshot, _) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let context = service
            .hunk_context(&snapshot.id, &snapshot.files[0].hunks[0].id, 25, 25)
            .await
            .unwrap();
        assert!(context.before.is_empty() && context.after.is_empty());
        assert_eq!((context.before_remaining, context.after_remaining), (0, 0));
    }
}
