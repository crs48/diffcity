import { createContext } from "react";
import type { DiffLine } from "../lib/api";

export type MapSource = { element: HTMLElement; lines: readonly DiffLine[] };

/** Mutable layout registry: scrolling never rerenders the review document. */
export function createFileNavigation() {
  const sources = new Set<MapSource>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    sources,
    register(source: MapSource) {
      sources.add(source);
      notify();
      return () => {
        sources.delete(source);
        notify();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const FileNavigationContext = createContext<ReturnType<
  typeof createFileNavigation
> | null>(null);
