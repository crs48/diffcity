use crate::{contracts::*, fixtures, service::Service};
use std::sync::Arc;
use tauri::{Emitter, State};
type Output<T> = Result<T, String>;
fn error(e: anyhow::Error) -> String {
    format!("{e:#}")
}
fn emitter(app: tauri::AppHandle) -> Arc<dyn Fn(RunEvent) + Send + Sync> {
    Arc::new(move |e| {
        let _ = app.emit("codex-run", e);
    })
}

#[tauri::command]
pub async fn bootstrap(service: State<'_, Arc<Service>>) -> Output<Bootstrap> {
    service.bootstrap().await.map_err(error)
}
#[tauri::command]
pub async fn refresh_inbox(service: State<'_, Arc<Service>>) -> Output<Vec<PullRequest>> {
    service.inbox().await.map_err(error)
}
#[tauri::command]
pub async fn list_pull_history(
    service: State<'_, Arc<Service>>,
    repository: Option<String>,
    page: u32,
    owner: Option<String>,
) -> Output<PullPage> {
    service
        .history(repository.as_deref(), page, owner.as_deref())
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn list_repositories(service: State<'_, Arc<Service>>) -> Output<Vec<Repository>> {
    service.github.repositories().await.map_err(error)
}
#[tauri::command]
pub fn save_settings(service: State<'_, Arc<Service>>, settings: Settings) -> Output<Settings> {
    service.settings(settings).map_err(error)
}
#[tauri::command]
pub async fn open_pull(
    service: State<'_, Arc<Service>>,
    repository: String,
    number: u32,
    refresh: bool,
) -> Output<ReviewWorkspace> {
    service
        .open(&repository, number, refresh)
        .await
        .map_err(error)
}
#[tauri::command]
pub fn open_saved_review(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
) -> Output<ReviewWorkspace> {
    service.saved(&snapshot_id).map_err(error)
}
#[tauri::command]
pub async fn check_pull(
    service: State<'_, Arc<Service>>,
    repository: String,
    number: u32,
) -> Output<PullRequest> {
    service
        .github
        .pull(&repository, number)
        .await
        .map_err(error)
}
#[tauri::command]
pub fn save_note(service: State<'_, Arc<Service>>, note: Note) -> Output<Note> {
    service.save_note(note).map_err(error)
}
#[tauri::command]
pub fn delete_note(service: State<'_, Arc<Service>>, id: String) -> Output<()> {
    let note: Note = service
        .store
        .get("note", &id)
        .map_err(error)?
        .ok_or("Note not found")?;
    if note.published_url.is_some() {
        return Err(
            "Published comments remain in GitHub; they cannot be deleted as local drafts".into(),
        );
    }
    service.store.delete("note", &id).map_err(error)
}
#[tauri::command]
pub fn save_progress(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    progress: ReviewProgress,
) -> Output<ReviewProgress> {
    service.progress(&snapshot_id, progress).map_err(error)
}
#[tauri::command]
pub async fn analyze(
    service: State<'_, Arc<Service>>,
    app: tauri::AppHandle,
    snapshot_id: String,
    run_id: String,
) -> Output<Guide> {
    service
        .analyze(&snapshot_id, &run_id, emitter(app))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn ask_codex(
    service: State<'_, Arc<Service>>,
    app: tauri::AppHandle,
    snapshot_id: String,
    note_id: String,
    run_id: String,
) -> Output<Note> {
    service
        .ask(&snapshot_id, &note_id, &run_id, emitter(app))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn cancel_codex(service: State<'_, Arc<Service>>) -> Output<()> {
    service.cancel().await;
    Ok(())
}
#[tauri::command]
pub async fn publish_review(
    service: State<'_, Arc<Service>>,
    request: PublishRequest,
) -> Output<PublishResult> {
    service.publish(request).await.map_err(error)
}
#[tauri::command]
pub fn sample_inbox(service: State<'_, Arc<Service>>) -> Output<Vec<PullRequest>> {
    let login = service
        .store
        .get::<String>("identity", "github")
        .map_err(error)?
        .unwrap_or_else(|| "you".into());
    fixtures::inbox(&login).map_err(error)
}
#[tauri::command]
pub fn sample_review(service: State<'_, Arc<Service>>) -> Output<ReviewWorkspace> {
    let (snapshot, sample) = fixtures::sample().map_err(error)?;
    service
        .store
        .put("snapshot", &snapshot.id, &snapshot)
        .map_err(error)?;
    let guide = service
        .store
        .get("guide", &snapshot.id)
        .map_err(error)?
        .unwrap_or(sample);
    Ok(ReviewWorkspace {
        notes: service.store.notes(&snapshot.id).map_err(error)?,
        progress: service
            .store
            .get("progress", &snapshot.id)
            .map_err(error)?
            .unwrap_or_default(),
        snapshot,
        guide,
        comments: vec![],
        checks: "Sample fixture · tests not executed".into(),
        previous_snapshot_id: None,
        changed_hunks: vec![],
        sync_error: None,
    })
}
#[tauri::command]
pub async fn open_external(url: String) -> Output<()> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL")?;
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("github.com" | "diff.city" | "learn.chatgpt.com")
        )
    {
        return Err(
            "Only HTTPS GitHub, diff.city, and Codex documentation links can be opened".into(),
        );
    }
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("/usr/bin/open");
    #[cfg(not(target_os = "macos"))]
    let mut command = tokio::process::Command::new("xdg-open");
    command.arg(url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
