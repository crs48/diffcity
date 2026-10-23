//! Opt-in first-guide plus background enrichment check, synthetic code and local AI logins only.
use diffcity_lib::{contracts::*, domain, fixtures, service::Service};
use std::sync::Arc;

#[tokio::test]
#[ignore = "uses local Claude Code and Codex accounts"]
async fn both_providers_generate_and_persist_anchored_marginalia() {
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
                "annotations-live",
                Some(preference),
                Arc::new(|event| {
                    if ["started", "analyzing", "annotating", "complete"]
                        .contains(&event.phase.as_str())
                    {
                        println!("{}: {}", event.phase, event.text);
                    }
                }),
            )
            .await
            .unwrap();
        assert_eq!(guide.policy_version, 5);
        assert!(
            guide.sections.iter().all(|s| s.annotations.is_empty()),
            "The first guide must be readable before enrichment"
        );
        let guide = service
            .enrich_guide(
                &snapshot.id,
                guide.id.as_deref().unwrap(),
                EnrichmentTier::Priority,
                "background-live",
                Arc::new(|event| println!("{}: {}", event.phase, event.text)),
            )
            .await
            .unwrap();
        let state = guide.enrichment.as_ref().unwrap();
        assert!(
            state
                .files
                .iter()
                .filter(|f| f.tier == EnrichmentTier::Further)
                .all(|f| f.status == EnrichmentStatus::Pending)
        );
        assert!(
            state
                .files
                .iter()
                .filter(|f| f.tier == EnrichmentTier::Priority)
                .all(|f| f.status == EnrichmentStatus::Complete)
        );
        let notes: Vec<_> = guide.sections.iter().flat_map(|s| &s.annotations).collect();
        // A completed inspection may legitimately find nothing new to add.
        // Quotas would encourage exactly the noise this pass is meant to avoid.
        assert!(notes.len() <= 12);
        for note in &notes {
            domain::validate_anchor(&snapshot, &note.anchor).unwrap();
        }
        service
            .select_guide(&snapshot.id, guide.id.as_deref().unwrap())
            .unwrap();
        let restored = Service::new(directory.path())
            .unwrap()
            .saved(&snapshot.id)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&restored.guide).unwrap(),
            serde_json::to_value(&guide).unwrap()
        );
        if let Ok(path) = std::env::var("DIFFCITY_ANNOTATIONS_OUTPUT") {
            std::fs::write(
                format!("{path}-{provider}.json"),
                serde_json::to_vec_pretty(&restored).unwrap(),
            )
            .unwrap();
        }
        println!(
            "PASS {provider}: {} grounded code notes; guide and annotations persisted",
            notes.len()
        );
    }
}
