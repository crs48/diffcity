//! Opt-in naming guide check against synthetic source using local provider logins.
use diffcity_lib::{contracts::*, fixtures, service::Service};
use std::sync::Arc;

#[tokio::test]
#[ignore = "uses local Claude Code and Codex accounts"]
async fn providers_identify_durable_names_in_the_main_guide() {
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
        let provider = preference.provider.clone();
        if std::env::var("DIFFCITY_LIVE_PROVIDER").is_ok_and(|only| only != provider) {
            continue;
        }
        let guide = service
            .analyze_with_preference(
                &snapshot.id,
                "naming-live",
                Some(preference),
                Arc::new(|e| {
                    if e.phase != "stream" {
                        println!("{}: {}", e.phase, e.text);
                    }
                }),
            )
            .await
            .unwrap();
        assert_eq!(guide.policy_version, 5);
        let names: Vec<_> = guide
            .sections
            .iter()
            .flat_map(|s| &s.naming_decisions)
            .collect();
        assert!(
            names
                .iter()
                .any(|n| n.kind == NamingKind::Database && n.name == "expires_at"),
            "The persisted expiry contract should be a naming decision in this fixture"
        );
        assert!(names.len() <= 12);
        assert!(
            guide
                .sections
                .iter()
                .all(|s| s.naming_decisions.is_empty() || !s.foldable)
        );
        assert!(
            guide.sections.iter().all(|s| s.annotations.is_empty()),
            "No extra enrichment call is needed"
        );
        let selected = service
            .select_guide(&snapshot.id, guide.id.as_deref().unwrap())
            .unwrap();
        let restored = Service::new(directory.path())
            .unwrap()
            .saved(&snapshot.id)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&selected.guide).unwrap(),
            serde_json::to_value(&restored.guide).unwrap()
        );
        if let Ok(path) = std::env::var("DIFFCITY_NAMING_OUTPUT") {
            std::fs::write(
                format!("{path}-{provider}.json"),
                serde_json::to_vec_pretty(&restored).unwrap(),
            )
            .unwrap();
        }
        println!(
            "PASS {provider}: {} naming decisions, persisted with grounded anchors",
            names.len()
        );
    }
}
