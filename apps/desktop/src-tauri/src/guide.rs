//! Coarse guide chapters with complete, revision-bound coverage.
use crate::{
    contracts::*,
    domain::{hash, rank, rule},
};
use std::collections::HashSet;

pub const MAX_SECTIONS: usize = 20;

pub fn provisional_sections(snapshot: &Snapshot, excluded: &HashSet<String>) -> Vec<GuideSection> {
    let mut sections: Vec<GuideSection> = vec![];
    for file in &snapshot.files {
        for hunk in file.hunks.iter().filter(|h| !excluded.contains(&h.id)) {
            let (attention, category, reason) = rule(hunk);
            let category = if category == "Tests" {
                "Implementation".into()
            } else {
                category
            };
            if let Some(section) = sections
                .iter_mut()
                .find(|s| s.attention == attention && s.category == category)
            {
                section.hunk_ids.push(hunk.id.clone());
            } else {
                let title = match category.as_str() {
                    "Database migration" => "Database changes and migrations",
                    "Authorization" => "Access and tenant boundaries",
                    "Localization contract" => "Translation contracts and callers",
                    "API contract" => "API compatibility",
                    "Implementation" => "Behavior and tests",
                    "Dependencies" => "Dependencies and build configuration",
                    "Localization" => "Translated copy",
                    "Documentation" => "Documentation and supporting context",
                    _ => &category,
                }
                .to_string();
                sections.push(GuideSection {
                    id: String::new(), title, summary: "Review these related changes together. Run Codex for an explanation grounded in the code.".into(),
                    explanation: String::new(), attention, category, reason, hunk_ids: vec![hunk.id.clone()], unavailable_paths: vec![],
                    questions: vec![], findings: vec![], assessed: false, foldable: false,
                });
            }
        }
        if file.unavailable.is_some() {
            if let Some(section) = sections
                .iter_mut()
                .find(|s| s.category == "Unavailable content")
            {
                section.unavailable_paths.push(file.path.clone());
            } else {
                sections.push(GuideSection {
                    id: String::new(), title: "Changes that need additional context".into(),
                    summary: "These files could not be captured as text. Inspect their limitations before finishing the review.".into(),
                    explanation: String::new(),
                    attention: Attention::NeedsAssessment, category: "Unavailable content".into(),
                    reason: "This content has not been assessed.".into(), hunk_ids: vec![], unavailable_paths: vec![file.path.clone()],
                    questions: vec![], findings: vec![], assessed: false, foldable: false,
                });
            }
        }
    }
    for section in &mut sections {
        section.id = section_id(section);
    }
    sections.sort_by_key(|s| rank(&s.attention));
    sections
}
fn section_id(section: &GuideSection) -> String {
    hash(&format!(
        "chapter/{}/{}",
        section.hunk_ids.join("/"),
        section.unavailable_paths.join("/")
    ))
}
fn joined(first: &str, second: &str) -> String {
    if first == second {
        first.into()
    } else {
        format!("{first}\n\n{second}")
    }
}

/// Also adapts older saved guides. Never merge across attention/assessment/folding boundaries.
/// Explanations and findings remain complete in the document, not truncated.
pub fn compact_sections(mut sections: Vec<GuideSection>) -> Vec<GuideSection> {
    sections.sort_by_key(|s| rank(&s.attention));
    while sections.len() > MAX_SECTIONS {
        let pair = (0..sections.len())
            .flat_map(|a| ((a + 1)..sections.len()).map(move |b| (a, b)))
            .filter(|&(a, b)| {
                sections[a].attention == sections[b].attention
                    && sections[a].assessed == sections[b].assessed
                    && sections[a].foldable == sections[b].foldable
            })
            .min_by_key(|&(a, b)| {
                (
                    sections[a].category != sections[b].category,
                    sections[a].hunk_ids.len()
                        + sections[b].hunk_ids.len()
                        + sections[a].unavailable_paths.len()
                        + sections[b].unavailable_paths.len(),
                    b - a,
                )
            });
        let Some((a, b)) = pair else {
            break;
        };
        let later = sections.remove(b);
        let earlier = &mut sections[a];
        if !earlier.explanation.is_empty() || !later.explanation.is_empty() {
            earlier.explanation = joined(
                if earlier.explanation.is_empty() {
                    &earlier.summary
                } else {
                    &earlier.explanation
                },
                if later.explanation.is_empty() {
                    &later.summary
                } else {
                    &later.explanation
                },
            );
        }
        earlier.summary = format!(
            "{}\n{}\n\n{}\n{}",
            earlier.title, earlier.summary, later.title, later.summary
        );
        earlier.title = format!(
            "{} and related changes",
            earlier.title.trim_end_matches(" and related changes")
        );
        earlier.reason = joined(&earlier.reason, &later.reason);
        earlier.category = joined(&earlier.category, &later.category);
        earlier.hunk_ids.extend(later.hunk_ids);
        earlier.unavailable_paths.extend(later.unavailable_paths);
        earlier.questions.extend(later.questions);
        earlier.findings.extend(later.findings);
        earlier.id = section_id(earlier);
    }
    sections
}

pub fn compact_workspace(mut w: ReviewWorkspace) -> ReviewWorkspace {
    let old = w.guide.sections.clone();
    w.guide.sections = compact_sections(w.guide.sections);
    let replacement = |id: &str| {
        let old = old.iter().find(|s| s.id == id);
        w.guide
            .sections
            .iter()
            .find(|s| {
                s.id == id
                    || s.hunk_ids.iter().any(|h| h == id)
                    || old.is_some_and(|old| {
                        s.hunk_ids.iter().any(|h| old.hunk_ids.contains(h))
                            || s.unavailable_paths
                                .iter()
                                .any(|p| old.unavailable_paths.contains(p))
                    })
            })
            .map(|s| s.id.clone())
    };
    w.progress.active_section = w.progress.active_section.as_deref().and_then(replacement);
    w.progress.expanded = w
        .progress
        .expanded
        .iter()
        .filter_map(|id| replacement(id))
        .collect();
    w
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{domain, fixtures};

    #[test]
    fn provisional_groups_many_hunks_and_keeps_partial_coverage_exact() {
        let (mut snapshot, _) = fixtures::sample().unwrap();
        let original = snapshot.files[2].hunks[0].clone();
        snapshot.files[2].hunks = (0..80)
            .map(|n| Hunk {
                id: format!("implementation-{n}"),
                ..original.clone()
            })
            .collect();
        let excluded = HashSet::from(["implementation-0".into(), "implementation-20".into()]);
        let sections = provisional_sections(&snapshot, &excluded);
        assert!(sections.len() < 10);
        assert_eq!(sections[0].attention, Attention::High);
        let all: Vec<_> = sections.iter().flat_map(|s| &s.hunk_ids).collect();
        assert_eq!(all.len(), 84);
        assert_eq!(all.iter().copied().collect::<HashSet<_>>().len(), all.len());
        assert!(!all.iter().any(|id| excluded.contains(*id)));
        assert!(sections.iter().all(|s| !s.assessed && !s.foldable));
        let proposal = domain::Proposal {
            summary: "Partially assessed".into(),
            limitations: vec![],
            sections: vec![domain::ProposedSection {
                title: "Reviewed behavior".into(),
                summary: "Only the first hunk was supplied.".into(),
                explanation: "This behavior is supported by the first captured hunk.".into(),
                reason: "One captured change".into(),
                category: "Behavior".into(),
                attention: Attention::Standard,
                hunk_ids: vec!["implementation-0".into()],
                questions: vec![],
                findings: vec![],
            }],
        };
        let guide = domain::validate_guide(
            &snapshot,
            proposal,
            "fixture",
            &HashSet::from(["implementation-0".into()]),
        )
        .unwrap();
        assert_eq!(guide.sections.iter().flat_map(|s| &s.hunk_ids).count(), 86);
        assert_eq!(
            guide
                .sections
                .iter()
                .filter(|s| !s.assessed)
                .flat_map(|s| &s.hunk_ids)
                .count(),
            85
        );
    }

    #[test]
    fn older_guides_compact_without_losing_findings_attention_or_progress() {
        let (snapshot, mut guide) = fixtures::sample().unwrap();
        let template = guide.sections[0].clone();
        guide.sections = (0..55)
            .map(|n| GuideSection {
                id: format!("section-{n}"),
                hunk_ids: vec![format!("hunk-{n}")],
                title: format!("Behavior {n}"),
                summary: format!("Explanation {n}"),
                explanation: format!("Detailed walkthrough {n}"),
                questions: vec![format!("Question {n}")],
                findings: vec![Finding {
                    title: format!("Finding {n}"),
                    body: format!("Evidence {n}"),
                    severity: "P2".into(),
                    anchor: Anchor {
                        hunk_id: format!("hunk-{n}"),
                        path: "test.ts".into(),
                        side: Side::RIGHT,
                        start_line: 1,
                        line: 1,
                    },
                }],
                attention: if n < 5 {
                    Attention::High
                } else {
                    Attention::Standard
                },
                ..template.clone()
            })
            .collect();
        let first = guide.sections[0].id.clone();
        let before = guide.sections.clone();
        let w = compact_workspace(ReviewWorkspace {
            snapshot,
            guide,
            progress: ReviewProgress {
                active_section: Some(first.clone()),
                expanded: vec![first],
                reviewed: vec!["hunk-0".into()],
                ..Default::default()
            },
            notes: vec![],
            comments: vec![],
            checks: String::new(),
            previous_snapshot_id: None,
            changed_hunks: vec![],
            sync_error: None,
        });
        assert_eq!(w.guide.sections.len(), 20);
        assert_eq!(
            w.guide.sections.iter().flat_map(|s| &s.hunk_ids).count(),
            55
        );
        assert_eq!(
            w.guide
                .sections
                .iter()
                .map(|s| s.findings.len())
                .sum::<usize>(),
            before.iter().map(|s| s.findings.len()).sum::<usize>()
        );
        let active = w
            .guide
            .sections
            .iter()
            .find(|s| Some(&s.id) == w.progress.active_section.as_ref())
            .unwrap();
        assert!(active.hunk_ids.contains(&"hunk-0".into()));
        assert_eq!(active.attention, Attention::High);
        assert!(w.progress.expanded.contains(&active.id));
        assert_eq!(w.progress.reviewed, vec!["hunk-0"]);
        for old in before {
            let now = w
                .guide
                .sections
                .iter()
                .find(|s| s.hunk_ids.contains(&old.hunk_ids[0]))
                .unwrap();
            assert_eq!(now.attention, old.attention);
            assert!(now.summary.contains(&old.summary));
            assert!(now.explanation.contains(&old.explanation));
            assert!(now.questions.contains(&old.questions[0]));
            let finding = now
                .findings
                .iter()
                .find(|f| f.title == old.findings[0].title)
                .unwrap();
            assert_eq!(finding.body, old.findings[0].body);
            assert_eq!(finding.anchor, old.findings[0].anchor);
        }
    }
}
