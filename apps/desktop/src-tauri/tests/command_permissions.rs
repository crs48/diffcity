//! Browser IPC mocks cannot detect a command denied by the packaged native ACL.
#[test]
fn every_registered_app_command_is_declared_and_available_to_the_main_window() {
    let registration = include_str!("../src/lib.rs");
    let manifest = include_str!("../build.rs");
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    let permissions = capability["permissions"].as_array().unwrap();
    let commands = regex::Regex::new(r"commands::([a-z_]+)").unwrap();
    for command in commands
        .captures_iter(registration)
        .map(|c| c[1].to_string())
    {
        assert!(
            manifest.contains(&format!("\"{command}\"")),
            "{command} is registered but absent from the Tauri command manifest"
        );
        let permission = format!("allow-{}", command.replace('_', "-"));
        assert!(
            permissions.iter().any(|p| p == &permission),
            "{command} is denied by the main window's capability"
        );
    }
}
