import {
  readFileSync,
  appendFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseMetadata(tag, versions, signing = "developer-id") {
  const match = /^v(\d+\.\d+\.\d+)(-(?:alpha|beta|rc)\.\d+)?$/.exec(tag ?? "");
  if (!match) throw new Error("Use vX.Y.Z or vX.Y.Z-alpha.N/beta.N/rc.N.");
  const version = tag.slice(1);
  if (!versions.length || versions.some((value) => value !== version))
    throw new Error(
      `Release ${tag} must match every package and Tauri version.`,
    );
  if (!["developer-id", "ad-hoc"].includes(signing))
    throw new Error("MACOS_SIGNING_MODE must be developer-id or ad-hoc.");
  const prerelease = Boolean(match[2]);
  if (!prerelease && signing !== "developer-id")
    throw new Error(
      "Stable releases require Developer ID signing and notarization.",
    );
  return { tag, version, prerelease, signing };
}

export function extensionMetadata(manifest, releaseVersion) {
  const parts = String(manifest.version).split(".");
  if (
    parts.length < 1 ||
    parts.length > 4 ||
    parts.some(
      (part) => !/^(0|[1-9]\d*)$/.test(part) || Number(part) > 65535,
    ) ||
    parts.every((part) => Number(part) === 0)
  )
    throw new Error(
      "Chrome requires a numeric version with up to four components.",
    );
  if (manifest.version_name !== releaseVersion)
    throw new Error("Chrome version_name must match the desktop release.");
  return {
    version: manifest.version,
    versionName: manifest.version_name,
    archive: `diffcity-chrome-${manifest.version}.zip`,
    minimumChromeVersion: manifest.minimum_chrome_version,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const jsonVersions = [
    "package.json",
    "apps/desktop/package.json",
    "apps/site/package.json",
    "apps/extension/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
  ].map((path) => JSON.parse(readFileSync(path, "utf8")).version);
  const cargoVersion = /^version = "([^"]+)"/m.exec(
    readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8"),
  )?.[1];
  const metadata = releaseMetadata(
    process.env.RELEASE_TAG,
    [...jsonVersions, cargoVersion],
    process.env.MACOS_SIGNING_MODE || "developer-id",
  );
  metadata.extension = extensionMetadata(
    JSON.parse(readFileSync("apps/extension/public/manifest.json", "utf8")),
    metadata.version,
  );
  if (metadata.signing === "developer-id") {
    for (const key of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      if (!process.env[key]?.trim())
        throw new Error(`Missing release secret: ${key}`);
    }
    if (
      !process.env.APPLE_SIGNING_IDENTITY.startsWith(
        "Developer ID Application:",
      )
    )
      throw new Error(
        "Use a Developer ID Application identity, not an Apple Development identity.",
      );
  }
  mkdirSync(".local/release", { recursive: true });
  writeFileSync(
    ".local/release/metadata.json",
    JSON.stringify(metadata, null, 2) + "\n",
  );
  writeFileSync(
    ".local/release/tauri.conf.json",
    JSON.stringify(
      {
        bundle: {
          resources: {
            "../../../.local/release/THIRD_PARTY_NOTICES.txt":
              "THIRD_PARTY_NOTICES.txt",
          },
          macOS: {
            signingIdentity:
              metadata.signing === "developer-id"
                ? process.env.APPLE_SIGNING_IDENTITY
                : "-",
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(metadata)
        .filter(([, value]) => typeof value !== "object")
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(JSON.stringify(metadata));
}
