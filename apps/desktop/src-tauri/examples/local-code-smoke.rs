//! Verify real provider tools read evidence absent from the prompt. No remote writes.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
fn git(path: &Path, args: &[&str]) -> Result<String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(path)
        .output()?;
    ensure!(output.status.success(), "Git fixture setup failed");
    Ok(String::from_utf8(output.stdout)?.trim().into())
}
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if !args.iter().any(|s| s == "--infer") {
        println!("Pass --infer [claude|codex] for a live local repository reading check.");
        return Ok(());
    }
    let provider = args
        .last()
        .filter(|s| matches!(s.as_str(), "claude" | "codex"))
        .map(String::as_str)
        .unwrap_or("claude");
    let directory = PathBuf::from(".local").join(format!(
        "local-code-smoke-{provider}-{}",
        uuid::Uuid::new_v4()
    ));
    let checkout = directory.join("code/unexpected-name");
    std::fs::create_dir_all(checkout.join("docs"))?;
    let marker = format!("evidence-{}", uuid::Uuid::new_v4());
    let history = format!("history-{}", uuid::Uuid::new_v4());
    std::fs::write(
        checkout.join("docs/probe.txt"),
        format!("The local evidence marker is {marker}.\n"),
    )?;
    git(&checkout, &["init", "-q"])?;
    git(
        &checkout,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/diffcity-fixtures/local-code",
        ],
    )?;
    git(&checkout, &["add", "."])?;
    git(
        &checkout,
        &[
            "-c",
            "user.name=Diffcity test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            &history,
        ],
    )?;
    let service = Service::new(&directory.join("data"))?;
    service
        .save_code_roots(vec![
            directory
                .join("code")
                .canonicalize()?
                .to_string_lossy()
                .into(),
        ])
        .await?;
    let (mut snapshot, mut guide) = fixtures::sample()?;
    snapshot.pull.repository = "diffcity-fixtures/local-code".into();
    snapshot.pull.head = git(&checkout, &["rev-parse", "HEAD"])?;
    snapshot.id = format!("local-code-{}", uuid::Uuid::new_v4());
    guide.snapshot_id = snapshot.id.clone();
    guide.id = None;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    service.store.current_guide(guide)?;
    let question = service.save_note(Note { id: String::new(), snapshot_id: snapshot.id.clone(), anchor: None,
        body: "Use your local repository tools to read docs/probe.txt and run git log -1 --format=%s. Report the exact evidence marker from that file and the exact most recent commit subject. Neither value appears in the supplied PR data. Do not invent them and do not change any file.".into(),
        role: "user".into(), parent_id: None, github_draft: false, published_url: None, created_at: String::new(), model: None, thread_title: None })?;
    let preference = if provider == "codex" {
        ModelPreference {
            provider: "codex".into(),
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("medium".into()),
        }
    } else {
        ModelPreference::default()
    };
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    let answer = service
        .ask_with_preference(
            &snapshot.id,
            &question.id,
            "repository-proof",
            Some(preference),
            Arc::new(move |e| {
                if e.phase == "tool" {
                    observed.fetch_add(1, Ordering::Relaxed);
                }
                if e.phase != "stream" {
                    println!("{}: {}", e.phase, e.text);
                }
            }),
        )
        .await?;
    std::fs::write(directory.join("answer.txt"), &answer.body)?;
    ensure!(
        answer.body.contains(&marker),
        "Agent did not retrieve the local file marker; see {}",
        directory.display()
    );
    ensure!(
        answer.body.contains(&history),
        "Agent did not retrieve local Git history; see {}",
        directory.display()
    );
    ensure!(
        count.load(Ordering::Relaxed) > 0,
        "No repository tool activity observed"
    );
    ensure!(
        git(&checkout, &["status", "--porcelain"])?.is_empty(),
        "Fixture checkout was changed"
    );
    println!(
        "PASS: {provider} read an unseen local file and Git history with real tools; checkout unchanged."
    );
    Ok(())
}
