//! Live, read-only GitHub corpus verification. Codex inference is opt-in.
//! cargo run -p diffcity --bin corpus-smoke -- 2 3 4 5 6
//! DIFFCITY_CORPUS_ANALYZE=4 enables a private guide and anchored discussion.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, domain, service::Service};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/corpus-smoke"));
    let repository = std::env::var("DIFFCITY_REPOSITORY").unwrap_or("crs48/diffcity".into());
    let numbers = std::env::args()
        .skip(1)
        .map(|s| s.parse::<u32>())
        .collect::<Result<Vec<_>, _>>()?;
    ensure!(!numbers.is_empty(), "Supply PR numbers to capture");
    let service = Service::new(&directory)?;
    let bootstrap = service.bootstrap().await?;
    ensure!(bootstrap.github.connected, "{}", bootstrap.github.detail);
    println!(
        "GitHub={} Codex={} schema={}",
        bootstrap.github.identity, bootstrap.codex.connected, bootstrap.schema_version
    );
    let mut settings = bootstrap.settings;
    settings.repositories = vec![repository.clone()];
    service.settings(settings)?;
    let inbox = service.inbox().await?;
    let history = service.history(Some(&repository), 1, None).await?;
    ensure!(
        history.sync_error.is_none(),
        "History must come from GitHub"
    );
    println!("Open inbox={} history={}", inbox.len(), history.pulls.len());
    let analyze = std::env::var("DIFFCITY_CORPUS_ANALYZE")
        .ok()
        .and_then(|v| v.parse::<u32>().ok());
    for number in numbers {
        let start = std::time::Instant::now();
        let mut workspace = service.open(&repository, number, true).await?;
        ensure!(
            workspace.sync_error.is_none(),
            "PR {number}: {:?}",
            workspace.sync_error
        );
        let snapshot = &workspace.snapshot;
        let mut additions = 0;
        let mut deletions = 0;
        for hunk in snapshot.files.iter().flat_map(|f| &f.hunks) {
            for line in &hunk.lines {
                let coordinate = match line.kind {
                    LineKind::Addition => {
                        additions += 1;
                        line.new.map(|n| (Side::RIGHT, n))
                    }
                    LineKind::Deletion => {
                        deletions += 1;
                        line.old.map(|n| (Side::LEFT, n))
                    }
                    _ => None,
                };
                if let Some((side, line)) = coordinate {
                    domain::validate_anchor(
                        snapshot,
                        &Anchor {
                            text_selection: None,
                            hunk_id: hunk.id.clone(),
                            path: hunk.path.clone(),
                            side,
                            start_line: line,
                            line,
                        },
                    )?;
                }
            }
        }
        let unavailable: Vec<_> = snapshot
            .files
            .iter()
            .filter(|f| f.unavailable.is_some())
            .map(|f| &f.path)
            .collect();
        println!(
            "PR #{number}: {} · {} files · GitHub +{}/-{} · captured +{additions}/-{deletions} · {} hunks · {:.2}s",
            snapshot.pull.state,
            snapshot.files.len(),
            snapshot.pull.additions,
            snapshot.pull.deletions,
            snapshot.files.iter().map(|f| f.hunks.len()).sum::<usize>(),
            start.elapsed().as_secs_f64()
        );
        println!("  unavailable={unavailable:?}");
        println!(
            "  renames={:?}",
            snapshot
                .files
                .iter()
                .filter_map(|f| f.previous_path.as_ref().map(|old| (old, &f.path)))
                .collect::<Vec<_>>()
        );
        if snapshot.pull.state != "open" {
            ensure!(
                !inbox
                    .iter()
                    .any(|p| p.number == number && p.state == "open"),
                "Closed PR incorrectly has open state in inbox"
            );
            ensure!(
                history.pulls.iter().any(|p| p.number == number),
                "Closed fixture missing from first history page"
            );
            let cached = service.open(&repository, number, false).await?;
            ensure!(
                cached.snapshot.pull.state == snapshot.pull.state,
                "Cached state is stale"
            );
        }
        if analyze == Some(number) {
            ensure!(
                bootstrap.codex.connected,
                "Codex must be connected for analysis"
            );
            let id = snapshot.id.clone();
            workspace.guide = service
                .analyze(
                    &id,
                    "corpus-guide",
                    Arc::new(|e| {
                        if e.phase != "stream" {
                            println!("Guide: {}", e.phase);
                        }
                    }),
                )
                .await?;
            ensure!(workspace.guide.source == "codex", "Expected a live guide");
            ensure!(
                workspace
                    .guide
                    .sections
                    .iter()
                    .any(|s| s.attention == Attention::High),
                "Risky fixture needs high attention"
            );
            let hunk = workspace
                .snapshot
                .files
                .iter()
                .filter(|f| f.path.ends_with("004_workspace_scope.sql"))
                .flat_map(|f| &f.hunks)
                .next()
                .expect("migration fixture");
            let anchor = Anchor {
                text_selection: None,
                hunk_id: hunk.id.clone(),
                path: hunk.path.clone(),
                side: Side::RIGHT,
                start_line: 2,
                line: 3,
            };
            let question = service.save_note(Note { id: String::new(), snapshot_id: id.clone(), anchor: Some(anchor.clone()), body: "Explain the existing-row and data-loss risks of these two lines. What safe rollout would you use?".into(), role: "user".into(), parent_id: None, github_draft: false, published_url: None, created_at: String::new() })?;
            let answer = service
                .ask(
                    &id,
                    &question.id,
                    "corpus-discussion",
                    Arc::new(|e| {
                        if e.phase != "stream" {
                            println!("Discussion: {}", e.phase);
                        }
                    }),
                )
                .await?;
            ensure!(
                answer.anchor.as_ref() == Some(&anchor) && !answer.body.trim().is_empty(),
                "Reply lost its exact anchor"
            );
            println!(
                "  Codex sections={} findings={} reply={} chars",
                workspace.guide.sections.len(),
                workspace
                    .guide
                    .sections
                    .iter()
                    .map(|s| s.findings.len())
                    .sum::<usize>(),
                answer.body.len()
            );
            workspace = service.saved(&id)?;
        }
        std::fs::write(
            directory.join(format!("pr-{number}.json")),
            serde_json::to_vec_pretty(&workspace)?,
        )?;
    }
    drop(service);
    let restored = Service::new(&directory)?;
    ensure!(
        restored.store.settings()?.locale == "en",
        "Settings did not survive restart"
    );
    println!("PASS: live GitHub corpus, all captured anchors, history, and local restart");
    Ok(())
}
