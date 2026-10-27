//! Live provider regression for an ambiguous question attached to a GitHub comment.
//! Uses synthetic comments in an isolated store; never posts to GitHub.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if !args.iter().any(|s| s == "--infer") {
        println!(
            "Pass --infer [claude|codex] to ask a real model about a synthetic GitHub thread."
        );
        return Ok(());
    }
    let provider = args
        .last()
        .filter(|s| matches!(s.as_str(), "claude" | "codex"))
        .map(String::as_str)
        .unwrap_or("claude");
    let directory = PathBuf::from(".local").join(format!(
        "comment-context-{provider}-{}",
        uuid::Uuid::new_v4()
    ));
    let service = Service::new(&directory.join("data"))?;
    let (snapshot, guide) = fixtures::sample()?;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    service.store.current_guide(guide)?;
    let hunk = &snapshot.files[0].hunks[0];
    let line = hunk.lines.iter().find_map(|l| l.new).unwrap();
    let anchor = Anchor {
        text_selection: None,
        hunk_id: hunk.id.clone(),
        path: hunk.path.clone(),
        side: Side::RIGHT,
        start_line: line,
        line,
    };
    let mut comments: Vec<RemoteComment> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/comment-context.json"
    ))?;
    comments[1].path = Some(anchor.path.clone());
    comments[1].line = Some(line);
    service.store.put("comments", &snapshot.id, &comments)?;
    let question = service.save_note(Note {
        id: String::new(),
        snapshot_id: snapshot.id.clone(),
        anchor: Some(anchor),
        body: "what's this?".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: false,
        published_url: None,
        created_at: String::new(),
        model: None,
        thread_title: None,
    })?;
    let preference = if provider == "codex" {
        ModelPreference {
            provider: provider.into(),
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("medium".into()),
        }
    } else {
        ModelPreference::default()
    };
    let answer = service
        .ask_with_preference(
            &snapshot.id,
            &question.id,
            "comment-context-proof",
            Some(preference),
            Arc::new(|e| {
                if e.phase != "stream" {
                    println!("{}: {}", e.phase, e.text);
                }
            }),
        )
        .await?;
    std::fs::write(directory.join("answer.md"), &answer.body)?;
    let body = answer.body.to_lowercase();
    ensure!(
        body.contains("smoke") && body.contains("auth") && body.contains("deploy"),
        "Answer missed the comment and its replies: {}",
        directory.display()
    );
    println!(
        "PASS: {provider} explained the smoke-coverage finding and authentication reply.\n{}\nSaved: {}",
        answer.body,
        directory.display()
    );
    Ok(())
}
