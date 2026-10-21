# Diff City

A desktop workspace for reviewing GitHub pull requests through Codex-guided walkthroughs. Consequential changes come first; assessed routine changes fold into summaries you can expand.

**Status:** working local macOS alpha. **Owner:** Christopher Smothers. **License:** [MIT](LICENSE). The repository remains private; [diff.city](https://diff.city) is reserved for future downloads and documentation.

## Run locally

Install Node.js 24, pnpm 10.11.1, Rust (the repository pins its toolchain), and Xcode command-line tools. Connect GitHub with `gh auth login`. Use a current OpenAI Codex CLI with a supported app-server and an existing Codex login.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Or build the standalone macOS application:

```sh
pnpm desktop:build
open target/release/bundle/macos/Diff City.app
```

The local build is unsigned for distribution. Signing, notarization, automatic updates, Apple Silicon validation, and a public release remain separate release work.

If Connections reports a network timeout while `gh api user` succeeds, inspect any per-application network-filter prompt for the installed app. A CLI login succeeding does not establish that a newly built executable has network access. The full error appears in Connections; private drafts remain local.

## Review a PR

1. Open **Connections** to confirm the local GitHub and Codex accounts. Executable paths and the model can be changed there.
2. Choose repositories with **Add project**, or open a GitHub PR URL directly. Your PRs appear first, followed by requested reviews, assigned PRs, and other open PRs.
3. Click **Review with Codex**. Open the completed guide when ready; it does not move your reading position while generation runs.
4. Work through actual code in the guide. Migration, authorization, API-contract, and localization-contract signals set attention floors. Findings have separate severity labels. Expand routine groups whenever you want; acknowledged summaries and deferred code are counted separately from reviewed code.
5. Drag across line numbers, click then Shift-click, or use Shift + Up/Down from a focused line number to select a range. Choose **Comment on lines** to leave a private note or **Ask Codex**. Saved comments also have **Ask Codex about this comment**. Comments and streamed Codex replies appear directly beneath the selected code. **PR chat** shows the same messages, with code references that jump back to their inline threads. Ask broader questions there, or choose **Continue in PR chat** to retain a thread’s code context. Selection stays within one diff hunk and one side; drafts survive guide navigation. Choose **Prepare GitHub draft** for feedback you want to publish; you can edit that draft.
6. **Finish review** shows coverage and the exact selected drafts. Publish a comment, approval, or change request as supported by GitHub; your own PR only permits a comment.
7. New code appears as an update banner. Loading it preserves review marks only for uniquely matching unchanged hunks. Earlier notes stay attached to their original code and can be reopened with **Open previous revision**.

**Explore a sample** works without a GitHub PR and demonstrates migrations, authorization, tests, documentation, and localization. It contains deliberate issues and cannot publish feedback.

## Appearance and accessibility

Use the appearance menu in the toolbar to choose **Light**, **Dark**, or **System**. The interface uses neutral black, white, and gray surfaces; diff additions/deletions, primary actions, and attention warnings retain semantic color. Appearance saves immediately without reconnecting accounts.

Tailwind CSS supplies the styling foundation, and React Aria supplies buttons, tabs, menus, and dialog behavior. Keyboard users can skip to the review, switch tabs with arrow keys, navigate the guide outline, and dismiss dialogs with Escape. Focus returns to the opener. **All lines for assistive reading** renders the complete hunk instead of only the visible virtualized rows. Added and removed lines also have textual labels. See [accessibility checks and remaining work](docs/accessibility.md).

## Data and integrations

- Tauri 2, React/TypeScript, Rust, and SQLite. No Diff City server or account is required.
- The Rust backend reads the existing GitHub CLI credential into memory; the credential is not sent to the webview, SQLite, or Codex.
- Codex runs through its local app-server using the existing login. Starting analysis sends the PR description and bounded diff context to the selected Codex model/provider. Asking a question sends the exact selected lines, nearby diff context (up to five rows before/after, plus opposite-side rows inside the range), guide summary, question, and recent private discussion across the current PR revision (up to 24 messages, 2,000 characters each). PR chat includes bounded supporting diff context, prioritizing high-attention changes. These conversations are reconstructed from saved messages on each request; earlier revisions remain separate. Oversized selections are rejected before inference. Source code is not guaranteed to remain on the device during model inference.
- Codex has no shell, edit, browser, GitHub publication, or MCP-tool access from this review workflow. Findings are suggestions; only you mark code reviewed and choose publication.
- SQLite holds snapshots, guides, notes, settings, review progress, and publication state in `~/Library/Application Support/city.diff.desktop/`. WebKit local storage holds the last opened PR and unfinished review summaries. **Connections** shows the resolved database directory. `DIFFCITY_DATA_DIR` overrides the database directory for isolated testing.
- Active PR metadata, comments, reviews, and checks refresh every 30 seconds while the app is visible; the inbox refreshes every 90 seconds. GitHub reads use conditional requests, pagination, serialization, and rate-limit backoff. Model reviews run only on demand.
- To remove local content, quit the app and remove its application-support directory and the WebKit storage for `city.diff.desktop`. GitHub comments already published remain on GitHub. There is no telemetry or diagnostic upload in this alpha.

## Development and validation

```sh
pnpm check
pnpm lint
pnpm test
pnpm contracts
cargo fmt --all -- --check
pnpm desktop:build
```

`pnpm contracts` generates TypeScript from the Rust contracts. Commit generated changes with the corresponding Rust change. CI checks contract drift, types, lint, tests, formatting, and the unsigned desktop build.

The native end-to-end harness uses the actual packaged WKWebView and actual local accounts:

```sh
pnpm --filter @Diff City/desktop tauri build --debug --features e2e --bundles app
node tests/e2e/native.mjs
```

For a connection check that does not invoke a model or publish feedback:

```sh
DIFFCITY_CONNECT_ONLY=1 cargo run -p diffcity --bin live-smoke
```

The harness currently targets the synthetic draft PR in this repository. It consumes Codex model usage. GitHub publication is off by default and requires `DIFFCITY_TEST_PUBLISH=yes` after the operator explicitly authorizes posting the labeled test review. The `e2e` feature adds a local WebDriver server and must never be used for distributed builds. Normal `pnpm desktop:build` excludes it.

See [implementation and validation notes](docs/implementation.md) for supported versions, evidence, and remaining release work. The original [product plan](docs/plans/initial-product/README.md) and [guided review specification](docs/plans/initial-product/guided-review.md) remain the longer-term roadmap.

Inspired by [Diffity](https://github.com/nilbuild/diffity). This is an original implementation; no Diffity source code was imported.

## Historical review experiment

Closed pull requests remain useful review material. This abandoned proposal is a history-view fixture and should not merge.
