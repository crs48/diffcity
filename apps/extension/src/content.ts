import { pullFromUrl, type PullContext } from "./protocol";

let toolbar: HTMLElement | undefined;
let selectionAction: HTMLElement | undefined;
let currentUrl = "";
function button(label: string, action: () => void, compact = false) {
  const host = document.createElement("span");
  host.dataset.diffcity = "true";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `button{font:500 12px system-ui;cursor:pointer;border:1px solid #d1d9e0;border-radius:6px;padding:6px 10px;background:#fff;color:#1f2328;box-shadow:0 1px 2px #0001}button:hover{background:#f6f8fa}button:focus-visible{outline:2px solid #0969da;outline-offset:2px}@media(prefers-color-scheme:dark){button{background:#212830;color:#f0f6fc;border-color:#3d444d}button:hover{background:#2a313c}}`;
  const control = document.createElement("button");
  control.type = "button";
  control.textContent = label;
  control.setAttribute("aria-label", label);
  if (compact) control.style.marginLeft = "8px";
  control.addEventListener("click", (event) => {
    if (event.isTrusted) action();
  });
  shadow.append(style, control);
  return host;
}
function send(type: "ask" | "open-guide", context: PullContext) {
  void chrome.runtime
    .sendMessage({ type, context })
    .then((result) => {
      if (result?.error) announce(result.error);
    })
    .catch(() => announce("Reload this GitHub page after updating Diff City."));
}
function announce(text: string) {
  const status = document.createElement("div");
  status.setAttribute("role", "alert");
  status.textContent = text;
  Object.assign(status.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "14px",
    maxWidth: "360px",
    background: "#fff",
    color: "#1f2328",
    boxShadow: "0 4px 24px #0003",
    borderRadius: "10px",
  });
  document.body.append(status);
  setTimeout(() => status.remove(), 7000);
}
function scan() {
  const pull = pullFromUrl(location.href);
  if (currentUrl !== location.pathname) {
    currentUrl = location.pathname;
    toolbar?.remove();
    toolbar = undefined;
    selectionAction?.remove();
    selectionAction = undefined;
    document
      .querySelectorAll("[data-diffcity]")
      .forEach((node) => node.remove());
  }
  if (!pull) return;
  if (!toolbar?.isConnected) {
    const target = document.querySelector(
      ".gh-header-actions, [data-testid='pull-request-header'] h1, .gh-header-title, #partial-discussion-header h1, h1[data-component='Heading']",
    );
    if (target) {
      toolbar = document.createElement("span");
      toolbar.dataset.diffcity = "true";
      Object.assign(toolbar.style, {
        display: "inline-flex",
        gap: "6px",
        margin: "0 8px",
        verticalAlign: "middle",
      });
      toolbar.append(
        button("Open Diff City guide", () => send("open-guide", pull)),
        button("Ask AI", () => send("ask", pull)),
      );
      if (target.tagName === "H1") {
        toolbar.style.margin = "8px 0";
        toolbar.style.flexWrap = "wrap";
        target.after(toolbar);
      } else target.append(toolbar);
    }
  }
  for (const header of document.querySelectorAll<HTMLElement>(
    ".file-header[data-path]",
  )) {
    if (header.querySelector("[data-diffcity]")) continue;
    const path = header.dataset.path;
    if (path)
      header.append(
        button("Ask AI about file", () => send("ask", { ...pull, path }), true),
      );
  }
  // Permalinks are identifiers only: actual comment bodies come from GitHub's API.
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="#discussion_r"], a[href*="#issuecomment-"], a[href*="#pullrequestreview-"]',
  )) {
    const area = link.closest(
      ".timeline-comment-header, .review-comment, [data-testid='comment-header'], .comment-header",
    );
    if (!area || area.querySelector("[data-diffcity]")) continue;
    const url = new URL(link.href, location.href);
    const linked = pullFromUrl(url.href);
    if (linked?.repository !== pull.repository || linked.number !== pull.number)
      continue;
    area.append(
      button(
        "Ask Diff City",
        () => send("ask", { ...pull, commentUrl: url.href }),
        true,
      ),
    );
  }
}
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan();
  }, 200);
}).observe(document.documentElement, { childList: true, subtree: true });
scan();
document.addEventListener("mouseup", (event) => {
  if (
    !event.isTrusted ||
    (event.target as Element)?.closest?.("[data-diffcity]")
  )
    return;
  selectionAction?.remove();
  selectionAction = undefined;
  const pull = pullFromUrl(location.href);
  const selection = getSelection();
  const text = selection?.toString();
  if (!pull || !selection?.rangeCount || !text?.trim() || text.length > 16000)
    return;
  const range = selection.getRangeAt(0);
  const element = range.startContainer.parentElement;
  const code = element?.closest(
    ".blob-code, [data-code-marker], [data-testid='diff-line-content'], [data-testid='code-cell']",
  );
  if (!code) return;
  const file = code.closest<HTMLElement>(
    "[data-path], [data-tagsearch-path], [data-file-path]",
  );
  const path =
    file?.dataset.path ?? file?.dataset.tagsearchPath ?? file?.dataset.filePath;
  const row = code.closest("tr");
  const side =
    code.closest(".blob-code-deletion") ||
    code.getAttribute("data-code-marker") === "-"
      ? "LEFT"
      : "RIGHT";
  const numbers = row?.querySelectorAll<HTMLElement>("[data-line-number]");
  const number = numbers?.[side === "LEFT" ? 0 : numbers.length - 1];
  const line = number?.dataset.lineNumber
    ? Number(number.dataset.lineNumber)
    : undefined;
  const rect = range.getBoundingClientRect();
  selectionAction = button("Ask AI about selection", () =>
    send("ask", { ...pull, selection: { text, path, line, side } }),
  );
  Object.assign(selectionAction.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: `${Math.max(8, Math.min(rect.right, innerWidth - 210))}px`,
    top: `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 40))}px`,
  });
  document.body.append(selectionAction);
});
document.addEventListener(
  "scroll",
  () => {
    selectionAction?.remove();
    selectionAction = undefined;
  },
  { passive: true, capture: true },
);
