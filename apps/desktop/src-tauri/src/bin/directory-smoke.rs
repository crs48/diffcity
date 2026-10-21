//! Read-only, metadata-only verification of automatic discovery using the local GitHub login.
use anyhow::{Result, ensure};
use diffcity_lib::service::Service;
use std::path::Path;
#[tokio::main]
async fn main() -> Result<()> {
    let root = Path::new(".local/directory-smoke");
    let service = Service::new(root)?;
    let settings = service.store.settings()?;
    let connection = service.github.connect(&settings).await?;
    service
        .store
        .put("identity", "github", &connection.identity)?;
    let directory = service.directory().await?;
    ensure!(directory.sync_error.is_none(), "{:?}", directory.sync_error);
    println!(
        "Discovered {} organizations and {} repositories",
        directory.organizations.len(),
        directory.repositories.len()
    );
    let inbox = service
        .sync_inbox(&|p| println!("Synced {}/{} repos", p.completed, p.total))
        .await?;
    ensure!(inbox.sync_error.is_none(), "{:?}", inbox.sync_error);
    println!(
        "Loaded {} open PRs and {} recent completions",
        inbox.pulls.iter().filter(|p| p.state == "open").count(),
        inbox.pulls.iter().filter(|p| p.state != "open").count()
    );
    let owner = std::env::args()
        .nth(1)
        .unwrap_or_else(|| connection.identity.clone());
    let history = service.history(None, 1, Some(&owner)).await?;
    ensure!(history.sync_error.is_none(), "{:?}", history.sync_error);
    ensure!(
        history.pulls.iter().all(|p| p
            .repository
            .split('/')
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case(&owner))
            && p.state != "open"),
        "History scope leaked"
    );
    println!(
        "{owner}: {} repos, {} open PRs, {} historical PRs on the first page",
        directory
            .repositories
            .iter()
            .filter(|r| r.full_name.starts_with(&format!("{owner}/")))
            .count(),
        inbox
            .pulls
            .iter()
            .filter(|p| p.repository.starts_with(&format!("{owner}/")) && p.state == "open")
            .count(),
        history.pulls.len()
    );
    if let Some(page) = history.next_page {
        let older = service.history(None, page, Some(&owner)).await?;
        ensure!(older.sync_error.is_none(), "{:?}", older.sync_error);
        ensure!(
            older.pulls.iter().all(|p| !history
                .pulls
                .iter()
                .any(|first| first.repository == p.repository && first.number == p.number)),
            "Repeated history page"
        );
        println!(
            "Next history page loaded {} distinct PRs",
            older.pulls.len()
        );
    }
    std::fs::write(
        root.join("directory.json"),
        serde_json::to_string_pretty(&directory)?,
    )?;
    std::fs::write(
        root.join("inbox.json"),
        serde_json::to_string_pretty(&inbox)?,
    )?;
    Ok(())
}
