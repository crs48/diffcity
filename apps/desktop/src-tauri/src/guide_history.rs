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
    pub fn guide_versions(&self, snapshot_id: &str) -> Result<Vec<GuideVersion>> {
        self.saved(snapshot_id)?; // Also migrates a legacy guide before listing.
        Ok(self
            .store
            .snapshot_documents::<Guide>("guide-version", snapshot_id)?
            .into_iter()
            .filter_map(|guide| {
                Some(GuideVersion {
                    id: guide.id?,
                    source: guide.source,
                    model: guide.model,
                    reasoning_effort: guide.reasoning_effort,
                    generated_at: guide.generated_at,
                    section_count: guide.sections.len(),
                })
            })
            .collect())
    }
    pub fn select_guide(&self, snapshot_id: &str, guide_id: &str) -> Result<ReviewWorkspace> {
        let mut workspace = self.saved(snapshot_id)?;
        let guide: Guide = self
            .store
            .get("guide-version", guide_id)?
            .context("This saved guide is unavailable")?;
        ensure!(
            guide.snapshot_id == snapshot_id,
            "This guide belongs to another PR revision"
        );
        let old_id = workspace
            .guide
            .id
            .as_deref()
            .context("Missing current guide ID")?;
        if old_id == guide_id {
            return Ok(workspace);
        }
        let view: ReviewProgress = self.store.get("guide-view", guide_id)?.unwrap_or_default();
        let mut progress = workspace.progress.clone();
        // All hunk decisions are shared. Only guide-specific navigation/folding changes.
        progress.active_section = view.active_section;
        progress.expanded = view.expanded;
        self.store.batch(&[
            ("guide-view", old_id, to_value(&workspace.progress)?),
            ("guide", snapshot_id, to_value(&guide)?),
            ("progress", snapshot_id, to_value(&progress)?),
        ])?;
        workspace.guide = self.store.enriched_guide(guide)?;
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
        };
        service.progress(&snapshot.id, progress.clone()).unwrap();
        let selected = service.select_guide(&snapshot.id, "claude-run").unwrap();
        assert_eq!(selected.progress.reviewed, progress.reviewed);
        assert_eq!(selected.progress.acknowledged, progress.acknowledged);
        assert_eq!(selected.progress.deferred, progress.deferred);
        assert_eq!(selected.progress.active_section, None);
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
