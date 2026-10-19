// Generate with `bun run dev` already running; --check needs no browser/server.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, mkdtemp, cp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "apps/web/src/assets/poster-template-previews");
const digest = data => createHash("sha256").update(data).digest("hex");
const sources = [
  "apps/web/src/lib/poster-design", "apps/web/src/lib/poster-canvas.ts",
  "packages/shared/src/poster.ts", "packages/shared/src/poster-design-catalog.ts",
  "packages/shared/src/poster-fonts.ts", "packages/shared/src/font-catalog.ts",
  "packages/shared/src/font-catalog-data.ts", "packages/shared/src/font-loader.ts",
  "packages/shared/src/font-defaults.ts", "packages/shared/src/font-resources.ts",
  "packages/shared/src/font-assets-registry.ts",
  "scripts/prepare-poster-thumbnails.mjs",
  "tests/browser/poster-thumbnail-generator.html", "tests/browser/poster-thumbnail-generator.ts",
];
const sourceFiles = async (relative) => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(error => {
    if (error.code === "ENOTDIR") return undefined;
    throw error;
  });
  if (!entries) return [relative];
  return (await Promise.all(entries.map(entry => sourceFiles(`${relative}/${entry.name}`)))).flat();
};
const files = (await Promise.all(sources.map(sourceFiles))).flat().sort();
const sourceHash = digest(await Promise.all(files.map(async file => `${file}\0${digest((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n"))}`)).then(parts => parts.join("\n")));
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json")));
  if (manifest.sourceHash !== sourceHash) throw new Error("Poster thumbnails are stale. Run bun run prepare:poster:thumbnails against bun run dev, then commit the generated assets.");
  if (manifest.templates.length === 0) throw new Error("No poster thumbnails");
  for (const template of manifest.templates) for (const language of ["zh", "en"]) {
    const asset = template[language];
    if (!/^[a-z-]+\.(zh|en)\.webp$/.test(asset.file) || digest(await readFile(path.join(output, asset.file))) !== asset.sha256) throw new Error(`Invalid poster thumbnail: ${template.id}/${language}`);
  }
  console.log(`Poster thumbnails current: ${manifest.templates.length} templates, ${manifest.templates.length * 2} images`);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const temporary = await mkdtemp(path.join(tmpdir(), "edgeever-poster-thumbnails-"));
  try {
    const page = await browser.newPage();
    const origin = process.env.EDGE_EVER_BROWSER_TEST_URL ?? "http://127.0.0.1:5173";
    await page.goto(`${origin}/@fs${root}tests/browser/poster-thumbnail-generator.html`);
    await page.waitForFunction(() => window.posterThumbnailGenerator);
    const templates = await page.evaluate(() => window.posterThumbnailGenerator.templates);
    for (const template of templates) for (const language of ["zh", "en"]) {
      const base64 = await page.evaluate(({ id, language }) => window.posterThumbnailGenerator.render(id, language === "zh"), { id: template.id, language });
      const bytes = Buffer.from(base64, "base64");
      if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`Invalid WebP: ${template.id}`);
      const file = `${template.id}.${language}.webp`;
      await writeFile(path.join(temporary, file), bytes);
      template[language] = { file, sha256: digest(bytes) };
      console.log(`Generated ${file}: ${bytes.length} bytes`);
    }
    await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify({ sourceHash, width: 480, height: 640, templates }, null, 2)}\n`);
    await mkdir(output, { recursive: true });
    await cp(temporary, output, { recursive: true });
    console.log(`Generated ${templates.length * 2} static poster thumbnails`);
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
