import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const metadata = JSON.parse(
  readFileSync(".local/release/metadata.json", "utf8"),
);
const bundle = "target/aarch64-apple-darwin/release/bundle";
const app = `${bundle}/macos/diffcity.app`;
const images = readdirSync(`${bundle}/dmg`).filter((name) =>
  name.endsWith(".dmg"),
);
if (images.length !== 1)
  throw new Error("Expected exactly one DMG; clean old release output first.");
execFileSync("node", ["scripts/verify-macos-architecture.mjs", app], {
  stdio: "inherit",
});
const dmg = `${bundle}/dmg/${images[0]}`;
execFileSync("hdiutil", ["verify", dmg], { stdio: "inherit" });
if (metadata.signing === "developer-id") {
  execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
  execFileSync("xcrun", ["stapler", "validate", dmg], { stdio: "inherit" });
  execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], {
    stdio: "inherit",
  });
}
const out = ".local/release/assets";
mkdirSync(out, { recursive: true });
copyFileSync(dmg, `${out}/diffcity-macos-arm64.dmg`);
execFileSync("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  `${out}/diffcity-macos-arm64.zip`,
]);
copyFileSync("LICENSE", `${out}/LICENSE.txt`);
copyFileSync(
  ".local/release/THIRD_PARTY_NOTICES.txt",
  `${out}/THIRD_PARTY_NOTICES.txt`,
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
writeFileSync(
  `${out}/release.json`,
  JSON.stringify(
    {
      ...metadata,
      commit,
      platform: "macOS",
      minimumSystemVersion: "14.0",
      architecture: "arm64",
      notarized: metadata.signing === "developer-id",
    },
    null,
    2,
  ) + "\n",
);
const files = [
  "diffcity-macos-arm64.dmg",
  "diffcity-macos-arm64.zip",
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "release.json",
];
writeFileSync(
  `${out}/SHA256SUMS.txt`,
  files
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(`${out}/${name}`))
          .digest("hex")}  ${name}\n`,
    )
    .join(""),
);
const signingNote =
  metadata.signing === "developer-id"
    ? "This build is Developer ID signed and notarized by Apple."
    : "**Unsigned alpha:** this build uses an ad-hoc integrity signature, not an Apple Developer ID certificate, and is **not notarized**. macOS will require approval in **System Settings → Privacy & Security → Open Anyway** after the first launch attempt. Do not disable Gatekeeper globally. If your Mac's policy blocks unnotarized apps, build from source or wait for a notarized release.";
writeFileSync(
  ".local/release/notes.md",
  `# Diff City ${metadata.version}\n\nA desktop workspace for GitHub pull request reviews with Codex and Claude Code.\n\n- Guided walkthroughs, rich overviews, naming decisions, and code notes beside the diff.\n- Inline AI conversations, queued follow-ups, and local GitHub review drafts.\n- A review inbox, incremental reviews, and a navigable guide rail.\n\n## Install\n\n**Apple silicon (M1 or later), macOS 14+.** Download **diffcity-macos-arm64.dmg**, open it, and drag **diffcity** into **Applications**. The ZIP contains the same app as an alternative.\n\n${signingNote}\n\nInstall [GitHub CLI](https://cli.github.com/) and run \`gh auth login\`. Install and sign into [Codex](https://developers.openai.com/codex/cli/) or [Claude Code](https://code.claude.com/docs/en/setup). Open Diff City and check **Connections**. These external tools and subscriptions are not bundled.\n\n## Verify and update\n\nDownload **SHA256SUMS.txt** and run \`shasum -a 256 --ignore-missing -c SHA256SUMS.txt\` in the download folder. Compare the included \`release.json\` with source commit \`${commit}\`.\n\nUpdates are manual: quit Diff City and replace the app. Your workspace stays in \`~/Library/Application Support/city.diff.desktop/\`; back it up before an upgrade or downgrade. Automatic updates are not included in this alpha.\n\n## Alpha limitations\n\nWindows, Linux, and Intel Mac binaries are not available. AI uses your provider account and can incur usage. Large diffs may have unassessed sections; a guide is not a completeness guarantee. See [setup and privacy](https://github.com/crs48/diffcity#data-and-integrations) and report bugs with sensitive code and account data removed.\n`,
);
console.log(`Release assets: ${resolve(out)}`);
