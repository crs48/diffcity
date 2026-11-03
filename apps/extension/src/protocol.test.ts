import { describe, expect, it } from "vitest";
import { pullFromUrl, safeContext, trustedPage } from "./protocol";

describe("browser trust boundary", () => {
  const url = "https://github.com/example/review/pull/42/files";
  it("accepts only real GitHub PR URLs", () => {
    expect(pullFromUrl(url)).toEqual({
      repository: "example/review",
      number: 42,
    });
    for (const input of [
      "https://github.com.attacker.test/example/review/pull/42",
      "http://github.com/example/review/pull/42",
      "https://token@github.com/example/review/pull/42",
      "https://github.com/example/review/pull/0",
      "https://github.com/example/review/pull/42oops",
      "https://github.com/example/review/pull/9999999999999",
    ])
      expect(pullFromUrl(input)).toBeNull();
  });
  it("does not let page messages select another repository or inject RPC fields", () => {
    expect(
      safeContext({ repository: "private/repo", number: 42 }, url),
    ).toBeNull();
    expect(
      safeContext(
        {
          repository: "example/review",
          number: 42,
          command: "publish_review",
          access: "full",
        },
        url,
      ),
    ).toEqual(pullFromUrl(url));
    expect(
      safeContext(
        {
          ...pullFromUrl(url),
          commentUrl: "https://github.com/private/repo/pull/42#discussion_r1",
        },
        url,
      ),
    ).toBeNull();
    expect(
      safeContext(
        { ...pullFromUrl(url), selection: { text: "x".repeat(16001) } },
        url,
      ),
    ).toBeNull();
  });
  it("permits RPC only from our bundled UI pages, never opaque or lookalike origins", () => {
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    expect(trustedPage(`${origin}/sidepanel.html`, origin)).toBe(true);
    expect(
      trustedPage(`${origin}/index.html?repo=example/review&number=42`, origin),
    ).toBe(true);
    for (const input of [
      "https://github.com/index.html",
      "data:text/html,test",
      "file:///index.html",
      "chrome-extension://other/index.html",
      `${origin}/content.js`,
    ])
      expect(trustedPage(input, origin)).toBe(false);
  });
});
