fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "bootstrap",
            "refresh_inbox",
            "list_repositories",
            "save_settings",
            "open_pull",
            "check_pull",
            "save_note",
            "delete_note",
            "save_progress",
            "analyze",
            "ask_codex",
            "cancel_codex",
            "publish_review",
            "sample_review",
            "open_external",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
