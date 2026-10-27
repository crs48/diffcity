# Contributing to Diff City

Diff City is an MIT-licensed project by Christopher Smothers. Bug reports, accessibility fixes, review-flow improvements, and documentation contributions are welcome.

## Development

The supported app target is Apple silicon on macOS 14 or later. Install Xcode command-line tools, Node.js 24, pnpm 10.11.1, and Rust through rustup; `rust-toolchain.toml` selects the compiler and target.

```sh
git clone https://github.com/crs48/diffcity.git
cd diffcity
pnpm install --frozen-lockfile
pnpm dev
```

For the website alone, run `pnpm site:dev`. The desktop frontend also runs in the browser with `pnpm --filter @diffcity/desktop dev`, but live integrations require the Tauri app.

```sh
pnpm contracts
cargo fmt --all -- --check
pnpm check
pnpm lint
cargo test --workspace --locked
pnpm --filter @diffcity/desktop exec vitest run --maxWorkers=2 --testTimeout=15000
pnpm release:check
pnpm desktop:build
pnpm site:build
```

Automated fixture tests need no GitHub token, AI subscription, or Apple signing credentials. Ignored live tests and smoke examples use local accounts and may consume model usage; they are opt-in. Run development helpers with `cargo run -p diffcity --example NAME`; keeping them in Cargo examples prevents Tauri from packaging them as application binaries. Never run publication smoke tests against real PRs without explicit permission. The `e2e` feature enables a test driver and must not be included in distributed builds.

## Pull requests

- Start from `main`, keep changes focused, and explain the user-visible problem and the verification you performed.
- Prefer declarative, functional code. Cover behavior changes with meaningful tests, including keyboard use for interactive changes.
- Run `pnpm contracts` after changing Rust contracts and commit the generated TypeScript.
- Include English and Spanish strings for new UI copy. Preserve light/dark contrast and visible focus states.
- Use synthetic repositories, code, and screenshots in fixtures. Never commit credentials, local databases, customer code, or private review conversations.
- Use conventional commit titles, with detailed bullets when the change needs explanation.

The intentionally flawed `[TEST ONLY]` and `[UX sample]` PRs are demonstration fixtures. Do not merge them. See [the corpus documentation](tests/corpus/README.md).

For vulnerabilities, use [private security reporting](SECURITY.md). Packaging and publishing are described in [the release guide](docs/releasing.md).
