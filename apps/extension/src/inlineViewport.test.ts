// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inlineViewport } from "./inlineViewport";
import { capturePlacement, findPlacement } from "./diffPlacement";

let observer: { emit: (target: Element, visible: boolean) => void };
beforeEach(() => {
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observer = {
          emit: (target, isIntersecting) =>
            callback(
              [{ target, isIntersecting } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  document.body.innerHTML = `<div data-path="a.ts"><table><tbody><tr><td data-line-number="1"></td><td data-line-number="1"></td><td class="blob-code"><span class="blob-code-inner">same code</span></td></tr></tbody></table></div>`;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const context = {
  repository: "example/repo",
  number: 1,
  line: { path: "a.ts", line: 1, side: "RIGHT" as const, text: "same code" },
};
const origin = "chrome-extension://test";
function setup() {
  const viewport = inlineViewport(origin);
  viewport.open("thread", context, document.querySelector(".blob-code")!, {
    id: "grant",
    url: `${origin}/inline.html?id=grant`,
  });
  const host = document.querySelector<HTMLElement>("[data-diffcity='inline']")!;
  const enter = () => observer.emit(host, true);
  const send = (
    type: string,
    extra = {},
    source = host.querySelector("iframe")!.contentWindow,
  ) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source,
        data: { type, id: "grant", ...extra },
      }),
    );
  return { viewport, host, enter, send };
}
it("mounts only in view, preserves measured space, then destroys the offscreen frame after saving", () => {
  const { viewport, host, enter, send } = setup();
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  enter();
  const frame = host.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  send("diffcity-inline-ready", { height: 740 });
  observer.emit(host, false);
  const request = post.mock.calls.at(-1)![0];
  expect(request.type).toBe("diffcity-inline-suspend");
  expect(host.querySelector("iframe")).toBe(frame); // Await trailing keystroke acknowledgement.
  send("diffcity-inline-suspended", { token: request.token });
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  expect(host.firstElementChild?.getAttribute("style")).toContain(
    "height: 740px",
  );
  enter();
  expect(host.querySelector("iframe")).not.toBe(frame);
  expect(host.querySelector("iframe")?.style.height).toBe("740px");
  send("diffcity-inline-size", { height: 40 }); // Loading UI must not collapse the spacer.
  expect(host.querySelector("iframe")?.style.height).toBe("740px");
  viewport.dispose();
});
it("ignores stale suspend acknowledgements if the user scrolls back quickly", () => {
  const { viewport, host, enter, send } = setup();
  enter();
  const frame = host.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  observer.emit(host, false);
  const token = post.mock.calls.at(-1)![0].token;
  enter();
  send("diffcity-inline-suspended", { token });
  expect(host.querySelector("iframe")).toBe(frame);
  viewport.dispose();
});
it("reanchors after GitHub removes or recycles a row, never next to a different file/line", () => {
  const { viewport, host, enter } = setup();
  enter();
  const old = document.querySelector("tr")!;
  old
    .querySelectorAll<HTMLElement>("[data-line-number]")
    .forEach((cell) => (cell.dataset.lineNumber = "2"));
  viewport.reconcile();
  expect(host.isConnected).toBe(false);
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  const correct = old.cloneNode(true) as HTMLElement;
  correct
    .querySelectorAll<HTMLElement>("[data-line-number]")
    .forEach((cell) => (cell.dataset.lineNumber = "1"));
  old.after(correct);
  viewport.reconcile();
  expect(correct.nextElementSibling?.getAttribute("data-diffcity")).toBe(
    "inline",
  );
  const file = document.querySelector<HTMLElement>("[data-path]")!;
  file.dataset.path = "other.ts";
  viewport.reconcile();
  expect(document.querySelector("[data-diffcity='inline']")).toBeNull();
  file.dataset.path = "a.ts";
  correct.querySelector(".blob-code-inner")!.textContent = "different revision";
  viewport.reconcile();
  expect(document.querySelector("[data-diffcity='inline']")).toBeNull();
  correct.querySelector(".blob-code-inner")!.textContent = "same code";
  viewport.reconcile();
  expect(correct.nextElementSibling?.getAttribute("data-diffcity")).toBe(
    "inline",
  );
  viewport.dispose();
});
it("does not render offscreen frame trees even with many open threads", () => {
  const { viewport, host } = setup();
  for (let i = 2; i <= 60; i++) {
    const row = document.querySelector("tr")!.cloneNode(true) as HTMLElement;
    row
      .querySelectorAll<HTMLElement>("[data-line-number]")
      .forEach((cell) => (cell.dataset.lineNumber = String(i)));
    document.querySelector("tbody")!.append(row);
    viewport.open(
      `thread-${i}`,
      { ...context, line: { ...context.line, line: i } },
      row.querySelector(".blob-code")!,
      { id: `grant-${i}`, url: `${origin}/inline.html?id=${i}` },
    );
  }
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  observer.emit(host, true);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(document.querySelectorAll("[data-diffcity='inline']")).toHaveLength(
    60,
  );
  viewport.dispose();
});
it("refuses ambiguous duplicate code anchors and distinguishes split diff sides", () => {
  const code = document.querySelector(".blob-code")!;
  const anchor = capturePlacement(context, code)!;
  document.body.append(document.body.firstElementChild!.cloneNode(true));
  expect(findPlacement(anchor)).toBeNull();
  document.body.lastElementChild!.remove();
  const row = document.querySelector("tr")!;
  row.innerHTML = `<td data-line-number="1"></td><td class="blob-code">old</td><td data-line-number="1"></td><td class="blob-code">new</td>`;
  const right = capturePlacement(context, row.cells[3])!;
  expect(right).toMatchObject({ side: "RIGHT", text: "new" });
  expect(findPlacement(right)).toBe(row);
});

it("restores after a page reload without scrolling or eagerly mounting offscreen conversations", () => {
  const { viewport, host } = setup();
  const placement = capturePlacement(
    context,
    document.querySelector(".blob-code")!,
  )!;
  viewport.dispose();
  expect(host.isConnected).toBe(false);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  const reopened = inlineViewport(origin);
  const entry = {
    key: "thread",
    id: "restored",
    url: `${origin}/inline.html?id=restored`,
    placement,
  };
  reopened.restore([entry]);
  reopened.restore([entry]);
  const restored = document.querySelector<HTMLElement>(
    "[data-diffcity='inline']",
  )!;
  expect(document.querySelectorAll("[data-diffcity='inline']")).toHaveLength(1);
  expect(restored.querySelector("iframe")).toBeNull();
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  observer.emit(restored, true);
  expect(restored.querySelector("iframe")?.src).toBe(entry.url);
  reopened.dispose();
});

it("waits for GitHub to load the correct row before restoring a conversation", () => {
  const placement = capturePlacement(
    context,
    document.querySelector(".blob-code")!,
  )!;
  const row = document.querySelector("tr")!;
  row.remove();
  const viewport = inlineViewport(origin);
  viewport.restore([
    {
      key: "thread",
      id: "restored",
      url: `${origin}/inline.html?id=restored`,
      placement,
    },
  ]);
  expect(document.querySelector("[data-diffcity='inline']")).toBeNull();
  document.querySelector("tbody")!.append(row);
  viewport.reconcile();
  expect(row.nextElementSibling?.getAttribute("data-diffcity")).toBe("inline");
  viewport.dispose();
});
