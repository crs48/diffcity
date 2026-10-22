use crate::{claude, codex, contracts::Settings};
use anyhow::{Result, bail};
use tokio::sync::watch;

pub async fn turn(
    settings: &Settings,
    request: codex::TurnRequest<'_>,
    cancel: watch::Receiver<bool>,
    emit: impl Fn(&str, &str),
) -> Result<(String, String)> {
    match request.preference.provider.as_str() {
        "codex" => {
            let mut rpc = codex::Rpc::spawn(&codex::path(settings)?, request.cwd).await?;
            rpc.turn(request, cancel, emit).await
        }
        "claude" => claude::turn(settings, request, cancel, emit).await,
        _ => bail!("Unknown AI provider. Choose Codex or Claude in Model settings."),
    }
}
