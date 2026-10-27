import { useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FileNavigationContext, type MapSource } from "./fileNavigation";
import {
  clamp,
  fileLineAtY,
  mapYAtLine,
  sourceAtLine,
  mapLineAtY,
  mapRowAtLine,
} from "../lib/minimap";
import { followScrollOffset } from "../lib/scrollTarget";

type FileMap = { element: HTMLElement; path: string; sources: MapSource[] };
const sameFile = (a: FileMap | null, b: FileMap | null) =>
  a?.element === b?.element &&
  a?.sources.length === b?.sources.length &&
  a?.sources.every((source, index) => source === b?.sources[index]);

/** One small canvas is painted only when file, theme, or map size changes.
 * Scroll work only measures the active file and moves its viewport indicator. */
export function FileMinimap() {
  const root = useRef<HTMLSpanElement>(null);
  const { t } = useTranslation();
  const registry = useContext(FileNavigationContext);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<FileMap | null>(null);
  const current = useRef<FileMap | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const stopJump = useRef(() => {});
  const schedule = useRef(() => {});
  useLayoutEffect(() => {
    const viewport = root.current?.closest<HTMLElement>("[data-review-scroll]");
    const target = viewport
      ?.closest(".review-document")
      ?.querySelector<HTMLElement>("#review-minimap-host");
    setHost(target ?? null);
    if (!viewport || !target || !registry) return;
    let groups: FileMap[] = [];
    let occluded = new Set<HTMLElement>();
    let frame = 0;
    const update = () => {
      frame = 0;
      const view = viewport.getBoundingClientRect();
      const visible =
        view.height > 0
          ? groups.filter((group) => {
              const rect = group.element.getBoundingClientRect();
              return rect.bottom > view.top + 64 && rect.top < view.bottom - 32;
            })
          : [];
      const file = visible[0] ?? null;
      // Keep partially covered line controls from leaving tiny clickable slivers.
      // Code and range geometry remain intact; focused controls stay available.
      const covered = new Set<HTMLElement>();
      for (const group of visible) {
        const bar = group.element
          .querySelector<HTMLElement>(".file-bar")
          ?.getBoundingClientRect();
        if (!bar) continue;
        for (const source of group.sources) {
          const bounds = source.element.getBoundingClientRect();
          if (bounds.top >= bar.bottom || bounds.bottom <= bar.top) continue;
          const start = Math.floor(mapLineAtY(source, bar.top));
          const end = Math.ceil(mapLineAtY(source, bar.bottom));
          for (let index = start; index <= end; index++) {
            const row = mapRowAtLine(source, index);
            if (!row || row.contains(document.activeElement)) continue;
            const rect = row.getBoundingClientRect();
            if (rect.top < bar.bottom && rect.bottom > bar.top)
              covered.add(row);
          }
        }
      }
      occluded.forEach((row) => {
        if (!covered.has(row)) delete row.dataset.headerOccluded;
      });
      covered.forEach((row) => {
        if (!occluded.has(row)) row.dataset.headerOccluded = "true";
      });
      occluded = covered;
      const next =
        file &&
        file.element.getBoundingClientRect().height > view.height &&
        file.sources.some((source) => source.lines.length > 1)
          ? file
          : null;
      if (!sameFile(current.current, next)) {
        current.current = next;
        setActive(next);
      }
      if (!next || !track.current || !indicator.current) return;
      const total = next.sources.reduce(
        (sum, source) => sum + source.lines.length,
        0,
      );
      const header = next.element.querySelector<HTMLElement>(".file-bar");
      const top = view.top + (header?.offsetHeight ?? 50);
      const start = fileLineAtY(next.sources, top) / total;
      const end = fileLineAtY(next.sources, view.bottom) / total;
      const height = track.current.clientHeight;
      const thumb = Math.max(6, (end - start) * height);
      indicator.current.style.height = `${thumb}px`;
      indicator.current.style.transform = `translateY(${clamp(start * height, 0, height - thumb)}px)`;
      const position = Math.round(clamp((start + end) / 2) * 100);
      track.current.setAttribute("aria-valuenow", String(position));
      track.current.setAttribute(
        "aria-valuetext",
        t("{{percent}}% through displayed code", { percent: position }),
      );
    };
    const enqueue = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule.current = enqueue;
    const resize = new ResizeObserver(enqueue);
    const collect = () => {
      resize.disconnect();
      resize.observe(viewport);
      const files = new Map<HTMLElement, FileMap>();
      const sources = [...registry.sources]
        .filter((source) => source.element.isConnected)
        .sort((a, b) =>
          a.element.compareDocumentPosition(b.element) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
      for (const source of sources) {
        const element = source.element.closest<HTMLElement>("[data-file-path]");
        if (!element) continue;
        if (!files.has(element))
          files.set(element, {
            element,
            path: element.dataset.filePath!,
            sources: [],
          });
        files.get(element)!.sources.push(source);
      }
      groups = [...files.values()];
      groups.forEach((group) => resize.observe(group.element));
      enqueue();
    };
    collect();
    const unsubscribe = registry.subscribe(collect);
    viewport.addEventListener("scroll", enqueue, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", enqueue);
      unsubscribe();
      resize.disconnect();
      occluded.forEach((row) => {
        delete row.dataset.headerOccluded;
      });
      stopJump.current();
      schedule.current = () => {};
    };
  }, [root, registry, t]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!active || !element || !track.current) return;
    const lines = active.sources.flatMap((source) => source.lines);
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const style = getComputedStyle(element);
      const colors = {
        addition: style.getPropertyValue("--green"),
        deletion: style.getPropertyValue("--red"),
        context: style.getPropertyValue("--muted"),
      };
      // Aggregate dense files into at most one paint band per physical pixel.
      const bands = Math.min(lines.length, Math.ceil(height * ratio));
      for (let band = 0; band < bands; band++) {
        const first = Math.floor((band * lines.length) / bands);
        const last = Math.floor(((band + 1) * lines.length) / bands);
        let added = false,
          removed = false,
          length = 0;
        for (let i = first; i < last; i++) {
          added ||= lines[i].kind === "addition";
          removed ||= lines[i].kind === "deletion";
          length = Math.max(length, Math.min(120, lines[i].text.length));
        }
        const inset =
          (Math.min(20, lines[first].text.search(/\S/) + 1) * width) / 120;
        const extent = Math.max(
          2,
          Math.min(width - inset, (length * width) / 120),
        );
        const y = (band * height) / bands,
          bandHeight = Math.max(0.5, height / bands - 0.3);
        context.globalAlpha = added || removed ? 0.75 : 0.35;
        context.fillStyle = added
          ? colors.addition
          : removed
            ? colors.deletion
            : colors.context;
        context.fillRect(inset, y, extent, bandHeight);
        if (added && removed) {
          context.fillStyle = colors.deletion;
          context.fillRect(inset, y, extent / 2, bandHeight);
        }
      }
      context.globalAlpha = 1;
      schedule.current();
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [active, host]);

  const navigate = (fraction: number) => {
    const file = current.current;
    const viewport = root.current?.closest<HTMLElement>("[data-review-scroll]");
    if (!file || !viewport) return;
    const count = file.sources.reduce(
      (sum, source) => sum + source.lines.length,
      0,
    );
    const { source, line } = sourceAtLine(
      file.sources,
      Math.floor(clamp(fraction) * (count - 1)),
    );
    stopJump.current();
    stopJump.current = followScrollOffset(
      viewport,
      () => {
        if (!source.element.isConnected) return null;
        const bounds = file.element.getBoundingClientRect();
        const middle = Math.max(64, viewport.clientHeight / 2);
        // Keep the first/last page within this file instead of exposing its
        // neighbor and changing maps halfway through a drag or keyboard jump.
        return clamp(
          mapYAtLine(source, line),
          bounds.top + middle,
          Math.max(
            bounds.top + middle,
            bounds.bottom - viewport.clientHeight + middle,
          ),
        );
      },
      () => Math.max(64, viewport.clientHeight / 2),
    );
  };
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    navigate((event.clientY - bounds.top) / bounds.height);
  };
  return (
    <>
      <span ref={root} hidden />
      {host &&
        active &&
        createPortal(
          <aside className="file-minimap" aria-label={t("File minimap")}>
            <span className="minimap-label" title={active.path}>
              {t("Map")}
            </span>
            <div
              ref={track}
              className="minimap-track"
              role="slider"
              tabIndex={0}
              aria-label={t("Code minimap for {{path}}", { path: active.path })}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              aria-describedby="file-minimap-help"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                point(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  point(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                const value =
                  Number(event.currentTarget.getAttribute("aria-valuenow")) /
                  100;
                const values: Record<string, number> = {
                  ArrowUp: value - 0.01,
                  ArrowDown: value + 0.01,
                  PageUp: value - 0.1,
                  PageDown: value + 0.1,
                  Home: 0,
                  End: 1,
                };
                if (event.key in values) {
                  event.preventDefault();
                  navigate(values[event.key]);
                }
              }}
            >
              <canvas ref={canvas} aria-hidden="true" />
              <div
                ref={indicator}
                className="minimap-viewport"
                aria-hidden="true"
              />
            </div>
            <span id="file-minimap-help" className="sr-only">
              {t(
                "Click or drag to navigate displayed code. Use arrow keys, Page Up, Page Down, Home, or End. Green marks additions; red marks deletions. Unloaded source is not shown.",
              )}
            </span>
          </aside>,
          host,
        )}
    </>
  );
}
