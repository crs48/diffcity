//! Claude Code's SDK streaming protocol, using its own stored login.
//! Each request is isolated, ephemeral, and has no repository/tool access.
use crate::{codex::TurnRequest, contracts::*, github::executable};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::watch,
};

pub fn path(settings: &Settings) -> Result<String> {
    let local = std::env::var("HOME")
        .map(|h| format!("{h}/.local/bin/claude"))
        .unwrap_or_default();
    executable(
        settings.claude_path.as_deref(),
        "claude",
        &[&local, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
    )
}
fn command(binary: &str) -> Command {
    let mut cmd = Command::new(binary);
    let environment: Vec<_> = [
        "HOME",
        "USER",
        "LOGNAME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "CLAUDE_CONFIG_DIR",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ]
    .iter()
    .filter_map(|key| std::env::var_os(key).map(|value| (*key, value)))
    .collect();
    cmd.env_clear()
        .envs(environment)
        .env("DISABLE_TELEMETRY", "1")
        .env("DISABLE_AUTOUPDATER", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    cmd
}
struct Session {
    _child: Child,
    input: ChildStdin,
    output: Lines<BufReader<ChildStdout>>,
}
impl Session {
    async fn spawn(binary: &str, cwd: &Path, preference: Option<&ModelPreference>) -> Result<Self> {
        std::fs::create_dir_all(cwd)?;
        let mut cmd = command(binary);
        cmd.current_dir(cwd).args([
            "-p",
            "--safe-mode",
            "--restricted",
            "--tools",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--setting-sources",
            "",
            "--settings",
            r#"{"disableAllHooks":true,"autoMemoryEnabled":false,"modelPicker":{"options":[{"model":"claude-fable-5","label":"Fable 5","description":"Fable 5 · A separate perspective on this review"}],"replaceBuiltInOptions":false}}"#,
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--permission-prompts",
            "none",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]);
        if let Some(p) = preference {
            cmd.args(["--model", &p.model]);
            if let Some(effort) = &p.reasoning_effort {
                cmd.args(["--effort", effort]);
            }
        }
        let mut child = cmd.spawn().context(
            "Could not start Claude Code. Install a current Claude Code runtime, then reconnect.",
        )?;
        let input = child.stdin.take().context("Claude stdin unavailable")?;
        let output =
            BufReader::new(child.stdout.take().context("Claude stdout unavailable")?).lines();
        Ok(Self {
            _child: child,
            input,
            output,
        })
    }
    async fn send(&mut self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        self.input.write_all(&bytes).await?;
        self.input.flush().await?;
        Ok(())
    }
    async fn read(&mut self) -> Result<Value> {
        let line = self.output.next_line().await?.context("Claude Code exited before finishing. Check your login and update Claude Code if needed.")?;
        ensure!(
            line.len() <= 8_000_000,
            "Claude response exceeded the local message budget"
        );
        serde_json::from_str(&line).context("Claude returned an invalid protocol message")
    }
    async fn initialize(&mut self, instructions: &str, schema: Option<Value>) -> Result<Value> {
        self.send(
            json!({"type":"control_request","request_id":"initialize","request":{
                "subtype":"initialize", "systemPrompt":[instructions], "jsonSchema":schema,
            }}),
        )
        .await?;
        tokio::time::timeout(Duration::from_secs(45), async {
            loop {
                let v = self.read().await?;
                ensure!(
                    v["type"] != "control_request",
                    "Claude requested a capability outside the review context"
                );
                if v["type"] == "control_response" && v["response"]["request_id"] == "initialize" {
                    ensure!(
                        v["response"]["subtype"] == "success",
                        "Claude initialization failed"
                    );
                    return Ok(v["response"]["response"].clone());
                }
            }
        })
        .await
        .context("Claude did not initialize in time")?
    }
}
fn models(value: &Value) -> Result<Vec<Model>> {
    let mut seen = HashSet::new();
    let mut models = vec![];
    for row in value["models"]
        .as_array()
        .context("Claude Code did not provide its model catalog")?
    {
        // Save exact, resolved IDs so alias changes cannot silently change a default.
        let id = row["resolvedModel"]
            .as_str()
            .or(row["value"].as_str())
            .context("Claude model ID missing")?;
        if !id.starts_with("claude-") || !seen.insert(id.to_owned()) {
            continue;
        }
        let name = if row["value"] == "default" {
            row["description"].as_str()
        } else {
            row["displayName"].as_str()
        }
        .unwrap_or(id);
        models.push(Model {
            id: id.into(),
            name: format!("Claude {name}"),
            is_default: row["value"] == "default",
            description: row["description"].as_str().unwrap_or_default().into(),
            reasoning_efforts: row["supportedEffortLevels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|e| e.as_str())
                .map(|effort| ReasoningOption {
                    effort: effort.into(),
                    description: String::new(),
                })
                .collect(),
            default_reasoning_effort: None,
        });
    }
    ensure!(!models.is_empty(), "Claude returned no supported models");
    Ok(models)
}
pub async fn connection(settings: &Settings, cwd: &Path) -> Result<(Connection, Vec<Model>)> {
    let binary = path(settings)?;
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        command(&binary).args(["auth", "status"]).output(),
    )
    .await
    .context("Claude login check timed out")??;
    let status: Value = serde_json::from_slice(&output.stdout).context(
        "Claude Code could not report its login. Update Claude Code and run claude auth login.",
    )?;
    ensure!(
        status["loggedIn"] == true && output.status.success(),
        "Claude Code is not signed in. Run claude auth login, then refresh models."
    );
    let mut session = Session::spawn(&binary, cwd, None).await?;
    let init = session
        .initialize(
            "You are a read-only code review assistant. No tools are available.",
            None,
        )
        .await?;
    Ok((Connection { connected: true, identity: status["email"].as_str().unwrap_or("Local Claude account").into(), executable: binary, detail: "Using your local Claude Code login. Review requests have no tools or repository access.".into() }, models(&init)?))
}
fn validate_event(value: &Value, preference: &ModelPreference, structured: bool) -> Result<()> {
    ensure!(
        value["type"] != "control_request",
        "Claude requested a capability outside the review context"
    );
    if value["type"] == "system" && value["subtype"] == "init" {
        ensure!(
            value["model"] == preference.model,
            "Claude selected a different model; the previous guide is preserved"
        );
        ensure!(
            value["tools"].as_array().is_some_and(|tools| tools
                .iter()
                .all(|tool| structured && tool == "StructuredOutput")),
            "Claude exposed tools outside the review context"
        );
        ensure!(
            value["mcp_servers"].as_array().is_some_and(Vec::is_empty),
            "Claude exposed MCP servers outside the review context"
        );
    }
    if value["type"] == "assistant" {
        if let Some(model) = value["message"]["model"].as_str() {
            ensure!(
                model == preference.model,
                "Claude answered with a different model; the previous guide is preserved"
            );
        }
        for block in value["message"]["content"].as_array().into_iter().flatten() {
            if block["type"] == "tool_use" {
                ensure!(
                    structured && block["name"] == "StructuredOutput",
                    "Claude attempted a tool outside the review context"
                );
            }
        }
    }
    Ok(())
}
pub async fn turn(
    settings: &Settings,
    request: TurnRequest<'_>,
    mut cancel: watch::Receiver<bool>,
    emit: impl Fn(&str, &str),
) -> Result<(String, String)> {
    let run = async {
        let mut session =
            Session::spawn(&path(settings)?, request.cwd, Some(request.preference)).await?;
        let structured = request.schema.is_some();
        let init = session
            .initialize(request.instructions, request.schema)
            .await?;
        crate::models::validate_preference(request.preference, &models(&init)?)?;
        session.send(json!({"type":"user","message":{"role":"user","content":request.prompt},"parent_tool_use_id":null,"session_id":""})).await?;
        let mut initialized = false;
        loop {
            let v = session.read().await?;
            validate_event(&v, request.preference, structured)?;
            if v["type"] == "system" && v["subtype"] == "init" {
                initialized = true;
            }
            if v["type"] == "stream_event"
                && v["event"]["delta"]["type"] == "text_delta"
                && let Some(text) = v["event"]["delta"]["text"].as_str()
            {
                emit("stream", text);
            }
            if v["type"] == "result" {
                ensure!(
                    initialized,
                    "Claude did not confirm an isolated review session"
                );
                ensure!(
                    v["is_error"] == false && v["subtype"] == "success",
                    "Claude could not finish: {}",
                    v["result"]
                        .as_str()
                        .unwrap_or("The request failed or reached its limit")
                );
                let usage = v["modelUsage"]
                    .as_object()
                    .context("Claude did not identify the model used")?;
                ensure!(
                    !usage.is_empty() && usage.keys().all(|m| m == &request.preference.model),
                    "Claude used a different model; the previous guide is preserved"
                );
                let answer = if structured {
                    let output = v.get("structured_output").filter(|v| v.is_object()).context("Claude did not return a structured guide; the previous guide is preserved")?;
                    serde_json::to_string(output)?
                } else {
                    v["result"]
                        .as_str()
                        .context("Claude returned no answer")?
                        .to_owned()
                };
                ensure!(!answer.trim().is_empty(), "Claude returned an empty answer");
                return Ok((answer, request.preference.model.clone()));
            }
        }
    };
    if *cancel.borrow() {
        bail!("Review cancelled");
    }
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(600), run) => result.context("Claude review timed out")?,
        _ = cancel.changed() => bail!("Review cancelled"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn preference() -> ModelPreference {
        ModelPreference {
            provider: "claude".into(),
            model: "claude-fable-5".into(),
            reasoning_effort: Some("high".into()),
        }
    }
    #[test]
    fn catalog_resolves_aliases_deduplicates_and_preserves_efforts() {
        let models = models(&json!({"models":[
            {"value":"default","resolvedModel":"claude-fable-5","description":"Fable 5","supportedEffortLevels":["high","xhigh"]},
            {"value":"fable","resolvedModel":"claude-fable-5"},
            {"value":"claude-sonnet-5","displayName":"Sonnet 5"}
        ]})).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "claude-fable-5");
        assert_eq!(models[0].reasoning_efforts[1].effort, "xhigh");
        assert!(crate::models::validate_preference(&preference(), &models).is_ok());
    }
    #[test]
    fn rejects_tools_mcp_and_silent_model_substitution() {
        let p = preference();
        let init = json!({"type":"system","subtype":"init","model":p.model,"tools":["StructuredOutput"],"mcp_servers":[]});
        assert!(validate_event(&init, &p, true).is_ok());
        assert!(validate_event(&init, &p, false).is_err());
        for (key, value) in [
            ("model", json!("claude-other")),
            ("tools", json!(["Bash"])),
            ("mcp_servers", json!(["github"])),
        ] {
            let mut invalid = init.clone();
            invalid[key] = value;
            assert!(validate_event(&invalid, &p, true).is_err());
        }
        assert!(validate_event(&json!({"type":"control_request"}), &p, false).is_err());
        assert!(
            validate_event(
                &json!({"type":"assistant","message":{"model":"claude-other"}}),
                &p,
                true
            )
            .is_err()
        );
        assert!(validate_event(&json!({"type":"assistant","message":{"model":p.model,"content":[{"type":"tool_use","name":"Read"}]}}), &p, true).is_err());
    }
    #[cfg(unix)]
    fn binary(root: &Path, mode: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join(format!("claude-{mode}"));
        let script = r#"#!/usr/bin/env python3
import sys,json,time,os
args=sys.argv[1:]
assert '--safe-mode' in args and '--restricted' in args and '--no-session-persistence' in args
assert args[args.index('--tools')+1]=='' and '--strict-mcp-config' in args
assert args[args.index('--permission-mode')+1]=='dontAsk'
assert not any(k in os.environ for k in ['GH_TOKEN','GITHUB_TOKEN','ANTHROPIC_API_KEY','OPENAI_API_KEY'])
init=json.loads(sys.stdin.readline()); assert init['request']['systemPrompt']==['Review only supplied code.']
print(json.dumps({'type':'control_response','response':{'request_id':'initialize','subtype':'success','response':{'models':[{'value':'claude-fable-5','displayName':'Fable 5','supportedEffortLevels':['high']}]}}}),flush=True)
user=json.loads(sys.stdin.readline());assert user['message']['content']=='Example PR'
print(json.dumps({'type':'system','subtype':'init','model':'claude-fable-5','tools':[],'mcp_servers':[]}),flush=True)
if 'cancel' in sys.argv[0]: time.sleep(20)
result={'type':'result','is_error':False,'subtype':'success','result':'A useful review','modelUsage':{'claude-fable-5':{}},'structured_output':{'summary':'A useful review'}}
if 'refusal' in sys.argv[0]: del result['structured_output']
if 'fallback' in sys.argv[0]: result['modelUsage']={'claude-other':{}}
print(json.dumps({'type':'stream_event','event':{'delta':{'type':'text_delta','text':'A useful review'}}}),flush=True)
print(json.dumps(result),flush=True)
"#;
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path.to_string_lossy().into()
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn structured_output_is_required_fallback_rejected_and_cancellation_stops_runtime() {
        let root = tempfile::tempdir().unwrap();
        let p = preference();
        for mode in ["success", "refusal", "fallback", "cancel"] {
            let settings = Settings {
                claude_path: Some(binary(root.path(), mode)),
                ..Settings::default()
            };
            let (tx, rx) = watch::channel(false);
            let cancel = async {
                if mode == "cancel" {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    tx.send(true).unwrap();
                }
            };
            let result = tokio::join!(
                turn(
                    &settings,
                    TurnRequest {
                        cwd: root.path(),
                        preference: &p,
                        instructions: "Review only supplied code.",
                        prompt: "Example PR",
                        schema: Some(json!({"type":"object"}))
                    },
                    rx,
                    |_, _| {}
                ),
                cancel
            )
            .0;
            assert_eq!(result.is_ok(), mode == "success", "{mode}: {result:?}");
            if mode == "cancel" {
                assert!(result.unwrap_err().to_string().contains("cancelled"));
            }
        }
    }
}
