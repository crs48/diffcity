//! Live opt-in check. Only a temporary local MCP service may be used.
use anyhow::{Result, ensure};
use diffcity_lib::{contracts::*, fixtures, service::Service};
use serde_json::json;
use std::{
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 || args[1] != "--infer" {
        println!("Usage: agent-access-smoke --infer claude|codex allow|deny|full");
        return Ok(());
    }
    let provider = &args[2];
    let action = &args[3];
    ensure!(
        matches!(provider.as_str(), "claude" | "codex")
            && matches!(action.as_str(), "allow" | "deny" | "full"),
        "Invalid test arguments"
    );
    let access = if action == "full" {
        AgentAccess::Full
    } else {
        AgentAccess::Ask
    };
    let directory = PathBuf::from(".local").join(format!(
        "agent-access-{provider}-{action}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory)?;
    let directory = directory.canonicalize()?;
    let probe = directory.join("probe.py");
    std::fs::write(
        &probe,
        include_str!("../../../../../tests/fixtures/access-probe-mcp.py"),
    )?;
    let marker = format!("mcp-evidence-{}", uuid::Uuid::new_v4());
    std::fs::write(directory.join("marker.txt"), &marker)?;
    let binary = directory.join("runtime");
    let real = if provider == "claude" {
        diffcity_lib::claude::path(&Settings::default())?
    } else {
        diffcity_lib::codex::path(&Settings::default())?
    };
    let extra = if provider == "claude" {
        vec![
            "--strict-mcp-config".to_owned(),
            "--mcp-config".to_owned(),
            json!({"mcpServers":{"diffcity_probe":{"command":"python3","args":[probe,directory]}}})
                .to_string(),
        ]
    } else {
        vec![
            "-c".into(),
            "mcp_servers.diffcity_probe.command=\"python3\"".into(),
            "-c".into(),
            format!(
                "mcp_servers.diffcity_probe.args={}",
                json!([probe, directory])
            ),
        ]
    };
    let wrapper = format!(
        "#!/usr/bin/env python3\nimport os,sys,json\nbinary=json.loads({})\nextra=json.loads({})\nos.execv(binary,[binary,*extra,*sys.argv[1:]])\n",
        json!(json!(real).to_string()),
        json!(json!(extra).to_string())
    );
    std::fs::write(&binary, wrapper)?;
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700))?;
    let service = Arc::new(Service::new(&directory.join("data"))?);
    let settings = Settings {
        claude_path: (provider == "claude").then(|| binary.to_string_lossy().into()),
        codex_path: (provider == "codex").then(|| binary.to_string_lossy().into()),
        ..Default::default()
    };
    service.store.put("settings", "main", &settings)?;
    let (mut snapshot, _) = fixtures::sample()?;
    snapshot.id = format!("access-{}", uuid::Uuid::new_v4());
    service.store.put("snapshot", &snapshot.id, &snapshot)?;
    let q = service.save_note(Note { id:String::new(),snapshot_id:snapshot.id.clone(),anchor:None,body:"This is a local integration test. Use ONLY the diffcity_probe MCP service. First call read_marker and report the exact marker returned, then call write_marker once. Do not use shell, filesystem tools, other integrations, or external services. If an action is denied, stop and report the denial; do not retry or work around it.".into(),role:"user".into(),parent_id:None,github_draft:false,published_url:None,created_at:String::new(),model:None,thread_title:None })?;
    let model = ModelPreference {
        provider: provider.into(),
        model: if provider == "claude" {
            "claude-fable-5"
        } else {
            "gpt-6-astra"
        }
        .into(),
        reasoning_effort: Some(
            if provider == "claude" {
                "high"
            } else {
                "medium"
            }
            .into(),
        ),
    };
    let approvals = Arc::new(AtomicUsize::new(0));
    let count = approvals.clone();
    let responder = service.clone();
    let deny = action == "deny";
    println!(
        "Testing {provider} {action}. Artifacts: {}",
        directory.display()
    );
    let answer = service
        .ask_with_access(
            &snapshot.id,
            &q.id,
            "probe",
            Some(model),
            access,
            Arc::new(move |event| {
                if event.phase == "approval" {
                    let prompt: AgentPrompt = serde_json::from_str(&event.text).unwrap();
                    count.fetch_add(1, Ordering::Relaxed);
                    let display =
                        format!("{} {} {}", prompt.title, prompt.description, prompt.details);
                    let fixture = display.contains("diffcity_probe")
                        || display.contains("read_marker")
                        || display.contains("write_marker");
                    let is_write = display.contains("write_marker");
                    let allow = fixture && (!deny || !is_write);
                    let answers = prompt
                        .questions
                        .iter()
                        .map(|q| {
                            let option = q.options.iter().find(|o| {
                                if allow {
                                    matches!(
                                        o.label.to_ascii_lowercase().as_str(),
                                        "accept" | "approve" | "allow" | "yes" | "accept once"
                                    )
                                } else {
                                    matches!(
                                        o.label.to_ascii_lowercase().as_str(),
                                        "decline" | "deny" | "no"
                                    )
                                }
                            });
                            (
                                q.id.clone(),
                                vec![option.map(|o| o.value.clone()).unwrap_or_else(|| {
                                    if allow { "Accept" } else { "Decline" }.into()
                                })],
                            )
                        })
                        .collect();
                    // This test auto-answers only the local fixture's synthetic requests.
                    responder
                        .approvals
                        .respond("probe", &prompt.id, AgentAnswer { allow, answers })
                        .unwrap();
                    println!(
                        "Test prompt: {} -> {}",
                        prompt.title,
                        if allow { "allow" } else { "decline" }
                    );
                } else if event.phase != "stream" {
                    println!("{}: {}", event.phase, event.text);
                }
            }),
        )
        .await?;
    std::fs::write(directory.join("answer.txt"), &answer.body)?;
    ensure!(
        answer.body.contains(&marker),
        "The agent did not read the marker through MCP"
    );
    let wrote = directory.join("action.txt").exists();
    ensure!(
        wrote == !deny,
        "MCP write outcome did not match access/approval"
    );
    if access == AgentAccess::Ask {
        ensure!(
            approvals.load(Ordering::Relaxed) > 0,
            "No approval was requested"
        );
    }
    if access == AgentAccess::Full {
        ensure!(
            approvals.load(Ordering::Relaxed) == 0,
            "Full access unexpectedly needed approval for the test tool"
        );
    }
    println!(
        "PASS: {provider} {action}; MCP read verified, write={wrote}, approvals={}",
        approvals.load(Ordering::Relaxed)
    );
    Ok(())
}
