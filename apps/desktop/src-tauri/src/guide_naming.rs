//! Naming is part of the main guide, with bounded, revision-grounded decisions.
use crate::{contracts::*, domain};
use anyhow::{Result, ensure};
use std::collections::HashSet;

fn contains_name(text: &str, name: &str) -> bool {
    let identifier = |c: char| c.is_alphanumeric() || c == '_';
    text.match_indices(name).any(|(start, _)| {
        !text[..start].chars().next_back().is_some_and(identifier)
            && !text[start + name.len()..]
                .chars()
                .next()
                .is_some_and(identifier)
    })
}

pub fn validate(
    snapshot: &Snapshot,
    section_hunks: &[String],
    decisions: &[NamingDecision],
    seen: &mut HashSet<(String, String)>,
) -> Result<()> {
    ensure!(
        decisions.len() <= 4 && seen.len() + decisions.len() <= 12,
        "Naming review exceeded its limit of four decisions per section and twelve per guide"
    );
    for decision in decisions {
        let name = decision.name.trim();
        ensure!(
            !name.is_empty() && name == decision.name && name.chars().count() <= 160,
            "Naming decision must cite a concise, exact source name"
        );
        ensure!(
            !decision.reason.trim().is_empty()
                && decision.reason.chars().count() <= 800
                && !decision.question.trim().is_empty()
                && decision.question.chars().count() <= 400,
            "Naming decision needs a bounded rationale and concrete question"
        );
        let anchor = &decision.anchor;
        domain::validate_anchor(snapshot, anchor)?;
        ensure!(
            anchor.text_selection.is_none()
                && anchor.line.saturating_sub(anchor.start_line) < 20
                && section_hunks.contains(&anchor.hunk_id),
            "Naming decision must anchor inside its section"
        );
        let hunks: Vec<_> = snapshot
            .files
            .iter()
            .flat_map(|f| &f.hunks)
            .filter(|h| section_hunks.contains(&h.id))
            .collect();
        let hunk = hunks.iter().find(|h| h.id == anchor.hunk_id).unwrap();
        ensure!(
            hunk.lines.iter().any(|line| {
                let (number, changed) = match anchor.side {
                    Side::LEFT => (line.old, line.kind == LineKind::Deletion),
                    Side::RIGHT => (line.new, line.kind == LineKind::Addition),
                };
                changed
                    && number.is_some_and(|n| n >= anchor.start_line && n <= anchor.line)
                    && contains_name(&line.text, name)
            }),
            "Naming decision cites a name absent from its anchored changed lines"
        );
        if let Some(previous) = &decision.previous_name {
            ensure!(
                !previous.trim().is_empty()
                    && previous.trim() == previous
                    && previous.chars().count() <= 160
                    && previous != name
                    && hunks
                        .iter()
                        .flat_map(|h| &h.lines)
                        .any(|l| contains_name(&l.text, previous)),
                "Naming rename must cite a distinct former name in supplied section evidence"
            );
        }
        ensure!(
            seen.insert((anchor.path.clone(), name.into())),
            "Naming decision repeats the same name in the same file"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example() -> (Snapshot, NamingDecision) {
        let (mut snapshot, _) = crate::fixtures::sample().unwrap();
        let path = "schema.sql";
        let hunk = domain::parse_patch(path,
            "@@ -1,2 +1,2 @@\n-CREATE TABLE domains (id INT);\n+CREATE TABLE portal_domains (id INT);\n -- retained context", "naming").unwrap().remove(0);
        let decision = NamingDecision {
            name: "portal_domains".into(),
            previous_name: Some("domains".into()),
            kind: NamingKind::Database,
            reason: "This persisted name defines the scope of a domain record.".into(),
            question: "Does portal ownership match the record's actual lifecycle?".into(),
            anchor: Anchor {
                hunk_id: hunk.id.clone(),
                path: path.into(),
                side: Side::RIGHT,
                start_line: 1,
                line: 1,
                text_selection: None,
            },
        };
        snapshot.files = vec![ChangedFile {
            path: path.into(),
            previous_path: None,
            status: "modified".into(),
            additions: 1,
            deletions: 1,
            hunks: vec![hunk],
            unavailable: None,
        }];
        (snapshot, decision)
    }

    #[test]
    fn rejects_invented_names_partial_identifiers_context_and_wrong_sections() {
        let (snapshot, decision) = example();
        let ids = vec![decision.anchor.hunk_id.clone()];
        assert!(
            validate(
                &snapshot,
                &ids,
                std::slice::from_ref(&decision),
                &mut HashSet::new()
            )
            .is_ok()
        );
        for name in ["customers", "portal_domain", "domains"] {
            let mut invalid = decision.clone();
            invalid.name = name.into();
            assert!(validate(&snapshot, &ids, &[invalid], &mut HashSet::new()).is_err());
        }
        let mut invalid = decision.clone();
        invalid.name = "context".into();
        invalid.anchor.start_line = 2;
        invalid.anchor.line = 2;
        assert!(validate(&snapshot, &ids, &[invalid], &mut HashSet::new()).is_err());
        let mut invalid = decision.clone();
        invalid.previous_name = Some("invented_old_name".into());
        assert!(validate(&snapshot, &ids, &[invalid], &mut HashSet::new()).is_err());
        assert!(
            validate(
                &snapshot,
                &[],
                std::slice::from_ref(&decision),
                &mut HashSet::new()
            )
            .is_err()
        );
        assert!(
            validate(
                &snapshot,
                &ids,
                &[decision.clone(), decision],
                &mut HashSet::new()
            )
            .is_err()
        );
    }

    #[test]
    fn naming_survives_storage_without_becoming_a_finding_or_hidden_routine_code() {
        let (snapshot, decision) = example();
        let id = decision.anchor.hunk_id.clone();
        let proposal = domain::Proposal {
            summary: "A new domain vocabulary.".into(),
            limitations: vec![],
            sections: vec![domain::ProposedSection {
                naming_decisions: vec![decision],
                title: "Domain storage".into(),
                summary: "Review the persistent vocabulary.".into(),
                explanation: "The table has a new name.".into(),
                reason: "A durable contract.".into(),
                category: "Schema".into(),
                attention: Attention::Routine,
                hunk_ids: vec![id.clone()],
                questions: vec![],
                findings: vec![],
            }],
        };
        let guide =
            domain::validate_guide(&snapshot, proposal, "test", &HashSet::from([id])).unwrap();
        assert_ne!(guide.sections[0].attention, Attention::Routine);
        assert!(!guide.sections[0].foldable);
        assert!(guide.sections[0].findings.is_empty());
        let dir = tempfile::tempdir().unwrap();
        let service = crate::service::Service::new(dir.path()).unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let retained = service.store.retain_guide(guide).unwrap();
        service
            .select_guide(&snapshot.id, retained.id.as_deref().unwrap())
            .unwrap();
        let restored = crate::service::Service::new(dir.path())
            .unwrap()
            .saved(&snapshot.id)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&restored.guide.sections[0].naming_decisions).unwrap(),
            serde_json::to_value(&retained.sections[0].naming_decisions).unwrap()
        );
        let old: ReviewWorkspace = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/review-workspace.json"
        ))
        .unwrap();
        assert!(
            old.guide
                .sections
                .iter()
                .all(|s| s.naming_decisions.is_empty())
        );
    }

    #[test]
    fn compaction_preserves_every_decision_and_enrichment_receives_its_file_context() {
        let (snapshot, decision) = example();
        let mut guide = domain::provisional(&snapshot);
        let s = &mut guide.sections[0];
        s.assessed = true;
        s.attention = Attention::Standard;
        s.naming_decisions = vec![decision];
        let input = crate::guide_annotations::input(&snapshot, &guide, "schema.sql").unwrap();
        let data: serde_json::Value =
            serde_json::from_str(input.prompt.split_once('\n').unwrap().1).unwrap();
        assert_eq!(
            data["sections"][0]["namingDecisions"][0]["name"],
            "portal_domains"
        );
        let sections = (0..25)
            .map(|i| {
                let mut s = guide.sections[0].clone();
                s.id = format!("section-{i}");
                s.hunk_ids = vec![format!("hunk-{i}")];
                s
            })
            .collect();
        let compacted = crate::guide::compact_sections(sections);
        assert_eq!(compacted.len(), 20);
        assert_eq!(
            compacted
                .iter()
                .map(|s| s.naming_decisions.len())
                .sum::<usize>(),
            25
        );
    }
}
