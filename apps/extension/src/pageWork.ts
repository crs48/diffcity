/** Content scripts share GitHub's main thread: never drain a large job in one turn. */
export function pageWork() {
  const jobs = new Map<string, Iterator<unknown>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer ??= setTimeout(flush, 16);
  };
  const flush = () => {
    timer = undefined;
    const deadline = performance.now() + 4;
    let steps = 0;
    for (const [key, job] of jobs) {
      while (steps++ < 400 && performance.now() < deadline) {
        if (job.next().done) {
          jobs.delete(key);
          break;
        }
      }
      if (steps >= 400 || performance.now() >= deadline) break;
    }
    if (jobs.size) schedule();
  };
  return {
    add(key: string, job: Iterator<unknown>) {
      // Coalesce invalidations without restarting an unfinished traversal.
      if (!jobs.has(key)) jobs.set(key, job);
      schedule();
    },
    clear() {
      jobs.clear();
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Skip our own trees, including table spacers; never scan code-token subtrees synchronously. */
export function* pageElements(root: Element): Generator<Element> {
  if (root.closest("[data-diffcity]")) return;
  yield root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      (node as Element).hasAttribute("data-diffcity")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) yield node as Element;
}
