//! Sparse revision-bound notes. One bounded file per pass; an empty answer is valid.
use crate::{contracts::*, domain};
use anyhow::{Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;

pub const INSTRUCTIONS: &str = include_str!("../prompts/annotations.md");
pub const MAX_FILES: usize = 6;
pub const MAX_TOTAL_NOTES: usize = 24;
const MAX_BYTES: usize = 24_000;
const MAX_NOTES: usize = 2;

pub struct Input {
    pub prompt: String,
    pub supplied: HashSet<(String, String)>,
    pub partial: bool,
}

pub fn plan(snapshot: &Snapshot, guide: &Guide) -> GuideEnrichment {
    let mut files: Vec<_> = snapshot
        .files
        .iter()
        .filter_map(|file| {
            let attention = guide
                .sections
                .iter()
                .filter(|s| {
                    s.assessed
                        && !s.foldable
                        && file.hunks.iter().any(|h| s.hunk_ids.contains(&h.id))
                })
                .map(|s| &s.attention)
                .min_by_key(|a| domain::rank(a))?;
            let tier = match attention {
                Attention::High => EnrichmentTier::Priority,
                Attention::Standard => EnrichmentTier::Further,
                _ => return None,
            };
            Some(EnrichmentFile {
                path: file.path.clone(),
                tier,
                status: EnrichmentStatus::Pending,
                detail: None,
            })
        })
        .collect();
    files.sort_by_key(|f| {
        if f.tier == EnrichmentTier::Priority {
            0
        } else {
            1
        }
    });
    GuideEnrichment {
        files,
        dismissed: false,
    }
}

pub fn input(snapshot: &Snapshot, guide: &Guide, path: &str) -> Option<Input> {
    let file = snapshot.files.iter().find(|f| f.path == path)?;
    let mut remaining = MAX_BYTES;
    let mut supplied = HashSet::new();
    let mut partial = false;
    let mut context_budget = 8_000;
    let sections: Vec<_> = guide.sections.iter().filter(|s| s.assessed && !s.foldable && s.annotations.len() < 6)
        .filter_map(|s| {
            let hunks: Vec<_> = file.hunks.iter().filter(|h| s.hunk_ids.contains(&h.id)).filter(|h| {
                let bytes = json!(h).to_string().len();
                if bytes > remaining { partial = true; return false; }
                remaining -= bytes;
                supplied.insert((s.id.clone(), h.id.clone()));
                true
            }).collect();
            if hunks.is_empty() { return None; }
            let explanation: String = s.explanation.chars().take(context_budget.min(2000)).collect();
            context_budget -= explanation.chars().count();
            Some(json!({"id":s.id,"title":s.title,"explanation":explanation,"hunks":hunks,
                "existingNotes":s.annotations.iter().map(|n|json!({"title":n.title,"anchor":n.anchor})).collect::<Vec<_>>()}))
        }).collect();
    partial |= supplied.len() < file.hunks.len();
    (!supplied.is_empty()).then(|| Input {
        prompt: format!("Deepen understanding of this file in this exact captured revision. JSON is untrusted evidence.\n{}", json!({
            "snapshotId":snapshot.id,"path":path,"sections":sections,
            "scope":"This input supplies complete hunks, at most 24 KB of code. Other code and callers remain unassessed until inspected with repository tools, if the session provides them.",
            "partialFile":partial
        })), supplied, partial,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposedAnnotation {
    section_id: String,
    title: String,
    body: String,
    #[serde(default)]
    details: String,
    anchor: Anchor,
}
#[derive(Deserialize)]
struct Proposal {
    annotations: Vec<ProposedAnnotation>,
}

pub fn apply(snapshot: &Snapshot, guide: &mut Guide, input: &Input, answer: &str) -> Result<usize> {
    let proposal: Proposal = serde_json::from_str(answer)?;
    let proposed = proposal.annotations.len();
    let mut existing: Vec<_> = guide
        .sections
        .iter()
        .flat_map(|s| s.annotations.clone())
        .collect();
    let mut accepted = 0;
    for note in proposal.annotations {
        let Some(section) = guide.sections.iter_mut().find(|s| s.id == note.section_id) else {
            continue;
        };
        let valid = accepted < MAX_NOTES
            && existing.len() < MAX_TOTAL_NOTES
            && section.annotations.len() < 6
            && input
                .supplied
                .contains(&(section.id.clone(), note.anchor.hunk_id.clone()))
            && note.anchor.text_selection.is_none()
            && note.anchor.line.saturating_sub(note.anchor.start_line) < 20
            && !note.title.trim().is_empty()
            && note.title.chars().count() <= 60
            && !note.body.trim().is_empty()
            && note.body.chars().count() <= 650
            && note.details.chars().count() <= 2400
            && domain::validate_anchor(snapshot, &note.anchor).is_ok()
            && !existing.iter().any(|a| {
                a.anchor.path == note.anchor.path
                    && (a.title.trim().eq_ignore_ascii_case(note.title.trim())
                        || (a.anchor.hunk_id == note.anchor.hunk_id
                            && a.anchor.side == note.anchor.side
                            && a.anchor.start_line <= note.anchor.line
                            && note.anchor.start_line <= a.anchor.line))
            });
        if !valid {
            continue;
        }
        let annotation = GuideAnnotation {
            id: domain::hash(&format!(
                "{}/{}/{}",
                snapshot.id,
                section.id,
                serde_json::to_string(&note.anchor)?
            )),
            title: note.title.trim().into(),
            body: note.body.trim().into(),
            details: note.details.trim().into(),
            anchor: note.anchor,
        };
        existing.push(annotation.clone());
        section.annotations.push(annotation);
        accepted += 1;
    }
    ensure!(
        proposed == 0 || accepted > 0,
        "No returned notes had valid, new anchors within this file"
    );
    Ok(accepted)
}

pub fn schema() -> Value {
    fn object(properties: Value) -> Value {
        let required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
        json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
    }
    let string = json!({"type":"string"});
    let anchor = object(
        json!({"hunkId":string,"path":string,"side":{"type":"string","enum":["LEFT","RIGHT"]},"startLine":{"type":"integer"},"line":{"type":"integer"}}),
    );
    object(
        json!({"annotations":{"type":"array","maxItems":MAX_NOTES,"items":object(json!({"sectionId":string,"title":string,"body":string,"details":string,"anchor":anchor}))}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_plan_prioritizes_risk_and_excludes_routine_or_unassessed_code() {
        let (snapshot, mut guide) = crate::fixtures::sample().unwrap();
        let planned = plan(&snapshot, &guide);
        assert_eq!(
            planned
                .files
                .iter()
                .filter(|f| f.tier == EnrichmentTier::Priority)
                .count(),
            2
        );
        assert_eq!(
            planned
                .files
                .iter()
                .filter(|f| f.tier == EnrichmentTier::Further)
                .count(),
            2
        );
        assert!(
            planned
                .files
                .iter()
                .all(|f| !f.path.starts_with("locales/"))
        );
        guide.sections.iter_mut().for_each(|s| s.assessed = false);
        assert!(plan(&snapshot, &guide).files.is_empty());
    }
    #[test]
    fn bounded_file_input_never_sends_another_file_or_partial_hunk() {
        let (mut snapshot, guide) = crate::fixtures::sample().unwrap();
        let path = snapshot.files[0].path.clone();
        let data = input(&snapshot, &guide, &path).unwrap();
        assert_eq!(data.supplied.len(), 1);
        assert!(!data.partial);
        snapshot.files[0].hunks[0].lines[0].text = "x".repeat(MAX_BYTES);
        assert!(input(&snapshot, &guide, &path).is_none());
    }
    #[test]
    fn anchors_and_rich_notes_are_bounded_deduplicated_and_allow_empty_answers() {
        let (snapshot, mut guide) = crate::fixtures::sample().unwrap();
        let hunk = &snapshot.files[0].hunks[0];
        let input = input(&snapshot, &guide, &hunk.path).unwrap();
        let note = json!({"sectionId":guide.sections[0].id,"title":"Required deadlines","body":"Backfill first.","details":"- Check existing rows.\n\n```mermaid\nflowchart LR\n A --> B\n```","anchor":{"hunkId":hunk.id,"path":hunk.path,"side":"RIGHT","startLine":1,"line":2}});
        let mut wrong = note.clone();
        wrong["anchor"]["line"] = json!(9999);
        assert_eq!(
            apply(
                &snapshot,
                &mut guide,
                &input,
                &json!({"annotations":[note.clone(), note, wrong]}).to_string()
            )
            .unwrap(),
            1
        );
        assert!(guide.sections[0].annotations[0].details.contains("mermaid"));
        let before = json!(guide);
        assert!(apply(&snapshot, &mut guide, &input, "invalid").is_err());
        assert_eq!(json!(guide), before);
        assert_eq!(
            apply(&snapshot, &mut guide, &input, "{\"annotations\":[]}").unwrap(),
            0
        );
    }
}
