import { expect, it } from "vitest";
import { annotationLayout, orderedAnnotations } from "./guideAnnotations";
import type { GuideAnnotation, ReviewWorkspace } from "./api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

it("follows guide reading order and old/new line coordinates rather than AI output order", () => {
  const w = fixture as ReviewWorkspace;
  const hunks = w.snapshot.files.flatMap((f) => f.hunks);
  const h = hunks[0];
  const note = (id: string, line: number): GuideAnnotation => ({
    id,
    title: id,
    body: "Explanation",
    anchor: {
      hunkId: h.id,
      path: h.path,
      side: "RIGHT",
      startLine: line,
      line,
    },
  });
  const section = {
    ...w.guide.sections[0],
    annotations: [note("late", 2), note("first", 1), note("bad", 99999)],
  };
  expect(orderedAnnotations(section, hunks).map((n) => n.id)).toEqual([
    "first",
    "late",
  ]);
  expect(
    orderedAnnotations({ ...section, annotations: undefined }, hunks),
  ).toEqual([]);
});

it("keeps the last note fully readable after a short final file", () => {
  const layout = annotationLayout(
    [
      { anchor: 0, height: 400 },
      { anchor: 900, height: 500 },
      { anchor: 1450, height: 1200 },
    ],
    1600,
  );
  expect(layout).toEqual([
    { top: 0, height: 900 },
    { top: 900, height: 550 },
    { top: 1450, height: 1200 },
  ]);
  expect(layout.at(-1)!.top + layout.at(-1)!.height).toBe(2650);
});

it("never overlaps or clips nearby notes, including notes on the same line", () => {
  const passages = [
    { anchor: 0, height: 400 },
    { anchor: 200, height: 1200 },
    { anchor: 200, height: 600 },
    { anchor: 500, height: 200 },
  ];
  const layout = annotationLayout(passages, 700);
  expect(layout.map((p) => p.top)).toEqual([0, 400, 1600, 2200]);
  layout.forEach((slot, i) =>
    expect(slot.height).toBeGreaterThanOrEqual(passages[i].height),
  );
});

it("lets short notes follow widely spaced code and recomputes after collapsing a file", () => {
  expect(
    annotationLayout(
      [
        { anchor: 0, height: 400 },
        { anchor: 1500, height: 300 },
      ],
      4000,
    ),
  ).toEqual([
    { top: 0, height: 1500 },
    { top: 1500, height: 2500 },
  ]);
  expect(annotationLayout([{ anchor: 0, height: 400 }], 300)).toEqual([
    { top: 0, height: 400 },
  ]);
});
