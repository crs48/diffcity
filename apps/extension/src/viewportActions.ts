/** Observe GitHub-owned targets, creating our controls only while visible. */
export function viewportActions() {
  const entries = new Map<
    Element,
    {
      key: string;
      create: () => HTMLElement;
      node?: HTMLElement;
      visible: boolean;
    }
  >();
  const observer = new IntersectionObserver((changes) => {
    for (const change of changes) {
      const entry = entries.get(change.target);
      if (!entry) continue;
      entry.visible = change.isIntersecting;
      if (entry.visible && !entry.node?.isConnected) {
        entry.node = entry.create();
      }
      if (!entry.visible) {
        entry.node?.remove();
        entry.node = undefined;
      }
    }
  });
  return {
    register(target: Element, key: string, create: () => HTMLElement) {
      const existing = entries.get(target);
      if (existing?.key === key) {
        existing.create = create;
        // GitHub can replace a visible header's children without replacing
        // the observed header itself (so no new intersection event fires).
        if (existing.visible && !existing.node?.isConnected)
          existing.node = create();
        return;
      }
      existing?.node?.remove();
      entries.set(target, { key, create, visible: existing?.visible ?? false });
      observer.observe(target);
      if (existing?.visible) entries.get(target)!.node = create();
    },
    prune() {
      for (const [target, entry] of entries)
        if (!target.isConnected) {
          entry.node?.remove();
          observer.unobserve(target);
          entries.delete(target);
        }
    },
    clear() {
      for (const [target, entry] of entries) {
        observer.unobserve(target);
        entry.node?.remove();
      }
      entries.clear();
    },
  };
}
