//! Read-only verification of review comparisons. Writes only its isolated local data directory.
use anyhow::{Context, Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/comparison-smoke"));
    let service = Service::new(&root)?;
    let (workspace, baseline) = if args.first().is_some_and(|a| a == "--live") {
        let repo = args
            .get(1)
            .context("Usage: comparison-smoke --live owner/repo number [reviewed-sha]")?;
        let number = args.get(2).context("Missing PR number")?.parse()?;
        let connection = service.github.connect(&service.store.settings()?).await?;
        service
            .store
            .put("identity", "github", &connection.identity)?;
        let workspace = service.open(repo, number, true).await?;
        let history = service
            .review_baseline(&workspace.snapshot.id, true)
            .await?;
        ensure!(
            history.sync_error.is_none(),
            "Review history: {:?}",
            history.sync_error
        );
        let baseline = if let Some(head) = args.get(3) {
            ReviewCheckpoint {
                head: head.clone(),
                reviewed_at: chrono::Utc::now().to_rfc3339(),
                source: "local".into(),
            }
        } else {
            history.checkpoint.context(
                "No submitted review; pass an explicit revision for this read-only smoke test",
            )?
        };
        (workspace, baseline)
    } else {
        let (snapshot, guide) = fixtures::sample()?;
        service.store.put("snapshot", &snapshot.id, &snapshot)?;
        service.store.put("guide", &snapshot.id, &guide)?;
        let baseline = service
            .review_baseline(&snapshot.id, false)
            .await?
            .checkpoint
            .context("Missing sample baseline")?;
        (service.saved(&snapshot.id)?, baseline)
    };
    let result = service
        .compare_review(&workspace.snapshot.id, baseline.clone())
        .await?;
    let offline = Service::new(&root)?;
    let cached = offline
        .compare_review(&workspace.snapshot.id, baseline)
        .await?;
    ensure!(
        serde_json::to_value(&cached)? == serde_json::to_value(&result)?,
        "Offline comparison differs"
    );
    for (name, value) in [
        ("workspace", serde_json::to_value(&workspace)?),
        ("comparison", serde_json::to_value(&result)?),
    ] {
        std::fs::write(
            root.join(format!("{name}.json")),
            serde_json::to_vec_pretty(&value)?,
        )?;
    }
    println!(
        "PASS: {}#{} · {} → {} · {} files +{} −{} · identical after offline restart",
        workspace.snapshot.pull.repository,
        workspace.snapshot.pull.number,
        result.baseline.head,
        result.snapshot.pull.head,
        result.snapshot.files.len(),
        result.snapshot.pull.additions,
        result.snapshot.pull.deletions
    );
    Ok(())
}
