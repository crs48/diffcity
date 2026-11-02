// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("handles comment mutations without document-wide rescans or replacing existing controls", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("location", new URL("https://github.com/example/repo/pull/1"));
  const callbacks: IntersectionObserverCallback[] = [];
  const observed: Element[] = [];
  let mutate: MutationCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe(node: Element) {
        observed.push(node);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: MutationCallback) {
        mutate = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: vi.fn().mockResolvedValue({ threads: [] }),
      onMessage: { addListener() {} },
    },
  });
  document.body.innerHTML =
    '<h1 class="gh-header-title">Title</h1>' +
    Array.from(
      { length: 1200 },
      (_, i) =>
        `<article><header class="timeline-comment-header"><a href="https://github.com/example/repo/pull/1#issuecomment-${i}">Time</a></header><p>Body</p></article>`,
    ).join("");
  await import("./content");
  expect(observed).toHaveLength(0); // Only the toolbar exists; discovery yields.
  await vi.runAllTimersAsync();
  const firstHeader = observed[0];
  callbacks[1](
    [
      {
        target: firstHeader,
        isIntersecting: true,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
  const control = firstHeader.querySelector("[data-diffcity]");
  expect(control).toBeTruthy();
  const query = vi.spyOn(document, "querySelectorAll");
  const paragraph = document.querySelector("p")!;
  paragraph.textContent = "Edited body";
  mutate!(
    [
      {
        target: paragraph,
        type: "childList",
        addedNodes: [paragraph.firstChild!],
        removedNodes: [],
      } as unknown as MutationRecord,
    ],
    {} as MutationObserver,
  );
  await vi.runAllTimersAsync();
  expect(query).not.toHaveBeenCalled();
  expect(firstHeader.querySelector("[data-diffcity]")).toBe(control);
  const newHeader = document.createElement("header");
  newHeader.className = "timeline-comment-header";
  newHeader.innerHTML =
    '<a href="https://github.com/example/repo/pull/1#issuecomment-9999">Later comment</a>';
  document.body.append(newHeader);
  mutate!(
    [
      {
        target: document.body,
        type: "childList",
        addedNodes: [newHeader],
        removedNodes: [],
      } as unknown as MutationRecord,
    ],
    {} as MutationObserver,
  );
  await vi.runAllTimersAsync();
  expect(observed).toContain(newHeader);
  expect(query).not.toHaveBeenCalled();
});
