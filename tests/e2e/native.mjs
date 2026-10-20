// Drives the real macOS WKWebView through a test-only embedded WebDriver.
// No GitHub write occurs unless DIFFCITY_TEST_PUBLISH=yes is explicitly set.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const binary =
  process.env.DIFFCITY_TEST_BINARY ||
  resolve(
    root,
    "target/debug/bundle/macos/diffcity.app/Contents/MacOS/diffcity",
  );
const port = 4459;
const base = `http://127.0.0.1:${port}`;
const artifacts = resolve(root, ".local/native-e2e");
const dataDirectory = resolve(artifacts, `data-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
let child;
let session;
async function request(
  path,
  data,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await r.json();
  if (!r.ok || body.value?.error) throw new Error(JSON.stringify(body));
  return body.value;
}
async function until(fn, timeout = 60_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out: ${last || fn.toString()}`);
}
const script = (code, args = []) =>
  request(`/session/${session}/execute/sync`, { script: code, args });
const text = () => script("return document.body.innerText");
const waitText = (value, timeout) =>
  until(async () => (await text()).includes(value), timeout);
const click = (label) =>
  script(
    'const b = [...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0] || b.getAttribute("aria-label")===arguments[0]); if(!b) throw new Error("Button missing: "+arguments[0]); if(b.disabled) throw new Error("Button disabled: "+arguments[0]); b.click(); return true;',
    [label],
  );
async function input(selector, value) {
  const e = await request(`/session/${session}/element`, {
    using: "css selector",
    value: selector,
  });
  const id = e["element-6066-11e4-a52e-4f735466cecf"];
  await request(`/session/${session}/element/${id}/clear`, {});
  await request(`/session/${session}/element/${id}/value`, { text: value });
}
async function screenshot(name) {
  const png = await request(`/session/${session}/screenshot`);
  await writeFile(
    resolve(artifacts, `${name}.png`),
    Buffer.from(png, "base64"),
  );
}
async function start() {
  child = spawn(binary, [], {
    cwd: root,
    env: {
      ...process.env,
      TAURI_WEBDRIVER_PORT: String(port),
      DIFFCITY_DATA_DIR: dataDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => {
    logs += d;
  });
  child.stderr.on("data", (d) => {
    logs += d;
  });
  child.on("exit", () => {
    void writeFile(resolve(artifacts, "app.log"), logs);
  });
  await until(() => request("/status"), 60_000);
  session = (await request("/session", { capabilities: { alwaysMatch: {} } }))
    .sessionId;
  await waitText("Codex connected", 90_000);
  await waitText("crs48", 90_000);
}
async function stop() {
  try {
    await request(`/session/${session}`, undefined, "DELETE");
  } catch {
    /* app may already be closed */
  }
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}

try {
  await start();
  console.log("PASS: real native app connects to GitHub and Codex");
  await click("Explore a sample");
  await waitText("Make existing invitations compatible");
  await screenshot("01-guide");
  await click("Next step");
  await waitText("Keep invitations inside their team");
  await click("Next step");
  await click("Next step");
  await waitText("Routine changes, kept together");
  await click("Acknowledge summary");
  assert.match(await text(), /1 summaries acknowledged/);
  await click("Expand all changes");
  await waitText("docs/invitations.md");
  console.log(
    "PASS: guide ordering, routine folding, expansion, truthful progress",
  );
  await click("Open a PR by URL");
  await input(
    '[aria-label="GitHub pull request URL"]',
    "https://github.com/crs48/diffcity/pull/1",
  );
  await click("Open");
  await until(() => script('return document.querySelector(".breadcrumb strong")?.textContent === "#1" && !document.querySelector(".loading-banner")'));
  await click("Review with Codex");
  await waitText("Your guided review is ready.", 600_000);
  await click("Open updated guide");
  await until(async () =>
    (
      await script('return document.querySelector(".section-meta")?.innerText')
    ).includes("High attention"),
  );
  await screenshot("02-live-guide");
  console.log(
    "PASS: real GitHub PR → immutable diff → Codex guided review in WKWebView",
  );
  const path =
    "tests/fixtures/live-review/db/migrations/042_invitation_expiry.sql";
  for (
    let step = 0;
    step < 2 &&
    !(await script(
      'return !!document.querySelector(`[aria-label="${arguments[0]} line 1"]`)',
      [path],
    ));
    step++
  )
    await click("Next step");
  await click(`${path} line 1`);
  await input(
    '[aria-label="Review note or Codex question"]',
    "What happens to existing rows when this migration runs?",
  );
  await click("Ask Codex");
  await until(
    () =>
      script(
        'return document.querySelectorAll(".message.assistant").length > 0',
      ),
    180_000,
  );
  await until(
    () => script('return !document.querySelector(".run-banner")'),
    180_000,
  );
  await screenshot("03-discussion");
  console.log("PASS: selected-line Codex discussion persists");
  const marker =
    "Diffcity end-to-end test: verified line anchoring and GitHub round-trip sync.";
  await input('[aria-label="Review note or Codex question"]', marker);
  await click("Save note");
  await waitText(marker);
  await script(
    'const article=[...document.querySelectorAll(".message")].find(el=>el.textContent.includes(arguments[0])); const b=[...article.querySelectorAll("button")].find(b=>b.textContent.includes("Prepare GitHub draft")); if(!b) throw new Error("Draft action missing"); b.click(); return true;',
    [marker],
  );
  await waitText("GitHub draft");
  await click("Close discussion");
  await click("Mark code reviewed");
  await click("Finish review");
  await waitText("Selected GitHub drafts");
  assert.ok(
    (
      await script(
        'return document.querySelector(".draft-preview")?.textContent',
      )
    ).includes(marker),
  );
  await screenshot("04-publish-preview");
  console.log(
    "PASS: only explicitly prepared draft appears in publication preview",
  );
  if (process.env.DIFFCITY_TEST_PUBLISH === "yes") {
    await input(
      '[aria-label="GitHub review summary"]',
      "Diffcity end-to-end test of guided review and explicit comment publishing. Synthetic fixture only.",
    );
    await click("Publish review");
    await waitText("Review published to GitHub", 90_000);
    console.log("PASS: selected review published through the native app");
    await click("Back to guide");
    await click(`${path} line 1`);
    await waitText("· GitHub");
    await screenshot("05-github-roundtrip");
  } else {
    console.log("SKIP: external publication requires explicit authorization");
    await click("Back to guide");
  }
  await stop();
  await start();
  await until(() => script('return document.querySelector(".breadcrumb strong")?.textContent === "#1"'));
  await script('document.querySelector(".step-track button").click(); return true;');
  for (let step = 0; step < 3 && !(await script('return !!document.querySelector(`[aria-label="${arguments[0]} line 1"]`)', [path])); step++) await click("Next step");
  await click(`${path} line 1`);
  await waitText(marker);
  await waitText("What happens to existing rows");
  console.log(
    "PASS: native app restart restores the PR, anchored notes, and discussion",
  );
  await screenshot("06-restored");
  console.log("PASS: native end-to-end journey complete");
} catch (error) {
  try {
    await writeFile(resolve(artifacts, "failure.txt"), await text());
    await screenshot("failure");
  } catch {
    /* preserve the original failure */
  }
  throw error;
} finally {
  await stop();
}
