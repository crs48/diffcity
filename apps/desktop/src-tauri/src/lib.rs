pub mod agent_access;
mod ai_runs;
#[cfg(unix)]
pub mod browser_bridge;
pub mod claude;
pub mod codex;
mod commands;
mod context;
pub mod contracts;
mod discussion_context;
pub mod domain;
pub mod fixtures;
pub mod github;
mod github_lists;
pub mod guide;
mod guide_annotations;
mod guide_carry;
mod guide_enrichment;
mod guide_history;
mod guide_naming;
mod guide_prompt;
mod local_repositories;
pub mod migrations;
mod models;
#[cfg(unix)]
pub mod native_messaging;
mod pins;
mod providers;
mod reply_draft;
mod review_cache;
mod review_comparison;
pub mod service;
pub mod text_diff;
mod text_selection;
mod thread_title;

use std::sync::Arc;
use tauri::{Emitter, Manager};
pub mod storage;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let directory = std::env::var_os("DIFFCITY_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let service = Arc::new(service::Service::new(&directory)?);
            #[cfg(unix)]
            {
                let listener = browser_bridge::bind(&directory)?;
                let shared = service.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = browser_bridge::serve(
                        listener,
                        shared,
                        Arc::new(move |event| {
                            let _ = handle.emit("codex-run", event);
                        }),
                    )
                    .await
                    {
                        eprintln!("Browser companion: {error:#}");
                    }
                });
                // Registration is explicit from Connections, never enables page RPC.
                if std::env::args().any(|arg| arg == "--browser-companion")
                    && let Some(window) = app.get_webview_window("main")
                {
                    window.hide()?;
                }
            }
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::install_browser_companion,
            commands::bootstrap,
            commands::local_repositories,
            commands::save_code_roots,
            commands::bind_local_repository,
            commands::repository_context,
            commands::choose_code_folder,
            commands::refresh_inbox,
            commands::list_pull_history,
            commands::refresh_directory,
            commands::save_settings,
            commands::model_catalog,
            commands::save_model_preference,
            commands::pin_repository,
            commands::pin_pull,
            commands::open_pull,
            commands::prefetch_pull,
            commands::sync_pull,
            commands::open_saved_review,
            commands::hunk_context,
            commands::review_baseline,
            commands::compare_review,
            commands::save_review_checkpoint,
            commands::check_pull,
            commands::save_note,
            commands::delete_note,
            commands::save_progress,
            commands::analyze,
            commands::enrich_guide,
            commands::dismiss_enrichment,
            commands::guide_versions,
            commands::pull_guides,
            commands::select_guide,
            commands::ask_codex,
            commands::respond_agent,
            commands::cancel_codex,
            commands::publish_review,
            commands::sample_review,
            commands::sample_inbox,
            commands::open_external
        ]);
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .build(tauri::generate_context!())
        .expect("could not start diffcity")
        .run(|app, event| match event {
            // Keep the local service available when the last window closes.
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } => api.prevent_exit(),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}
