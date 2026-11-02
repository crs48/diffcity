//! Local-only Chrome transport. No TCP listener, credentials, or shell passthrough.
use crate::{contracts::*, service::Service};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::UnixListener,
    sync::{Mutex, mpsc, watch},
};

const MAX_REQUEST: usize = 8 * 1024 * 1024;
pub const MAX_RESPONSE: usize = 64 * 1024 * 1024;
type Emit = Arc<dyn Fn(RunEvent) + Send + Sync>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

pub async fn read_frame<R: AsyncRead + Unpin>(
    reader: &mut R,
    limit: usize,
) -> Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    // EOF is only clean between messages, never inside a frame.
    if reader.read(&mut header[..1]).await? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut header[1..]).await?;
    let length = u32::from_ne_bytes(header) as usize;
    ensure!(length > 0 && length <= limit, "Invalid native message size");
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).await?;
    Ok(Some(bytes))
}
pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, bytes: &[u8]) -> Result<()> {
    ensure!(bytes.len() <= MAX_RESPONSE, "Response is too large");
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .await?;
    writer.write_all(bytes).await?;
    writer.flush().await?;
    Ok(())
}
fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .with_context(|| format!("Invalid {key}"))
}
fn value<T: Serialize>(result: T) -> Result<Value> {
    Ok(serde_json::to_value(result)?)
}

#[derive(Default)]
struct Queue {
    threads: Mutex<HashMap<String, std::sync::Weak<Mutex<()>>>>,
    cancellations: std::sync::Mutex<HashMap<String, watch::Sender<bool>>>,
}

async fn dispatch(
    service: &Service,
    queue: &Queue,
    request: &Request,
    emit: Emit,
) -> Result<Value> {
    let a = &request.args;
    match request.command.as_str() {
        "ping" => Ok(json!({"protocol":1,"version":env!("CARGO_PKG_VERSION")})),
        "bootstrap" => value(service.bootstrap().await?),
        "open_pull" | "sync_pull" => {
            let repository: String = arg(a, "repository")?;
            ensure!(crate::domain::valid_repo(&repository), "Invalid repository");
            let number: u32 = arg(a, "number")?;
            ensure!(number > 0, "Invalid pull request number");
            value(
                service
                    .open(
                        &repository,
                        number,
                        request.command == "sync_pull"
                            || arg::<Option<bool>>(a, "refresh")?.unwrap_or(false),
                    )
                    .await?,
            )
        }
        "open_saved_review" => value(service.saved(&arg::<String>(a, "snapshotId")?)?),
        "model_catalog" => value(
            service
                .provider_catalog(
                    &arg::<Option<String>>(a, "provider")?.unwrap_or_else(|| "claude".into()),
                )
                .await?,
        ),
        "save_model_preference" => {
            value(service.save_model_preference(arg(a, "preference")?).await?)
        }
        "repository_context" => value(
            service
                .repository_context(
                    &arg::<String>(a, "repository")?,
                    arg::<Option<String>>(a, "head")?.as_deref(),
                )
                .await?,
        ),
        "guide_versions" => value(service.guide_versions(&arg::<String>(a, "snapshotId")?)?),
        "select_guide" => value(service.select_guide(
            &arg::<String>(a, "snapshotId")?,
            &arg::<String>(a, "guideId")?,
        )?),
        "save_note" => value(service.save_note(arg(a, "note")?)?),
        "save_progress" => {
            value(service.progress(&arg::<String>(a, "snapshotId")?, arg(a, "progress")?)?)
        }
        "hunk_context" => value(
            service
                .hunk_context(
                    &arg::<String>(a, "snapshotId")?,
                    &arg::<String>(a, "hunkId")?,
                    arg(a, "before")?,
                    arg(a, "after")?,
                )
                .await?,
        ),
        "analyze" => value(
            service
                .analyze_with_preference(
                    &arg::<String>(a, "snapshotId")?,
                    &arg::<String>(a, "runId")?,
                    arg(a, "preference")?,
                    emit,
                )
                .await?,
        ),
        "enrich_guide" => value(
            service
                .enrich_guide(
                    &arg::<String>(a, "snapshotId")?,
                    &arg::<String>(a, "guideId")?,
                    arg(a, "tier")?,
                    &arg::<String>(a, "runId")?,
                    emit,
                )
                .await?,
        ),
        "dismiss_enrichment" => value(service.dismiss_enrichment(
            &arg::<String>(a, "snapshotId")?,
            &arg::<String>(a, "guideId")?,
            arg(a, "dismissed")?,
        )?),
        "ask_codex" => {
            let snapshot: String = arg(a, "snapshotId")?;
            let note_id: String = arg(a, "noteId")?;
            let run_id: String = arg(a, "runId")?;
            let note = service
                .store
                .notes(&snapshot)?
                .into_iter()
                .find(|n| n.id == note_id)
                .context("Save the question first")?;
            let scope = format!("{snapshot}/{}", serde_json::to_string(&note.anchor)?);
            let lock = {
                let mut threads = queue.threads.lock().await;
                threads.retain(|_, lock| lock.strong_count() > 0);
                let lock = threads
                    .get(&scope)
                    .and_then(std::sync::Weak::upgrade)
                    .unwrap_or_default();
                threads.insert(scope, Arc::downgrade(&lock));
                lock
            };
            let (cancel, mut cancelled) = watch::channel(false);
            {
                let mut pending = queue.cancellations.lock().unwrap();
                ensure!(
                    pending.len() < 32 && !pending.contains_key(&run_id),
                    "AI queue is full or run already exists"
                );
                pending.insert(run_id.clone(), cancel);
            }
            emit(RunEvent {
                guide: None,
                run_id: run_id.clone(),
                snapshot_id: snapshot.clone(),
                phase: "queued".into(),
                text: "Waiting for earlier replies…".into(),
            });
            let result = async {
                let _guard = tokio::select! { biased; _ = cancelled.changed() => bail!("AI job cancelled"), guard = lock.lock() => guard };
                ensure!(!*cancelled.borrow(), "AI job cancelled");
                let answer = service.ask_with_access(&snapshot,&note_id,&run_id,arg(a,"preference")?,arg::<Option<AgentAccess>>(a,"access")?.unwrap_or_default(),emit).await?;
                let draft = service.store.notes(&snapshot)?.into_iter().find(|n| n.github_draft && n.parent_id.as_deref() == Some(&answer.id));
                value(AskReply { answer, draft })
            }.await;
            queue.cancellations.lock().unwrap().remove(&run_id);
            result
        }
        "cancel_codex" => {
            let id: String = arg(a, "runId")?;
            if let Some(cancel) = queue.cancellations.lock().unwrap().get(&id) {
                let _ = cancel.send(true);
            }
            service.cancel(&id).await;
            Ok(Value::Null)
        }
        "respond_agent" => {
            service.approvals.respond(
                &arg::<String>(a, "runId")?,
                &arg::<String>(a, "requestId")?,
                arg(a, "answer")?,
            )?;
            Ok(Value::Null)
        }
        "save_review_checkpoint" => {
            value(service.save_review_checkpoint(&arg::<String>(a, "snapshotId")?)?)
        }
        "publish_review" => value(service.publish(arg(a, "request")?).await?),
        _ => bail!("Command is not available to the browser companion"),
    }
}

pub fn bind(directory: &Path) -> Result<std::os::unix::net::UnixListener> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    let path = directory.join("browser.sock");
    if path.exists() {
        ensure!(
            std::fs::symlink_metadata(&path)?.file_type().is_socket(),
            "Unexpected browser socket file"
        );
        ensure!(
            std::os::unix::net::UnixStream::connect(&path).is_err(),
            "Diff City is already running"
        );
        std::fs::remove_file(&path)?;
    }
    let listener = std::os::unix::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

pub async fn serve(
    listener: std::os::unix::net::UnixListener,
    service: Arc<Service>,
    app_emit: Emit,
) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let uid = std::fs::metadata(&service.store.directory)?.uid();
    let listener = UnixListener::from_std(listener)?;
    let queue = Arc::new(Queue::default());
    let connections = Arc::new(tokio::sync::Semaphore::new(8));
    loop {
        let (socket, _) = listener.accept().await?;
        if socket.peer_cred()?.uid() != uid {
            continue;
        }
        let Ok(permit) = connections.clone().try_acquire_owned() else {
            continue;
        };
        let service = service.clone();
        let queue = queue.clone();
        let app_emit = app_emit.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let (mut reader, mut writer) = socket.into_split();
            // Bound streaming buffers even when a browser stops reading.
            let (tx, mut rx) = mpsc::channel::<Value>(128);
            let writer_task = tokio::spawn(async move {
                while let Some(message) = rx.recv().await {
                    if write_frame(&mut writer, &serde_json::to_vec(&message)?)
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok::<_, anyhow::Error>(())
            });
            let inflight = Arc::new(tokio::sync::Semaphore::new(40));
            while let Ok(Some(bytes)) = read_frame(&mut reader, MAX_REQUEST).await {
                let Ok(request) = serde_json::from_slice::<Request>(&bytes) else {
                    break;
                };
                if request.id.is_empty() || request.id.len() > 128 {
                    break;
                }
                let Ok(slot) = inflight.clone().try_acquire_owned() else {
                    let _ =
                        tx.try_send(json!({"id":request.id,"error":"Too many pending requests"}));
                    continue;
                };
                let tx = tx.clone();
                let service = service.clone();
                let queue = queue.clone();
                let app_emit = app_emit.clone();
                // Jobs deliberately outlive browser tab closure. Results remain in SQLite.
                tokio::spawn(async move {
                    let _slot = slot;
                    let events = tx.clone();
                    let emit: Emit = Arc::new(move |event| {
                        app_emit(event.clone());
                        let _ = events.try_send(json!({"event":"codex-run","payload":event}));
                    });
                    let result = dispatch(&service, &queue, &request, emit).await;
                    let reply = match result {
                        Ok(result) => json!({"id":request.id,"result":result}),
                        Err(error) => json!({"id":request.id,"error":format!("{error:#}")}),
                    };
                    let _ = tx.send(reply).await;
                });
            }
            writer_task.abort();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn framing_rejects_oversized_and_truncated_messages() {
        assert!(
            read_frame(&mut &100u32.to_ne_bytes()[..], 10)
                .await
                .is_err()
        );
        assert!(read_frame(&mut &[1, 0][..], 10).await.is_err());
        assert!(read_frame(&mut &[2, 0, 0, 0, 1][..], 10).await.is_err());
        assert!(read_frame(&mut &[][..], 10).await.unwrap().is_none());
        let mut bytes = vec![];
        write_frame(&mut bytes, b"abc").await.unwrap();
        assert_eq!(
            read_frame(&mut bytes.as_slice(), 10)
                .await
                .unwrap()
                .unwrap(),
            b"abc"
        );
    }
    #[tokio::test]
    async fn browser_cannot_execute_arbitrary_commands_or_read_local_paths() {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        for command in [
            "open_external",
            "save_code_roots",
            "choose_code_folder",
            "shell",
            "read_file",
        ] {
            let request = Request {
                id: "1".into(),
                command: command.into(),
                args: json!({}),
            };
            assert!(
                dispatch(&service, &Queue::default(), &request, Arc::new(|_| {}))
                    .await
                    .is_err()
            );
        }
    }
    #[test]
    fn registration_does_not_replace_a_running_listener_or_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let listener = bind(dir.path()).unwrap();
        assert!(bind(dir.path()).is_err());
        drop(listener);
        assert!(bind(dir.path()).is_ok());
        std::fs::remove_file(dir.path().join("browser.sock")).unwrap();
        std::fs::write(dir.path().join("browser.sock"), "keep").unwrap();
        assert!(bind(dir.path()).is_err());
    }
}
