import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultBundle = fileURLToPath(
  new URL(
    "../target/aarch64-apple-darwin/release/bundle/macos/diffcity.app",
    import.meta.url,
  ),
);

/** Inspect actual Mach-O slices, including helpers and framework symlinks. */
export function verifyMacArchitecture(bundle = defaultBundle) {
  const root = realpathSync(bundle);
  const main = realpathSync(join(root, "Contents/MacOS/diffcity"));
  const visited = new Set();
  const binaries = [];
  const visit = (path) => {
    const real = realpathSync(path);
    if (real !== root && !real.startsWith(root + sep))
      throw new Error(`Bundle symlink escapes the app: ${path}`);
    if (visited.has(real)) return;
    visited.add(real);
    if (statSync(real).isDirectory()) {
      readdirSync(real).forEach((name) => visit(join(real, name)));
      return;
    }
    const format = execFileSync("file", ["-b", real], { encoding: "utf8" });
    if (!format.includes("Mach-O")) return;
    const architectures = execFileSync("lipo", ["-archs", real], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/);
    if (!architectures.includes("arm64"))
      throw new Error(
        `Missing arm64: ${relative(root, real)} (${architectures.join(", ")})`,
      );
    binaries.push({ path: real, architectures });
  };
  visit(root);
  if (!binaries.some((binary) => binary.path === main))
    throw new Error("The main executable is not an arm64 Mach-O binary.");
  return binaries;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const bundle = resolve(process.argv[2] ?? defaultBundle);
  const binaries = verifyMacArchitecture(bundle);
  execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {
    stdio: "inherit",
  });
  console.log(
    `Verified Apple silicon support in ${binaries.length} Mach-O binary/binaries: ${bundle}`,
  );
  binaries.forEach(({ path, architectures }) =>
    console.log(`  ${relative(bundle, path)}: ${architectures.join(", ")}`),
  );
  console.log("Bundle signature verified.");
}
