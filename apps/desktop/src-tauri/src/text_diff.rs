//! Bounded reconstruction when GitHub omits a text patch.
use crate::{contracts::*, domain};
use anyhow::{Result, bail, ensure};
use std::time::Duration;

pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
pub fn matches_counts(hunks: &[Hunk], additions: u32, deletions: u32) -> bool {
    let lines = || hunks.iter().flat_map(|h| &h.lines);
    lines().filter(|l| l.kind == LineKind::Addition).count() == additions as usize
        && lines().filter(|l| l.kind == LineKind::Deletion).count() == deletions as usize
}
pub fn reconstruct(file: &ChangedFile, old: &str, new: &str, revision: &str) -> Result<Vec<Hunk>> {
    ensure!(
        old.len() <= MAX_FILE_BYTES && new.len() <= MAX_FILE_BYTES,
        "File exceeds the 2 MiB text capture limit"
    );
    if old.contains('\0') || new.contains('\0') {
        bail!("Binary content has no text diff");
    }
    ensure!(
        old.lines().count() <= 50_000 && new.lines().count() <= 50_000,
        "File exceeds the 50,000-line capture limit"
    );
    let diff = similar::TextDiff::configure()
        .timeout(Duration::from_millis(750))
        .diff_lines(old, new);
    let patch = diff.unified_diff().context_radius(3).to_string();
    let hunks = domain::parse_patch(&file.path, &patch, revision)?;
    ensure!(
        matches_counts(&hunks, file.additions, file.deletions),
        "Reconstructed diff disagrees with GitHub's change counts; inspect the file in GitHub"
    );
    ensure!(
        !hunks.is_empty(),
        "No textual changes; inspect file metadata in GitHub"
    );
    Ok(hunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(additions: u32, deletions: u32) -> ChangedFile {
        ChangedFile {
            path: "renamed/日本語.txt".into(),
            previous_path: Some("old.txt".into()),
            status: "renamed".into(),
            additions,
            deletions,
            hunks: vec![],
            unavailable: None,
        }
    }
    #[test]
    fn reconstructs_large_replacements_and_valid_source_anchors() {
        let old = (0..3500)
            .map(|i| format!("old record {i}\n"))
            .collect::<String>();
        let new = (0..4000)
            .map(|i| format!("new record {i}\n"))
            .collect::<String>();
        let hunks = reconstruct(&file(4000, 3500), &old, &new, "snapshot").unwrap();
        assert_eq!(
            hunks
                .iter()
                .flat_map(|h| &h.lines)
                .filter(|l| l.old.is_some())
                .count(),
            3500
        );
        assert!(
            hunks
                .iter()
                .flat_map(|h| &h.lines)
                .any(|l| l.new == Some(4000))
        );
    }
    #[test]
    fn preserves_crlf_unicode_and_missing_newline_coordinates() {
        let hunks = reconstruct(
            &file(1, 1),
            "header\r\n古い",
            "header\r\n新しい",
            "snapshot",
        )
        .unwrap();
        assert!(
            hunks[0]
                .lines
                .iter()
                .any(|l| l.kind == LineKind::Deletion && l.old == Some(2))
        );
        assert!(
            hunks[0]
                .lines
                .iter()
                .any(|l| l.kind == LineKind::Addition && l.new == Some(2))
        );
        assert!(hunks[0].lines.iter().any(|l| l.kind == LineKind::Meta));
    }
    #[test]
    fn rejects_binary_oversized_and_inconsistent_content() {
        assert!(reconstruct(&file(1, 1), "a\0", "b", "s").is_err());
        assert!(reconstruct(&file(1, 1), "a", &"b".repeat(MAX_FILE_BYTES + 1), "s").is_err());
        assert!(reconstruct(&file(2, 1), "a", "b", "s").is_err());
    }
}
