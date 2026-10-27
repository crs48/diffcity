#![cfg(unix)]
use diffcity_lib::{
    agent_access::{Approvals, Interaction},
    claude,
    codex::{self, TurnRequest},
    contracts::*,
};
use std::{
    os::unix::fs::PermissionsExt,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::sync::watch;

#[tokio::test]
async fn both_protocols_wait_for_a_matching_decision_before_actions_and_full_uses_native_mode() {
    for provider in ["claude", "codex"] {
        for (access, allow) in [
            (AgentAccess::Ask, true),
            (AgentAccess::Ask, false),
            (AgentAccess::Full, true),
        ] {
            let root = tempfile::tempdir().unwrap();
            let binary = root.path().join(provider);
            std::fs::write(
                &binary,
                include_str!("../../../../tests/fixtures/agent-permissions.py"),
            )
            .unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            let approvals = Approvals::default();
            let interaction = Interaction {
                approvals: &approvals,
                run_id: "run",
            };
            let count = AtomicUsize::new(0);
            let id = Mutex::new(String::new());
            let emit = |phase: &str, text: &str| {
                if phase != "approval" {
                    return;
                }
                assert!(
                    !root.path().join("action.txt").exists(),
                    "Action ran before approval"
                );
                count.fetch_add(1, Ordering::Relaxed);
                let prompt: AgentPrompt = serde_json::from_str(text).unwrap();
                *id.lock().unwrap() = prompt.id.clone();
                assert!(
                    approvals
                        .respond(
                            "wrong-run",
                            &prompt.id,
                            AgentAnswer {
                                allow: true,
                                ..Default::default()
                            }
                        )
                        .is_err()
                );
                approvals
                    .respond(
                        "run",
                        &prompt.id,
                        AgentAnswer {
                            allow,
                            ..Default::default()
                        },
                    )
                    .unwrap();
            };
            let preference = ModelPreference {
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
            let request = TurnRequest {
                cwd: root.path(),
                repository_access: true,
                access,
                interaction: Some(&interaction),
                preference: &preference,
                instructions: "Test action",
                prompt: "Test action",
                schema: None,
            };
            let (_tx, rx) = watch::channel(false);
            let result = if provider == "claude" {
                claude::turn(
                    &Settings {
                        claude_path: Some(binary.to_string_lossy().into()),
                        ..Default::default()
                    },
                    request,
                    rx,
                    emit,
                )
                .await
            } else {
                let mut rpc = codex::Rpc::spawn_for_access(
                    binary.to_str().unwrap(),
                    root.path(),
                    true,
                    access,
                )
                .await
                .unwrap();
                rpc.turn(request, rx, emit).await
            }
            .unwrap();
            assert_eq!(result.0, if allow { "Allowed" } else { "Declined" });
            assert_eq!(root.path().join("action.txt").exists(), allow);
            assert_eq!(
                count.load(Ordering::Relaxed),
                usize::from(access == AgentAccess::Ask)
            );
            assert!(
                approvals
                    .respond(
                        "run",
                        &id.lock().unwrap(),
                        AgentAnswer {
                            allow: true,
                            ..Default::default()
                        }
                    )
                    .is_err()
            );
        }
    }
}
