// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CodeText } from "./CodeText";
import { selectedCode } from "../lib/textSelection";
afterEach(cleanup);
it("highlights source without changing text, executing HTML, or breaking character selections", () => {
  const text = 'const name = "<img src=x onerror=alert(1)>";';
  const { container } = render(
    <div data-file-path="a.ts">
      <div data-source-path="a.ts" data-hunk-id="h" data-source-snapshot="s">
        <code data-code-text data-new-line="1">
          <CodeText text={text} path="a.ts" />
        </code>
      </div>
    </div>,
  );
  const code = container.querySelector("code")!;
  expect(code.textContent).toBe(text);
  expect(code.querySelector("img")).toBeNull();
  expect(code.querySelector(".hljs-keyword")).toBeTruthy();
  const keyword = code.querySelector(".hljs-keyword")!.firstChild!;
  const range = document.createRange();
  range.setStart(keyword, 0);
  range.setEnd(keyword, 5);
  expect(selectedCode(range, container)?.textSelection).toMatchObject({
    text: "const",
    startColumn: 0,
    endColumn: 5,
  });
});
it("leaves oversized and unsupported code plain", () => {
  const { container } = render(
    <code>
      <CodeText path="bundle.js" text={"x".repeat(2001)} />
    </code>,
  );
  expect(container.querySelector("span")).toBeNull();
});
