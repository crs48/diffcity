pub mod codex;
mod commands;
pub mod contracts;
pub mod domain;
pub mod fixtures;
pub mod github;
pub mod migrations;
pub mod service;

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
            commands::list_repositories,
            commands::save_settings,
            commands::open_pull,
            commands::open_saved_review,
            commands::check_pull,
            commands::save_note,
            commands::delete_note,
            commands::save_progress,
            commands::analyze,
            commands::ask_codex,
            commands::cancel_codex,
            commands::publish_review,
            commands::sample_review,
            commands::open_external
        ]);
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .run(tauri::generate_context!())
        .expect("could not start diffcity");
}
