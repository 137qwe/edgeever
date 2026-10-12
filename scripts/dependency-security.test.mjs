import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const rootRequire = createRequire(new URL("../package.json", import.meta.url));
const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const extensionRequire = createRequire(new URL("../apps/extension/package.json", import.meta.url));

function consumerRequire(start, ...packages) {
  return packages.reduce((require, name) => createRequire(require.resolve(name)), start);
}

describe("dependency security at the actual consumer", () => {
  test("native plist consumers preserve values and reject injected entity names", () => {
    const expoRequire = consumerRequire(mobileRequire, "expo/package.json", "@expo/config-plugins");
    const builderRequire = consumerRequire(desktopRequire, "electron-builder", "app-builder-lib");
    const consumers = [
      [expoRequire, "@expo/plist"],
      [builderRequire, "plist"],
      [consumerRequire(expoRequire, "xcode", "simple-plist"), "plist"],
      [consumerRequire(builderRequire, "@electron/osx-sign"), "plist"],
      [consumerRequire(builderRequire, "@electron/universal"), "plist"],
    ];
    const fixture = { CFBundleIdentifier: "com.edgeever.app", label: "中文 & <EdgeEver>", enabled: true, count: 42, values: ["a", "b"] };
    for (const [require, name] of consumers) {
      const plistModule = require(name);
      const plist = plistModule.default ?? plistModule;
      expect(plist.parse(plist.build(fixture))).toEqual(fixture);
      const xmlRequire = consumerRequire(require, name);
      const { DOMImplementation } = xmlRequire("@xmldom/xmldom");
      const doc = new DOMImplementation().createDocument(null, "root", null);
      expect(() => doc.createEntityReference("x;<injected/>")).toThrow();
    }
  });

  test("Firefox profile encoding uses the fixed ZIP parser and preserves preferences", async () => {
    const webExtRequire = consumerRequire(extensionRequire, "web-ext/package.json");
    const profileRequire = consumerRequire(webExtRequire, "firefox-profile");
    const FirefoxProfile = webExtRequire("firefox-profile");
    const AdmZip = profileRequire("adm-zip");
    expect(profileRequire("adm-zip/package.json").version).toBe("0.6.1");
    const directory = mkdtempSync(join(tmpdir(), "edgeever-firefox-profile-"));
    const profile = new FirefoxProfile({ destinationDirectory: directory });
    try {
      profile.setPreference("edgeever.security.test", "中文 & value");
      const encoded = await new Promise((resolve, reject) => profile.encoded((error, data) => error ? reject(error) : resolve(data)));
      const zip = new AdmZip(Buffer.from(encoded, "base64"));
      expect(zip.readAsText("user.js")).toContain('user_pref("edgeever.security.test", "中文 & value");');
    } finally {
      process.removeListener("exit", profile.onExit);
      process.removeListener("SIGINT", profile.onSigInt);
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
