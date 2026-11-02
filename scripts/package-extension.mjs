import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps/extension/dist");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
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
const zip = join(output, `diffcity-chrome-${manifest.version}.zip`);
execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", dist, zip]);
const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${hash}  ${zip.split("/").at(-1)}\n`);
console.log(`Packaged ${zip} (${readdirSync(dist).length} top-level entries)`);
