pub mod claude;
pub mod codex;
mod commands;
mod context;
pub mod contracts;
pub mod domain;
pub mod fixtures;
pub mod github;
mod github_lists;
pub mod guide;
mod guide_history;
mod guide_prompt;
pub mod migrations;
mod models;
mod pins;
mod providers;
mod review_cache;
mod review_comparison;
pub mod service;
pub mod text_diff;
mod text_selection;

use std::sync::Arc;
use tauri::Manager;
pub mod storage;

pub fn run() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            let directory = std::env::var_os("DIFFCITY_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            app.manage(Arc::new(service::Service::new(&directory)?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
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
            commands::guide_versions,
            commands::select_guide,
            commands::ask_codex,
            commands::cancel_codex,
            commands::publish_review,
            commands::sample_review,
            commands::sample_inbox,
            commands::open_external
        ]);
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .run(tauri::generate_context!())
        .expect("could not start diffcity");
}
