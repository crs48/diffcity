//! Opt-in local-provider check; synthetic code only, never calls GitHub publication.
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::sync::Arc;
#[tokio::test]
#[ignore = "uses local Claude Code and Codex accounts"]
async fn requested_feedback_becomes_an_unpublished_local_draft() {
    for provider in ["claude", "codex"] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        let (snapshot, _) = fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let h = &snapshot.files[1].hunks[0];
        let question=service.save_note(Note{thread_title:None,model:None,id:String::new(),snapshot_id:snapshot.id.clone(),anchor:Some(Anchor{hunk_id:h.id.clone(),path:h.path.clone(),side:Side::RIGHT,start_line:3,line:4,text_selection:None}),body:"Please leave a concise GitHub review comment for the PR author asking them to scope the invitation lookup by tenant. Prepare the local draft; do not publish it.".into(),role:"user".into(),parent_id:None,github_draft:false,published_url:None,created_at:String::new()}).unwrap();
        let preference = if provider == "claude" {
            ModelPreference::default()
        } else {
            ModelPreference {
                provider: "codex".into(),
                model: "gpt-6-astra".into(),
                reasoning_effort: Some("medium".into()),
            }
        };
        let reply = service
            .ask_with_preference(
                &snapshot.id,
                &question.id,
                "draft-live",
                Some(preference),
                Arc::new(|_| {}),
            )
            .await
            .unwrap();
        let notes = service.store.notes(&snapshot.id).unwrap();
        let draft = notes
            .iter()
            .find(|n| n.github_draft && n.parent_id.as_deref() == Some(reply.id.as_str()))
            .expect("AI should prepare the requested local draft");
        assert_eq!(draft.anchor, question.anchor);
        assert!(draft.published_url.is_none());
        assert!(!draft.body.contains("diffcity-github-draft"));
        assert!(!reply.body.contains("diffcity-github-draft"));
        let restored = Service::new(dir.path())
            .unwrap()
            .store
            .notes(&snapshot.id)
            .unwrap();
        assert!(restored.iter().any(|n| n.id == draft.id && n.github_draft));
        println!("PASS {provider}: exact line range, local draft persisted, unpublished");
    }
}
