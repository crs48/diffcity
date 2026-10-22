// @vitest-environment jsdom
import { expect, it } from "vitest";
import { fileLineAtY, mapLineAtY, mapYAtLine, sourceAtLine } from "./minimap";
import type { MapSource } from "../features/fileNavigation";

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height }) as DOMRect;
const source = (): MapSource => {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => rect(100, 1100);
  const first = document.createElement("div");
  first.dataset.mapStart = "0";
  first.dataset.mapEnd = "3";
  first.getBoundingClientRect = () => rect(100, 300);
  [100, 125, 250, 300].forEach((top, index) => {
    const row = document.createElement("div");
    row.dataset.mapLine = String(index);
    row.getBoundingClientRect = () => rect(top, index === 1 ? 100 : 25);
    first.append(row);
  });
  const virtual = document.createElement("div");
  virtual.dataset.mapStart = "4";
  virtual.dataset.mapEnd = "11";
  virtual.getBoundingClientRect = () => rect(400, 800);
  element.append(first, virtual);
  return {
    element,
    lines: Array.from({ length: 12 }, (_, index) => ({
      kind: "addition",
      old: null,
      new: index + 1,
      text: String(index),
    })),
  };
};

it("maps wrapped code and discussion gaps without treating comments as code rows", () => {
  const s = source();
  expect(mapLineAtY(s, 175)).toBe(1.5);
  expect(mapLineAtY(s, 240)).toBe(2);
  expect(mapLineAtY(s, 0)).toBe(0);
  expect(mapLineAtY(s, 1400)).toBe(12);
  expect(mapYAtLine(s, 2)).toBe(250);
});

it("estimates virtual rows, then uses their measured position after mounting", () => {
  const s = source();
  expect(mapLineAtY(s, 800)).toBe(8);
  expect(mapYAtLine(s, 8)).toBe(800);
  const row = document.createElement("div");
  row.dataset.mapLine = "8";
  row.getBoundingClientRect = () => rect(875, 50);
  s.element.lastElementChild!.append(row);
  expect(mapYAtLine(s, 8)).toBe(875);
});

it("keeps multi-hunk and expanded-context coordinates continuous and clamps endpoints", () => {
  const a = source(),
    b = source();
  b.element.getBoundingClientRect = () => rect(1300, 1100);
  expect(fileLineAtY([a, b], 1250)).toBe(12);
  expect(sourceAtLine([a, b], 15)).toEqual({ source: b, line: 3 });
  expect(sourceAtLine([a, b], 1000)).toEqual({ source: b, line: 11 });
});
