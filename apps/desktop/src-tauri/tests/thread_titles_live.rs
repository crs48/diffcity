//! Opt-in contract check against the two local AI logins, using synthetic code only.
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::sync::Arc;

#[tokio::test]
#[ignore = "uses local Claude Code and Codex accounts"]
async fn titles_survive_reload_and_followups_for_both_providers() {
    let directory = tempfile::tempdir().unwrap();
    let service = Service::new(directory.path()).unwrap();
    let (snapshot, _) = fixtures::sample().unwrap();
    service
        .store
        .put("snapshot", &snapshot.id, &snapshot)
        .unwrap();
    for preference in [
        ModelPreference::default(),
        ModelPreference {
            provider: "codex".into(),
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("medium".into()),
        },
    ] {
        let hunk = &snapshot.files[if preference.provider == "claude" {
            0
        } else {
            1
        }]
        .hunks[0];
        let question = service
            .save_note(Note {
                thread_title: None,
                model: None,
                id: String::new(),
                snapshot_id: snapshot.id.clone(),
                anchor: Some(Anchor {
                    hunk_id: hunk.id.clone(),
                    path: hunk.path.clone(),
                    side: Side::RIGHT,
                    start_line: 1,
                    line: 1,
                    text_selection: None,
                }),
                body: "Explain this code's main review concern in two sentences.".into(),
                role: "user".into(),
                parent_id: None,
                github_draft: false,
                published_url: None,
                created_at: String::new(),
            })
            .unwrap();
        let answer = service
            .ask_with_preference(
                &snapshot.id,
                &question.id,
                "title",
                Some(preference.clone()),
                Arc::new(|_| {}),
            )
            .await
            .unwrap();
        let title = answer.thread_title.as_ref().expect("AI omitted the title");
        assert!(!title.trim().is_empty() && title.chars().count() <= 72);
        assert!(!answer.body.contains("diffcity-thread-title"));
        let loaded: Note = service.store.get("note", &answer.id).unwrap().unwrap();
        assert_eq!(loaded.thread_title.as_ref(), Some(title));
        let mut followup = question.clone();
        followup.id.clear();
        followup.body = "Summarize that in one short sentence.".into();
        let followup = service.save_note(followup).unwrap();
        let response = service
            .ask_with_preference(
                &snapshot.id,
                &followup.id,
                "followup",
                Some(preference.clone()),
                Arc::new(|_| {}),
            )
            .await
            .unwrap();
        assert!(
            response.thread_title.is_none(),
            "Follow-up retitled the conversation"
        );
        assert!(!response.body.contains("diffcity-thread-title"));
        println!(
            "PASS {}: {title}; title persisted and stayed stable",
            preference.provider
        );
    }
}
