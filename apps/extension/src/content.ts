import { pullFromUrl, type PullContext } from "./protocol";

let toolbar: HTMLElement | undefined;
let selectionAction: HTMLElement | undefined;
let currentUrl = "";
function button(
  label: string,
  action: () => void,
  { guide = false, floating = false } = {},
) {
  const host = document.createElement("span");
  host.dataset.diffcity = "true";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      display: inline-flex; align-self: center; align-items: center;
      flex: 0 0 auto; vertical-align: middle; line-height: 0;
      --dc-red: #d1242f; --dc-green: #1a7f37; --dc-purple: #8250df;
    }
    button {
      display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box; width: 28px; height: 28px; padding: 4px;
      cursor: pointer; border: 0; border-radius: 6px; background: transparent;
      color: var(--fgColor-muted, #59636e);
    }
    button:hover { background: var(--bgColor-neutral-muted, #818b981f); }
    button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 2px; }
    svg { display: block; width: 18px; height: 18px; pointer-events: none; }
    .floating {
      background: var(--bgColor-default, #fff);
      border: 1px solid var(--borderColor-default, #d1d9e0);
      box-shadow: 0 2px 8px #0002;
    }
    .floating:hover, .floating:focus-visible {
      background: var(--bgColor-muted, #f6f8fa);
      border-color: var(--borderColor-emphasis, #818b98);
      box-shadow: 0 2px 10px #0003;
    }
    @media (prefers-color-scheme: dark) {
      :host { --dc-red: #f85149; --dc-green: #3fb950; --dc-purple: #ab7df8; }
    }
    :host-context([data-color-mode="light"]) {
      --dc-red: #d1242f; --dc-green: #1a7f37; --dc-purple: #8250df;
    }
    :host-context([data-color-mode="dark"]) {
      --dc-red: #f85149; --dc-green: #3fb950; --dc-purple: #ab7df8;
    }
  `;
  const control = document.createElement("button");
  control.type = "button";
  control.title = label;
  control.setAttribute("aria-label", label);
  if (floating) control.className = "floating";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  if (guide) {
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute(
      "d",
      "M12 7v14m0-14C9 4 5 4 2 5v14c3-1 7-1 10 2 3-3 7-3 10-2V5c-3-1-7-1-10 2Z",
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  } else {
    // The same three buildings and Primer colors as the desktop/site wordmark.
    for (const [x, y, height, color] of [
      [2, 15, 15, "red"],
      [12, 2, 28, "green"],
      [22, 9, 21, "purple"],
    ] as const) {
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      for (const [name, value] of Object.entries({
        x,
        y,
        height,
        width: 7,
        rx: 1,
        fill: `var(--dc-${color})`,
      }))
        rect.setAttribute(name, String(value));
      svg.append(rect);
    }
  }
  control.append(svg);
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
        gap: "4px",
        margin: "0 8px",
        verticalAlign: "middle",
        flexShrink: "0",
      });
      toolbar.append(
        button("Open Diff City guide", () => send("open-guide", pull), {
          guide: true,
        }),
        button("Ask Diff City", () => send("ask", pull)),
      );
      if (target.tagName === "H1") {
        // GitHub's React header keeps the visible PR number outside the H1.
        // Keep that number beside its title, with our controls after both.
        const suffix = target.nextElementSibling;
        const after =
          suffix?.textContent?.trim() === `#${pull.number}` ? suffix : target;
        after.after(toolbar);
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
        button("Ask Diff City about this file", () =>
          send("ask", { ...pull, path }),
        ),
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
    const actions =
      area.querySelector(
        ".timeline-comment-actions, [data-testid='comment-actions']",
      ) ?? area;
    actions.append(
      button("Ask Diff City", () =>
        send("ask", { ...pull, commentUrl: url.href }),
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
  // A multi-line range's union includes the full width of intervening table
  // cells. Anchor to the focus caret (the drag endpoint), not that union.
  const endpoint = range.cloneRange();
  if (selection.focusNode)
    endpoint.setStart(selection.focusNode, selection.focusOffset);
  endpoint.collapse(true);
  const caret = Array.from(endpoint.getClientRects()).find((r) => r.height > 0);
  // Element-boundary carets may have no rect; the pointer still identifies
  // the endpoint without falling back to the whole file's bounding box.
  const x = caret?.right ?? event.clientX;
  const bottom = caret?.bottom ?? event.clientY;
  const top = caret?.top ?? event.clientY;
  selectionAction = button(
    "Ask Diff City about this selection",
    () => send("ask", { ...pull, selection: { text, path, line, side } }),
    { floating: true },
  );
  Object.assign(selectionAction.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: `${Math.max(8, Math.min(x + 6, innerWidth - 36))}px`,
    top: `${Math.max(8, Math.min(bottom + 34 <= innerHeight ? bottom + 6 : top - 34, innerHeight - 36))}px`,
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
