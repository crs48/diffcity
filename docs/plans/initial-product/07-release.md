# 07 — Private alpha, distribution, and public MIT release

## Launch decision · October 27, 2026

The owner approved a public unsigned alpha. The original repository is archived privately; the public repository contains sanitized history. This explicitly replaces the original signed/private-alpha rollout below. Developer ID signing, notarization, automatic updates, clean-machine acceptance and the broader research gates remain follow-up work; see [release operations](../../releasing.md) and the [security exploration](../../explorations/0001_[_]_SECURITY_BOUNDARIES_AND_PUBLIC_LAUNCH_READINESS.md).

## Objective and dependencies

Make the completed review loop dependable enough for daily use, then prepare a clean public release under the owner's personal account. Depends on steps 01–06. Public visibility is a later owner-selected milestone, not an automatic side effect of completing this plan.

## Proposed touchpoints

Tauri bundle/capability configuration under `apps/desktop/src-tauri`, Cargo/pnpm build and CI configuration, release scripts, update configuration, `apps/site`, maintained installation/privacy/contribution docs, `LICENSE`, and third-party notices.

## Private alpha

Dogfood against a representative mix of the owner's PRs and other people's PRs. The primary release gate is the [guided-review evaluation](guided-review.md): consequential code appears early, routine folding does not conceal seeded important changes, explanations are grounded, and a review can be completed in Guide. Compare counterbalanced tasks against file order and a simple topic-order guide before claiming a better experience. Inbox polish cannot compensate for a poor guide.

Measure time to the first important concern, planted-issue detection, comprehension, mistaken folding, manual priority corrections, Files detours, and time to understand the overall change. Also measure opening latency, GitHub context switches, model failures, incorrect anchors, duplicate-publication incidents, and sync drift. Keep metrics local by default. Record results and use failures to improve the corpus; do not trade missed consequential changes for a faster completion number.

Before inviting external testers, complete the GitHub App onboarding flow, test approval restrictions in an organization, and confirm supported Codex setup on a clean machine. Present actionable errors for unsupported runtime versions, missing credentials, denied repository access, and account policies. Do not rely on the developer's shell PATH or preexisting local tools accidentally making the app work.

Validate Tauri capabilities and custom-command authorization, untrusted Markdown, restricted Codex context, secret redaction, dependency licenses, local retention, and recovery from a corrupt or outdated local database. Confirm test-only WebDriver/backend-access plugins are absent from distribution artifacts. Accessibility and large-diff checks are release gates, not optional post-launch work.

## Packaging and updates

Ship macOS Apple Silicon first, with Intel support only after equivalent verification. Choose the minimum macOS version from the intersection of Tauri/plugin support, the Rust toolchain, the Codex runtime, and the UI's required WebKit features. Test that minimum and the current supported macOS version in a packaged app and record the resulting policy in installation docs. Tauri uses the OS-provided WKWebView on macOS, so frontend compatibility follows supported system webviews; see [Tauri's webview reference](https://v2.tauri.app/reference/webview-versions/).

Use signed/notarized macOS artifacts for external distribution and a signed update channel with rollback guidance. Signing keys and credentials stay in release secrets. Pull-request CI should build and test without release credentials; trusted release jobs get narrowly scoped permissions. Determine private-alpha artifact access explicitly: private GitHub release assets require authorized access and are not a public download channel.

Initially distribute to invited testers through a documented private channel. When public launch is chosen, point diff.city downloads to verified public release artifacts. The website needs product explanation, setup, screenshots made from synthetic data, privacy/data-flow documentation, source link, and release notes. Domain ownership/DNS and hosting have not been verified or configured in this planning pass.

## Open-source transition

The project carries `MIT` under Christopher Smothers. Keep it in the personal repository `crs48/diffcity`. Private visibility controls access; licensing and visibility are separate settings. Maintain attribution for any code or assets reused from Diffity and preserve dependency license/NOTICE obligations. Do not rebrand someone else's contribution as solely original work.

Before making the repository public, inspect tracked files and reachable history for credentials, private customer/work code, copied fixtures, diagnostics, and screenshots. Public-ready synthetic fixtures should be the norm from the first implementation commit. If a secret is found, rotate it and resolve history exposure before publication; do not assume deleting the current file is sufficient.

Add contribution instructions, development setup, architecture overview, issue templates, a security reporting route, and an explicit supported-platform policy. Keep the main branch buildable and document required third-party accounts. Contributors should be able to run fixture-driven tests without private credentials, Apple signing access, or paid model calls.

## Release checklist

- [ ] Pass a clean-machine install and complete author/reviewer journeys.
- [ ] Pass guided-review ordering, folding, coverage, and stability fixture gates.
- [ ] Record guide comprehension/detection results against the two baselines and resolve material failures.
- [ ] Validate account setup, token rotation, revocation, and organization restrictions.
- [ ] Validate PR revision changes, missing context, and offline recovery.
- [ ] Validate interrupted writes and absence of private text in GitHub payloads.
- [ ] Meet agreed large-diff and accessibility targets.
- [ ] Document local storage, model data flow, cache deletion, and diagnostic export.
- [ ] Produce and verify signed/notarized private-alpha artifacts.
- [x] Verify the shipped Tauri build has no test-driver or backend-debug access enabled.
- [ ] Test the update channel and previous-version recovery.
- [x] Add repeatable source-build and contributor instructions.
- [x] Audit exact dependency licenses and third-party attribution.
- [x] Inspect public-release history and all shipped assets.
- [x] Prepare diff.city downloads and docs after hosting/DNS is selected.
- [x] Make the repository public when the owner chooses to publish.
- [x] Verify public source access, downloads, docs, and install instructions.

## Validation and exit criteria

A tester with no developer checkout can connect GitHub, choose a repository, open a PR in Guide, review consequential code first, inspect a folded routine group, ask about a line, publish selected feedback, and revisit a new revision without a required Files detour. The guided-review corpus passes and observed comprehension/detection results support release. Restart/offline/expired-auth paths preserve their work. A contributor can clone the public repository and run meaningful fixture-based checks.

The optional webhook relay, additional providers, automatic code fixes, cross-device sync, and Windows/Linux releases receive separate plans after this loop is proven.
