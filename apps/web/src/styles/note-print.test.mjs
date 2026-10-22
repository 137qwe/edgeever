import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("./note-print.css", import.meta.url), "utf8");

const pageRule = (selector) => {
  const marker = `@page${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
};

describe("note print running header", () => {
  test("repeats the note title from the second page onward", () => {
    expect(pageRule("")).toContain("content: string(edgeever-note-title)");
    expect(css).toContain("string-set: edgeever-note-title content(text)");
  });

  test("leaves the first page header empty so it does not repeat the title", () => {
    expect(pageRule(" :first")).toMatch(/@top-center\s*\{[^}]*content:\s*none;/s);
  });
});
