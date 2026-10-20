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
