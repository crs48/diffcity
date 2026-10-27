import type { MapSource } from "../features/fileNavigation";

export const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const blocks = (source: MapSource) =>
  [...source.element.children] as HTMLElement[];
const firstAfter = <T>(
  items: T[],
  after: (item: T) => boolean,
): T | undefined => {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (after(items[middle])) high = middle;
    else low = middle + 1;
  }
  return items[Math.min(low, items.length - 1)];
};

/** Exact mounted-row geometry; estimated within an unmounted block only. */
export function mapLineAtY(source: MapSource, y: number): number {
  const bounds = source.element.getBoundingClientRect();
  if (y <= bounds.top) return 0;
  if (y >= bounds.bottom) return source.lines.length;
  const block = firstAfter(
    blocks(source),
    (item) => item.getBoundingClientRect().bottom > y,
  );
  if (!block) return 0;
  const start = Number(block.dataset.mapStart),
    end = Number(block.dataset.mapEnd) + 1;
  const rows = [...block.querySelectorAll<HTMLElement>("[data-map-line]")];
  const row = firstAfter(
    rows,
    (item) => item.getBoundingClientRect().bottom > y,
  );
  if (row) {
    const rect = row.getBoundingClientRect();
    return (
      Number(row.dataset.mapLine) +
      clamp((y - rect.top) / Math.max(1, rect.height))
    );
  }
  const rect = block.getBoundingClientRect();
  return (
    start + clamp((y - rect.top) / Math.max(1, rect.height)) * (end - start)
  );
}

export function mapYAtLine(source: MapSource, line: number): number {
  const block = firstAfter(
    blocks(source),
    (item) => Number(item.dataset.mapEnd) >= line,
  );
  if (!block) return source.element.getBoundingClientRect().top;
  const row = block.querySelector<HTMLElement>(
    `[data-map-line="${Math.floor(line)}"]`,
  );
  if (row) return row.getBoundingClientRect().top;
  const rect = block.getBoundingClientRect();
  const start = Number(block.dataset.mapStart),
    end = Number(block.dataset.mapEnd) + 1;
  return (
    rect.top + rect.height * clamp((line - start) / Math.max(1, end - start))
  );
}

export function sourceAtLine(sources: MapSource[], index: number) {
  let offset = 0;
  for (const source of sources) {
    if (index < offset + source.lines.length)
      return { source, line: Math.max(0, index - offset) };
    offset += source.lines.length;
  }
  const source = sources.at(-1)!;
  return { source, line: Math.max(0, source.lines.length - 1) };
}

export function mapRowAtLine(source: MapSource, line: number) {
  const block = firstAfter(
    blocks(source),
    (item) => Number(item.dataset.mapEnd) >= line,
  );
  return (
    block?.querySelector<HTMLElement>(
      `[data-map-line="${Math.floor(line)}"]`,
    ) ?? null
  );
}

export function fileLineAtY(sources: MapSource[], y: number): number {
  let offset = 0;
  for (const source of sources) {
    if (source.element.getBoundingClientRect().bottom > y)
      return offset + mapLineAtY(source, y);
    offset += source.lines.length;
  }
  return offset;
}
