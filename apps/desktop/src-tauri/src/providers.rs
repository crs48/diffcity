use crate::{claude, codex, contracts::Settings};
use anyhow::{Result, bail};
use tokio::sync::watch;

pub async fn turn(
    settings: &Settings,
    request: codex::TurnRequest<'_>,
    cancel: watch::Receiver<bool>,
    emit: impl Fn(&str, &str),
) -> Result<(String, String)> {
    let run = async {
        match request.preference.provider.as_str() {
            "codex" => {
                let mut rpc = codex::Rpc::spawn_for_access(
                    &codex::path(settings)?,
                    request.cwd,
                    request.repository_access,
                    request.access,
                )
                .await?;
                rpc.turn(request, cancel.clone(), emit).await
            }
            "claude" => claude::turn(settings, request, cancel.clone(), emit).await,
            _ => bail!("Unknown AI provider. Choose Codex or Claude in Model settings."),
        }
    };
    let mut stopped = cancel.clone();
    if *stopped.borrow() {
        bail!("Agent run cancelled");
    }
    tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(3600), run) => result.map_err(|_| anyhow::anyhow!("Agent run timed out"))?,
        _ = stopped.changed() => bail!("Agent run cancelled"),
    }
}
