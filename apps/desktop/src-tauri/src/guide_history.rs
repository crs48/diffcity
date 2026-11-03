//! Immutable guide runs and an explicitly selected guide per immutable PR revision.
use crate::{contracts::*, service::Service, storage::Store};
use anyhow::{Context, Result, ensure};
use serde_json::to_value;

impl Store {
    /// Upgrade legacy guides in place once; old model output is never discarded.
    pub fn retain_guide(&self, mut guide: Guide) -> Result<Guide> {
        if guide.id.is_none() {
            guide.id = Some(crate::domain::hash(&serde_json::to_string(&guide)?));
        }
        let id = guide.id.as_deref().context("Missing guide ID")?;
        if let Some(old) = self.get::<Guide>("guide-version", id)? {
            ensure!(
                to_value(&old)? == to_value(&guide)?,
                "Saved guides are immutable"
            );
            return Ok(old);
        }
        self.put("guide-version", id, &guide)?;
        Ok(guide)
    }
    pub fn current_guide(&self, fallback: Guide) -> Result<Guide> {
        let guide = self
            .get::<Guide>("guide", &fallback.snapshot_id)?
            .unwrap_or(fallback);
        if guide.id.is_some() {
            return self.enriched_guide(guide);
        }
        let guide = self.retain_guide(guide)?;
        self.put("guide", &guide.snapshot_id, &guide)?;
        self.enriched_guide(guide)
    }
}

impl Service {
    fn stored_guide(&self, id: &str) -> Result<Guide> {
        if let Some(guide) = self.store.get("guide-version", id)? {
            return Ok(guide);
        }
        // Legacy selected guides are migrated lazily, only when actually opened.
        let snapshot_id = id
            .strip_prefix("legacy/")
            .context("This saved guide is unavailable")?;
        let guide = self
            .store
            .get("guide", snapshot_id)?
            .context("This saved guide is unavailable")?;
        let guide = self.store.retain_guide(guide)?;
        self.store.put("guide", snapshot_id, &guide)?;
        Ok(guide)
    }
    fn guide_for_revision(&self, guide: Guide, snapshot: &Snapshot) -> Result<Guide> {
        let guide = self.store.enriched_guide(guide)?;
        if guide.snapshot_id == snapshot.id {
            return Ok(guide);
        }
        let original = self.snapshot(&guide.snapshot_id)?;
        Ok(crate::guide_carry::carry(guide, &original, snapshot))
    }
    pub(crate) fn review_guide(&self, snapshot: &Snapshot) -> Result<Guide> {
        let current = self
            .store
            .current_guide(crate::domain::provisional(snapshot))?;
        if let Some(id) = self.store.get::<String>("guide-selection", &snapshot.id)? {
            return self.guide_for_revision(self.stored_guide(&id)?, snapshot);
        }
        if current.source != "provisional" {
            return Ok(current);
        }
        // Completed runs are durable even when the app closed before their toast
        // was clicked. Prefer a run for this revision, then the newest older run.
        let versions = self.store.guide_history(snapshot)?;
        if let Some(version) = versions
            .iter()
            .find(|v| ["codex", "claude"].contains(&v.source.as_str()))
        {
            return self.guide_for_revision(self.stored_guide(&version.id)?, snapshot);
        }
        Ok(current)
    }
    pub fn guide_versions(&self, snapshot_id: &str) -> Result<Vec<GuideVersion>> {
        let workspace = self.saved(snapshot_id)?; // Migrate the selected legacy guide.
        self.store.guide_history(&workspace.snapshot)
    }
    pub fn select_guide(&self, snapshot_id: &str, guide_id: &str) -> Result<ReviewWorkspace> {
        let mut workspace = self.saved(snapshot_id)?;
        // The history query scopes cross-revision selections to this PR, and
        // keeps Full PR and Since your last review guides separate.
        ensure!(
            self.store
                .guide_history(&workspace.snapshot)?
                .iter()
                .any(|v| v.id == guide_id),
            "This guide belongs to another PR or review scope"
        );
        let guide = self.stored_guide(guide_id)?;
        let selected_id = guide.id.as_deref().context("Missing guide ID")?;
        let old_id = workspace
            .guide
            .id
            .as_deref()
            .context("Missing current guide ID")?;
        let view_key = format!("{snapshot_id}/{selected_id}");
        let old_view_key = format!("{snapshot_id}/{old_id}");
        let view: ReviewProgress = self
            .store
            .get("guide-view", &view_key)?
            .or(if guide.snapshot_id == snapshot_id {
                self.store.get("guide-view", selected_id)?
            } else {
                None
            })
            .unwrap_or_default();
        let mut progress = workspace.progress.clone();
        // All hunk decisions are shared. Only guide-specific navigation/folding changes.
        if old_id != selected_id {
            progress.active_section = view.active_section;
            progress.expanded = view.expanded;
            progress.collapsed = view.collapsed;
        }
        self.store.batch(&[
            ("guide-view", &old_view_key, to_value(&workspace.progress)?),
            ("guide-selection", snapshot_id, to_value(selected_id)?),
            ("progress", snapshot_id, to_value(&progress)?),
        ])?;
        workspace.guide = self.guide_for_revision(guide, &workspace.snapshot)?;
        workspace.progress = progress;
        Ok(crate::guide::compact_workspace(workspace))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    #[test]
    fn inbox_inventory_keeps_revisions_and_providers_without_loading_guide_bodies() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (snapshot, mut legacy) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        legacy.source = "codex".into();
        legacy.model = "gpt-6-astra".into();
        legacy.reasoning_effort = Some("xhigh".into());
        legacy.generated_at = "2026-10-23T09:00:00Z".into();
        service.store.put("guide", &snapshot.id, &legacy).unwrap();
        service.store.retain_guide(legacy.clone()).unwrap();
        let mut claude = legacy.clone();
        claude.id = Some("claude-new".into());
        claude.source = "claude".into();
        claude.model = "claude-fable-5".into();
        claude.reasoning_effort = Some("high".into());
        claude.generated_at = "2026-10-23T09:05:00Z".into();
        service.store.retain_guide(claude).unwrap();
        let mut old = snapshot.clone();
        old.id = "old-snapshot".into();
        old.pull.head = "old-head".into();
        service.store.put("snapshot", &old.id, &old).unwrap();
        legacy.snapshot_id = old.id;
        legacy.id = Some("codex-old-revision".into());
        service.store.retain_guide(legacy).unwrap();
        drop(service);
        let restarted = Service::new(root.path()).unwrap();
        let inventory = restarted.store.pull_guides().unwrap();
        assert_eq!(
            inventory.len(),
            3,
            "Selected/version duplicates are collapsed; revisions and providers are retained"
        );
        assert_eq!(inventory[0].preference.provider, "claude");
        assert_eq!(
            inventory[0].preference.reasoning_effort.as_deref(),
            Some("high")
        );
        assert_eq!(inventory[0].base, snapshot.pull.base);
        assert!(inventory.iter().any(|g| g.head == "old-head"));
        let serialized = serde_json::to_value(inventory).unwrap();
        assert!(serialized[0].get("sections").is_none());
        assert!(serialized[0].get("summary").is_none());
    }

    #[test]
    fn legacy_runs_coexist_and_switch_without_losing_notes_or_hunk_decisions() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (snapshot, legacy) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service.store.put("guide", &snapshot.id, &legacy).unwrap();
        let original = service.saved(&snapshot.id).unwrap().guide;
        assert!(original.id.is_some());
        assert_eq!(service.guide_versions(&snapshot.id).unwrap().len(), 1);
        let mut other = original.clone();
        other.id = Some("claude-run".into());
        other.source = "claude".into();
        other.model = "claude-fable-5".into();
        other.summary = "A second perspective".into();
        service.store.retain_guide(other.clone()).unwrap();
        assert_eq!(
            service.saved(&snapshot.id).unwrap().guide.summary,
            original.summary
        );
        let note = service
            .save_note(Note {
                thread_title: None,
                model: None,
                id: String::new(),
                snapshot_id: snapshot.id.clone(),
                anchor: None,
                body: "Keep this discussion".into(),
                role: "user".into(),
                parent_id: None,
                github_draft: false,
                published_url: None,
                created_at: String::new(),
            })
            .unwrap();
        let progress = ReviewProgress {
            reviewed: vec![snapshot.files[0].hunks[0].id.clone()],
            acknowledged: vec![snapshot.files[1].hunks[0].id.clone()],
            deferred: vec![snapshot.files[2].hunks[0].id.clone()],
            active_section: Some(original.sections[0].id.clone()),
            expanded: vec![original.sections[0].id.clone()],
            collapsed: vec![original.sections[1].id.clone()],
        };
        service.progress(&snapshot.id, progress.clone()).unwrap();
        let selected = service.select_guide(&snapshot.id, "claude-run").unwrap();
        assert_eq!(selected.progress.reviewed, progress.reviewed);
        assert_eq!(selected.progress.acknowledged, progress.acknowledged);
        assert_eq!(selected.progress.deferred, progress.deferred);
        assert_eq!(selected.progress.active_section, None);
        assert!(selected.progress.collapsed.is_empty());
        assert_eq!(selected.notes[0].id, note.id);
        drop(service);
        let restarted = Service::new(root.path()).unwrap();
        assert_eq!(
            restarted.saved(&snapshot.id).unwrap().guide.model,
            "claude-fable-5"
        );
        let restored = restarted
            .select_guide(&snapshot.id, original.id.as_deref().unwrap())
            .unwrap();
        assert_eq!(restored.progress.active_section, progress.active_section);
        assert_eq!(restored.progress.expanded, progress.expanded);
        assert_eq!(restored.progress.collapsed, progress.collapsed);
        assert_eq!(restarted.guide_versions(&snapshot.id).unwrap().len(), 2);
        other.summary = "Do not overwrite a saved run".into();
        assert!(restarted.store.retain_guide(other).is_err());
        assert!(restarted.select_guide(&snapshot.id, "missing").is_err());
        assert_eq!(restarted.saved(&snapshot.id).unwrap().guide.id, original.id);
    }

    #[test]
    fn guide_switch_rejects_another_revision_and_preserves_defaults() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (snapshot, mut guide) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        guide.snapshot_id = "another-revision".into();
        guide.id = Some("another-guide".into());
        service.store.retain_guide(guide).unwrap();
        assert!(service.select_guide(&snapshot.id, "another-guide").is_err());
        assert_eq!(service.guide_versions(&snapshot.id).unwrap().len(), 1);
        assert_eq!(
            service.store.model_preference().unwrap(),
            ModelPreference::default()
        );
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use crate::{domain, fixtures};

    #[tokio::test]
    async fn completed_guides_survive_restart_and_multiple_new_revisions_until_replaced() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (mut first, mut guide) = fixtures::sample().unwrap();
        first.pull.repository = "owner/repo".into();
        first.captured_at = "2026-10-01T00:00:00Z".into();
        service.store.put("snapshot", &first.id, &first).unwrap();
        assert_eq!(
            service.saved(&first.id).unwrap().guide.source,
            "provisional"
        );
        guide.id = Some("completed-before-restart".into());
        guide.source = "claude".into();
        guide.model = "claude-fable-5".into();
        service.store.retain_guide(guide.clone()).unwrap();
        // No select_guide call: this is the guide-ready toast/restart failure.
        drop(service);
        let service = Service::new(root.path()).unwrap();
        assert_eq!(service.saved(&first.id).unwrap().guide.id, guide.id);
        let mut middle = first.clone();
        middle.id = "prefetched-middle".into();
        middle.pull.head = "middle-head".into();
        middle.captured_at = "2026-10-02T00:00:00Z".into();
        let mut latest = middle.clone();
        latest.id = "latest".into();
        latest.pull.head = "latest-head".into();
        latest.captured_at = "2026-10-03T00:00:00Z".into();
        latest.files[0].hunks[0].lines[0].text.push_str(" changed");
        for snapshot in [&middle, &latest] {
            service
                .store
                .put("snapshot", &snapshot.id, snapshot)
                .unwrap();
            service.saved(&snapshot.id).unwrap(); // Prefetch must not freeze a provisional guide.
        }
        let progress = ReviewProgress {
            reviewed: vec![first.files[1].hunks[0].id.clone()],
            ..Default::default()
        };
        service.progress(&first.id, progress.clone()).unwrap();
        service
            .store
            .put("latest", &domain::pull_key(&latest.pull), &latest.id)
            .unwrap();
        drop(service);
        let service = Service::new(root.path()).unwrap();
        let opened = service
            .open("owner/repo", first.pull.number, false)
            .await
            .unwrap();
        assert_eq!(opened.guide.id, guide.id);
        assert_eq!(opened.snapshot.id, latest.id);
        assert_eq!(
            opened.guide.previous_revision.as_ref().unwrap().snapshot_id,
            first.id
        );
        assert!(
            !opened
                .guide
                .previous_revision
                .as_ref()
                .unwrap()
                .outdated_sections
                .is_empty()
        );
        assert_eq!(opened.progress.reviewed, progress.reviewed);
        let history = service.guide_versions(&latest.id).unwrap();
        assert!(
            history
                .iter()
                .any(|v| Some(&v.id) == guide.id.as_ref() && v.snapshot_id == first.id)
        );
        let mut replacement = domain::provisional(&latest);
        replacement.id = Some("replacement".into());
        replacement.source = "codex".into();
        replacement.generated_at = "2026-10-03T01:00:00Z".into();
        service.store.retain_guide(replacement.clone()).unwrap();
        drop(service);
        let service = Service::new(root.path()).unwrap();
        let reopened = service.saved(&latest.id).unwrap();
        assert_eq!(reopened.guide.id, replacement.id);
        assert!(reopened.guide.previous_revision.is_none());
        // Older models remain selectable against current code, with their origin clear.
        let selected = service
            .select_guide(&latest.id, guide.id.as_deref().unwrap())
            .unwrap();
        assert!(selected.guide.previous_revision.is_some());
        assert_eq!(selected.progress.reviewed, progress.reviewed);
        drop(service);
        let service = Service::new(root.path()).unwrap();
        assert_eq!(service.saved(&latest.id).unwrap().guide.id, guide.id);
        let original = service
            .select_guide(&first.id, guide.id.as_deref().unwrap())
            .unwrap();
        assert!(original.guide.previous_revision.is_none());
        assert_eq!(original.guide.summary, guide.summary);
        assert_eq!(
            original.guide.sections[0].hunk_ids,
            guide.sections[0].hunk_ids
        );
    }

    #[test]
    fn history_and_selection_do_not_cross_prs_or_full_and_incremental_scopes() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let (snapshot, mut guide) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        guide.id = Some("foreign-guide".into());
        guide.source = "claude".into();
        let mut other = snapshot.clone();
        other.id = "other-pr".into();
        other.pull.number += 1;
        service.store.put("snapshot", &other.id, &other).unwrap();
        guide.snapshot_id = other.id;
        service.store.retain_guide(guide.clone()).unwrap();
        assert!(service.select_guide(&snapshot.id, "foreign-guide").is_err());
        let mut comparison = snapshot.clone();
        comparison.id = "incremental".into();
        service
            .store
            .put("comparison-snapshot", &comparison.id, &comparison)
            .unwrap();
        guide.id = Some("incremental-guide".into());
        guide.snapshot_id = comparison.id.clone();
        service.store.retain_guide(guide).unwrap();
        assert!(
            service
                .select_guide(&snapshot.id, "incremental-guide")
                .is_err()
        );
        assert!(
            service
                .guide_versions(&snapshot.id)
                .unwrap()
                .iter()
                .all(|g| g.snapshot_id == snapshot.id)
        );
        assert!(
            service
                .guide_versions(&comparison.id)
                .unwrap()
                .iter()
                .all(|g| g.snapshot_id == comparison.id)
        );
    }
}
