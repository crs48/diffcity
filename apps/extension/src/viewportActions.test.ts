// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { viewportActions } from "./viewportActions";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("creates controls only in view and restores them when GitHub replaces header children", () => {
  let intersect: (target: Element, visible: boolean) => void;
  const unobserve = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = (target, isIntersecting) =>
          callback(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      unobserve = unobserve;
    },
  );
  const actions = viewportActions();
  const header = document.createElement("header");
  document.body.append(header);
  const create = vi.fn(() => {
    const button = document.createElement("button");
    header.append(button);
    return button;
  });
  actions.register(header, "file:a.ts", create);
  expect(create).not.toHaveBeenCalled();
  intersect!(header, true);
  expect(header.querySelectorAll("button")).toHaveLength(1);
  header.replaceChildren();
  actions.register(header, "file:a.ts", create);
  expect(header.querySelectorAll("button")).toHaveLength(1);
  intersect!(header, false);
  expect(header.querySelectorAll("button")).toHaveLength(0);
  intersect!(header, true);
  header.remove();
  actions.prune();
  expect(unobserve).toHaveBeenCalledWith(header);
  expect(header.querySelectorAll("button")).toHaveLength(0);
  actions.clear();
});
