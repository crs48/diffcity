//! Mutable, resumable enrichment lives beside immutable guide versions.
use crate::{codex, contracts::*, guide_annotations as notes, service::Service, storage::Store};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc, time::Duration};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Addition {
    section_id: String,
    note: GuideAnnotation,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    snapshot_id: String,
    guide_id: String,
    state: GuideEnrichment,
    additions: Vec<Addition>,
}
impl Store {
    fn enrichment_record(&self, guide: &Guide) -> Result<Record> {
        let id = guide.id.as_deref().context("Missing guide ID")?;
        let record: Option<Record> = self.get("guide-enrichment", id)?;
        if let Some(record) = record {
            ensure!(
                record.snapshot_id == guide.snapshot_id && record.guide_id == id,
                "Enrichment belongs to a different guide revision"
            );
            return Ok(record);
        }
        let snapshot: Snapshot = self
            .get("snapshot", &guide.snapshot_id)?
            .context("Missing captured code")?;
        let mut state = notes::plan(&snapshot, guide);
        for file in &mut state.files {
            if guide
                .sections
                .iter()
                .flat_map(|s| &s.annotations)
                .any(|n| n.anchor.path == file.path)
            {
                file.status = EnrichmentStatus::Complete;
                file.detail = Some("This guide already includes code notes for this file.".into());
            }
        }
        Ok(Record {
            snapshot_id: guide.snapshot_id.clone(),
            guide_id: id.into(),
            state,
            additions: vec![],
        })
    }
    pub fn enriched_guide(&self, mut guide: Guide) -> Result<Guide> {
        if guide.id.is_none() || !["codex", "claude"].contains(&guide.source.as_str()) {
            return Ok(guide);
        }
        let record = self.enrichment_record(&guide)?;
        for addition in record.additions {
            if let Some(section) = guide
                .sections
                .iter_mut()
                .find(|s| s.id == addition.section_id)
                && !section.annotations.iter().any(|n| n.id == addition.note.id)
            {
                section.annotations.push(addition.note);
            }
        }
        guide.enrichment = Some(record.state);
        Ok(guide)
    }
}

pub fn remaining(file: &EnrichmentFile) -> bool {
    matches!(
        file.status,
        EnrichmentStatus::Pending | EnrichmentStatus::Interrupted | EnrichmentStatus::Failed
    )
}

impl Service {
    fn enrichment_base(&self, snapshot_id: &str, guide_id: &str) -> Result<Guide> {
        let guide: Guide = self
            .store
            .get("guide-version", guide_id)?
            .context("Saved guide unavailable")?;
        ensure!(
            guide.snapshot_id == snapshot_id,
            "This guide belongs to another PR revision"
        );
        ensure!(
            ["codex", "claude"].contains(&guide.source.as_str()),
            "Generate an AI guide before enriching it"
        );
        Ok(guide)
    }
    pub fn dismiss_enrichment(
        &self,
        snapshot_id: &str,
        guide_id: &str,
        dismissed: bool,
    ) -> Result<Guide> {
        let _guard = self.runs.begin(
            &uuid::Uuid::new_v4().to_string(),
            format!("enrichment/{guide_id}"),
        )?;
        let guide = self.enrichment_base(snapshot_id, guide_id)?;
        let mut record = self.store.enrichment_record(&guide)?;
        record.state.dismissed = dismissed;
        self.store.put("guide-enrichment", guide_id, &record)?;
        self.store.enriched_guide(guide)
    }
    pub async fn enrich_guide(
        &self,
        snapshot_id: &str,
        guide_id: &str,
        tier: EnrichmentTier,
        run_id: &str,
        emit: Arc<dyn Fn(RunEvent) + Send + Sync>,
    ) -> Result<Guide> {
        let base = self.enrichment_base(snapshot_id, guide_id)?;
        let snapshot = self.snapshot(snapshot_id)?;
        let settings = self.store.settings()?;
        // Always use the provider/model that authored this exact guide.
        let preference = ModelPreference {
            provider: base.source.clone(),
            model: base.model.clone(),
            reasoning_effort: base.reasoning_effort.clone(),
        };
        let job = self.runs.begin(run_id, format!("enrichment/{guide_id}"))?;
        let mut rx = job.cancel.clone();
        let report = |phase: &str, text: String, guide: Option<Guide>| {
            emit(RunEvent {
                run_id: run_id.into(),
                snapshot_id: snapshot_id.into(),
                phase: phase.into(),
                text,
                guide,
            })
        };
        report(
            "queued",
            "Waiting for a background enrichment slot…".into(),
            None,
        );
        // Background work occupies at most one of the four global AI slots.
        let _background = tokio::select! {
            biased;
            _ = rx.changed() => return self.store.enriched_guide(base),
            permit = self.enrichment_slot.acquire() => permit?,
        };
        let mut record = self.store.enrichment_record(&base)?;
        ensure!(
            tier != EnrichmentTier::Further
                || !record
                    .state
                    .files
                    .iter()
                    .any(|f| f.tier == EnrichmentTier::Priority && remaining(f)),
            "Finish or stop the priority pass before exploring further"
        );
        record.state.dismissed = false;
        let paths: Vec<_> = record
            .state
            .files
            .iter()
            .filter(|f| f.tier == tier && remaining(f))
            .take(notes::MAX_FILES)
            .map(|f| f.path.clone())
            .collect();
        for (index, path) in paths.iter().enumerate() {
            if *rx.borrow() {
                break;
            }
            let mut guide = self.store.enriched_guide(base.clone())?;
            if guide
                .sections
                .iter()
                .map(|s| s.annotations.len())
                .sum::<usize>()
                >= notes::MAX_TOTAL_NOTES
            {
                for file in record.state.files.iter_mut().filter(|f| remaining(f)) {
                    file.status = EnrichmentStatus::Skipped;
                    file.detail = Some("The guide reached its limit of 24 code notes.".into());
                }
                break;
            }
            let Some(input) = notes::input(&snapshot, &guide, path) else {
                let file = record
                    .state
                    .files
                    .iter_mut()
                    .find(|f| &f.path == path)
                    .unwrap();
                file.status = EnrichmentStatus::Skipped;
                file.detail =
                    Some("No eligible complete hunk remains within the input budget and section note limit.".into());
                self.store.put("guide-enrichment", guide_id, &record)?;
                report(
                    "enriched",
                    format!("Skipped {path}: input or note limit"),
                    Some(self.store.enriched_guide(base.clone())?),
                );
                continue;
            };
            let permit = match job.wait().await {
                Ok(p) => p,
                Err(_) if *rx.borrow() => break,
                Err(e) => return Err(e),
            };
            let file = record
                .state
                .files
                .iter_mut()
                .find(|f| &f.path == path)
                .unwrap();
            // A crash/restart leaves a resumable marker; reopening never starts a model call.
            file.status = EnrichmentStatus::Interrupted;
            file.detail =
                Some("No result saved yet. Resume explicitly to try this file again.".into());
            self.store.put("guide-enrichment", guide_id, &record)?;
            report(
                "enriching",
                format!("Reading {} of {} · {path}", index + 1, paths.len()),
                Some(self.store.enriched_guide(base.clone())?),
            );
            let directory = self.store.directory.join("review-context");
            let result = tokio::time::timeout(
                Duration::from_secs(180),
                crate::providers::turn(
                    &settings,
                    codex::TurnRequest {
                        cwd: &directory,
                        preference: &preference,
                        instructions: notes::INSTRUCTIONS,
                        prompt: &input.prompt,
                        schema: Some(notes::schema()),
                    },
                    rx.clone(),
                    |_, _| {},
                ),
            )
            .await;
            drop(permit);
            if *rx.borrow() {
                break;
            }
            let old_ids: HashSet<_> = guide
                .sections
                .iter()
                .flat_map(|s| &s.annotations)
                .map(|n| n.id.clone())
                .collect();
            let result = result
                .context("This file reached the three-minute enrichment limit")
                .and_then(|result| result)
                .and_then(|(answer, _)| notes::apply(&snapshot, &mut guide, &input, &answer));
            let file = record
                .state
                .files
                .iter_mut()
                .find(|f| &f.path == path)
                .unwrap();
            let failed = result.is_err();
            match result {
                Ok(count) => {
                    file.status = EnrichmentStatus::Complete;
                    file.detail = Some(format!(
                        "{count} new code notes. {}",
                        if input.partial {
                            "Some hunks exceeded the input budget; this is a partial inspection."
                        } else {
                            "Captured diff inspected; surrounding code may be omitted."
                        }
                    ));
                    record.additions.extend(guide.sections.iter().flat_map(|s| {
                        s.annotations
                            .iter()
                            .filter(|n| !old_ids.contains(&n.id))
                            .map(|n| Addition {
                                section_id: s.id.clone(),
                                note: n.clone(),
                            })
                    }));
                }
                Err(error) => {
                    file.status = EnrichmentStatus::Failed;
                    file.detail = Some(format!("{error:#}").chars().take(500).collect());
                }
            }
            self.store.put("guide-enrichment", guide_id, &record)?;
            report(
                "enriched",
                format!("Finished {} of {} · {path}", index + 1, paths.len()),
                Some(self.store.enriched_guide(base.clone())?),
            );
            // A provider failure must not spend the rest of a batch retrying.
            if failed {
                break;
            }
        }
        self.store.put("guide-enrichment", guide_id, &record)?;
        let guide = self.store.enriched_guide(base)?;
        report(
            "complete",
            if *rx.borrow() {
                "Enrichment stopped; completed notes are saved."
            } else {
                "Enrichment batch complete. No further work will start automatically."
            }
            .into(),
            Some(guide.clone()),
        );
        Ok(guide)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlays_persist_without_mutating_saved_guides_or_switching_models() {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        let (snapshot, mut guide) = crate::fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        guide.id = Some("original".into());
        guide.source = "claude".into();
        let guide = service.store.retain_guide(guide).unwrap();
        let hunk = &snapshot.files[0].hunks[0];
        let mut record = service.store.enrichment_record(&guide).unwrap();
        record.state.files[0].status = EnrichmentStatus::Complete;
        record.additions.push(Addition {
            section_id: guide.sections[0].id.clone(),
            note: GuideAnnotation {
                id: "new-note".into(),
                title: "Backfill".into(),
                body: "Check existing data.".into(),
                details: "- Use a populated database.".into(),
                anchor: Anchor {
                    text_selection: None,
                    hunk_id: hunk.id.clone(),
                    path: hunk.path.clone(),
                    side: Side::RIGHT,
                    start_line: 1,
                    line: 1,
                },
            },
        });
        service
            .store
            .put("guide-enrichment", "original", &record)
            .unwrap();
        let shown = service.select_guide(&snapshot.id, "original").unwrap();
        assert_eq!(shown.guide.sections[0].annotations.len(), 1);
        assert_eq!(
            serde_json::to_value(
                service
                    .store
                    .get::<Guide>("guide-version", "original")
                    .unwrap()
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_value(&guide).unwrap()
        );
        let reopened = Service::new(dir.path())
            .unwrap()
            .saved(&snapshot.id)
            .unwrap();
        assert_eq!(reopened.guide.sections[0].annotations.len(), 1);
        assert_eq!(
            reopened.guide.enrichment.unwrap().files[0].status,
            EnrichmentStatus::Complete
        );
        assert!(
            service
                .dismiss_enrichment("wrong-revision", "original", true)
                .is_err()
        );
        assert!(
            service
                .dismiss_enrichment(&snapshot.id, "original", true)
                .unwrap()
                .enrichment
                .unwrap()
                .dismissed
        );
    }
    #[cfg(unix)]
    fn fake_service(
        mode: &str,
    ) -> (
        tempfile::TempDir,
        Arc<Service>,
        Snapshot,
        Guide,
        std::path::PathBuf,
    ) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join(format!("claude-{mode}"));
        std::fs::write(&binary, r#"#!/usr/bin/env python3
import sys,json,pathlib
log=pathlib.Path(__file__).with_suffix('.calls')
init=json.loads(sys.stdin.readline())
print(json.dumps({'type':'control_response','response':{'request_id':'initialize','subtype':'success','response':{'models':[{'value':'claude-fable-5','supportedEffortLevels':['high']}]}}}),flush=True)
user=json.loads(sys.stdin.readline())
data=json.loads(user['message']['content'].split('\n',1)[1])
with log.open('a') as f:f.write(data['path']+'\n')
print(json.dumps({'type':'system','subtype':'init','model':'claude-fable-5','tools':[],'mcp_servers':[]}),flush=True)
s=data['sections'][0];h=s['hunks'][0];line=next(l for l in h['lines'] if l['new'] is not None)
note={'sectionId':s['id'],'title':'Check '+data['path'].split('/')[-1],'body':'Check the captured invariant.','details':'- Verify existing records.\n\n```mermaid\nflowchart LR\n A --> B\n```','anchor':{'hunkId':h['id'],'path':h['path'],'side':'RIGHT','startLine':line['new'],'line':line['new']}}
print(json.dumps({'type':'result','is_error':'failure' in __file__,'subtype':'success','result':'Fixture response','modelUsage':{'claude-fable-5':{}},'structured_output':{'annotations':[] if 'empty' in __file__ else [note]}}),flush=True)
"#).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let service = Arc::new(Service::new(dir.path()).unwrap());
        service
            .store
            .put(
                "settings",
                "main",
                &Settings {
                    claude_path: Some(binary.to_string_lossy().into()),
                    ..Settings::default()
                },
            )
            .unwrap();
        let (snapshot, mut guide) = crate::fixtures::sample().unwrap();
        guide.id = Some("bounded-guide".into());
        guide.source = "claude".into();
        guide.model = "claude-fable-5".into();
        guide.reasoning_effort = Some("high".into());
        (
            dir,
            service,
            snapshot,
            guide,
            binary.with_extension("calls"),
        )
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn batches_stop_at_six_and_standard_files_require_an_explicit_call() {
        let (_dir, service, mut snapshot, mut guide, log) = fake_service("empty");
        for i in 0..6 {
            let mut file = snapshot.files[0].clone();
            file.path = format!("migration-{i}.sql");
            file.hunks[0].path = file.path.clone();
            file.hunks[0].id = format!("copy-{i}");
            guide.sections[0].hunk_ids.push(file.hunks[0].id.clone());
            snapshot.files.push(file);
        }
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service.store.retain_guide(guide.clone()).unwrap();
        let emit = Arc::new(|_: RunEvent| {});
        assert!(
            service
                .enrich_guide(
                    &snapshot.id,
                    "bounded-guide",
                    EnrichmentTier::Further,
                    "early",
                    emit.clone()
                )
                .await
                .is_err()
        );
        let first = service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "first",
                emit.clone(),
            )
            .await
            .unwrap();
        let state = first.enrichment.unwrap();
        assert_eq!(
            state
                .files
                .iter()
                .filter(|f| f.status == EnrichmentStatus::Complete)
                .count(),
            6
        );
        assert!(
            state
                .files
                .iter()
                .filter(|f| f.tier == EnrichmentTier::Further)
                .all(|f| f.status == EnrichmentStatus::Pending)
        );
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 6);
        service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "second",
                emit.clone(),
            )
            .await
            .unwrap();
        service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "repeat",
                emit.clone(),
            )
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 8);
        service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Further,
                "further",
                emit,
            )
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 10);
        assert!(
            service
                .store
                .get::<Guide>("guide-version", "bounded-guide")
                .unwrap()
                .unwrap()
                .enrichment
                .is_none()
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_saves_completed_notes_and_resume_does_not_repeat_files() {
        let (_dir, service, snapshot, guide, log) = fake_service("notes");
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service.store.retain_guide(guide.clone()).unwrap();
        let cancel_service = service.clone();
        let first = service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "cancel",
                Arc::new(move |event| {
                    if event.phase == "enriched" {
                        assert!(
                            event
                                .guide
                                .unwrap()
                                .sections
                                .iter()
                                .any(|s| !s.annotations.is_empty())
                        );
                        cancel_service.runs.cancel("cancel");
                    }
                }),
            )
            .await
            .unwrap();
        assert_eq!(
            first
                .sections
                .iter()
                .map(|s| s.annotations.len())
                .sum::<usize>(),
            1
        );
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
        let resumed = service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "resume",
                Arc::new(|_| {}),
            )
            .await
            .unwrap();
        assert_eq!(
            resumed
                .sections
                .iter()
                .map(|s| s.annotations.len())
                .sum::<usize>(),
            2
        );
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 2);
        assert_eq!(resumed.model, "claude-fable-5");
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn a_provider_failure_stops_the_batch_without_spending_on_other_files() {
        let (_dir, service, snapshot, guide, log) = fake_service("failure");
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        service.store.retain_guide(guide).unwrap();
        let result = service
            .enrich_guide(
                &snapshot.id,
                "bounded-guide",
                EnrichmentTier::Priority,
                "failure",
                Arc::new(|_| {}),
            )
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
        assert_eq!(
            result.enrichment.as_ref().unwrap().files[0].status,
            EnrichmentStatus::Failed
        );
        assert_eq!(
            result.enrichment.as_ref().unwrap().files[1].status,
            EnrichmentStatus::Pending
        );
        assert!(result.sections.iter().all(|s| s.annotations.is_empty()));
    }
}
