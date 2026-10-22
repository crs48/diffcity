use crate::contracts::*;
use anyhow::{Result, bail};
use regex::Regex;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))[..24].to_string()
}
pub fn pull_key(pull: &PullRequest) -> String {
    format!("{}#{}", pull.repository, pull.number)
}
pub fn valid_repo(repo: &str) -> bool {
    let parts: Vec<_> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
}
pub fn parse_patch(path: &str, patch: &str, revision: &str) -> Result<Vec<Hunk>> {
    let header = Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")?;
    let mut hunks: Vec<Hunk> = Vec::new();
    let (mut old, mut new) = (0, 0);
    let (mut expected_old, mut expected_new) = (0, 0);
    let (mut read_old, mut read_new) = (0, 0);
    for line in patch.lines() {
        if let Some(c) = header.captures(line) {
            if !hunks.is_empty() && (read_old != expected_old || read_new != expected_new) {
                bail!("Truncated hunk in {path}");
            }
            old = c[1].parse()?;
            new = c[3].parse()?;
            expected_old = c.get(2).map_or("1", |m| m.as_str()).parse()?;
            expected_new = c.get(4).map_or("1", |m| m.as_str()).parse()?;
            read_old = 0;
            read_new = 0;
            hunks.push(Hunk {
                id: String::new(),
                fingerprint: String::new(),
                path: path.into(),
                header: line.into(),
                lines: vec![],
            });
            continue;
        }
        let Some(hunk) = hunks.last_mut() else {
            continue;
        };
        let (kind, left, right) = match line.as_bytes().first() {
            Some(b'+') => {
                let n = new;
                new += 1;
                read_new += 1;
                (LineKind::Addition, None, Some(n))
            }
            Some(b'-') => {
                let n = old;
                old += 1;
                read_old += 1;
                (LineKind::Deletion, Some(n), None)
            }
            Some(b' ') => {
                let p = (old, new);
                old += 1;
                new += 1;
                read_old += 1;
                read_new += 1;
                (LineKind::Context, Some(p.0), Some(p.1))
            }
            Some(b'\\') => (LineKind::Meta, None, None),
            _ => bail!("Invalid patch row in {path}"),
        };
        hunk.lines.push(DiffLine {
            kind,
            old: left,
            new: right,
            text: line.get(1..).unwrap_or("").to_string(),
        });
    }
    if !hunks.is_empty() && (read_old != expected_old || read_new != expected_new) {
        bail!("Truncated hunk in {path}");
    }
    for (index, hunk) in hunks.iter_mut().enumerate() {
        let contents = hunk
            .lines
            .iter()
            .map(|l| format!("{:?}:{}", l.kind, l.text))
            .collect::<Vec<_>>()
            .join("\n");
        hunk.fingerprint = hash(&format!("{path}\n{contents}"));
        hunk.id = hash(&format!("{revision}/{path}/{index}/{}", hunk.header));
    }
    Ok(hunks)
}

pub fn validate_anchor(snapshot: &Snapshot, anchor: &Anchor) -> Result<()> {
    let hunk = snapshot
        .files
        .iter()
        .flat_map(|f| &f.hunks)
        .find(|h| h.id == anchor.hunk_id && h.path == anchor.path)
        .ok_or_else(|| anyhow::anyhow!("The selected code is not in this revision"))?;
    if anchor.start_line == 0 || anchor.start_line > anchor.line {
        bail!("Invalid line range");
    }
    let positions: HashSet<u32> = hunk
        .lines
        .iter()
        .filter_map(|l| match anchor.side {
            Side::LEFT => l.old,
            Side::RIGHT => l.new,
        })
        .collect();
    if !(anchor.start_line..=anchor.line).all(|n| positions.contains(&n)) {
        bail!("The selected range is outside this diff hunk");
    }
    Ok(())
}

pub fn rule(hunk: &Hunk) -> (Attention, String, String) {
    let p = hunk.path.to_lowercase();
    let changed = hunk
        .lines
        .iter()
        .filter(|l| l.kind == LineKind::Addition || l.kind == LineKind::Deletion)
        .map(|l| l.text.to_lowercase())
        .collect::<Vec<_>>()
        .join("\n");
    if p.contains("migration") || changed.contains("alter table") || changed.contains("drop table")
    {
        return (Attention::High,"Database migration".into(),"Changes persisted data or schema. Check existing rows, deployment order, locks, and rollback.".into());
    }
    if ["/auth", "authorization", "permission", "rbac"]
        .iter()
        .any(|s| p.contains(s))
        || [
            "is_admin",
            "tenant_id",
            "tenantid",
            "checkpermission",
            "require_role",
        ]
        .iter()
        .any(|s| changed.contains(s))
    {
        return (
            Attention::High,
            "Authorization".into(),
            "Changes access or tenant-related code. Check who can read or modify each resource."
                .into(),
        );
    }
    let localization = p.contains("locales/") || p.contains("i18n/") || p.contains("translations/");
    if localization {
        let key = Regex::new(r#"^\s*"([^"]+)"\s*:"#).expect("valid key pattern");
        let placeholder = Regex::new(r"\{[a-zA-Z_][a-zA-Z_0-9]*\}|%[0-9$]*[sdif]")
            .expect("valid placeholder pattern");
        let lines = |kind: LineKind| hunk.lines.iter().filter(move |l| l.kind == kind);
        let removed: HashSet<_> = lines(LineKind::Deletion)
            .filter_map(|l| key.captures(&l.text).map(|c| c[1].to_string()))
            .collect();
        let added: HashSet<_> = lines(LineKind::Addition)
            .filter_map(|l| key.captures(&l.text).map(|c| c[1].to_string()))
            .collect();
        let old_slots: Vec<_> = lines(LineKind::Deletion)
            .flat_map(|l| {
                placeholder
                    .find_iter(&l.text)
                    .map(|m| m.as_str().to_string())
            })
            .collect();
        let new_slots: Vec<_> = lines(LineKind::Addition)
            .flat_map(|l| {
                placeholder
                    .find_iter(&l.text)
                    .map(|m| m.as_str().to_string())
            })
            .collect();
        if !removed.is_subset(&added) || (!removed.is_empty() && old_slots != new_slots) {
            return (Attention::High,"Localization contract".into(),"Translation keys or interpolation placeholders changed. Check callers and other locales before treating this as copy-only work.".into());
        }
    }
    if p.contains("openapi") || p.contains("graphql/schema") {
        return (
            Attention::High,
            "API contract".into(),
            "Changes a machine-readable API contract. Check compatibility with existing clients."
                .into(),
        );
    }
    let category = if localization {
        "Localization"
    } else if p.ends_with(".md") || p.starts_with("docs/") {
        "Documentation"
    } else if p.contains("test") || p.contains("spec.") {
        "Tests"
    } else if p.contains("lock") || p.contains("package.json") || p.ends_with("cargo.toml") {
        "Dependencies"
    } else {
        "Implementation"
    };
    (
        Attention::NeedsAssessment,
        category.into(),
        "Waiting for an assessment of this change and its consequences.".into(),
    )
}
pub fn rank(a: &Attention) -> u8 {
    match a {
        Attention::High => 0,
        Attention::NeedsAssessment => 1,
        Attention::Standard => 2,
        Attention::Routine => 3,
    }
}

pub fn provisional(snapshot: &Snapshot) -> Guide {
    let sections = crate::guide::provisional_sections(snapshot, &HashSet::new());
    Guide {
        enrichment: None,
        id: None,
        reasoning_effort: None,
        snapshot_id: snapshot.id.clone(),
        summary: snapshot.pull.title.clone(),
        sections,
        source: "provisional".into(),
        model: String::new(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        limitations: snapshot.limitations.clone(),
        policy_version: 1,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proposal {
    pub summary: String,
    pub sections: Vec<ProposedSection>,
    pub limitations: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposedSection {
    pub title: String,
    pub summary: String,
    pub explanation: String,
    pub attention: Attention,
    pub category: String,
    pub reason: String,
    pub hunk_ids: Vec<String>,
    pub questions: Vec<String>,
    pub findings: Vec<Finding>,
}

pub fn validate_guide(
    snapshot: &Snapshot,
    proposal: Proposal,
    model: &str,
    supplied: &HashSet<String>,
) -> Result<Guide> {
    if proposal.summary.trim().is_empty() || proposal.sections.is_empty() {
        bail!("Codex returned no walkthrough; kept the previous guide");
    }
    let hunks: HashMap<_, _> = snapshot
        .files
        .iter()
        .flat_map(|f| &f.hunks)
        .map(|h| (h.id.clone(), h))
        .collect();
    let mut seen = HashSet::new();
    let mut sections = Vec::new();
    for s in proposal.sections {
        if s.hunk_ids.is_empty()
            || s.title.trim().is_empty()
            || s.summary.trim().is_empty()
            || s.explanation.trim().is_empty()
            || s.reason.trim().is_empty()
        {
            bail!(
                "Codex returned an empty section, explanation, or rationale; kept the previous guide"
            );
        }
        for id in &s.hunk_ids {
            if !hunks.contains_key(id) || !supplied.contains(id) || !seen.insert(id.clone()) {
                bail!("Codex returned an invalid, duplicate, or unseen hunk reference");
            }
        }
        for f in &s.findings {
            validate_anchor(snapshot, &f.anchor)?;
            if !s.hunk_ids.contains(&f.anchor.hunk_id) {
                bail!("Finding is not grounded in its section");
            }
        }
        let mut attention = s.attention;
        let mut reasons = vec![s.reason];
        let mut categories = vec![s.category];
        for id in &s.hunk_ids {
            let (floor, category, reason) = rule(hunks[id]);
            if floor == Attention::High {
                attention = Attention::High;
                reasons.push(reason);
                categories.push(category);
            }
        }
        // Uncertain classifications and findings are always visible. Filename hints
        // never establish routine status on their own; they only restrict folding.
        let assessed = attention != Attention::NeedsAssessment;
        let routine_candidate = s
            .hunk_ids
            .iter()
            .all(|id| matches!(rule(hunks[id]).1.as_str(), "Documentation" | "Localization"));
        if attention == Attention::Routine && (!routine_candidate || !s.findings.is_empty()) {
            attention = Attention::Standard;
        }
        let foldable = assessed && attention == Attention::Routine && s.findings.is_empty();
        let id = hash(&s.hunk_ids.join("/"));
        reasons.dedup();
        categories.dedup();
        sections.push(GuideSection {
            annotations: vec![],
            id,
            title: s.title,
            summary: s.summary,
            explanation: s.explanation,
            attention,
            category: categories.join(" · "),
            reason: reasons.join(" "),
            hunk_ids: s.hunk_ids,
            unavailable_paths: vec![],
            questions: s.questions,
            findings: s.findings,
            assessed,
            foldable,
        });
    }
    sections.extend(crate::guide::provisional_sections(snapshot, &seen));
    let mut sections = crate::guide::compact_sections(sections);
    sections.sort_by_key(|s| rank(&s.attention));
    if sections.iter().all(|s| s.attention == Attention::Routine)
        && let Some(s) = sections.first_mut()
    {
        s.foldable = false;
    }
    let mut limitations = snapshot.limitations.clone();
    limitations.extend(proposal.limitations);
    if seen.len() < hunks.len() {
        limitations.push(format!(
            "{} changed hunks still need assessment.",
            hunks.len() - seen.len()
        ));
    }
    Ok(Guide {
        enrichment: None,
        id: None,
        reasoning_effort: None,
        snapshot_id: snapshot.id.clone(),
        summary: proposal.summary,
        sections,
        source: "codex".into(),
        model: model.into(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        limitations,
        policy_version: 3,
    })
}

pub fn transfer_progress(
    old: &Snapshot,
    new: &Snapshot,
    previous: &ReviewProgress,
) -> (ReviewProgress, Vec<String>) {
    let mut by_fingerprint: HashMap<String, Vec<&Hunk>> = HashMap::new();
    for h in old.files.iter().flat_map(|f| &f.hunks) {
        by_fingerprint
            .entry(h.fingerprint.clone())
            .or_default()
            .push(h);
    }
    let mut progress = ReviewProgress::default();
    let mut changed = Vec::new();
    for h in new.files.iter().flat_map(|f| &f.hunks) {
        match by_fingerprint.get(&h.fingerprint) {
            Some(matches) if matches.len() == 1 => {
                if previous.reviewed.contains(&matches[0].id) {
                    progress.reviewed.push(h.id.clone());
                }
            }
            _ => changed.push(h.id.clone()),
        }
    }
    (progress, changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_deletion_addition_and_unicode_coordinates() {
        let h = parse_patch("é.ts", "@@ -4,2 +4,2 @@\n-old\n+new\n same", "rev").unwrap();
        assert_eq!(h[0].lines[0].old, Some(4));
        assert_eq!(h[0].lines[0].new, None);
        assert_eq!(h[0].lines[1].new, Some(4));
        assert_eq!(h[0].lines[2].old, Some(5));
    }
    #[test]
    fn rejects_truncated_patch() {
        assert!(parse_patch("a", "@@ -1,8 +1,8 @@\n a", "rev").is_err());
    }
    #[test]
    fn migration_floor_and_routine_hints() {
        let h = parse_patch(
            "db/migrations/001.sql",
            "@@ -0,0 +1 @@\n+ALTER TABLE people ADD COLUMN active BOOLEAN;",
            "rev",
        )
        .unwrap();
        assert_eq!(rule(&h[0]).0, Attention::High);
        let h = parse_patch("docs/api.md", "@@ -0,0 +1 @@\n+Hello", "rev").unwrap();
        assert_eq!(rule(&h[0]).0, Attention::NeedsAssessment);
    }
    #[test]
    fn prevents_repo_path_injection() {
        assert!(!valid_repo("owner/../repo"));
        assert!(!valid_repo("owner/repo?token=x"));
        assert!(valid_repo("crs48/diffcity"));
    }
}
