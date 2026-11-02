// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { pageWork, pageElements } from "./pageWork";
import { placementIndex } from "./placementIndex";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("yields large traversals to page input and coalesces repeat invalidations", async () => {
  vi.useFakeTimers();
  const work = pageWork();
  let steps = 0;
  const task = function* () {
    for (let i = 0; i < 5000; i++) {
      steps++;
      yield;
    }
  };
  work.add("scan", task());
  work.add("scan", task());
  expect(steps).toBe(0);
  await vi.advanceTimersByTimeAsync(16);
  expect(steps).toBeGreaterThan(0);
  expect(steps).toBeLessThanOrEqual(400);
  let inputHandled = false;
  setTimeout(() => {
    inputHandled = true;
  }, 0);
  await vi.advanceTimersByTimeAsync(1);
  expect(inputHandled).toBe(true);
  expect(steps).toBeLessThan(5000);
  await vi.runAllTimersAsync();
  expect(steps).toBe(5000);
  work.add("scan", task());
  work.clear();
  await vi.runAllTimersAsync();
  expect(steps).toBe(5000);
});

it("skips extension trees and resolves re-used rows using only indexed file containers", () => {
  document.body.innerHTML = `<div data-path="a.ts"><table><tbody><tr><td data-line-number="1"></td><td class="blob-code">code</td></tr></tbody></table></div><div data-diffcity="inline"><span data-path="fake.ts"></span></div>`;
  const index = placementIndex();
  const discovered = [...pageElements(document.body)];
  expect(discovered.some((n) => n.hasAttribute("data-diffcity"))).toBe(false);
  discovered.forEach(index.visit);
  const query = vi.spyOn(document, "querySelectorAll");
  const placement = {
    kind: "code",
    path: "a.ts",
    line: 1,
    side: "RIGHT",
    text: "code",
  } as const;
  expect(index.find(placement)?.tagName).toBe("TR");
  expect(query).not.toHaveBeenCalled();
  const file = document.body.firstElementChild!;
  file.setAttribute("data-path", "b.ts");
  index.visit(file);
  expect(index.find(placement)).toBeNull();
  expect(index.find({ ...placement, path: "b.ts" })?.tagName).toBe("TR");
  index.clear();
  [...pageElements(file)].forEach(index.visit);
  expect(index.find({ ...placement, path: "b.ts" })?.tagName).toBe("TR");
  document.body.append(file.cloneNode(true));
  [...pageElements(document.body.lastElementChild!)].forEach(index.visit);
  expect(index.find({ ...placement, path: "b.ts" })).toBeNull();
  document.body.lastElementChild!.remove();
  expect(index.find({ ...placement, path: "b.ts" })?.tagName).toBe("TR");
  file.remove();
  [...index.prune()];
  expect(index.find({ ...placement, path: "b.ts" })).toBeNull();
  document.body.append(file);
  [...pageElements(file)].forEach(index.visit);
  expect(index.find({ ...placement, path: "b.ts" })?.tagName).toBe("TR");
  query.mockRestore();
});
