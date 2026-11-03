import { findPlacement, type DiffPlacement } from "./diffPlacement";

export const fileSelector =
  "[data-path], [data-tagsearch-path], [data-file-path]";
export const commentLinkSelector =
  'a[href*="#discussion_r"], a[href*="#issuecomment-"], a[href*="#pullrequestreview-"]';
const pathOf = (node: Element) =>
  node.getAttribute("data-path") ??
  node.getAttribute("data-tagsearch-path") ??
  node.getAttribute("data-file-path");

/** Index discovered containers, not every code token. Lookups never traverse the document. */
export function placementIndex() {
  const files = new Map<string, Set<Element>>();
  const comments = new Map<string, Set<HTMLAnchorElement>>();
  let previous = new WeakMap<
    Element,
    { map: Map<string, Set<Element>>; key: string }
  >();
  const put = (node: Element, key: string, map: Map<string, Set<Element>>) => {
    const old = previous.get(node);
    if (old?.key === key && old.map === map) return;
    if (old) {
      const group = old.map.get(old.key);
      group?.delete(node);
      if (!group?.size) old.map.delete(old.key);
    }
    const group = map.get(key) ?? new Set<Element>();
    group.add(node);
    map.set(key, group);
    previous.set(node, { map, key });
  };
  return {
    visit(node: Element) {
      const path = pathOf(node);
      if (path) put(node, path, files);
      if (
        node instanceof HTMLAnchorElement &&
        node.matches(commentLinkSelector)
      )
        put(node, node.href, comments as Map<string, Set<Element>>);
    },
    find(placement: DiffPlacement): Element | null {
      const matches = new Set<Element>();
      if (placement.kind === "comment") {
        for (const link of comments.get(placement.url) ?? []) {
          if (!link.isConnected || link.href !== placement.url) continue;
          const thread = link.closest(
            '.review-comment, [data-testid="review-thread"], .timeline-comment',
          );
          if (thread) matches.add(thread.closest("tr") ?? thread);
        }
      } else {
        for (const file of files.get(placement.path) ?? []) {
          if (!file.isConnected || pathOf(file) !== placement.path) continue;
          const target = findPlacement(placement, file);
          if (target) matches.add(target);
        }
      }
      return matches.size === 1 ? [...matches][0] : null;
    },
    *prune() {
      for (const map of [files, comments])
        for (const [key, group] of map) {
          for (const node of group) {
            if (!node.isConnected) {
              group.delete(node as HTMLAnchorElement);
              previous.delete(node);
            }
            yield;
          }
          if (!group.size) map.delete(key);
        }
    },
    clear() {
      files.clear();
      comments.clear();
      previous = new WeakMap();
    },
  };
}
