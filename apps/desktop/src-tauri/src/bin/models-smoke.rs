use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/models-smoke"));
    let service = Service::new(&directory)?;
    let catalog = service.model_catalog().await?;
    std::fs::write(
        directory.join("models.json"),
        serde_json::to_vec_pretty(&catalog.models)?,
    )?;
    for model in &catalog.models {
        println!(
            "{}: {}",
            model.id,
            model
                .reasoning_efforts
                .iter()
                .map(|o| o.effort.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    let preference = service
        .save_model_preference(ModelPreference::default())
        .await?;
    ensure!(
        Service::new(&directory)?.store.model_preference()? == preference,
        "Model selection did not survive restart"
    );
    println!(
        "PASS: catalog and persisted {} / {}",
        preference.model,
        preference.reasoning_effort.as_deref().unwrap_or("default")
    );
    if !std::env::args().any(|arg| arg == "--infer") {
        return Ok(());
    }
    let (snapshot, _) = fixtures::sample()?;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    let guide = service
        .analyze(
            &snapshot.id,
            "model-guide-smoke",
            Arc::new(|event| {
                if event.phase != "stream" {
                    println!("Guide: {}", event.phase);
                }
            }),
        )
        .await?;
    ensure!(
        guide.model == preference.model,
        "Guide used a different model"
    );
    let note = service.save_note(Note {
        model: None,
        id: String::new(),
        snapshot_id: snapshot.id.clone(),
        anchor: None,
        body: "In one sentence, what is the main migration risk in this sample PR?".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: false,
        published_url: None,
        created_at: String::new(),
    })?;
    let answer = service
        .ask(&snapshot.id, &note.id, "model-chat-smoke", Arc::new(|_| {}))
        .await?;
    ensure!(!answer.body.is_empty(), "Empty model response");
    println!(
        "PASS: {} guide sections and {} character chat answer using saved model preference",
        guide.sections.len(),
        answer.body.len()
    );
    Ok(())
}
