use crate::{contracts::*, fixtures, service::Service};
use std::sync::Arc;
use tauri::{Emitter, State};
type Output<T> = Result<T, String>;
#[tauri::command]
pub async fn review_baseline(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    refresh: bool,
) -> Output<ReviewBaseline> {
    service
        .review_baseline(&snapshot_id, refresh)
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn compare_review(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    baseline: ReviewCheckpoint,
) -> Output<ReviewComparison> {
    service
        .compare_review(&snapshot_id, baseline)
        .await
        .map_err(error)
}
#[tauri::command]
pub fn save_review_checkpoint(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
) -> Output<ReviewCheckpoint> {
    service.save_review_checkpoint(&snapshot_id).map_err(error)
}
#[tauri::command]
pub async fn hunk_context(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    hunk_id: String,
    before: u32,
    after: u32,
) -> Output<HunkContext> {
    service
        .hunk_context(&snapshot_id, &hunk_id, before, after)
        .await
        .map_err(error)
}
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
pub async fn refresh_inbox(
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
) -> Output<InboxResult> {
    service
        .sync_inbox(&|progress| {
            let _ = app.emit("inbox-sync", progress);
        })
        .await
        .map_err(error)
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
pub async fn refresh_directory(service: State<'_, Arc<Service>>) -> Output<RepositoryDirectory> {
    service.directory().await.map_err(error)
}
#[tauri::command]
pub fn save_settings(service: State<'_, Arc<Service>>, settings: Settings) -> Output<Settings> {
    service.settings(settings).map_err(error)
}
#[tauri::command]
pub async fn model_catalog(
    service: State<'_, Arc<Service>>,
    provider: Option<String>,
) -> Output<ModelCatalog> {
    service
        .provider_catalog(provider.as_deref().unwrap_or("codex"))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn save_model_preference(
    service: State<'_, Arc<Service>>,
    preference: ModelPreference,
) -> Output<ModelPreference> {
    service
        .save_model_preference(preference)
        .await
        .map_err(error)
}
#[tauri::command]
pub fn pin_repository(
    service: State<'_, Arc<Service>>,
    repository: String,
    pinned: bool,
) -> Output<Pins> {
    service.pin_repository(&repository, pinned).map_err(error)
}
#[tauri::command]
pub fn pin_pull(service: State<'_, Arc<Service>>, pull: PullRequest, pinned: bool) -> Output<Pins> {
    service.pin_pull(pull, pinned).map_err(error)
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
pub async fn sync_pull(
    service: State<'_, Arc<Service>>,
    repository: String,
    number: u32,
) -> Output<ReviewWorkspace> {
    service.sync_pull(&repository, number).await.map_err(error)
}
#[tauri::command]
pub async fn prefetch_pull(service: State<'_, Arc<Service>>, pull: PullRequest) -> Output<bool> {
    service.prefetch_pull(&pull).await.map_err(error)
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
    preference: Option<ModelPreference>,
) -> Output<Guide> {
    service
        .analyze_with_preference(&snapshot_id, &run_id, preference, emitter(app))
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
    preference: Option<ModelPreference>,
) -> Output<Note> {
    service
        .ask_with_preference(&snapshot_id, &note_id, &run_id, preference, emitter(app))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn cancel_codex(service: State<'_, Arc<Service>>, run_id: String) -> Output<()> {
    service.cancel(&run_id).await;
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
    let guide = service.store.current_guide(sample).map_err(error)?;
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
    let parsed = external_web_url(&url)?;
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("/usr/bin/open");
    #[cfg(not(target_os = "macos"))]
    let mut command = tokio::process::Command::new("xdg-open");
    command
        .arg(parsed.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn external_web_url(url: &str) -> Output<reqwest::Url> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid URL")?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(
            "Only HTTP and HTTPS web links without embedded credentials can be opened".into(),
        );
    }
    Ok(parsed)
}

#[cfg(test)]
mod external_link_tests {
    use super::external_web_url;

    #[test]
    fn allows_web_links_but_rejects_local_or_executable_schemes() {
        for url in [
            "https://docs.example.com/guide?q=one#two",
            "http://example.com/",
        ] {
            assert!(external_web_url(url).is_ok(), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "data:text/html,test",
            "file:///tmp/test",
            "mailto:a@example.com",
            "vscode://file/tmp/test",
            "--args",
            "/relative",
            "https://user:password@example.com/",
        ] {
            assert!(external_web_url(url).is_err(), "{url}");
        }
    }
}

#[tauri::command]
pub fn guide_versions(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
) -> Output<Vec<GuideVersion>> {
    service.guide_versions(&snapshot_id).map_err(error)
}
#[tauri::command]
pub fn select_guide(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    guide_id: String,
) -> Output<ReviewWorkspace> {
    service.select_guide(&snapshot_id, &guide_id).map_err(error)
}

#[tauri::command]
pub async fn enrich_guide(
    service: State<'_, Arc<Service>>,
    app: tauri::AppHandle,
    snapshot_id: String,
    guide_id: String,
    tier: EnrichmentTier,
    run_id: String,
) -> Output<Guide> {
    service
        .enrich_guide(&snapshot_id, &guide_id, tier, &run_id, emitter(app))
        .await
        .map_err(error)
}
#[tauri::command]
pub fn dismiss_enrichment(
    service: State<'_, Arc<Service>>,
    snapshot_id: String,
    guide_id: String,
    dismissed: bool,
) -> Output<Guide> {
    service
        .dismiss_enrichment(&snapshot_id, &guide_id, dismissed)
        .map_err(error)
}
