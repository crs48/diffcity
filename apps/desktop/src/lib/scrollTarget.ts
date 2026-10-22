/** Reconcile an explicit jump while nearby virtual blocks acquire real heights.
 * Any new user gesture takes ownership immediately. Ordinary scrolling never
 * installs a target, so measurement cannot pull the reader back to a heading. */
export function followScrollTarget(
  viewport: HTMLElement,
  target: HTMLElement,
  inset: () => number,
  settled: () => void = () => {},
) {
  return followScrollOffset(
    viewport,
    () => (target.isConnected ? target.getBoundingClientRect().top : null),
    inset,
    settled,
  );
}

/** A resolver can refine a virtual target once its actual row is mounted. */
export function followScrollOffset(
  viewport: HTMLElement,
  targetY: () => number | null,
  inset: () => number,
  settled: () => void = () => {},
) {
  let frame = 0;
  let remaining = 8;
  let stopped = false;
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    events.forEach((event) => viewport.removeEventListener(event, stop));
    settled();
  };
  const align = () => {
    const y = targetY();
    if (y === null || !viewport.clientHeight) {
      stop();
      return;
    }
    const delta = y - viewport.getBoundingClientRect().top - inset();
    if (Math.abs(delta) > 1)
      viewport.scrollTo({
        top: Math.max(0, viewport.scrollTop + delta),
        behavior: "auto",
      });
    if (--remaining > 0) frame = requestAnimationFrame(align);
    else stop();
  };
  events.forEach((event) =>
    viewport.addEventListener(event, stop, { passive: true }),
  );
  align();
  return stop;
}
