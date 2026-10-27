//! Read-only live inbox verification; exports real service data for UI replay.
use anyhow::{Result, ensure};
use diffcity_lib::{fixtures, service::Service};
use std::path::PathBuf;
#[tokio::main]
async fn main() -> Result<()> {
    let repo = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "crs48/diffcity".into());
    let dir = PathBuf::from(".local/inbox-smoke");
    let service = Service::new(&dir)?;
    let settings = service.settings(diffcity_lib::contracts::Settings {
        repositories: vec![repo],
        ..service.store.settings()?
    })?;
    let github = service.github.connect(&settings).await?;
    service.store.put("identity", "github", &github.identity)?;
    let pulls = service.inbox().await?;
    ensure!(
        pulls
            .iter()
            .filter(|p| p.state == "open")
            .all(|p| p.review_metadata_available),
        "Missing live review metadata"
    );
    ensure!(
        pulls
            .iter()
            .filter(|p| p.state != "open")
            .all(|p| p.author.eq_ignore_ascii_case(&github.identity) && p.closed_at.is_some()),
        "Unexpected recent completion"
    );
    std::fs::write(
        dir.join("pulls.json"),
        serde_json::to_string_pretty(&pulls)?,
    )?;
    let samples = fixtures::inbox(&github.identity)?;
    std::fs::write(
        dir.join("samples.json"),
        serde_json::to_string_pretty(&samples)?,
    )?;
    for p in &samples {
        let workspace = service.open(fixtures::INBOX_REPO, p.number, false).await?;
        std::fs::write(
            dir.join(format!("sample-{}.json", p.number)),
            serde_json::to_string_pretty(&workspace)?,
        )?;
    }
    println!(
        "Live inbox: {} open ({} draft), {} recently completed; all open review metadata available. {} isolated local samples exported.",
        pulls.iter().filter(|p| p.state == "open").count(),
        pulls
            .iter()
            .filter(|p| p.state == "open" && p.draft)
            .count(),
        pulls.iter().filter(|p| p.state != "open").count(),
        samples.len()
    );
    Ok(())
}
