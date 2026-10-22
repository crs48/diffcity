//! Exercise precise text questions and follow-ups through the local Codex runtime.
//! Uses isolated local data and never publishes to GitHub.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/text-selection-smoke"));
    let service = Service::new(&directory)?;
    let (snapshot, guide) = fixtures::sample()?;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    service.store.put("guide", &snapshot.id, &guide)?;
    let preference = service
        .save_model_preference(ModelPreference::default())
        .await?;
    let anchor = Anchor {
        hunk_id: snapshot.files[2].hunks[0].id.clone(),
        path: snapshot.files[2].path.clone(),
        side: Side::RIGHT,
        start_line: 1,
        line: 1,
        text_selection: Some(TextSelection {
            snapshot_id: snapshot.id.clone(),
            start_column: 13,
            end_column: 29,
            text: "invitationExpiry".into(),
        }),
    };
    for (index, body) in [
        "Help me understand this selected code. What does it do, and how does it fit into the surrounding code?",
        "For this same selected helper, does seven days mean calendar days or elapsed hours? Keep the answer brief.",
    ].into_iter().enumerate() {
        let question = service.save_note(Note {
            id: String::new(), snapshot_id: snapshot.id.clone(), anchor: Some(anchor.clone()),
            body: body.into(), role: "user".into(), parent_id: None,
            github_draft: false, published_url: None, created_at: String::new(),
        })?;
        let answer = service.ask(&snapshot.id, &question.id, &format!("text-smoke-{index}"), Arc::new(|event| {
            if event.phase != "stream" { println!("Codex: {}", event.phase); }
        })).await?;
        ensure!(!answer.body.trim().is_empty(), "Codex returned an empty answer");
        ensure!(answer.anchor == Some(anchor.clone()), "Reply changed the selected text");
        ensure!(!answer.github_draft && answer.published_url.is_none(), "Text reply became publishable");
        println!("PASS: question {} → {} character AI-only answer", index + 1, answer.body.chars().count());
    }
    let reopened = Service::new(&directory)?;
    let notes = reopened.store.notes(&snapshot.id)?;
    ensure!(
        notes.len() >= 4
            && notes
                .iter()
                .all(|n| n.anchor == Some(anchor.clone()) && !n.github_draft),
        "Conversation did not persist"
    );
    let workspace = serde_json::json!({"snapshot":snapshot,"guide":guide,"notes":notes});
    std::fs::write(
        directory.join("conversation.json"),
        serde_json::to_vec_pretty(&workspace)?,
    )?;
    println!(
        "PASS: persisted precise selection and follow-up with {} / {:?}",
        preference.model, preference.reasoning_effort
    );
    Ok(())
}
