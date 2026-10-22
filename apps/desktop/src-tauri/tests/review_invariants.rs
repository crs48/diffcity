use diffcity_lib::{
    contracts::*,
    domain::{self, Proposal},
    fixtures, github,
};
use serde_json::json;
use std::collections::HashSet;

fn snapshot() -> Snapshot {
    fixtures::sample().unwrap().0
}
fn ids(s: &Snapshot) -> HashSet<String> {
    s.files
        .iter()
        .flat_map(|f| f.hunks.iter().map(|h| h.id.clone()))
        .collect()
}
fn proposal(hunks: Vec<String>, attention: &str) -> Proposal {
    serde_json::from_value(json!({"summary":"Test review","limitations":[],"sections":[{"title":"Related change","summary":"Inspect the changed behavior.","explanation":"The changed path now handles the scenario described in this fixture.","attention":attention,"category":"Documentation","reason":"Grounded in the supplied diff.","hunkIds":hunks,"questions":[],"findings":[]}]})).unwrap()
}
#[test]
fn migration_and_authorization_precede_routine_content() {
    let (_, guide) = fixtures::sample().unwrap();
    assert_eq!(guide.sections[0].attention, Attention::High);
    assert_eq!(guide.sections[1].attention, Attention::High);
    assert!(guide.sections.last().unwrap().foldable);
}
#[test]
fn model_cannot_demote_a_migration() {
    let s = snapshot();
    let g = domain::validate_guide(
        &s,
        proposal(vec![s.files[0].hunks[0].id.clone()], "routine"),
        "test",
        &ids(&s),
    )
    .unwrap();
    assert_eq!(g.sections[0].attention, Attention::High);
    assert!(!g.sections[0].foldable);
}
#[test]
fn mixed_routine_and_migration_group_inherits_highest_attention() {
    let s = snapshot();
    let g = domain::validate_guide(
        &s,
        proposal(
            vec![
                s.files[0].hunks[0].id.clone(),
                s.files[4].hunks[0].id.clone(),
            ],
            "routine",
        ),
        "test",
        &ids(&s),
    )
    .unwrap();
    assert_eq!(g.sections[0].attention, Attention::High);
    assert!(!g.sections[0].foldable);
}
#[test]
fn omitted_hunks_remain_visible_and_unassessed() {
    let s = snapshot();
    let g = domain::validate_guide(
        &s,
        proposal(vec![s.files[4].hunks[0].id.clone()], "routine"),
        "test",
        &ids(&s),
    )
    .unwrap();
    assert_eq!(g.sections.iter().flat_map(|s| &s.hunk_ids).count(), 7);
    assert_eq!(
        g.sections
            .iter()
            .filter(|s| !s.assessed)
            .map(|s| s.hunk_ids.len())
            .sum::<usize>(),
        6
    );
    assert!(
        g.sections
            .iter()
            .filter(|s| !s.assessed)
            .all(|s| !s.foldable)
    );
}
#[test]
fn duplicate_primary_coverage_is_rejected() {
    let s = snapshot();
    let id = s.files[0].hunks[0].id.clone();
    assert!(
        domain::validate_guide(&s, proposal(vec![id.clone(), id], "high"), "test", &ids(&s))
            .is_err()
    );
}
#[test]
fn model_cannot_cite_context_it_was_not_given() {
    let s = snapshot();
    assert!(
        domain::validate_guide(
            &s,
            proposal(vec![s.files[0].hunks[0].id.clone()], "high"),
            "test",
            &HashSet::new()
        )
        .is_err()
    );
}
#[test]
fn unknown_hunk_ids_are_rejected() {
    let s = snapshot();
    assert!(
        domain::validate_guide(
            &s,
            proposal(vec!["hallucinated".into()], "routine"),
            "test",
            &ids(&s)
        )
        .is_err()
    );
}

#[test]
fn new_guides_require_explanations_but_old_saved_guides_still_load() {
    let s = snapshot();
    let mut p = proposal(vec![s.files[0].hunks[0].id.clone()], "high");
    p.sections[0].explanation = "  ".into();
    assert!(domain::validate_guide(&s, p, "test", &ids(&s)).is_err());
    let (_, guide) = fixtures::sample().unwrap();
    let mut saved = serde_json::to_value(guide).unwrap();
    for section in saved["sections"].as_array_mut().unwrap() {
        section.as_object_mut().unwrap().remove("explanation");
    }
    let restored: Guide = serde_json::from_value(saved).unwrap();
    assert!(restored.sections.iter().all(|s| s.explanation.is_empty()));
    assert!(!restored.sections[0].summary.is_empty());
}
#[test]
fn auth_change_in_documentation_is_not_hidden_by_filename() {
    let mut s = snapshot();
    s.files[1].hunks[0].path = "docs/example.md".into();
    let id = s.files[1].hunks[0].id.clone();
    let g = domain::validate_guide(&s, proposal(vec![id.clone()], "routine"), "test", &ids(&s))
        .unwrap();
    let section = g
        .sections
        .iter()
        .find(|s| s.hunk_ids.contains(&id))
        .unwrap();
    assert_eq!(section.attention, Attention::High);
    assert!(!section.foldable);
}
#[test]
fn documentation_only_pr_opens_its_primary_step() {
    let mut s = snapshot();
    s.files = vec![s.files[4].clone()];
    let g = domain::validate_guide(
        &s,
        proposal(vec![s.files[0].hunks[0].id.clone()], "routine"),
        "test",
        &ids(&s),
    )
    .unwrap();
    assert_eq!(g.sections.len(), 1);
    assert!(!g.sections[0].foldable);
}
#[test]
fn source_anchors_reject_wrong_side_and_out_of_diff_ranges() {
    let s = snapshot();
    let h = &s.files[0].hunks[0];
    let mut a = Anchor {
        text_selection: None,
        hunk_id: h.id.clone(),
        path: h.path.clone(),
        side: Side::RIGHT,
        start_line: 1,
        line: 2,
    };
    assert!(domain::validate_anchor(&s, &a).is_ok());
    a.side = Side::LEFT;
    assert!(domain::validate_anchor(&s, &a).is_err());
    a.side = Side::RIGHT;
    a.line = 999;
    assert!(domain::validate_anchor(&s, &a).is_err());
}
#[test]
fn changed_content_loses_progress_but_unchanged_code_keeps_it() {
    let old = snapshot();
    let mut new = old.clone();
    let previous = ReviewProgress {
        reviewed: old
            .files
            .iter()
            .flat_map(|f| f.hunks.iter().map(|h| h.id.clone()))
            .collect(),
        acknowledged: vec![old.files[4].hunks[0].id.clone()],
        ..Default::default()
    };
    new.files[0].hunks[0].id = "new-migration".into();
    new.files[0].hunks[0].fingerprint = "modified".into();
    new.files[1].hunks[0].id = "same-auth-new-revision".into();
    let (p, changed) = domain::transfer_progress(&old, &new, &previous);
    assert!(!p.reviewed.contains(&"new-migration".into()));
    assert!(p.reviewed.contains(&"same-auth-new-revision".into()));
    assert!(p.acknowledged.is_empty());
    assert_eq!(changed, vec!["new-migration"]);
}
#[test]
fn private_notes_never_enter_publication_payload() {
    let s = snapshot();
    let mut n = Note {
        model: None,
        id: "private".into(),
        snapshot_id: s.id.clone(),
        anchor: None,
        body: "Do not publish this private thought".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: false,
        published_url: None,
        created_at: String::new(),
    };
    let mut r = PublishRequest {
        snapshot_id: s.id.clone(),
        note_ids: vec![],
        body: "Public summary".into(),
        event: "COMMENT".into(),
    };
    let p = github::payload(&s, &r, &[n.clone()], "reviewer").unwrap();
    assert!(!p.to_string().contains("private thought"));
    r.note_ids.push(n.id.clone());
    assert!(github::payload(&s, &r, &[n.clone()], "reviewer").is_err());
    n.github_draft = true;
    let p = github::payload(&s, &r, &[n], "reviewer").unwrap();
    assert!(p["body"].as_str().unwrap().contains("private thought"));
}
#[test]
fn self_approval_is_rejected_before_network() {
    let s = snapshot();
    let r = PublishRequest {
        snapshot_id: s.id.clone(),
        note_ids: vec![],
        body: "Looks good".into(),
        event: "APPROVE".into(),
    };
    assert!(github::payload(&s, &r, &[], &s.pull.author).is_err());
}
#[test]
fn multiline_deletion_uses_left_source_coordinates() {
    let mut s = snapshot();
    let h = domain::parse_patch("old.ts", "@@ -8,2 +8,0 @@\n-old\n-code", "left")
        .unwrap()
        .remove(0);
    s.files[0].hunks = vec![h.clone()];
    let n = Note {
        model: None,
        id: "draft".into(),
        snapshot_id: s.id.clone(),
        anchor: Some(Anchor {
            text_selection: None,
            hunk_id: h.id,
            path: "old.ts".into(),
            side: Side::LEFT,
            start_line: 8,
            line: 9,
        }),
        body: "Explain this deletion".into(),
        role: "user".into(),
        parent_id: None,
        github_draft: true,
        published_url: None,
        created_at: String::new(),
    };
    let r = PublishRequest {
        snapshot_id: s.id.clone(),
        note_ids: vec![n.id.clone()],
        body: String::new(),
        event: "COMMENT".into(),
    };
    let p = github::payload(&s, &r, &[n], "reviewer").unwrap();
    assert_eq!(p["comments"][0]["side"], "LEFT");
    assert_eq!(p["comments"][0]["start_line"], 8);
    assert_eq!(p["comments"][0]["line"], 9);
}

#[test]
fn translation_key_removals_and_placeholder_changes_are_not_routine() {
    for patch in [
        "@@ -1 +1 @@\n-  \"greeting\": \"Hello {name}\"\n+  \"greeting\": \"Welcome {user}\"",
        "@@ -1 +1 @@\n-  \"greeting\": \"Hello\"\n+  \"welcome\": \"Hello\"",
    ] {
        let hunks = domain::parse_patch("locales/en.json", patch, "test").unwrap();
        assert_eq!(domain::rule(&hunks[0]).0, Attention::High);
    }
    let copy = domain::parse_patch(
        "locales/en.json",
        "@@ -1 +1 @@\n-  \"greeting\": \"Hello {name}\"\n+  \"greeting\": \"Welcome {name}\"",
        "test",
    )
    .unwrap();
    assert_eq!(domain::rule(&copy[0]).0, Attention::NeedsAssessment);
}

#[test]
fn skipped_and_unknown_checks_are_never_reported_as_passed() {
    let checks = vec![
        json!({"status":"completed","conclusion":"skipped"}),
        json!({"status":"completed","conclusion":"new_state"}),
    ];
    let summary = github::summarize_checks(&checks, &json!({"total_count":2,"state":"failure"}));
    assert!(!summary.contains("passed"));
    assert!(summary.contains("skipped or neutral"));
    assert!(summary.contains("unknown"));
    assert!(summary.contains("status contexts failed"));
}

#[test]
fn earlier_revision_notes_can_be_reopened_without_changing_latest() {
    use diffcity_lib::service::Service;
    let directory = tempfile::tempdir().unwrap();
    let service = Service::new(directory.path()).unwrap();
    let mut first = snapshot();
    first.captured_at = "2026-10-20T00:00:00Z".into();
    let mut second = first.clone();
    second.id = "new-revision".into();
    second.pull.head = "new-head".into();
    second.captured_at = "2026-10-20T00:01:00Z".into();
    service.store.put("snapshot", &first.id, &first).unwrap();
    service.store.put("snapshot", &second.id, &second).unwrap();
    let key = domain::pull_key(&first.pull);
    service.store.put("latest", &key, &second.id).unwrap();
    let note = service
        .save_note(Note {
            model: None,
            id: String::new(),
            snapshot_id: first.id.clone(),
            anchor: None,
            body: "Private prior context".into(),
            role: "user".into(),
            parent_id: None,
            github_draft: false,
            published_url: None,
            created_at: String::new(),
        })
        .unwrap();
    let current = service.saved(&second.id).unwrap();
    assert_eq!(current.previous_snapshot_id, Some(first.id.clone()));
    let previous = service
        .saved(current.previous_snapshot_id.as_deref().unwrap())
        .unwrap();
    assert_eq!(previous.notes[0].id, note.id);
    assert_eq!(
        service.store.get::<String>("latest", &key).unwrap(),
        Some(second.id)
    );
}

#[test]
fn historical_prs_distinguish_closed_from_merged_and_block_publication() {
    use diffcity_lib::github;
    let closed = serde_json::json!({"number":3,"state":"closed","merged_at":null});
    let merged =
        serde_json::json!({"number":4,"state":"closed","merged_at":"2026-10-20T12:00:00Z"});
    assert_eq!(github::parse_pull("owner/repo", &closed).state, "closed");
    assert_eq!(github::parse_pull("owner/repo", &merged).state, "merged");
    let (mut snapshot, _) = diffcity_lib::fixtures::sample().unwrap();
    snapshot.pull.state = "merged".into();
    let request = diffcity_lib::contracts::PublishRequest {
        snapshot_id: snapshot.id.clone(),
        note_ids: vec![],
        body: "private historical note".into(),
        event: "COMMENT".into(),
    };
    assert!(github::payload(&snapshot, &request, &[], "reviewer").is_err());
}
