type Listener = (top: number, height: number) => void;
const observers = new WeakMap<
  HTMLElement,
  { listeners: Set<Listener>; stop: () => void }
>();

/** Share one passive, frame-batched scroll listener across all code windows. */
export function observeReviewScroll(viewport: HTMLElement, listener: Listener) {
  let observer = observers.get(viewport);
  if (!observer) {
    const listeners = new Set<Listener>();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = viewport.scrollTop,
          height = viewport.clientHeight;
        listeners.forEach((notify) => notify(top, height));
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    observer = {
      listeners,
      stop: () => {
        cancelAnimationFrame(frame);
        viewport.removeEventListener("scroll", onScroll);
        observers.delete(viewport);
      },
    };
    observers.set(viewport, observer);
  }
  observer.listeners.add(listener);
  return () => {
    observer.listeners.delete(listener);
    if (!observer.listeners.size) observer.stop();
  };
}
