//! Read-only live verification of cold capture, prefetch, and offline switching.
//! cargo run -p diffcity --bin review-cache-smoke -- 2 3 4
use anyhow::{Result, ensure};
use diffcity_lib::service::Service;
use std::{path::PathBuf, time::Instant};

#[tokio::main]
async fn main() -> Result<()> {
    let root = PathBuf::from(".local/review-cache-smoke").join(uuid::Uuid::new_v4().to_string());
    let service = Service::new(&root)?;
    service.github.connect(&service.store.settings()?).await?;
    let repository = "crs48/diffcity";
    let numbers = std::env::args()
        .skip(1)
        .map(|s| s.parse::<u32>())
        .collect::<Result<Vec<_>, _>>()?;
    ensure!(!numbers.is_empty(), "Supply test PR numbers");
    for (index, number) in numbers.iter().enumerate() {
        let pull = service.github.pull(repository, *number).await?;
        ensure!(pull.state == "open", "Use open PRs for this prefetch test");
        let started = Instant::now();
        if index == 0 {
            let cold = service.open(repository, *number, false).await?;
            println!(
                "PR {number}: cold code capture {} ms ({} files)",
                started.elapsed().as_millis(),
                cold.snapshot.files.len()
            );
            let synced = service.open(repository, *number, true).await?;
            ensure!(
                synced.sync_error.is_none(),
                "Live sync failed: {:?}",
                synced.sync_error
            );
        } else {
            ensure!(service.prefetch_pull(&pull).await?, "Prefetch interrupted");
            println!(
                "PR {number}: background preparation {} ms",
                started.elapsed().as_millis()
            );
        }
        let repeat = Instant::now();
        ensure!(
            service.prefetch_pull(&pull).await?,
            "Cached prefetch failed"
        );
        println!(
            "PR {number}: duplicate prefetch skipped in {} ms",
            repeat.elapsed().as_millis()
        );
    }
    // Reopen the database without connecting GitHub: no network can hide on this path.
    let offline = Service::new(&root)?;
    for number in numbers {
        let started = Instant::now();
        let cached = offline.open(repository, number, false).await?;
        ensure!(
            cached.sync_error.is_none(),
            "Cached open should not contact GitHub"
        );
        ensure!(!cached.snapshot.files.is_empty(), "Missing prefetched diff");
        ensure!(
            cached.checks != "Checks not synced yet",
            "Missing prefetched checks"
        );
        ensure!(
            !cached.guide.sections.is_empty(),
            "Missing local walkthrough"
        );
        println!(
            "PR {number}: offline cached open {} ms, {} files, {} hunks, {} comments",
            started.elapsed().as_millis(),
            cached.snapshot.files.len(),
            cached
                .snapshot
                .files
                .iter()
                .map(|f| f.hunks.len())
                .sum::<usize>(),
            cached.comments.len()
        );
    }
    println!(
        "PASS: cold capture, prefetch, deduplication, and cached restart; no AI runs or GitHub writes"
    );
    Ok(())
}
