import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("./note-print.css", import.meta.url), "utf8");

describe("note print page margin", () => {
  test("keeps the page number and leaves the note title off the page header", () => {
    expect(css).toContain('content: counter(page) " / " counter(pages)');
    expect(css).not.toContain("@top-center");
    expect(css).not.toContain("edgeever-note-title");
    expect(css).not.toContain("string-set:");
  });
});
