use crate::{contracts::*, domain, github};
use anyhow::Result;
use serde_json::{Value, json};

pub fn sample() -> Result<(Snapshot, Guide)> {
    let raw: Value =
        serde_json::from_str(include_str!("../../../../tests/fixtures/invitations.json"))?;
    let id = "demo-invitations-v1".to_string();
    let files = raw["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let path = github::string(v, "filename");
            Ok(ChangedFile {
                hunks: domain::parse_patch(&path, v["patch"].as_str().unwrap(), &id)?,
                path,
                previous_path: None,
                status: "added".into(),
                additions: v["additions"].as_u64().unwrap() as u32,
                deletions: 0,
                unavailable: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let snapshot = Snapshot {
        id,
        pull: github::parse_pull("diffcity/demo", &raw["pull"]),
        captured_at: chrono::Utc::now().to_rfc3339(),
        files,
        limitations: vec![],
    };
    let groups = [
        (
            vec![0],
            "Make existing invitations compatible",
            "high",
            "Database migration",
            "A new required column changes existing rows. Inspect the backfill before deployment.",
            "Existing rows need an expiry value before adding NOT NULL.",
        ),
        (
            vec![1],
            "Keep invitations inside their team",
            "high",
            "Authorization",
            "Follow the tenant boundary through both lookup and creation.",
            "The lookup searches by email without tenant scope; check cross-team access.",
        ),
        (
            vec![2, 3],
            "Give new invitations a seven-day lifetime",
            "standard",
            "Implementation and tests",
            "The helper and its test define the expiry behavior.",
            "Read the implementation and its focused test together.",
        ),
        (
            vec![4],
            "Explain the invitation workflow",
            "routine",
            "Documentation",
            "Prose explains the Members page and seven-day expiry.",
            "Documentation only; expand to inspect the copy.",
        ),
        (
            vec![5, 6],
            "Add invitation copy in two languages",
            "routine",
            "Localization",
            "New UI copy in English and French, with matching keys.",
            "No interpolation placeholders in this sample. Expand to inspect each locale.",
        ),
    ];
    let sections:Vec<Value>=groups.into_iter().map(|(indices,title,attention,category,summary,reason)|json!({"title":title,"summary":summary,"attention":attention,"category":category,"reason":reason,"hunkIds":indices.into_iter().flat_map(|i|snapshot.files[i].hunks.iter().map(|h|h.id.clone())).collect::<Vec<_>>(),"questions":[],"findings":[]})).collect();
    let proposal = serde_json::from_value(
        json!({"summary":"Introduce team invitations, their expiry policy, and supporting copy. Start with the migration and tenant boundary.","sections":sections,"limitations":["This sample guide is authored fixture data, not a live Codex result. Use Review with Codex to analyze it."]}),
    )?;
    let ids = snapshot
        .files
        .iter()
        .flat_map(|f| f.hunks.iter().map(|h| h.id.clone()))
        .collect();
    let mut guide = domain::validate_guide(&snapshot, proposal, "fixture", &ids)?;
    guide.source = "sample".into();
    Ok((snapshot, guide))
}

pub const INBOX_REPO: &str = "diffcity/inbox-samples";
pub fn is_sample_repo(repo: &str) -> bool {
    matches!(repo, "diffcity/demo" | INBOX_REPO)
}
pub fn inbox(login: &str) -> Result<Vec<PullRequest>> {
    let scenarios: Vec<Value> =
        serde_json::from_str(include_str!("../../../../tests/fixtures/inbox.json"))?;
    let now = chrono::Utc::now();
    let ago = |hours: f64| (now - chrono::Duration::seconds((hours * 3600.0) as i64)).to_rfc3339();
    let template = sample()?.0.pull;
    scenarios.iter().map(|s| {
        let mut pull = template.clone();
        pull.repository = INBOX_REPO.into();
        pull.number = s["number"].as_u64().unwrap() as u32;
        pull.title = github::string(s, "title");
        pull.author = if s["author"] == "$viewer" { login.into() } else { github::string(s, "author") };
        pull.body = "Local inbox sample. Authors and review states are fictional; the code is the shared invitations walkthrough. Nothing here is posted to GitHub.".into();
        pull.url = String::new();
        pull.draft = s["draft"].as_bool().unwrap_or(false);
        pull.state = s["state"].as_str().unwrap_or("open").into();
        pull.updated_at = ago(s["ageHours"].as_f64().unwrap_or(0.0));
        pull.closed_at = s["completedHours"].as_f64().map(ago);
        pull.merged_at = (pull.state == "merged").then(|| pull.closed_at.clone()).flatten();
        pull.requested = if s["requested"] == true { vec![login.into()] } else { vec![] };
        pull.assigned = if s["assigned"] == true { vec![login.into()] } else { vec![] };
        pull.review_metadata_available = true;
        pull.review_decision = s["decision"].as_str().map(str::to_owned);
        pull.status = s.get("status").map(|status| serde_json::from_value(status.clone())).transpose()?;
        pull.viewer_review = s["review"].as_str().map(|state| SubmittedReview { state: state.into(), submitted_at: ago(24.0) });
        Ok(pull)
    }).collect()
}
pub fn inbox_review(login: &str, number: u32) -> Result<(Snapshot, Guide)> {
    let pull = inbox(login)?
        .into_iter()
        .find(|p| p.number == number)
        .ok_or_else(|| anyhow::anyhow!("Unknown sample PR"))?;
    let (mut snapshot, mut guide) = sample()?;
    snapshot.id = format!("sample-inbox-v1-{number}");
    snapshot.pull = pull;
    guide.snapshot_id = snapshot.id.clone();
    Ok((snapshot, guide))
}

#[cfg(test)]
mod inbox_tests {
    use super::*;
    #[test]
    fn samples_are_local_and_every_card_opens_a_valid_review() {
        let pulls = inbox("me").unwrap();
        assert_eq!(pulls.len(), 23);
        assert!(
            pulls
                .iter()
                .all(|p| p.url.is_empty() && is_sample_repo(&p.repository))
        );
        assert!(pulls.iter().any(|p| p.author == "me" && p.draft));
        assert!(
            pulls
                .iter()
                .any(|p| p.viewer_review.is_some() && !p.requested.is_empty())
        );
        for pull in pulls {
            let (snapshot, guide) = inbox_review("me", pull.number).unwrap();
            assert_eq!(guide.snapshot_id, snapshot.id);
            assert_eq!(snapshot.pull.number, pull.number);
            for section in guide.sections {
                for id in section.hunk_ids {
                    assert!(
                        snapshot
                            .files
                            .iter()
                            .flat_map(|f| &f.hunks)
                            .any(|h| h.id == id)
                    );
                }
            }
        }
    }
    #[tokio::test]
    async fn sample_publication_is_blocked_before_github_access() {
        let dir = tempfile::tempdir().unwrap();
        let service = crate::service::Service::new(dir.path()).unwrap();
        let workspace = service.open(INBOX_REPO, 101, false).await.unwrap();
        let error = service
            .publish(PublishRequest {
                snapshot_id: workspace.snapshot.id,
                note_ids: vec![],
                body: "Must stay local".into(),
                event: "COMMENT".into(),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("sample PR is local"));
        let history = service.history(Some(INBOX_REPO), 1, None).await.unwrap();
        assert_eq!(history.pulls.len(), 6);
        assert!(history.pulls.iter().all(|p| p.state != "open"));
    }
    #[test]
    fn completion_preference_defaults_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let service = crate::service::Service::new(dir.path()).unwrap();
        assert_eq!(service.store.settings().unwrap().completed_days, 2);
        let mut legacy = serde_json::to_value(service.store.settings().unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("completedDays");
        let settings: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(settings.completed_days, 2);
        for days in [0, 1, 2, 7, 30] {
            service
                .settings(Settings {
                    completed_days: days,
                    ..settings.clone()
                })
                .unwrap();
            assert_eq!(service.store.settings().unwrap().completed_days, days);
        }
        assert!(
            service
                .settings(Settings {
                    completed_days: 99,
                    ..settings
                })
                .is_err()
        );
    }
}
