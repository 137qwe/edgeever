import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const rootRequire = createRequire(new URL("../package.json", import.meta.url));

describe("dependency security at the actual consumer", () => {
  test("the desktop updater enforces a budget for empty YAML merge sources", () => {
    const updaterRequire = createRequire(desktopRequire.resolve("electron-updater"));
    const yaml = updaterRequire("js-yaml");
    expect(yaml.load("version: 1.111.0\nfiles: []\n")).toEqual({ version: "1.111.0", files: [] });
    expect(() => yaml.load("a: &a {}\nb:\n  <<: [*a, *a, *a, *a]\n", {
      maxTotalMergeKeys: 3,
    })).toThrow();
  });

  test("the command tool refuses a line terminator after a comment token", () => {
    const commandRequire = createRequire(rootRequire.resolve("concurrently"));
    const { quote } = commandRequire("shell-quote");
    expect(() => quote(["echo", { comment: "test" }, "value\ncommand"])).toThrow(TypeError);
    expect(quote(["echo", "two words"])).toContain("two words");
  });

  test("npm's bundled dependencies cannot hide vulnerable copies from root overrides", () => {
    const npmRequire = createRequire(desktopRequire.resolve("npm/package.json"));
    const semver = npmRequire("semver");
    const gypRequire = createRequire(npmRequire.resolve("node-gyp/package.json"));
    const cacheRequire = createRequire(npmRequire.resolve("make-fetch-happen/package.json"));
    const pacoteRequire = createRequire(npmRequire.resolve("pacote/package.json"));
    const undici = gypRequire("undici/package.json").version;
    expect(semver.satisfies(undici, ">=6.28.1 <7 || >=7.29.1 <8 || >=8")).toBe(true);
    expect(semver.gte(cacheRequire("http-cache-semantics/package.json").version, "4.3.0")).toBe(true);
    expect(semver.gte(pacoteRequire("tar/package.json").version, "7.5.21")).toBe(true);
  });
});
