# diffcity

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
open target/release/bundle/macos/diffcity.app
```

The local build is unsigned for distribution. Signing, notarization, automatic updates, Apple Silicon validation, and a public release remain separate release work.

If Connections reports a network timeout while `gh api user` succeeds, inspect any per-application network-filter prompt for the installed app. A CLI login succeeding does not establish that a newly built executable has network access. The full error appears in Connections; private drafts remain local.

## Review a PR

1. Open **Connections** to confirm the local GitHub and Codex accounts. Executable paths can be changed there. Use **Model** near the bottom of the left sidebar to choose your default model and reasoning level.
2. Your organizations and accessible repos appear automatically. Your personal account stays first; other accounts sort by their latest PR or repo activity. Accounts with no known updates in the last 30 days fold behind an expandable count; your selected account stays visible. Use the account rail and **Repo** filter to narrow the inbox, or open a GitHub PR URL directly. Your open PRs (including drafts) appear first, followed by requested reviews, assigned work, and other open PRs. **History** shows closed and merged PRs.
3. Click **Review with Codex**. Open the completed guide when ready; it does not move your reading position while generation runs.
4. Scroll through the entire guide, with each section’s explanation pinned beside its code. Use the outline or up/down arrows to jump between sections. Codex groups substantial reviews into 5–20 broad sections, with fewer for small changes. Migration, authorization, API-contract, and localization-contract signals set attention floors. Findings have separate severity labels. Expand routine groups whenever you want; acknowledged summaries and deferred code are counted separately from reviewed code.
5. Drag across line numbers, click then Shift-click, or use Shift + Up/Down from a focused line number to select a range. Click the comment button in the **left gutter** beside any selected line, or choose **Comment on lines**, to leave a private note or **Ask Codex**. Saved comments also have **Ask Codex about this comment**. Comments and streamed Codex replies appear directly beneath the selected code. **PR chat** shows the same messages, with code references that jump back to their inline threads. Ask broader questions there, or choose **Continue in PR chat** to retain a thread’s code context. Selection stays within one diff hunk and one side; drafts survive guide navigation. Choose **Prepare GitHub draft** for feedback you want to publish; you can edit that draft.
6. **Finish review** shows coverage and the exact selected drafts. Publish a comment, approval, or change request as supported by GitHub; your own PR only permits a comment.
7. New code appears as an update banner. Loading it preserves review marks only for uniquely matching unchanged hunks. Earlier notes stay attached to their original code and can be reopened with **Open previous revision**.

**More room for code:** Scrolling compacts the PR title and Codex action into a 48px header. Author, checks, and diff totals return when you scroll to the top. History and previous-revision details scroll with the document, while review tabs, navigation, and active update/error controls remain available.

**Fast review switching:** Your open PRs (including drafts), requested reviews, and assigned PRs prepare in the background across all repos, independent of the inbox filter. Saved code and guides open from local storage immediately; comments, checks, and PR metadata refresh in the background. Downloads run one at a time, yield to interactive opens, reuse unchanged revisions, and back off after failures. Prefetching does not run Codex. New code stays behind **Load new revision** while you review, and inherits your latest progress when opened.

**Choose a model:** The default is **Codex · GPT-6 Astra · Extra high**. The Model panel lists models and reasoning levels available through your local Codex login. Save a choice for future guided reviews, inline replies, and PR chat. Changing it leaves an active request unchanged. Existing explicit choices from Connections are retained; unavailable selections are shown with an explanation instead of silently falling back.

**Scan PR status:** Cards use green open, gray draft, purple merged, and red closed icons. Status overlays and labeled badges distinguish reviews, approvals, changes requested, checks, conflicts, blocked merges, and branches behind their base. Repo, author, source/target branch, and update age stay visible; diff counts appear when available. The sample inbox includes varied status combinations.

**Pin repos and PRs:** Select a repo and use its pin button to add a shortcut and move it to the top of the repo selector. Each PR card and the review toolbar also has a pin button. Pinned PRs appear above the usual priority groups and remain in the inbox after closing or merging until unpinned. Account, repo, and search filters still apply. Pins save locally and survive restarts.

**Explore a sample** works without a GitHub PR and demonstrates migrations, authorization, tests, documentation, and localization. It contains deliberate issues and cannot publish feedback.

## Appearance and accessibility

Use the appearance menu in the toolbar to choose **Light**, **Dark**, or **System**. The interface uses neutral black, white, and gray surfaces; PR status, diff additions/deletions, primary actions, and attention warnings retain semantic color. Appearance saves immediately without reconnecting accounts.

Tailwind CSS supplies the styling foundation, and React Aria supplies buttons, tabs, menus, and dialog behavior. Keyboard users can skip to the review, switch tabs with arrow keys, navigate the guide outline, and dismiss dialogs with Escape. Outline jumps focus the destination heading; ordinary scrolling preserves keyboard focus. Explanations stack above code in narrow windows. **Read full context** opens longer explanations and review questions in the document. Focus returns to dialog openers. Code and discussions flow in one review scrollbar, with every expanded line available to assistive technology. Use **Collapse changes**, individual diff controls, or inline discussion controls to compact a section. **Show 25 lines above/below** reveals unchanged context from the captured revision; repeat to see more, or use **Collapse context**. Extra context is read-only and stops at adjacent changes. Added and removed lines also have textual labels. See [accessibility checks and remaining work](docs/accessibility.md).

## Data and integrations

- Tauri 2, React/TypeScript, Rust, and SQLite. No diffcity server or account is required.
- The Rust backend reads the existing GitHub CLI credential into memory; the credential is not sent to the webview, SQLite, or Codex.
- Codex runs through its local app-server using the existing login. Starting analysis sends the PR description and bounded diff context to the selected Codex model/provider. Asking a question sends the exact selected lines, nearby diff context (up to five rows before/after, plus opposite-side rows inside the range), guide summary, question, and recent private discussion across the current PR revision (up to 24 messages, 2,000 characters each). PR chat includes bounded supporting diff context, prioritizing high-attention changes. These conversations are reconstructed from saved messages on each request; earlier revisions remain separate. Oversized selections are rejected before inference. Source code is not guaranteed to remain on the device during model inference.
- Codex has no shell, edit, browser, GitHub publication, or MCP-tool access from this review workflow. Findings are suggestions; only you mark code reviewed and choose publication.
- SQLite holds snapshots, guides, notes, settings, review progress, and publication state in `~/Library/Application Support/city.diff.desktop/`. WebKit local storage holds the last opened PR and unfinished review summaries. **Connections** shows the resolved database directory. `DIFFCITY_DATA_DIR` overrides the database directory for isolated testing.
- Active PR metadata, comments, reviews, and checks refresh every 30 seconds while the app is visible; the inbox refreshes every 90 seconds, and organization/repo discovery refreshes every 15 minutes. **Refresh repos and accounts** refreshes both on demand. Open PR metadata loads in small paginated batches, with visible progress and saved results retained on failures. GitHub reads use conditional REST requests, pagination, serialization, and rate-limit backoff. Model reviews run only on demand.
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
pnpm --filter @diffcity/desktop tauri build --debug --features e2e --bundles app
node tests/e2e/native.mjs
```

For a connection check that does not invoke a model or publish feedback:

```sh
DIFFCITY_CONNECT_ONLY=1 cargo run -p diffcity --bin live-smoke
```

To verify automatic organization/repo discovery, the complete open inbox, and two pages of an account's history without invoking a model or publishing feedback:

```sh
cargo run -p diffcity --bin directory-smoke -- ACCOUNT_OR_ORGANIZATION
```

This read-only check stores metadata in the ignored `.local/directory-smoke/` directory. Omit the account argument to check your personal account's history.

The harness currently targets the synthetic draft PR in this repository. It consumes Codex model usage. GitHub publication is off by default and requires `DIFFCITY_TEST_PUBLISH=yes` after the operator explicitly authorizes posting the labeled test review. The `e2e` feature adds a local WebDriver server and must never be used for distributed builds. Normal `pnpm desktop:build` excludes it.

See [implementation and validation notes](docs/implementation.md) for supported versions, evidence, and remaining release work. The original [product plan](docs/plans/initial-product/README.md) and [guided review specification](docs/plans/initial-product/guided-review.md) remain the longer-term roadmap.

Inspired by [Diffity](https://github.com/nilbuild/diffity). This is an original implementation; no Diffity source code was imported.
