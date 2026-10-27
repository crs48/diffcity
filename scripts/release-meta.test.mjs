import assert from "node:assert/strict";
import test from "node:test";
import { releaseMetadata } from "./release-meta.mjs";

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
