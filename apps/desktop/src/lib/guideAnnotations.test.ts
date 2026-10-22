import { expect, it } from "vitest";
import { annotationPosition, orderedAnnotations } from "./guideAnnotations";
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

it("pushes the previous note out as the next passage approaches and reverses on upward scrolling", () => {
  const tops = [100, 600, 1200];
  expect(annotationPosition(tops, 0, 200)).toEqual({ active: -1, push: 0 });
  expect(annotationPosition(tops, 100, 200)).toEqual({ active: 0, push: 0 });
  expect(annotationPosition(tops, 500, 200)).toEqual({ active: 0, push: 100 });
  expect(annotationPosition(tops, 600, 200)).toEqual({ active: 1, push: 0 });
  expect(annotationPosition(tops, 300, 200)).toEqual({ active: 0, push: 0 });
  expect(annotationPosition(tops, 2000, 200)).toEqual({ active: 2, push: 0 });
});
