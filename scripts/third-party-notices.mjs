import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const jsonCommand = (command, args) =>
  JSON.parse(
    execFileSync(command, args, { encoding: "utf8", maxBuffer: 30_000_000 }),
  );
const licenseFiles = (root) =>
  readdirSync(root, { withFileTypes: true }).flatMap((file) => {
    const path = join(root, file.name);
    if (
      file.isFile() &&
      /^(licen[sc]e|notice|copying|copyright|unlicen[sc]e|ofl)([._-]|$)/i.test(
        file.name,
      )
    )
      return [path];
    if (file.isDirectory() && /^(licen[sc]es|legal)$/i.test(file.name))
      return readdirSync(path, { withFileTypes: true })
        .filter((child) => child.isFile())
        .map((child) => join(path, child.name));
    return [];
  });
const npm = jsonCommand("pnpm", [
  "--filter",
  "@diffcity/desktop",
  "licenses",
  "list",
  "--prod",
  "--json",
]);
const npmPackages = Object.values(npm)
  .flat()
  .flatMap((entry) =>
    entry.paths.map((path) => {
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      return {
        name: `${pkg.name}@${pkg.version}`,
        path,
        license: pkg.license ?? entry.license,
        source: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/").at(-1)}-${pkg.version}.tgz`,
      };
    }),
  );
const cargo = jsonCommand("cargo", [
  "metadata",
  "--locked",
  "--format-version",
  "1",
  "--filter-platform",
  "aarch64-apple-darwin",
]);
const nodes = new Map(cargo.resolve.nodes.map((node) => [node.id, node]));
const reached = new Set();
const visit = (id) => {
  if (reached.has(id)) return;
  reached.add(id);
  for (const dep of nodes.get(id)?.deps ?? [])
    if (dep.dep_kinds.some((kind) => kind.kind !== "dev")) visit(dep.pkg);
};
cargo.workspace_members.forEach(visit);
const rustPackages = cargo.packages
  .filter((pkg) => reached.has(pkg.id) && pkg.source)
  .map((pkg) => ({
    name: `${pkg.name}@${pkg.version}`,
    path: dirname(pkg.manifest_path),
    license: pkg.license,
    source: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
    licenseFile: pkg.license_file,
  }));
const packages = [...npmPackages, ...rustPackages].sort((a, b) =>
  a.name.localeCompare(b.name),
);
const notices = packages.map((pkg) => {
  const paths = [
    ...new Set([
      ...licenseFiles(pkg.path),
      ...(pkg.licenseFile ? [join(pkg.path, pkg.licenseFile)] : []),
    ]),
  ].filter(existsSync);
  // React's marker package declares MIT but omits LICENSE from its npm files list.
  if (pkg.name === "client-only@0.0.1" && !paths.length)
    paths.push("apps/desktop/node_modules/react/LICENSE");
  // tauri-plugin is part of the core Tauri repository, whose license files
  // are included in the tauri crate but omitted from this helper crate.
  if (pkg.name.startsWith("tauri-plugin@") && !paths.length) {
    const tauri = cargo.packages.find((entry) => entry.name === "tauri");
    paths.push(...licenseFiles(dirname(tauri.manifest_path)));
  }
  if (/^ts-rs(-macros)?@12\.0\.1$/.test(pkg.name) && !paths.length)
    paths.push("scripts/licenses/ts-rs-MIT.txt");
  // Some packages put their full license in the README instead of a separate file.
  const readme = readdirSync(pkg.path).find((name) =>
    /^readme(\.md|\.txt)?$/i.test(name),
  );
  if (!paths.length && readme) paths.push(join(pkg.path, readme));
  if (!paths.length)
    throw new Error(
      `No license text for ${pkg.name}. Review the package before distributing.`,
    );
  return (
    `\n${"=".repeat(72)}\n${pkg.name}\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\nOriginal source: ${pkg.source}\n\n` +
    paths
      .map((path) => `${basename(path)}\n${readFileSync(path, "utf8")}`)
      .join("\n\n")
  );
});
const assets = [
  "apps/desktop/src/assets/providers/LICENSE",
  "packages/brand/PRIMER-LICENSE",
];
const header = `Diff City — third-party notices\n\n${readFileSync("LICENSE", "utf8")}\n\nThe following unmodified packages support the desktop app and its build.\nTheir original licenses remain in force; Diff City's MIT license does not\nreplace them. Source archives are linked at exact versions. This includes\nsource availability for EPL/MPL components. Rebuild instructions are in\nhttps://github.com/crs48/diffcity/blob/main/CONTRIBUTING.md.\n`;
mkdirSync(".local/release", { recursive: true });
writeFileSync(
  ".local/release/THIRD_PARTY_NOTICES.txt",
  header +
    notices.join("\n") +
    assets.map((path) => `\n${path}\n${readFileSync(path, "utf8")}`).join("\n"),
);
console.log(
  `Collected notices and source links for ${packages.length} dependencies and bundled artwork.`,
);
