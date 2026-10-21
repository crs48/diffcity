import { type ReactNode } from "react";

// Small paint boundaries let WebKit skip offscreen code without hiding it,
// estimating row heights, or removing selection and accessibility targets.
export const DIFF_CHUNK_SIZE = 64;

export function DiffChunks<T>({
  items,
  render,
  itemKey,
  startsChunk = (_, index) => index % DIFF_CHUNK_SIZE === 0,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  itemKey: (item: T) => string;
  startsChunk?: (item: T, index: number) => boolean;
}) {
  const chunks = items.reduce<Array<Array<{ item: T; index: number }>>>(
    (result, item, index) => {
      if (index === 0 || startsChunk(item, index)) result.push([]);
      result.at(-1)!.push({ item, index });
      return result;
    },
    [],
  );
  return chunks.map((chunk) => (
    <div className="diff-chunk" key={itemKey(chunk[0].item)}>
      {chunk.map(({ item, index }) => render(item, index))}
    </div>
  ));
}

/** Binary search the paint blocks, then their variable-height rows (including threads). */
export function rowAtOffset(
  element: HTMLElement,
  offset: number,
): HTMLElement | null {
  const y = element.getBoundingClientRect().top + offset;
  const atY = (rows: HTMLCollection): HTMLElement | null => {
    let left = 0,
      right = rows.length - 1;
    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      const row = rows[middle] as HTMLElement;
      const bounds = row.getBoundingClientRect();
      if (y < bounds.top) right = middle - 1;
      else if (y >= bounds.bottom) left = middle + 1;
      else return row;
    }
    return null;
  };
  const chunk = atY(element.children);
  return chunk ? atY(chunk.children) : null;
}
