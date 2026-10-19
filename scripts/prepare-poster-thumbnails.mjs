// Used by Vite on startup/build and template saves. Fresh assets need no browser.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, mkdtemp, rename, rm, open, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const sources = [
  "apps/web/src/lib/poster-design", "apps/web/src/lib/poster-canvas.ts",
  "apps/web/package.json", "packages/shared/src/poster.ts",
  "packages/shared/src/poster-design-catalog.ts", "packages/shared/src/poster-fonts.ts",
  "packages/shared/src/font-catalog.ts", "packages/shared/src/font-catalog-data.ts",
  "packages/shared/src/font-loader.ts", "packages/shared/src/font-defaults.ts",
  "packages/shared/src/font-resources.ts", "packages/shared/src/font-assets-registry.ts",
  "packages/shared/src/note-image-asset-urls.ts",
  "scripts/prepare-poster-thumbnails.mjs",
  "tests/browser/poster-thumbnail-generator.html", "tests/browser/poster-thumbnail-generator.ts",
];
const digest = data => createHash("sha256").update(data).digest("hex");
const languages = ["zh", "en"];
const assetName = /^[a-z0-9-]+\.(zh|en)\.webp$/;
const readJson = file => readFile(file, "utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
const sourceFiles = async (root, relative) => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(error => {
    if (error.code === "ENOTDIR") return undefined;
    throw error;
  });
  if (!entries) return [relative];
  return (await Promise.all(entries.filter(entry => !entry.name.startsWith(".")).map(entry => sourceFiles(root, `${relative}/${entry.name}`)))).flat();
};
export async function sourceState(root = projectRoot) {
  const files = (await Promise.all(sources.map(relative => sourceFiles(root, relative)))).flat().sort();
  const hashes = await Promise.all(files.map(async file => [file, digest((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n"))]));
  // Template/layout changes are captured in each prepared document. Changes to
  // the painter or font definitions can affect pixels even with identical JSON.
  const painter = hashes.filter(([file]) => file === "apps/web/src/lib/poster-canvas.ts" || /\/font[^/]*\.ts$|\/poster-fonts\.ts$/.test(file));
  const web = await readJson(path.join(root, "apps/web/package.json"));
  return { sourceHash: digest(JSON.stringify(hashes)), painterHash: digest(JSON.stringify([painter, web.dependencies?.fabric])) };
}
async function validAsset(output, asset) {
  if (!asset || !assetName.test(asset.file)) return false;
  return readFile(path.join(output, asset.file)).then(bytes => digest(bytes) === asset.sha256, () => false);
}
export async function thumbnailsCurrent(output, state) {
  const manifest = await readJson(path.join(output, "manifest.json"));
  if (manifest?.version !== 2 || manifest.sourceHash !== state.sourceHash || !manifest.templates?.length) return false;
  const valid = await Promise.all(manifest.templates.flatMap(template => languages.map(language => validAsset(output, template[language]))));
  return valid.every(Boolean);
}

async function launchBrowser(root) {
  const { chromium } = await import("@playwright/test");
  const executablePath = process.env.EDGE_EVER_POSTER_CHROME_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  try { return await chromium.launch({ channel: "chrome", headless: true }); }
  catch { /* Standard desktop/CI Chrome may not be installed. */ }
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    if (!/executable.*doesn.t exist/i.test(String(error))) throw error;
    console.log("[poster thumbnails] Preparing the build browser");
    const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
    await promisify(execFile)(process.execPath, [cli, "install", "chromium"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    return chromium.launch({ headless: true });
  }
}
export async function openRenderer(root) {
  root = await realpath(root);
  const { createServer } = await import("vite");
  // No application config/plugins: this server cannot recursively trigger the
  // thumbnail hook, authenticate, start an API or touch user notes.
  const server = await createServer({
    configFile: false, root, appType: "mpa", logLevel: "error",
    cacheDir: path.join(tmpdir(), "edgeever-poster-thumbnails-vite", digest(root).slice(0, 16)),
    resolve: { alias: { "@": path.join(root, "apps/web/src") } },
    optimizeDeps: { entries: ["tests/browser/poster-thumbnail-generator.html"], include: ["fabric"] },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, preTransformRequests: false, fs: { allow: [root, projectRoot] } },
  });
  const closeServer = async () => {
    // Bun can otherwise wait on idle development HTTP connections after Chrome
    // has exited, keeping the generation lock held across subsequent saves.
    server.httpServer?.closeAllConnections?.();
    await server.close();
  };
  let browser;
  try {
    await server.listen();
    browser = await launchBrowser(root);
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/poster-thumbnail-generator.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.posterThumbnailGenerator, null, { timeout: 30_000 });
    const bounded = async pending => {
      let timer;
      try {
        return await Promise.race([pending, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Poster thumbnail rendering timed out")), 120_000);
        })]);
      } finally { clearTimeout(timer); }
    };
    return {
      list: () => bounded(page.evaluate(() => window.posterThumbnailGenerator.templates)),
      prepare: (id, language) => bounded(page.evaluate(({ id, language }) => window.posterThumbnailGenerator.prepare(id, language === "zh"), { id, language })),
      render: (id, language) => bounded(page.evaluate(({ id, language }) => window.posterThumbnailGenerator.render(id, language === "zh"), { id, language })),
      close: async () => { await browser.close(); await closeServer(); },
    };
  } catch (error) {
    await browser?.close();
    await closeServer();
    throw error;
  }
}

async function acquireLock(root) {
  const file = path.join(root, "node_modules/.cache/edgeever/poster-thumbnails.lock");
  await mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => rm(file, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(file, "utf8").catch(() => ""));
      if (pid) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === "ESRCH") { await rm(file, { force: true }); continue; } }
      }
      if (Date.now() - started > 300_000) throw new Error("Timed out waiting for poster thumbnail generation");
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

export async function ensurePosterThumbnails({ root = projectRoot, output = path.join(root, "apps/web/src/assets/poster-template-previews"), renderer = openRenderer, log = console.log } = {}) {
  let state = await sourceState(root);
  if (await thumbnailsCurrent(output, state)) return { generated: 0, skipped: true };
  const release = await acquireLock(root);
  let runtime, temporary;
  try {
    state = await sourceState(root);
    if (await thumbnailsCurrent(output, state)) return { generated: 0, skipped: true };
    const previous = await readJson(path.join(output, "manifest.json"));
    const oldTemplates = new Map(previous?.templates?.map(template => [template.id, template]));
    log("[poster thumbnails] Checking changed templates");
    runtime = await renderer(root);
    const templates = await runtime.list();
    if (!templates.length || new Set(templates.map(template => template.id)).size !== templates.length) throw new Error("Invalid poster template catalog");
    temporary = await mkdtemp(path.join(tmpdir(), "edgeever-poster-thumbnails-"));
    let generated = 0;
    for (const template of templates) {
      if (!/^[a-z0-9-]+$/.test(template.id)) throw new Error("Invalid poster template ID");
      for (const language of languages) {
        const document = await runtime.prepare(template.id, language);
        const renderHash = digest(`${state.painterHash}\0${document}`);
        const previousAsset = oldTemplates.get(template.id)?.[language];
        if (previousAsset?.renderHash === renderHash && await validAsset(output, previousAsset)) {
          template[language] = previousAsset;
          continue;
        }
        const bytes = Buffer.from(await runtime.render(template.id, language), "base64");
        if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`Invalid WebP: ${template.id}`);
        const file = `${template.id}.${language}.webp`;
        await writeFile(path.join(temporary, file), bytes);
        template[language] = { file, sha256: digest(bytes), renderHash };
        generated++;
        log(`[poster thumbnails] Generated ${file}`);
      }
    }
    // A save during generation must not mark old code as synchronized. The dev
    // queue retries the latest source; builds fail rather than publish it.
    if ((await sourceState(root)).sourceHash !== state.sourceHash) throw new Error("Poster sources changed during generation; retrying the latest save is required");
    await mkdir(output, { recursive: true });
    for (const file of await readdir(temporary)) {
      const staged = path.join(output, `.${file}.tmp`);
      await writeFile(staged, await readFile(path.join(temporary, file)));
      await rename(staged, path.join(output, file));
    }
    const manifest = { version: 2, ...state, width: 480, height: 640, templates };
    const stagedManifest = path.join(output, ".manifest.json.tmp");
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(stagedManifest, path.join(output, "manifest.json"));
    const keep = new Set(templates.flatMap(template => languages.map(language => template[language].file)));
    for (const file of await readdir(output)) if (assetName.test(file) && !keep.has(file)) await rm(path.join(output, file));
    log(`[poster thumbnails] Updated ${generated} images; reused ${templates.length * 2 - generated}`);
    return { generated, skipped: false };
  } finally {
    try { await runtime?.close(); }
    finally {
      try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
      finally { await release(); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--check")) {
    if (!await thumbnailsCurrent(path.join(projectRoot, "apps/web/src/assets/poster-template-previews"), await sourceState())) throw new Error("Poster thumbnails are stale; normal dev/build will regenerate them automatically.");
    console.log("Poster thumbnails are current");
  } else {
    const result = await ensurePosterThumbnails();
    if (result.skipped) console.log("[poster thumbnails] Already current; no renderer needed");
  }
}
