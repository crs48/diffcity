import {
  capturePlacement,
  findPlacement,
  type DiffPlacement,
} from "./diffPlacement";
import type { PullContext } from "./protocol";

type Entry = {
  id: string;
  url: string;
  placement: DiffPlacement;
  height: number;
  host?: HTMLElement;
  container?: HTMLElement;
  frame?: HTMLIFrameElement;
  visible: boolean;
  ready: boolean;
  suspend?: string;
};

/** Only spacers live offscreen. Drafts and agent jobs belong to the worker. */
export function inlineViewport(origin: string) {
  const entries = new Map<string, Entry>();
  const byHost = new WeakMap<Element, Entry>();
  const unmount = (entry: Entry) => {
    entry.frame?.remove();
    entry.frame = undefined;
    entry.ready = false;
    entry.suspend = undefined;
    if (entry.host) entry.host.dataset.diffcityMounted = "false";
  };
  const update = (entry: Entry) => {
    if (entry.visible && !document.hidden && entry.host?.isConnected) {
      entry.suspend = undefined;
      if (entry.frame) return;
      const frame = document.createElement("iframe");
      frame.src = entry.url;
      frame.title = "Diff City inline conversation";
      frame.allow = "clipboard-write";
      Object.assign(frame.style, {
        display: "block",
        border: "0",
        width: "100%",
        maxWidth: "1000px",
        height: `${entry.height}px`,
        colorScheme: "normal",
      });
      entry.frame = frame;
      entry.container!.append(frame);
      entry.host.dataset.diffcityMounted = "true";
    } else if (entry.frame && !entry.suspend) {
      // Do not discard the last keystroke while saving the draft. The frame
      // acknowledges privately persisted state before the parent removes it.
      entry.suspend = crypto.randomUUID();
      entry.frame.contentWindow?.postMessage(
        { type: "diffcity-inline-suspend", id: entry.id, token: entry.suspend },
        origin,
      );
    }
  };
  const observer = new IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        const entry = byHost.get(change.target);
        if (entry) {
          entry.visible = change.isIntersecting;
          update(entry);
        }
      }
    },
    { rootMargin: "0px" },
  );
  const detach = (entry: Entry) => {
    if (entry.host) observer.unobserve(entry.host);
    unmount(entry);
    entry.host?.remove();
    entry.host = undefined;
    entry.container = undefined;
    entry.visible = false;
  };
  const attach = (entry: Entry, target: Element) => {
    const table = target instanceof HTMLTableRowElement;
    const host = document.createElement(table ? "tr" : "div");
    host.dataset.diffcity = "inline";
    host.dataset.diffcityMounted = "false";
    const container = document.createElement(table ? "td" : "div");
    if (table)
      (container as HTMLTableCellElement).colSpan =
        Array.from(target.cells).reduce((sum, cell) => sum + cell.colSpan, 0) ||
        4;
    Object.assign(container.style, {
      padding: "0",
      whiteSpace: "normal",
      height: `${entry.height}px`,
    });
    host.append(container);
    target.after(host);
    entry.host = host;
    entry.container = container;
    byHost.set(host, entry);
    observer.observe(host);
  };
  const reconcile = () => {
    for (const entry of entries.values()) {
      const target = findPlacement(entry.placement);
      let previous = entry.host?.previousElementSibling;
      while (previous?.getAttribute("data-diffcity") === "inline")
        previous = previous.previousElementSibling;
      if (!target || !entry.host?.isConnected || previous !== target) {
        detach(entry);
        if (target) attach(entry, target);
      }
    }
  };
  const message = (event: MessageEvent) => {
    if (event.origin !== origin) return;
    for (const [key, entry] of entries) {
      if (
        !entry.frame ||
        event.source !== entry.frame.contentWindow ||
        event.data?.id !== entry.id
      )
        continue;
      if (event.data.type === "diffcity-inline-ready") {
        entry.ready = true;
        entry.suspend = undefined;
        update(entry);
      }
      if (
        (event.data.type === "diffcity-inline-size" ||
          event.data.type === "diffcity-inline-ready") &&
        entry.ready &&
        Number.isFinite(event.data.height)
      ) {
        entry.height = Math.max(80, Math.min(1000000, event.data.height));
        entry.frame.style.height = `${entry.height}px`;
        entry.container!.style.height = `${entry.height}px`;
      }
      if (
        event.data.type === "diffcity-inline-suspended" &&
        entry.suspend === event.data.token &&
        (!entry.visible || document.hidden)
      )
        unmount(entry);
      if (event.data.type === "diffcity-inline-close") {
        detach(entry);
        entries.delete(key);
      }
    }
  };
  const visibility = () => entries.forEach(update);
  window.addEventListener("message", message);
  document.addEventListener("visibilitychange", visibility);
  return {
    has: (key: string) => entries.has(key),
    reveal(key: string) {
      reconcile();
      const entry = entries.get(key);
      entry?.host?.scrollIntoView({ block: "nearest" });
      entry?.frame?.focus();
    },
    open(
      key: string,
      context: PullContext,
      target: Element,
      grant: { id: string; url: string },
    ) {
      const placement = capturePlacement(context, target);
      if (!placement)
        throw new Error(
          "This code location is no longer available. Select it again.",
        );
      entries.set(key, {
        ...grant,
        placement,
        height: 230,
        visible: false,
        ready: false,
      });
      reconcile();
      entries.get(key)?.host?.scrollIntoView({ block: "nearest" });
    },
    reconcile,
    clear() {
      entries.forEach(detach);
      entries.clear();
    },
    dispose() {
      entries.forEach(detach);
      entries.clear();
      observer.disconnect();
      window.removeEventListener("message", message);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
