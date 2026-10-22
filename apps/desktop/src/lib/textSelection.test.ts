// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { selectedCode } from "./textSelection";
import { sameAnchor } from "./selection";
import { anchorKey } from "./diffRows";
function fixture(html: string) {
  const root = document.createElement("div");
  root.innerHTML = `<div data-file-path="a.ts"><div data-source-snapshot="snapshot" data-source-path="a.ts" data-hunk-id="hunk">${html}</div></div>`;
  document.body.append(root);
  return root;
}
function range(
  root: HTMLElement,
  first: number,
  start: number,
  last = first,
  end = start + 3,
) {
  const cells = root.querySelectorAll("code");
  const r = document.createRange();
  r.setStart(cells[first].firstChild!, start);
  r.setEnd(cells[last].firstChild!, end);
  return r;
}
afterEach(() => document.body.replaceChildren());
describe("precise code selection", () => {
  it("captures only the selected variable and keeps variables on the same line separate", () => {
    const root = fixture(
      '<button>1</button><code data-code-text data-new-line="1">const first = second;</code>',
    );
    const first = selectedCode(range(root, 0, 6, 0, 11), root)!;
    const second = selectedCode(range(root, 0, 14, 0, 20), root)!;
    expect(first.textSelection).toEqual({
      snapshotId: "snapshot",
      startColumn: 6,
      endColumn: 11,
      text: "first",
    });
    expect(second.textSelection?.text).toBe("second");
    expect(sameAnchor(first, second)).toBe(false);
    expect(anchorKey(first)).not.toBe(anchorKey(second));
    expect(sameAnchor(first, { ...first, textSelection: undefined })).toBe(
      false,
    );
  });
  it("excludes gutters and opposite split columns across consecutive lines", () => {
    const root = fixture(
      '<button>91</button><code data-code-text data-code-side="LEFT" data-old-line="91">old first</code><code data-code-text data-code-side="RIGHT" data-new-line="101">new first</code><button>92</button><code data-code-text data-code-side="LEFT" data-old-line="92">old second</code><code data-code-text data-code-side="RIGHT" data-new-line="102">new second</code>',
    );
    const result = selectedCode(range(root, 1, 4, 3, 6), root)!;
    expect(result).toMatchObject({
      startLine: 101,
      line: 102,
      side: "RIGHT",
      textSelection: { text: "first\nnew se" },
    });
    expect(selectedCode(range(root, 0, 0, 3, 6), root)).toBeNull();
  });
  it("rejects mixed old/new unified selections, gaps, cross-file selections, and non-code", () => {
    const root = fixture(
      '<code data-code-text data-old-line="1">removed</code><code data-code-text data-new-line="1">added</code><code data-code-text data-new-line="3">gap</code>',
    );
    expect(selectedCode(range(root, 0, 0, 1, 3), root)).toBeNull();
    expect(selectedCode(range(root, 1, 0, 2, 3), root)).toBeNull();
    expect(selectedCode(range(root, 0, 0, 0, 3), root)?.side).toBe("LEFT");
    const other = fixture(
      '<code data-code-text data-new-line="1">elsewhere</code>',
    );
    const cross = range(root, 0, 0);
    cross.setEnd(other.querySelector("code")!.firstChild!, 3);
    expect(selectedCode(cross, root)).toBeNull();
  });
  it("preserves Unicode UTF-16 positions and empty source lines without inventing spaces", () => {
    const root = fixture(
      '<code data-code-text data-new-line="1">const emoji = "😀";</code><code data-code-text data-new-line="2" data-code-empty="true"> </code><code data-code-text data-new-line="3">return emoji;</code>',
    );
    const result = selectedCode(range(root, 0, 15, 2, 6), root)!;
    expect(result.textSelection).toMatchObject({
      startColumn: 15,
      endColumn: 6,
      text: '😀";\n\nreturn',
    });
  });
});
