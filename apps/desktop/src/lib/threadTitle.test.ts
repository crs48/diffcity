import { expect, it } from "vitest";
import { threadTitle, visibleReply } from "./threadTitle";
import { newNote } from "./review";
import type { Anchor } from "./api";

it("keeps the first AI title stable and ignores titles on drafts", () => {
  const first = {
    ...newNote("s", null, "Explain this migration"),
    id: "1",
    createdAt: "1",
  };
  const reply = {
    ...first,
    id: "2",
    createdAt: "2",
    role: "assistant",
    threadTitle: "Backfilling invitation expiry",
  };
  const followup = {
    ...reply,
    id: "3",
    createdAt: "3",
    threadTitle: "A different topic",
  };
  expect(threadTitle([followup, first, reply])).toBe(reply.threadTitle);
  expect(threadTitle([first, { ...reply, githubDraft: true }])).toBe(
    first.body,
  );
  expect(threadTitle([])).toBe("");
});

it("uses a short opening preview and the selected code for a generic explanation", () => {
  expect(
    threadTitle([newNote("s", null, "## **Migration safety**\nMore details")]),
  ).toBe("Migration safety");
  expect(
    threadTitle([newNote("s", null, "word ".repeat(30))]).length,
  ).toBeLessThanOrEqual(72);
  const anchor: Anchor = {
    hunkId: "h",
    path: "file",
    side: "RIGHT",
    startLine: 1,
    line: 1,
    textSelection: {
      snapshotId: "s",
      startColumn: 0,
      endColumn: 11,
      text: "dnssec_zone",
    },
  };
  expect(
    threadTitle(
      [
        newNote(
          "s",
          anchor,
          "Help me understand this selected code. What does it do?",
        ),
      ],
      [],
      anchor,
    ),
  ).toBe("dnssec_zone");
});

it("hides complete and partial title metadata while preserving code and Markdown", () => {
  const marker = "<!-- diffcity-thread-title:";
  for (let length = 1; length <= marker.length; length++)
    expect(visibleReply(`Answer.\n${marker.slice(0, length)}`)).toBe("Answer.");
  expect(
    visibleReply("Answer.\n<!-- diffcity-thread-title: DNSSEC metadata -->"),
  ).toBe("Answer.");
  const ordinary = "```html\n<div>Example</div>\n```";
  expect(visibleReply(ordinary)).toBe(ordinary);
});

it("hides a streamed GitHub draft envelope from the conversation", () => {
  const marker = "<diffcity-github-draft>";
  for (let length = 1; length <= marker.length; length++)
    expect(visibleReply(`Draft prepared.\n${marker.slice(0, length)}`)).toBe(
      "Draft prepared.",
    );
  expect(
    visibleReply(
      'Draft prepared.\n<diffcity-github-draft>\n{"body":"Check tenant scope"}\n</diffcity-github-draft>',
    ),
  ).toBe("Draft prepared.");
});
