# 07 — Private alpha, distribution, and public MIT release

## Objective and dependencies

Make the completed review loop dependable enough for daily use, then prepare a clean public release under the owner's personal account. Depends on steps 01–06. Public visibility is a later owner-selected milestone, not an automatic side effect of completing this plan.

## Proposed touchpoints

Packaging and CI configuration, release scripts, update configuration, `apps/site`, maintained installation/privacy/contribution docs, `LICENSE`, and third-party notices.

## Private alpha

Dogfood against a representative mix of the owner's PRs and other people's PRs. Measure time to open a PR, time to understand the change, number of GitHub context switches, model failures, incorrect anchors, duplicate-publication incidents, and drift in sync state. Keep metrics local by default. The useful outcome is a shorter, more confident review, not more generated text.

Before inviting external testers, complete the GitHub App onboarding flow, test approval restrictions in an organization, and confirm supported Codex setup on a clean machine. Present actionable errors for unsupported runtime versions, missing credentials, denied repository access, and account policies. Do not rely on the developer's shell PATH or preexisting local tools accidentally making the app work.

Validate renderer isolation, untrusted Markdown, restricted Codex context, secret redaction, dependency licenses, local retention, and recovery from a corrupt or outdated local database. Accessibility and large-diff checks are release gates, not optional post-launch work.

## Packaging and updates

Ship macOS Apple Silicon first, with Intel support only after equivalent verification. Choose the minimum macOS version from the pinned Electron runtime's supported range at build time. Record it in installation docs.

Use signed/notarized macOS artifacts for external distribution and a signed update channel with rollback guidance. Signing keys and credentials stay in release secrets. Pull-request CI should build and test without release credentials; trusted release jobs get narrowly scoped permissions. Determine private-alpha artifact access explicitly: private GitHub release assets require authorized access and are not a public download channel.

Initially distribute to invited testers through a documented private channel. When public launch is chosen, point diff.city downloads to verified public release artifacts. The website needs product explanation, setup, screenshots made from synthetic data, privacy/data-flow documentation, source link, and release notes. Domain ownership/DNS and hosting have not been verified or configured in this planning pass.

## Open-source transition

The project carries `MIT` under Christopher Smothers. Keep it in the personal repository `crs48/diffcity`. Private visibility controls access; licensing and visibility are separate settings. Maintain attribution for any code or assets reused from Diffity and preserve dependency license/NOTICE obligations. Do not rebrand someone else's contribution as solely original work.

Before making the repository public, inspect tracked files and reachable history for credentials, private customer/work code, copied fixtures, diagnostics, and screenshots. Public-ready synthetic fixtures should be the norm from the first implementation commit. If a secret is found, rotate it and resolve history exposure before publication; do not assume deleting the current file is sufficient.

Add contribution instructions, development setup, architecture overview, issue templates, a security reporting route, and an explicit supported-platform policy. Keep the main branch buildable and document required third-party accounts. Contributors should be able to run fixture-driven tests without private credentials, Apple signing access, or paid model calls.

## Release checklist

- [ ] Pass a clean-machine install and complete author/reviewer journeys.
- [ ] Validate account setup, token rotation, revocation, and organization restrictions.
- [ ] Validate PR revision changes, missing context, and offline recovery.
- [ ] Validate interrupted writes and absence of private text in GitHub payloads.
- [ ] Meet agreed large-diff and accessibility targets.
- [ ] Document local storage, model data flow, cache deletion, and diagnostic export.
- [ ] Produce and verify signed/notarized private-alpha artifacts.
- [ ] Test the update channel and previous-version recovery.
- [ ] Add repeatable source-build and contributor instructions.
- [ ] Audit exact dependency licenses and third-party attribution.
- [ ] Inspect public-release history and all shipped assets.
- [ ] Prepare diff.city downloads and docs after hosting/DNS is selected.
- [ ] Make the repository public when the owner chooses to publish.
- [ ] Verify public source access, downloads, docs, and install instructions.

## Validation and exit criteria

A tester with no developer checkout can connect GitHub, choose a repository, open a PR, obtain a walkthrough, ask about a line, publish selected feedback, and revisit a new revision. Restart/offline/expired-auth paths preserve their work. A contributor can clone the public repository and run meaningful fixture-based checks.

The optional webhook relay, additional providers, automatic code fixes, cross-device sync, and Windows/Linux releases receive separate plans after this loop is proven.
