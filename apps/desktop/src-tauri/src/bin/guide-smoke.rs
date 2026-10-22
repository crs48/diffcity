//! Live read-only guide verification against a GitHub PR; never posts comments.
//! cargo run -p diffcity --bin guide-smoke -- owner/repo 123
use anyhow::{Context, Result, ensure};
use diffcity_lib::service::Service;
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let repo = args.first().context("Supply owner/repo and PR number")?;
    let number = args.get(1).context("Supply PR number")?.parse()?;
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/guide-smoke"));
    let service = Service::new(&directory)?;
    let bootstrap = service.bootstrap().await?;
    ensure!(bootstrap.github.connected, "{}", bootstrap.github.detail);
    ensure!(bootstrap.codex.connected, "{}", bootstrap.codex.detail);
    let workspace = service.open(repo, number, true).await?;
    ensure!(
        workspace.sync_error.is_none(),
        "Capture failed: {:?}",
        workspace.sync_error
    );
    let guide = service
        .analyze(
            &workspace.snapshot.id,
            "guide-smoke",
            Arc::new(|e| {
                if e.phase != "stream" {
                    println!("{}: {}", e.phase, e.text);
                }
            }),
        )
        .await?;
    ensure!(
        guide.source == "codex" && guide.policy_version == 3,
        "Expected new live guide"
    );
    ensure!(
        guide
            .sections
            .iter()
            .filter(|s| s.assessed)
            .all(|s| !s.explanation.trim().is_empty()),
        "Missing walkthrough"
    );
    let total = workspace
        .snapshot
        .files
        .iter()
        .map(|f| f.hunks.len())
        .sum::<usize>();
    let assessed = guide
        .sections
        .iter()
        .filter(|s| s.assessed)
        .map(|s| s.hunk_ids.len())
        .sum::<usize>();
    let covered: Vec<_> = guide.sections.iter().flat_map(|s| &s.hunk_ids).collect();
    ensure!(
        covered.len() == total
            && covered
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                == total,
        "Expected exact stored hunk coverage"
    );
    let workspace = service.saved(&workspace.snapshot.id)?;
    std::fs::write(
        directory.join(format!("pr-{number}.json")),
        serde_json::to_vec_pretty(&workspace)?,
    )?;
    println!(
        "Guide: {} sections, {assessed}/{total} hunks assessed, {} words of explanation, {} review checks",
        guide.sections.len(),
        guide
            .sections
            .iter()
            .map(|s| s.explanation.split_whitespace().count())
            .sum::<usize>(),
        guide
            .sections
            .iter()
            .map(|s| s.questions.len())
            .sum::<usize>()
    );
    drop(service);
    let restored = Service::new(&directory)?.saved(&workspace.snapshot.id)?;
    ensure!(
        serde_json::to_value(&restored.guide)? == serde_json::to_value(guide)?,
        "Guide changed on restart"
    );
    println!(
        "PASS: GitHub capture, local Codex guide, anchor validation, complete stored coverage, and restart. Inspect pr-{number}.json for explanation quality."
    );
    Ok(())
}
