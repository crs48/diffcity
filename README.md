# diffcity

A desktop workspace for reviewing GitHub pull requests through AI-guided walkthroughs with Codex and Claude. Consequential changes come first; assessed routine changes fold into summaries you can expand.

**Status:** working local macOS alpha. **Owner:** Christopher Smothers. **License:** [MIT](LICENSE). The repository remains private; [diff.city](https://diff.city) is reserved for future downloads and documentation.

## Run locally

Install Node.js 24, pnpm 10.11.1, Rust (the repository pins its toolchain), and Xcode command-line tools. Connect GitHub with `gh auth login`. Use a current OpenAI Codex CLI with a supported app-server and an existing Codex login. For Claude, install a current Claude Code CLI and sign in with `claude auth login`; the integration has been verified with Claude Code 2.1.304.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Or build the standalone macOS application:

```sh
pnpm desktop:build
open target/aarch64-apple-darwin/release/bundle/macos/diffcity.app
```

Development and production app builds explicitly target Apple silicon (`aarch64-apple-darwin`), even if the selected Rust compiler has an Intel host. `pnpm desktop:build` checks every packaged Mach-O executable/library for an `arm64` slice and fails on Intel-only components. `pnpm desktop:verify` repeats that check, or pass a different `.app` path to check an installed bundle. The app uses macOS WebKit and does not bundle Node.js, GitHub CLI, Codex, or Claude Code. External CLI installations need their own native builds.

If `rustc -vV` reports `host: x86_64-apple-darwin` on an ARM Mac, use the native compiler for this checkout with `rustup toolchain install 1.97.1-aarch64-apple-darwin --component rustfmt --component clippy` followed by `rustup override set 1.97.1-aarch64-apple-darwin`. This leaves other repositories' toolchains unchanged. The explicit app target and bundle check are still required; a successful build alone does not establish its architecture.

Local builds use ad-hoc code signing, and `pnpm desktop:verify` also verifies the complete bundle signature. Developer ID signing, notarization, automatic updates, and a public release remain separate release work. Intel-only and universal release packages are not currently produced.

If Connections reports a network timeout while `gh api user` succeeds, inspect any per-application network-filter prompt for the installed app. A CLI login succeeding does not establish that a newly built executable has network access. The full error appears in Connections; private drafts remain local.

## Review a PR

1. Open **Connections** to confirm the local GitHub and Codex accounts. Executable paths can be changed there. Use **Model** near the bottom of the left sidebar to choose your default model and reasoning level.
2. Your organizations and accessible repos appear automatically. Your personal account stays first; other accounts sort by their latest PR or repo activity. Accounts with no known updates in the last 30 days fold behind an expandable count; your selected account stays visible. Use the account rail and **Repo** filter to narrow the inbox, or open a GitHub PR URL directly. Your open PRs (including drafts) appear first, followed by requested reviews, assigned work, and other open PRs. **History** shows closed and merged PRs.
3. Click **New guide**, choose **Codex** or **Claude Code**, then choose a model and reasoning level. **Generate guide** creates a separate saved run without changing your default model or the guide you are reading. Open it when ready, or use **Saved guide** above the walkthrough to switch between models and earlier runs. Each entry shows its model, reasoning level, and generation time. Comments and hunk review decisions are shared; guide navigation and expanded sections restore independently. Guides belong to the captured PR revision, so a new code revision has its own history.
4. Scroll through the entire guide, with each section’s explanation pinned beside its code. Use the outline or up/down arrows to jump between sections. The agent groups substantial reviews into roughly 5–12 broad sections (at most 20), with fewer for small changes. Migration, authorization, API-contract, and localization-contract signals set attention floors. Findings have separate severity labels. Expand routine groups whenever you want; acknowledged summaries and deferred code are counted separately from reviewed code.
5. Drag across line numbers, click then Shift-click, or use Shift + Up/Down from a focused line number to select a range. Click the comment button in the **left gutter** beside any selected line, or choose **Comment on lines**, to leave a private note or **Ask AI**. Saved comments also have **Ask AI about this comment**. Comments and streamed AI replies appear directly beneath the selected code. **PR chat** shows the same messages, with code references that jump back to their inline threads. Ask broader questions there, or choose **Continue in PR chat** to retain a thread’s code context. Selection stays within one diff hunk and one side; drafts survive guide navigation. Choose **Prepare GitHub draft** for feedback you want to publish; you can edit that draft.
6. **Finish review** shows coverage and the exact selected drafts. Publish a comment, approval, or change request as supported by GitHub; your own PR only permits a comment.
7. New code appears as an update banner. Loading it preserves review marks only for uniquely matching unchanged hunks. Earlier notes stay attached to their original code and can be reopened with **Open previous revision**.

**Ask about selected text:** Select a variable, function, or code fragment and click the floating **Ask AI** button (or press **Alt+Enter**). Diffcity immediately asks your default AI model to explain that exact text and its role in the surrounding code. Continue the conversation inline or in PR chat. These threads are labeled **AI only** and cannot be prepared or published as GitHub comments. Text selection works in captured surrounding context and the “Since your last review” diff. Select up to 200 consecutive lines / 16,000 characters in one file and one side; use split view to select from a particular version when old and new lines are interleaved.

**Informative guides:** The guide opens with the change's purpose and before/after behavior. Each chapter has a short sticky takeaway and a full Markdown walkthrough, shown above its code, explaining the flow across files, important design choices, and test evidence or gaps. **Why it matters** and **What to verify** make the review concerns concrete. You can collapse explanations independently of code. Provisional groups are clearly labeled; use **New guide** to regenerate older brief guides. The prompt follows the intent-first approach in [Diffity's guide instructions](https://github.com/nilbuild/diffity/blob/ce9de40e94707f1983d1995c9c63679ffa9c670c/src-tauri/prompts/guide.md), adapted for risk-first PR review and validated hunk coverage.

**Faster large reviews:** Reviews with at least 3,000 captured diff lines render nearby code in measured blocks, keeping selected code, focused controls, and inline discussions mounted. Smaller reviews stay fully rendered. **Find in code** (Cmd/Ctrl+F) searches all captured diff lines, including offscreen and folded code; Enter and Shift+Enter move between matching lines. **Render all code** enables full-document assistive reading and text selection and saves your preference. In the 19,890-line production WebKit fixture, adaptive rendering reduced opening time from 7.6 seconds to 249 ms and median scripted scroll-frame time to 17 ms, with about 4,200 DOM elements instead of 200,000. These are local fixture measurements. The guide toolbar stays above the scrolling viewport without covering line controls.

**More room for code:** Scrolling compacts the PR title and guide action into a 48px header. Author, checks, and diff totals return when you scroll to the top. History and previous-revision details scroll with the document, while review tabs, navigation, and active update/error controls remain available.

**Stay oriented inside long files:** File titles stick at the top of the code viewport until their file scrolls away. Collapse a file from its header at any point; consecutive hunks share one header without changing the guide's reading order. A small canvas minimap overlays the right side of the editor for the active file when it is taller than the viewport. It keeps the code's width and wrapping unchanged; horizontal scrolling has extra space to move covered text clear of the map. Click or drag to navigate, or focus it and use arrows, Page Up/Down, Home, and End. Its viewport marker tracks wrapped rows, expanded context, and inline discussions. The map represents displayed code and diff colors, not unloaded portions of the source file; it disappears for short files.

**Markdown comments:** GitHub comments, private notes, Codex replies, and draft previews share GitHub-flavored Markdown rendering: tables, task lists, strikethrough, lists, quotes, fenced code, links, and footnotes. The overview renders PR descriptions the same way. Code and table cells wrap within the review; task checkboxes display their saved state. Web links open in your browser. Active HTML and automatic remote image loading remain disabled.

**Independent PR chat:** Chat has its own message scrollbar beside the review, with its header and composer always available. Scrolling code and inline comments does not move the conversation. New replies follow when you are at the bottom and preserve your position when you are reading older messages. In narrow windows, chat occupies a separate panel; Escape or the close button returns to the review, and code references return directly to their inline thread.

**Fast review switching:** Your open PRs (including drafts), requested reviews, and assigned PRs prepare in the background across all repos, independent of the inbox filter. Saved code and guides open from local storage immediately; comments, checks, and PR metadata refresh in the background. Downloads run one at a time, yield to interactive opens, reuse unchanged revisions, and back off after failures. Prefetching does not run Codex. New code stays behind **Load new revision** while you review, and inherits your latest progress when opened.

**Choose a model:** The default is **Claude Code · Fable 5 · High**. The icon-only Model control in the left rail opens a popover with models and reasoning levels available through your local Codex or Claude Code login. Save a choice for new guides and conversations. Existing conversations retain their model for follow-ups; changing the default leaves active requests unchanged. Existing explicit choices from Connections are retained; unavailable selections are shown with an explanation instead of silently falling back.

**Scan PR status:** Cards use green open, gray draft, purple merged, and red closed icons. Status overlays and labeled badges distinguish reviews, approvals, changes requested, checks, conflicts, blocked merges, and branches behind their base. Repo, author, source/target branch, and update age stay visible; diff counts appear when available. The sample inbox includes varied status combinations.

**Pin repos and PRs:** Select a repo and use its pin button to add a shortcut and move it to the top of the repo selector. Each PR card and the review toolbar also has a pin button. Pinned PRs appear above the usual priority groups and remain in the inbox after closing or merging until unpinned. Account, repo, and search filters still apply. Pins save locally and survive restarts.

**Explore a sample** works without a GitHub PR and demonstrates migrations, authorization, tests, documentation, and localization. It contains deliberate issues and cannot publish feedback.

## Appearance and accessibility

Use the appearance menu in the toolbar to choose **Light**, **Dark**, or **System**. The interface uses neutral black, white, and gray surfaces; PR status, diff additions/deletions, primary actions, and attention warnings retain semantic color. Appearance saves immediately without reconnecting accounts.

Tailwind CSS supplies the styling foundation, and React Aria supplies buttons, tabs, menus, and dialog behavior. Keyboard users can skip to the review, switch tabs with arrow keys, navigate the guide outline, and dismiss dialogs with Escape. Outline jumps focus the destination heading; ordinary scrolling preserves keyboard focus. Explanations stack above code in narrow windows. **Read full context** opens longer explanations and review questions in the document. Focus returns to dialog openers. Code and discussions flow in one review scrollbar. Large reviews load code near the viewport; **Render all code** keeps every expanded line available to assistive technology. Offscreen blocks also have named keyboard load controls. Native Select All from code temporarily renders the full document, while ordinary text selections remain mounted as you scroll. Use **Collapse changes**, individual diff controls, or inline discussion controls to compact a section. **Show 25 lines above/below** reveals unchanged context from the captured revision; repeat to see more, or use **Collapse context**. Extra context is read-only and stops at adjacent changes. Added and removed lines also have textual labels. See [accessibility checks and remaining work](docs/accessibility.md).

## Data and integrations

- Tauri 2, React/TypeScript, Rust, and SQLite. No diffcity server or account is required.
- The Rust backend reads the existing GitHub CLI credential into memory; the credential is not sent to the webview, SQLite, or Codex.
- Codex runs through its local app-server using the existing login. Starting analysis sends the PR description and bounded diff context to the selected model/provider. Asking a question sends the exact selected lines, nearby diff context (up to five rows before/after, plus opposite-side rows inside the range), guide summary, question, and recent private discussion within the same thread and PR revision (up to 24 messages, 2,000 characters each). PR chat includes bounded supporting diff context, prioritizing high-attention changes. These conversations are reconstructed from saved messages on each request; earlier revisions remain separate. Oversized selections are rejected before inference. Source code is not guaranteed to remain on the device during model inference.
- Codex and Claude have no shell, edit, browser, GitHub publication, or MCP-tool access from this review workflow. Claude uses a fresh ephemeral SDK session in an isolated directory with customization hooks disabled, an empty tool set (except structured guide output), and no MCP servers. Authentication stays with each provider’s CLI. The app checks the actual model and rejects silent substitution or malformed guides, preserving existing saved runs. Findings are suggestions; only you mark code reviewed and choose publication.
- SQLite holds snapshots, guides, notes, settings, review progress, and publication state in `~/Library/Application Support/city.diff.desktop/`. WebKit local storage holds the last opened PR, unfinished review summaries, and the full-code rendering preference. **Connections** shows the resolved database directory. `DIFFCITY_DATA_DIR` overrides the database directory for isolated testing.
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
pnpm --filter @diffcity/desktop tauri build --debug --features e2e --target aarch64-apple-darwin --bundles app
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

**Concurrent review conversations:** Ask about multiple code ranges or text selections while a guide is generating. Each exact selection has independent conversation history; PR-wide chat is its own conversation. Threads receive the PR description, current overview, selected code, and supporting diff context, without unrelated threads’ messages. The sidebar collects the conversations together. Up to four jobs execute at once, with additional jobs queued. Each response has its own progress, errors, and cancel control. Follow-ups within a busy thread wait for its response, while other threads remain available. Jobs continue when you navigate to a different review; saved replies and guides remain associated with their original revision. Closing the app stops unfinished jobs.
