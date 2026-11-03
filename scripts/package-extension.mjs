import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extensionMetadata } from "./release-meta.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps/extension/dist");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const sourceManifest = JSON.parse(
  readFileSync(join(root, "apps/extension/public/manifest.json"), "utf8"),
);
if (!isDeepStrictEqual(manifest, sourceManifest))
  throw new Error("Extension build is stale; rebuild before packaging.");
const releaseVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
const extension = extensionMetadata(manifest, releaseVersion);
const identity = JSON.parse(
  readFileSync(join(root, "apps/extension/identity.json"), "utf8"),
);
const id = [
  ...createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest()
    .subarray(0, 16),
]
  .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
  .join("");
if (id !== identity.id)
  throw new Error("Extension ID does not match the registered native host");
const embedded = manifest.web_accessible_resources;
if (
  manifest.externally_connectable ||
  JSON.stringify(embedded) !==
    JSON.stringify([
      {
        resources: ["inline.html", "inline.js", "assets/*"],
        matches: ["https://github.com/*"],
      },
    ])
)
  throw new Error(
    "Only the scoped inline frame and its assets may be exposed to GitHub",
  );
const output = resolve(process.argv[2] || join(root, ".local/extension"));
mkdirSync(output, { recursive: true });
const zip = join(output, extension.archive);
const staging = mkdtempSync(join(tmpdir(), "diffcity-extension-"));
try {
  cpSync(dist, staging, { recursive: true });
  copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE.txt"));
  copyFileSync(
    join(root, ".local/release/THIRD_PARTY_NOTICES.txt"),
    join(staging, "THIRD_PARTY_NOTICES.txt"),
  );
  writeFileSync(
    join(staging, "INSTALL.txt"),
    `Diff City ${releaseVersion} — Chrome companion\n\nInstall the matching Diff City desktop app from the same GitHub release.\nIn Diff City, open Connections and enable the Chrome connection.\nKeep this extracted directory in a permanent location. In chrome://extensions,\nenable Developer mode and choose Load unpacked, then select this directory.\n\nSetup and manual updates: https://github.com/crs48/diffcity/blob/main/docs/chrome-extension.md\nThis alpha is not listed in the Chrome Web Store.\n`,
  );
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", staging, zip]);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${hash}  ${zip.split("/").at(-1)}\n`);
console.log(`Packaged ${zip} (${readdirSync(dist).length} top-level entries)`);
