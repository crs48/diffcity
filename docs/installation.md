# Install Diff City

Diff City currently supports **Apple silicon Macs (M1 or newer), macOS 14 or later**. Intel Macs, Windows, and Linux do not yet have supported release binaries.

1. Open [GitHub Releases](https://github.com/crs48/diffcity/releases) and select the newest release. Alpha releases are marked **Pre-release**.
2. Download `diffcity-macos-arm64.dmg`, open it, and drag `diffcity` to **Applications**. The ZIP contains the same app if you prefer to unpack it yourself.
3. Read the release's signing status. Early unsigned alphas use an ad-hoc integrity signature and are **not notarized**. After attempting to open one, use **System Settings → Privacy & Security → Open Anyway** if macOS offers that option and you trust the download. Do not disable Gatekeeper globally. If your organization's policy blocks these apps, build from source or wait for a notarized release.
4. Install [GitHub CLI](https://cli.github.com/) and sign in with `gh auth login`. Install and sign into [Codex CLI](https://developers.openai.com/codex/cli/) or [Claude Code](https://code.claude.com/docs/en/setup). Diff City uses those local tools and their accounts; they are not bundled with the app.
5. Open Diff City and check **Connections**. Use **Local code** to select your code folder or link a repository directly. Select a model, open a PR, and generate a guide.

No Diff City account is required. AI requests use your model provider's subscription or API billing. The desktop **Limited** access mode is the default; review the implications before enabling broader access.

## Verify your download

Download `SHA256SUMS.txt` from the same release into the same folder as the DMG or ZIP, then run:

```sh
shasum -a 256 --ignore-missing -c SHA256SUMS.txt
```

Confirm that the actual file you downloaded reports `OK`. The release includes `release.json` with the exact source commit, architecture, version, and notarization status, plus the dependency license notices. Checksums detect a corrupted download; they do not replace Apple signing or notarization. Obtain all files directly from the linked GitHub release.

## Updates and recovery

This alpha uses manual updates. Quit Diff City, download the new version, and replace the app in Applications. Guides, notes, settings, and review state are stored separately in `~/Library/Application Support/city.diff.desktop/`. Back up that folder with the app closed before updating. The last opened PR and some UI preferences also live in WebKit storage.

An older executable may not understand a newer database schema. To roll back, restore both the older app and its matching data backup while Diff City is closed. Never delete a newer workspace just to make an older build open. Replacing the app alone does not remove your saved reviews.

## Troubleshooting

- **Missing CLI:** check its executable path in Connections. Install the native ARM version of each external tool; Diff City's ARM bundle cannot fix an Intel-only external installation.
- **GitHub works in Terminal but not Diff City:** check local network-filter prompts for the installed app and the error in Connections. GitHub organization SSO policies also apply.
- **Model unavailable:** choose a model exposed by your installed provider CLI/account. Diff City does not supply an AI subscription.
- **No packaged download yet or Gatekeeper policy blocks it:** use the [source build instructions](../CONTRIBUTING.md). Local builds are ad-hoc signed.

For macOS's approval flow, see [Apple's guidance on safely opening apps](https://support.apple.com/en-us/102445).
