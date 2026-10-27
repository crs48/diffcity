use anyhow::{Result, ensure};
use diffcity_lib::service::Service;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let root = PathBuf::from(".local/context-smoke");
    let service = Service::new(&root)?;
    service.github.connect(&service.store.settings()?).await?;
    let workspace = service.open("crs48/diffcity", 2, true).await?;
    let mut expanded = false;
    for file in workspace
        .snapshot
        .files
        .iter()
        .filter(|f| f.status != "added" && f.status != "removed")
    {
        let Some(hunk) = file.hunks.first() else {
            continue;
        };
        let context = service
            .hunk_context(&workspace.snapshot.id, &hunk.id, 25, 25)
            .await?;
        if context.before.is_empty() && context.after.is_empty() {
            continue;
        }
        std::fs::write(
            root.join("workspace.json"),
            serde_json::to_vec_pretty(&workspace)?,
        )?;
        std::fs::write(
            root.join("context.json"),
            serde_json::to_vec_pretty(&context)?,
        )?;
        let offline = Service::new(&root)?;
        let cached = offline
            .hunk_context(&workspace.snapshot.id, &hunk.id, 25, 25)
            .await?;
        ensure!(
            serde_json::to_value(&context)? == serde_json::to_value(&cached)?,
            "Cached context differs"
        );
        println!(
            "PASS: {} / {} · {} lines above, {} below · immutable revision and offline restart",
            file.path,
            hunk.header,
            context.before.len(),
            context.after.len()
        );
        expanded = true;
        break;
    }
    ensure!(
        expanded,
        "No surrounding context found in the implementation PR"
    );
    Ok(())
}
