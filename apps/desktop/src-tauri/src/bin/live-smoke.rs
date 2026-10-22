use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/live-smoke"));
    let service = Service::new(&directory)?;
    let bootstrap = service.bootstrap().await?;
    println!(
        "GitHub: {} · connected={}",
        bootstrap.github.identity, bootstrap.github.connected
    );
    println!(
        "Codex: {} · connected={} · models={}",
        bootstrap.codex.detail,
        bootstrap.codex.connected,
        bootstrap.models.len()
    );
    anyhow::ensure!(
        bootstrap.github.connected,
        "GitHub: {}",
        bootstrap.github.detail
    );
    anyhow::ensure!(
        bootstrap.codex.connected,
        "Codex: {}",
        bootstrap.codex.detail
    );
    if std::env::var("DIFFCITY_CONNECT_ONLY").as_deref() == Ok("1") {
        println!("PASS: live GitHub and Codex connection checks");
        return Ok(());
    }
    let inbox = service.inbox().await?;
    println!("GitHub inbox fetched: {} PRs", inbox.len());
    let (snapshot, _) = fixtures::sample()?;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    let guide = service
        .analyze(
            &snapshot.id,
            "live-smoke",
            Arc::new(|e| println!("Codex: {}", e.phase)),
        )
        .await?;
    anyhow::ensure!(guide.source == "codex", "Expected a live Codex guide");
    anyhow::ensure!(
        guide
            .sections
            .iter()
            .filter(|s| s.assessed)
            .flat_map(|s| &s.hunk_ids)
            .count()
            == snapshot.files.iter().map(|f| f.hunks.len()).sum::<usize>(),
        "Expected complete sample coverage"
    );
    println!(
        "Guide: {} sections · {} findings",
        guide.sections.len(),
        guide
            .sections
            .iter()
            .map(|s| s.findings.len())
            .sum::<usize>()
    );
    let hunk = &snapshot.files[0].hunks[0];
    let note = service.save_note(Note {
        id: String::new(),
        snapshot_id: snapshot.id.clone(),
        anchor: Some(Anchor {
            text_selection: None,
            hunk_id: hunk.id.clone(),
            path: hunk.path.clone(),
            side: Side::RIGHT,
            start_line: 1,
            line: 1,
        }),
        body: "What happens to existing rows when this migration runs?".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: false,
        published_url: None,
        created_at: String::new(),
    })?;
    let answer = service
        .ask(
            &snapshot.id,
            &note.id,
            "live-question",
            Arc::new(|e| {
                if e.phase != "stream" {
                    println!("Discussion: {}", e.phase)
                }
            }),
        )
        .await?;
    anyhow::ensure!(
        !answer.body.trim().is_empty(),
        "Codex returned an empty answer"
    );
    println!("Line discussion saved: {} characters", answer.body.len());
    drop(service);
    let restored = Service::new(&directory)?;
    anyhow::ensure!(
        restored
            .store
            .notes(&snapshot.id)?
            .iter()
            .any(|n| n.id == answer.id),
        "Discussion did not survive restart"
    );
    println!("PASS: local GitHub + Codex analysis + grounded line discussion + SQLite restart");
    Ok(())
}
