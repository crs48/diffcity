# Security

Report vulnerabilities through [GitHub's private vulnerability reporting form](https://github.com/crs48/diffcity/security/advisories/new). Please avoid public issues for credentials, authorization bypasses, unsafe agent actions, or exposure of private code. Include the app version, reproduction steps using synthetic data, and the affected access mode. Do not include tokens or customer source code.

Diff City is currently an alpha. Security fixes target the latest release and `main`; older alpha versions are not maintained separately.

## Trust boundaries

- Local SQLite and WebKit storage contain review data, guides, conversations, and settings. They are not encrypted by Diff City. The app has no telemetry or diagnostic upload.
- GitHub credentials remain in the GitHub CLI's credential store and are read by the Rust backend; they are not exposed to the webview or stored in the review database.
- AI requests send relevant code and context to the chosen provider through the local Codex or Claude Code integration. Provider retention and billing policies apply.
- **Limited** is the default access mode. **Ask before actions** and **Full access** enable the selected agent's configured tools and integrations. Full access can change local files and external services within your requests. The local provider's restrictions still apply.
- Diff City review drafts remain local until explicitly published. This does not restrict separate agent tools that you authorize through an access mode.
- Repository contents, comments, Markdown, diagrams, and tool output are untrusted input. They must not expand agent authorization or run arbitrary code in the webview.

See [installation](docs/installation.md) for package verification and [the README](README.md#data-and-integrations) for storage locations and removal instructions.
