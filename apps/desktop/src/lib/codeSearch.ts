import type { Anchor, ChangedFile } from "./api";

export type CodeMatch = { anchor: Anchor; codeIndex: number; text: string };

/** Search the captured data, including code that is folded or not mounted. */
export function findCode(files: ChangedFile[], query: string): CodeMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return files.flatMap((file) =>
    file.hunks.flatMap((hunk) =>
      hunk.lines.flatMap((line, codeIndex) => {
        const side = line.kind === "deletion" ? "LEFT" : "RIGHT";
        const coordinate = side === "LEFT" ? line.old : line.new;
        return coordinate !== null &&
          line.text.toLocaleLowerCase().includes(needle)
          ? [
              {
                codeIndex,
                text: line.text,
                anchor: {
                  hunkId: hunk.id,
                  path: hunk.path,
                  side,
                  startLine: coordinate,
                  line: coordinate,
                },
              },
            ]
          : [];
      }),
    ),
  );
}
