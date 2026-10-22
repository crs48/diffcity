//! Exercise real local accounts concurrently against synthetic code, never GitHub feedback.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[tokio::main]
async fn main() -> Result<()> {
    if !std::env::args().any(|a| a == "--infer") {
        println!("Pass --infer to test concurrent jobs with local Claude Code and Codex logins.");
        return Ok(());
    }
    let directory = std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/concurrency-smoke"));
    let service = Service::new(&directory)?;
    let (mut snapshot, mut guide) = fixtures::sample()?;
    snapshot.id = format!("concurrent-{}", uuid::Uuid::new_v4());
    guide.snapshot_id = snapshot.id.clone();
    guide.id = None;
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    service.store.current_guide(guide)?;
    let choices = [
        ModelPreference::default(),
        ModelPreference::default(),
        ModelPreference {
            provider: "codex".into(),
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("medium".into()),
        },
    ];
    let questions: Vec<_> = snapshot.files.iter().take(3).enumerate().map(|(i,file)| {
        let hunk = &file.hunks[0];
        service.save_note(Note {
            id: String::new(), snapshot_id: snapshot.id.clone(),
            anchor: Some(Anchor {hunk_id:hunk.id.clone(),path:file.path.clone(),side:Side::RIGHT,start_line:1,line:1,text_selection:None}),
            body:format!("In two sentences, explain this line and its main review concern. This is independent conversation {}.",i+1),
            role:"user".into(),parent_id:None,github_draft:false,published_url:None,created_at:String::new(),model:None,
        })
    }).collect::<Result<_>>()?;
    let active = Arc::new(Mutex::new(std::collections::HashSet::new()));
    let emitter: Arc<dyn Fn(RunEvent) + Send + Sync> = {
        let active = active.clone();
        Arc::new(move |e| {
            if ["thinking", "analyzing"].contains(&e.phase.as_str()) {
                active.lock().unwrap().insert(e.run_id.clone());
            }
            if e.phase != "stream" {
                println!("{}: {}", e.run_id, e.phase);
            }
        })
    };
    let (g, a, b, c) = tokio::join!(
        service.analyze_with_preference(
            &snapshot.id,
            "guide",
            Some(ModelPreference::default()),
            emitter.clone()
        ),
        service.ask_with_preference(
            &snapshot.id,
            &questions[0].id,
            "question-a",
            Some(choices[0].clone()),
            emitter.clone()
        ),
        service.ask_with_preference(
            &snapshot.id,
            &questions[1].id,
            "question-b",
            Some(choices[1].clone()),
            emitter.clone()
        ),
        service.ask_with_preference(
            &snapshot.id,
            &questions[2].id,
            "question-c",
            Some(choices[2].clone()),
            emitter.clone()
        ),
    );
    let guide = g?;
    for (i, answer) in [a?, b?, c?].iter().enumerate() {
        ensure!(answer.parent_id.as_ref() == Some(&questions[i].id));
        ensure!(answer.anchor == questions[i].anchor && answer.model.as_ref() == Some(&choices[i]));
        ensure!(!answer.body.trim().is_empty());
        println!("PASS: {} answered its own thread", choices[i].model);
    }
    ensure!(active.lock().unwrap().len() == 4);
    ensure!(guide.source == "claude" && guide.model == "claude-fable-5");
    let mut followup = questions[0].clone();
    followup.id.clear();
    followup.body = "What did I ask you to explain earlier? Answer in one sentence.".into();
    let followup = service.save_note(followup)?;
    let answer = service
        .ask_with_preference(
            &snapshot.id,
            &followup.id,
            "followup",
            Some(choices[2].clone()),
            emitter,
        )
        .await?;
    ensure!(
        answer.model.as_ref() == Some(&choices[0]),
        "Follow-up changed the thread model"
    );
    std::fs::write(
        directory.join("workspace.json"),
        serde_json::to_vec_pretty(&service.saved(&snapshot.id)?)?,
    )?;
    println!(
        "PASS: guide + three questions completed; replies and follow-up model retained independently"
    );
    Ok(())
}
