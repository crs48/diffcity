//! Uses isolated data and real local logins; never publishes GitHub feedback.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> Result<()> {
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/guides-smoke"));
    let service = Service::new(&directory)?;
    let (snapshot, sample) = fixtures::sample()?;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    let initial = service.store.current_guide(sample)?;
    let preference = service.store.model_preference()?;
    for provider in ["codex", "claude"] {
        let catalog = service.provider_catalog(provider).await?;
        println!(
            "PASS: {provider} connected; {} models",
            catalog.models.len()
        );
    }
    if !std::env::args().any(|a| a == "--infer") {
        return Ok(());
    }
    let mut guides = vec![];
    for choice in [
        ModelPreference {
            provider: "codex".into(),
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("xhigh".into()),
        },
        ModelPreference {
            provider: "claude".into(),
            model: "claude-fable-5".into(),
            reasoning_effort: Some("high".into()),
        },
    ] {
        let expected = choice.clone();
        let cached = service
            .store
            .snapshot_documents::<Guide>("guide-version", &snapshot.id)?
            .into_iter()
            .find(|g| g.model == expected.model && g.source == expected.provider);
        let guide = if let Some(guide) = cached {
            guide
        } else {
            service
                .analyze_with_preference(
                    &snapshot.id,
                    "guides-smoke",
                    Some(choice),
                    Arc::new(|e| {
                        if e.phase != "stream" {
                            println!("Guide: {}", e.phase);
                        }
                    }),
                )
                .await?
        };
        ensure!(
            guide.source == expected.provider
                && guide.model == expected.model
                && guide.reasoning_effort == expected.reasoning_effort
        );
        ensure!(
            service.saved(&snapshot.id)?.guide.id == initial.id,
            "New run replaced the guide being read"
        );
        println!(
            "PASS: {} generated {} sections / {} overview characters",
            guide.model,
            guide.sections.len(),
            guide.summary.len()
        );
        guides.push(guide);
    }
    let mut progress = service.saved(&snapshot.id)?.progress;
    progress
        .reviewed
        .push(snapshot.files[0].hunks[0].id.clone());
    service.progress(&snapshot.id, progress.clone())?;
    for guide in &guides {
        let selected = service.select_guide(&snapshot.id, guide.id.as_deref().unwrap())?;
        ensure!(
            selected.guide.summary == guide.summary
                && selected.progress.reviewed == progress.reviewed
        );
        ensure!(Service::new(&directory)?.saved(&snapshot.id)?.guide.id == guide.id);
    }
    ensure!(
        service.store.model_preference()? == preference,
        "Guide choice changed the default model"
    );
    service
        .save_model_preference(ModelPreference {
            provider: "claude".into(),
            model: "claude-fable-5".into(),
            reasoning_effort: Some("low".into()),
        })
        .await?;
    let question = service.save_note(Note {
        thread_title: None,
        model: None,
        id: String::new(),
        snapshot_id: snapshot.id.clone(),
        anchor: None,
        body: "In one sentence, what should I check first in this PR?".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: false,
        published_url: None,
        created_at: String::new(),
    })?;
    let answer = service
        .ask(
            &snapshot.id,
            &question.id,
            "claude-chat-smoke",
            Arc::new(|_| {}),
        )
        .await?;
    ensure!(!answer.body.is_empty() && answer.model.is_some_and(|m| m.provider == "claude"));
    service.store.put("model-preference", "main", &preference)?;
    std::fs::write(
        directory.join("workspace.json"),
        serde_json::to_vec_pretty(&service.saved(&snapshot.id)?)?,
    )?;
    std::fs::write(
        directory.join("guides.json"),
        serde_json::to_vec_pretty(&service.guide_versions(&snapshot.id)?)?,
    )?;
    println!(
        "PASS: guides coexist, switch and survive restart; review marks and default preserved; Claude chat answered"
    );
    Ok(())
}
