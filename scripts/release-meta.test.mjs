import assert from "node:assert/strict";
import test from "node:test";
import { releaseMetadata, extensionMetadata } from "./release-meta.mjs";

test("only explicitly opted-in prereleases allow ad-hoc signing", () => {
  assert.deepEqual(
    releaseMetadata("v0.1.0-alpha.1", ["0.1.0-alpha.1"], "ad-hoc"),
    {
      tag: "v0.1.0-alpha.1",
      version: "0.1.0-alpha.1",
      prerelease: true,
      signing: "ad-hoc",
    },
  );
  assert.throws(
    () => releaseMetadata("v0.1.0", ["0.1.0"], "ad-hoc"),
    /require Developer ID/,
  );
  assert.equal(releaseMetadata("v0.1.0", ["0.1.0"]).signing, "developer-id");
});

test("Chrome numeric versions retain a matching human-readable alpha version", () => {
  const manifest = {
    version: "0.1.0.2",
    version_name: "0.1.0-alpha.2",
    minimum_chrome_version: "120",
  };
  assert.deepEqual(extensionMetadata(manifest, "0.1.0-alpha.2"), {
    version: "0.1.0.2",
    versionName: "0.1.0-alpha.2",
    archive: "diffcity-chrome-0.1.0.2.zip",
    minimumChromeVersion: "120",
  });
  assert.throws(
    () => extensionMetadata(manifest, "0.1.0-alpha.1"),
    /must match/,
  );
  for (const version of [
    "0.1.0-alpha.2",
    "0.1.0.2.1",
    "0.01.2",
    "0.1.65536",
    "0.0.0.0",
    "../archive",
  ])
    assert.throws(
      () => extensionMetadata({ ...manifest, version }, "0.1.0-alpha.2"),
      /numeric version/,
    );
});

test("rejects invalid tags, unknown signing modes, and version drift", () => {
  for (const tag of [
    "main",
    "v1.2",
    "v1.2.3\nother=value",
    "v1.2.3-unknown.1",
    "v1.2.3;touch /tmp/file",
  ])
    assert.throws(() => releaseMetadata(tag, [tag.slice(1)]));
  assert.throws(
    () => releaseMetadata("v1.2.3", ["1.2.3", "1.2.2"]),
    /must match/,
  );
  assert.throws(() => releaseMetadata("v1.2.3", [undefined]), /must match/);
  assert.throws(() => releaseMetadata("v1.2.3", []), /must match/);
  assert.throws(
    () => releaseMetadata("v1.2.3", ["1.2.3"], "unsigned"),
    /SIGNING_MODE/,
  );
});
