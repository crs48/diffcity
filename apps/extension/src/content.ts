import { pullFromUrl, type PullContext } from "./protocol";
import { inlineViewport } from "./inlineViewport";
import { viewportActions } from "./viewportActions";
import type { RestoredInline } from "./inlineRestore";
import { pageWork, pageElements } from "./pageWork";
import { placementIndex, commentLinkSelector } from "./placementIndex";

let toolbar: HTMLElement | undefined;
let selectionAction: HTMLElement | undefined;
let lineAction: HTMLElement | undefined;
let selectedCode: { context: PullContext; target: Element } | undefined;
let commentFallback: HTMLElement | undefined;
let currentUrl = "";
let restoredUrl = "";
let restoringUrl = "";
let restoreAfter = 0;
const extensionOrigin = chrome.runtime.getURL("/").replace(/\/$/, "");
const openingInline = new Set<string>();
const work = pageWork();
const placements = placementIndex();
const inlineThreads = inlineViewport(extensionOrigin, {
  find: placements.find,
  work,
});
const roots = new Set<Element>();
const actionsInView = viewportActions();
const codeSelector =
  ".blob-code, [data-code-marker], [data-testid='diff-line-content'], [data-testid='code-cell']";

async function openInline(context: PullContext, target: Element) {
  const key = JSON.stringify(context);
  if (inlineThreads.has(key)) {
    inlineThreads.reveal(key);
    return;
  }
  if (openingInline.has(key)) return;
  openingInline.add(key);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "create-inline",
      context,
    });
    if (result?.error) throw new Error(result.error);
    if (
      !target.isConnected ||
      context.repository !== pullFromUrl(location.href)?.repository ||
      context.number !== pullFromUrl(location.href)?.number
    )
      return;
    if (result.fallback === "comment-panel") {
      commentFallback?.remove();
      commentFallback = showCommentFallback(target, () => send("ask", context));
      return;
    }
    const threadKey = result.key ?? key;
    if (inlineThreads.has(threadKey)) inlineThreads.reveal(threadKey);
    else inlineThreads.open(threadKey, context, target, result);
    selectionAction?.remove();
    selectionAction = undefined;
    lineAction?.remove();
    lineAction = undefined;
  } catch (error) {
    announce(String(error));
  } finally {
    openingInline.delete(key);
  }
}
function showCommentFallback(target: Element, open: () => void) {
  const row = target.closest("tr");
  const host = document.createElement(row ? "tr" : "div");
  host.dataset.diffcity = "true";
  let content: HTMLElement = host;
  if (row) {
    const cell = document.createElement("td");
    cell.colSpan = row.cells.length || 1;
    host.append(cell);
    content = document.createElement("div");
    cell.append(content);
  }
  const shadow = content.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display: block; }
    aside { padding: 12px 16px; margin: 8px; border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 8px; background: var(--bgColor-default, #fff); color: var(--fgColor-default, #1f2328); font: 14px/1.5 system-ui; }
    p { margin: 0 0 8px; }
    button { font: inherit; cursor: pointer; padding: 4px 10px; border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px; color: inherit; background: var(--bgColor-muted, #f6f8fa); margin-right: 8px; }
    button:hover { background: var(--bgColor-neutral-muted, #818b981f); }
    button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 2px; }
  `;
  const notice = document.createElement("aside");
  notice.setAttribute("aria-label", "Diff City comment context");
  const text = document.createElement("p");
  text.textContent =
    "This comment’s code is not available in the current diff. Continue in PR chat with the comment and its replies attached.";
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "Continue in PR chat";
  action.addEventListener("click", (event) => {
    if (event.isTrusted) open();
  });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => host.remove());
  notice.append(text, action, dismiss);
  shadow.append(style, notice);
  (row ?? target).after(host);
  action.focus({ preventScroll: true });
  return host;
}
function button(
  label: string,
  action: () => void,
  { guide = false, floating = false, compact = false } = {},
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
  if (compact)
    Object.assign(control.style, {
      width: "20px",
      height: "20px",
      padding: "2px",
    });
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
function refreshPage() {
  const pull = pullFromUrl(location.href);
  const pullKey = pull ? `${pull.repository}#${pull.number}` : "";
  if (currentUrl !== pullKey) {
    currentUrl = pullKey;
    restoredUrl = "";
    restoreAfter = 0;
    work.clear();
    roots.clear();
    placements.clear();
    inlineThreads.clear();
    commentFallback?.remove();
    commentFallback = undefined;
    actionsInView.clear();
    lineAction?.remove();
    selectedCode = undefined;
    toolbar?.remove();
    toolbar = undefined;
    selectionAction?.remove();
    selectionAction = undefined;
    document
      .querySelectorAll("[data-diffcity]")
      .forEach((node) => node.remove());
    if (pull) queueRoot(document.documentElement);
  }
  if (!pull) return;
  if (
    restoredUrl !== pullKey &&
    restoringUrl !== pullKey &&
    Date.now() >= restoreAfter
  ) {
    restoringUrl = pullKey;
    void chrome.runtime
      .sendMessage({ type: "restore-inline", context: pull })
      .then((result) => {
        if (currentUrl !== pullKey) return;
        if (result?.error) throw new Error(result.error);
        inlineThreads.restore((result?.threads ?? []) as RestoredInline[]);
        restoredUrl = pullKey;
      })
      .catch(() => {
        restoreAfter = Date.now() + 30000;
      })
      .finally(() => {
        if (restoringUrl === pullKey) restoringUrl = "";
      });
  }

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
  return pull;
}
function visit(element: Element, pull: PullContext) {
  placements.visit(element);
  if (element.matches(".file-header[data-path]")) {
    const header = element as HTMLElement;
    const path = header.dataset.path;
    if (path)
      actionsInView.register(header, `file:${path}`, () => {
        const action = button("Ask Diff City about this file", () =>
          send("ask", { ...pull, path }),
        );
        header.append(action);
        return action;
      });
  }
  // Permalinks are identifiers only: actual bodies come from GitHub's API.
  if (
    !(element instanceof HTMLAnchorElement) ||
    !element.matches(commentLinkSelector)
  )
    return;
  const area = element.closest(
    ".timeline-comment-header, .review-comment, [data-testid='comment-header'], .comment-header",
  );
  if (!area) return;
  const url = new URL(element.href, location.href);
  const linked = pullFromUrl(url.href);
  if (linked?.repository !== pull.repository || linked.number !== pull.number)
    return;
  const actions =
    area.querySelector(
      ".timeline-comment-actions, [data-testid='comment-actions']",
    ) ?? area;
  actionsInView.register(area, url.href, () => {
    const action = button("Ask Diff City", () => {
      const context = { ...pull, commentUrl: url.href };
      if (url.hash.startsWith("#discussion_r")) {
        const thread =
          area.closest(
            ".review-comment, [data-testid='review-thread'], .timeline-comment",
          ) ?? area;
        void openInline(context, thread);
      } else send("ask", context);
    });
    actions.append(action);
    return action;
  });
}
function* discover() {
  while (roots.size) {
    const root = roots.values().next().value!;
    roots.delete(root);
    if (!root.isConnected) continue;
    const pull = pullFromUrl(location.href);
    if (!pull) continue;
    for (const element of pageElements(root)) {
      if (element.isConnected) visit(element, pull);
      yield;
    }
  }
  yield* placements.prune();
  yield* actionsInView.pruneSteps();
  inlineThreads.reconcile();
}
function queueRoot(root: Element) {
  if (root.closest("[data-diffcity]")) return;
  for (const queued of roots) {
    if (queued.contains(root)) return;
    if (root.contains(queued)) roots.delete(queued);
  }
  roots.add(root);
  work.add("discover", discover());
}

const mutations: MutationRecord[][] = [];
function* applyMutations() {
  while (mutations.length) {
    const records = mutations.shift()!;
    const pull = refreshPage();
    if (!pull) continue;
    let changed = false;
    for (const record of records) {
      yield;
      const element =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (!element || element.closest("[data-diffcity]")) continue;
      if (record.type === "childList") {
        const external = [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(node instanceof Element && node.hasAttribute("data-diffcity")),
        );
        if (!external) continue;
        // Visit only the changed subtrees, never rescan the whole PR for a clock,
        // streamed comment, or sidebar layout mutation.
        if (record.addedNodes.length > 8) queueRoot(element);
        else
          for (const node of record.addedNodes)
            if (node instanceof Element) queueRoot(node);
        const header = element.closest(
          ".timeline-comment-header, .review-comment, [data-testid='comment-header'], .comment-header, .file-header",
        );
        if (header) queueRoot(header);
      } else queueRoot(element);
      changed = true;
    }
    if (changed) work.add("discover", discover());
  }
}
new MutationObserver((records) => {
  mutations.push(records);
  work.add("mutations", applyMutations());
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: [
    "data-line-number",
    "data-path",
    "data-tagsearch-path",
    "data-file-path",
    "data-code-marker",
    "id",
    "href",
  ],
});
if (refreshPage()) queueRoot(document.documentElement);
document.addEventListener("mouseup", (event) => {
  if (
    !event.isTrusted ||
    (event.target as Element)?.closest?.("[data-diffcity]")
  )
    return;
  selectionAction?.remove();
  selectionAction = undefined;
  lineAction?.remove();
  lineAction = undefined;
  selectedCode = undefined;
  const pull = pullFromUrl(location.href);
  const selection = getSelection();
  const text = selection?.toString();
  if (!pull || !selection?.rangeCount || !text?.trim() || text.length > 16000)
    return;
  const range = selection.getRangeAt(0);
  const element = range.startContainer.parentElement;
  const code = element?.closest(codeSelector);
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
  const end =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : range.endContainer.parentElement;
  const captured = {
    context: { ...pull, selection: { text, path, line, side } } as PullContext,
    target: end?.closest(codeSelector) ?? code,
  };
  selectedCode = captured;
  selectionAction = button(
    "Ask Diff City about this selection",
    () => void openInline(captured.context, captured.target),
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
    lineAction?.remove();
    lineAction = undefined;
  },
  { passive: true, capture: true },
);

// A single gutter control follows the hovered line; no buttons are added to
// thousands of rows and keyboard users can select code or use the context menu.
document.addEventListener("pointerover", (event) => {
  if (
    !event.isTrusted ||
    (event.target as Element)?.closest?.("[data-diffcity]")
  )
    return;
  lineAction?.remove();
  lineAction = undefined;
  if (selectionAction?.isConnected) return;
  const pull = pullFromUrl(location.href);
  const element = event.target as Element;
  const code =
    element?.closest?.(
      ".blob-code, [data-testid='diff-line-content'], [data-testid='code-cell']",
    ) ?? element?.closest?.("[data-code-marker]");
  const row = code?.closest("tr");
  if (!pull || !code || !row) return;
  const file = code.closest<HTMLElement>(
    "[data-path], [data-tagsearch-path], [data-file-path]",
  );
  const path =
    file?.dataset.path ?? file?.dataset.tagsearchPath ?? file?.dataset.filePath;
  const side =
    code.matches(".blob-code-deletion") ||
    code.getAttribute("data-code-marker") === "-"
      ? "LEFT"
      : "RIGHT";
  const numbers = row.querySelectorAll<HTMLElement>("[data-line-number]");
  const number = numbers[side === "LEFT" ? 0 : numbers.length - 1];
  const line = Number(number?.dataset.lineNumber);
  if (!path || !line) return;
  const text =
    (code.querySelector(".blob-code-inner") ?? code).textContent ?? undefined;
  lineAction = button(
    "Ask Diff City about this line",
    () => void openInline({ ...pull, line: { path, line, side, text } }, code),
    { floating: true, compact: true },
  );
  const rect = code.getBoundingClientRect();
  Object.assign(lineAction.style, {
    position: "fixed",
    zIndex: "100",
    left: `${Math.max(0, rect.left - 22)}px`,
    top: `${rect.top}px`,
  });
  document.body.append(lineAction);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== "open-inline-selection"
  )
    return;
  if (
    !selectedCode ||
    selectedCode.context.selection?.text !== message.text ||
    !selectedCode.target.isConnected
  ) {
    respond({ inline: false });
    return;
  }
  void openInline(selectedCode.context, selectedCode.target);
  respond({ inline: true });
});
