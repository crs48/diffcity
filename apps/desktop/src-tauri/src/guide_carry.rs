//! Carry prose forward without attaching old explanations to different code.
//! Only uniquely identical hunks (including context) keep their line annotations.
use crate::{contracts::*, domain, guide};
use std::collections::{HashMap, HashSet};

fn by_fingerprint(snapshot: &Snapshot) -> HashMap<(&str, &str), Vec<&Hunk>> {
    snapshot
        .files
        .iter()
        .flat_map(|f| &f.hunks)
        .fold(HashMap::new(), |mut groups, hunk| {
            groups
                .entry((hunk.path.as_str(), hunk.fingerprint.as_str()))
                .or_default()
                .push(hunk);
            groups
        })
}

pub(crate) fn carry(mut saved: Guide, old: &Snapshot, new: &Snapshot) -> Guide {
    let old_hunks: HashMap<_, _> = old
        .files
        .iter()
        .flat_map(|f| &f.hunks)
        .map(|h| (h.id.as_str(), h))
        .collect();
    let old_groups = by_fingerprint(old);
    let new_groups = by_fingerprint(new);
    let matching = |a: &Hunk, b: &Hunk| {
        a.path == b.path
            && a.fingerprint == b.fingerprint
            && a.lines.len() == b.lines.len()
            && a.lines
                .iter()
                .zip(&b.lines)
                .all(|(a, b)| a.kind == b.kind && a.text == b.text)
    };
    let mapped: HashMap<_, _> = old_groups
        .iter()
        .filter_map(|(key, old)| {
            let new = new_groups.get(key)?;
            (old.len() == 1 && new.len() == 1 && matching(old[0], new[0]))
                .then(|| (old[0].id.as_str(), (old[0], new[0])))
        })
        .collect();
    let changed_files: HashSet<_> = old
        .files
        .iter()
        .filter(|file| {
            !new.files.iter().any(|next| {
                file.path == next.path
                    && file.previous_path == next.previous_path
                    && file.status == next.status
                    && file.unavailable.is_none()
                    && next.unavailable.is_none()
                    && file.hunks.len() == next.hunks.len()
                    && file
                        .hunks
                        .iter()
                        .all(|h| mapped.contains_key(h.id.as_str()))
            })
        })
        .map(|f| f.path.as_str())
        .collect();
    let relocate = |anchor: &Anchor| -> Option<Anchor> {
        if anchor.text_selection.is_some() {
            return None;
        }
        let (before, after) = mapped.get(anchor.hunk_id.as_str())?;
        if before.path != anchor.path {
            return None;
        }
        let line = |row: &DiffLine| match anchor.side {
            Side::LEFT => row.old,
            Side::RIGHT => row.new,
        };
        let move_line = |number| {
            before
                .lines
                .iter()
                .position(|row| line(row) == Some(number))
                .and_then(|index| line(&after.lines[index]))
        };
        let next = Anchor {
            hunk_id: after.id.clone(),
            start_line: move_line(anchor.start_line)?,
            line: move_line(anchor.line)?,
            ..anchor.clone()
        };
        domain::validate_anchor(new, &next).ok()?;
        Some(next)
    };
    let mut outdated = vec![];
    let mut covered = HashSet::new();
    saved.sections = guide::compact_sections(saved.sections)
        .into_iter()
        .map(|mut section| {
            let changed = section.hunk_ids.iter().any(|id| {
                !mapped.contains_key(id.as_str())
                    || old_hunks
                        .get(id.as_str())
                        .is_some_and(|h| changed_files.contains(h.path.as_str()))
            }) || !section.unavailable_paths.is_empty();
            if changed {
                outdated.push(section.id.clone());
                section.foldable = false;
            }
            section.hunk_ids = section
                .hunk_ids
                .iter()
                .filter_map(|id| mapped.get(id.as_str()))
                .map(|(_, h)| h.id.clone())
                .filter(|id| covered.insert(id.clone()))
                .collect();
            section.annotations = section
                .annotations
                .into_iter()
                .filter_map(|mut note| {
                    note.anchor = relocate(&note.anchor)?;
                    Some(note)
                })
                .collect();
            section.findings = section
                .findings
                .into_iter()
                .filter_map(|mut finding| {
                    finding.anchor = relocate(&finding.anchor)?;
                    Some(finding)
                })
                .collect();
            section.naming_decisions = section
                .naming_decisions
                .into_iter()
                .filter_map(|mut name| {
                    name.anchor = relocate(&name.anchor)?;
                    Some(name)
                })
                .collect();
            // Unavailable/removed files stay in the original guide. Current unavailable
            // files get a fresh, unassessed section below rather than a stale assessment.
            section.unavailable_paths.clear();
            section
        })
        .collect();
    let additions = guide::provisional_sections(new, &covered).into_iter().map(|mut section| {
        section.title = format!("Updated code · {}", section.title);
        section.summary = "These changes are not covered by the saved guide. Generate a new guide to assess them.".into();
        section
    }).collect::<Vec<_>>();
    saved.previous_revision = Some(GuideRevision {
        snapshot_id: old.id.clone(),
        head: old.pull.head.clone(),
        outdated_sections: outdated,
        unassessed_hunks: additions.iter().map(|s| s.hunk_ids.len()).sum(),
    });
    saved.sections.extend(additions);
    saved.snapshot_id = new.id.clone();
    // Enrichment belongs to the original revision. A new guide can enrich new code.
    saved.enrichment = None;
    saved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    fn revisions() -> (Snapshot, Snapshot, Guide) {
        let (old, mut guide) = fixtures::sample().unwrap();
        guide.source = "claude".into();
        guide.id = Some("original-guide".into());
        let mut new = old.clone();
        new.id = "updated-revision".into();
        new.pull.head = "updated-head".into();
        for hunk in new.files.iter_mut().flat_map(|f| &mut f.hunks) {
            hunk.id = format!("new-{}", hunk.id);
            for line in &mut hunk.lines {
                line.old = line.old.map(|n| n + 10);
                line.new = line.new.map(|n| n + 20);
            }
        }
        (old, new, guide)
    }
    fn annotate(guide: &mut Guide, old: &Snapshot) {
        for section in &mut guide.sections {
            if let Some(hunk) = old
                .files
                .iter()
                .flat_map(|f| &f.hunks)
                .find(|h| section.hunk_ids.contains(&h.id))
            {
                let line = hunk.lines.iter().find_map(|l| l.new).unwrap();
                section.annotations.push(GuideAnnotation {
                    id: format!("note-{}", section.id),
                    title: "Saved code note".into(),
                    body: "Keep this explanation".into(),
                    details: "Deeper explanation".into(),
                    anchor: Anchor {
                        hunk_id: hunk.id.clone(),
                        path: hunk.path.clone(),
                        side: Side::RIGHT,
                        start_line: line,
                        line,
                        text_selection: None,
                    },
                });
            }
        }
    }
    #[test]
    fn identical_code_moves_annotations_to_current_lines_without_changing_original() {
        let (old, new, mut guide) = revisions();
        annotate(&mut guide, &old);
        let original = serde_json::to_value(&guide).unwrap();
        let carried = carry(guide.clone(), &old, &new);
        let previous = carried.previous_revision.as_ref().unwrap();
        assert_eq!(previous.snapshot_id, old.id);
        assert_eq!(carried.snapshot_id, new.id);
        assert!(previous.outdated_sections.is_empty());
        assert_eq!(previous.unassessed_hunks, 0);
        for (before, after) in guide.sections.iter().zip(&carried.sections) {
            assert_eq!(before.explanation, after.explanation);
            assert_eq!(
                before.annotations[0].anchor.line + 20,
                after.annotations[0].anchor.line
            );
            domain::validate_anchor(&new, &after.annotations[0].anchor).unwrap();
        }
        assert_eq!(serde_json::to_value(guide).unwrap(), original);
        assert!(carried.enrichment.is_none());
    }
    #[test]
    fn changed_removed_and_new_code_cannot_inherit_an_old_assessment() {
        let (old, mut new, mut guide) = revisions();
        annotate(&mut guide, &old);
        let removed = new.files.remove(0);
        // Even a stale fingerprint must not match different text.
        new.files[0].hunks[0].lines[0].text.push_str(" changed");
        let mut added = new.files[1].clone();
        added.path = "brand-new.ts".into();
        for hunk in &mut added.hunks {
            hunk.id = format!("added-{}", hunk.id);
            hunk.path = added.path.clone();
        }
        new.files.push(added);
        let carried = carry(guide.clone(), &old, &new);
        assert!(
            carried
                .previous_revision
                .as_ref()
                .unwrap()
                .outdated_sections
                .len()
                >= 2
        );
        for section in &carried.sections {
            for note in &section.annotations {
                domain::validate_anchor(&new, &note.anchor).unwrap();
                assert_ne!(note.anchor.path, removed.path);
            }
            if !section.assessed {
                assert!(!section.foldable);
            }
        }
        let ids: Vec<_> = carried.sections.iter().flat_map(|s| &s.hunk_ids).collect();
        let current: HashSet<_> = new
            .files
            .iter()
            .flat_map(|f| &f.hunks)
            .map(|h| &h.id)
            .collect();
        assert_eq!(ids.len(), current.len());
        assert_eq!(ids.into_iter().collect::<HashSet<_>>(), current);
        assert!(
            carried
                .sections
                .iter()
                .any(|s| !s.assessed && s.hunk_ids.contains(&new.files[0].hunks[0].id))
        );
        assert!(
            carried
                .sections
                .iter()
                .any(|s| s.title == guide.sections[0].title && !s.summary.is_empty())
        );
    }
    #[test]
    fn ambiguous_repeated_hunks_are_unassessed_instead_of_guessing_an_anchor() {
        let (old, mut new, mut guide) = revisions();
        annotate(&mut guide, &old);
        let mut duplicate = new.files[0].hunks[0].clone();
        duplicate.id = "ambiguous-repeat".into();
        new.files[0].hunks.push(duplicate);
        let carried = carry(guide, &old, &new);
        let first = &old.files[0].hunks[0];
        assert!(
            carried
                .sections
                .iter()
                .flat_map(|s| &s.annotations)
                .all(|n| n.anchor.path != first.path)
        );
        assert!(
            carried
                .sections
                .iter()
                .filter(|s| !s.assessed)
                .flat_map(|s| &s.hunk_ids)
                .any(|id| id == "ambiguous-repeat")
        );
    }
}
