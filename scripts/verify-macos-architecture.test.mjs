import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyMacArchitecture,
  verifyDistributionContents,
} from "./verify-macos-architecture.mjs";

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "diffcity-architecture-"));
  const source = join(root, "main.c");
  writeFileSync(source, "int main(void) { return 0; }\n");
  for (const architecture of ["arm64", "x86_64"])
    execFileSync("clang", [
      "-arch",
      architecture,
      source,
      "-o",
      join(root, architecture),
    ]);
  execFileSync("lipo", [
    "-create",
    join(root, "arm64"),
    join(root, "x86_64"),
    "-output",
    join(root, "universal"),
  ]);
});
after(() => root && rmSync(root, { recursive: true, force: true }));

const bundle = (architecture) => {
  const app = mkdtempSync(join(root, "test.app-"));
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  copyFileSync(join(root, architecture), join(app, "Contents/MacOS/diffcity"));
  return app;
};

test("accepts an Apple silicon app", () => {
  assert.deepEqual(verifyMacArchitecture(bundle("arm64"))[0].architectures, [
    "arm64",
  ]);
});
test("accepts a universal executable with an ARM slice", () => {
  assert.equal(
    verifyMacArchitecture(bundle("universal"))[0].architectures.includes(
      "arm64",
    ),
    true,
  );
});
test("rejects an Intel-only main executable", () => {
  assert.throws(
    () => verifyMacArchitecture(bundle("x86_64")),
    /Missing arm64: Contents\/MacOS\/diffcity/,
  );
});
test("rejects an Intel-only helper inside an ARM app", () => {
  const app = bundle("arm64");
  mkdirSync(join(app, "Contents/Helpers"));
  copyFileSync(
    join(root, "x86_64"),
    join(app, "Contents/Helpers/review-helper"),
  );
  assert.throws(
    () => verifyMacArchitecture(app),
    /Missing arm64: Contents\/Helpers\/review-helper/,
  );
});

test("rejects development tools even when they are native ARM executables", () => {
  const app = bundle("arm64");
  assert.doesNotThrow(() => verifyDistributionContents(app));
  copyFileSync(join(root, "arm64"), join(app, "Contents/MacOS/live-smoke"));
  assert.throws(
    () => verifyDistributionContents(app),
    /Unexpected distribution executables/,
  );
});
