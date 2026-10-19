// Run against `bun run dev`. Uses installed Google Chrome and isolated fixture
// pages, without opening a user profile or touching workspace notes.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const origin = process.env.EDGE_EVER_BROWSER_TEST_URL ?? "http://127.0.0.1:5173";
const fixture = `${origin}/@fs${process.cwd()}/tests/browser/poster-previews.html`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const open = async (setup) => {
  const page = await browser.newPage();
  if (setup) await page.addInitScript(setup);
  await page.goto(fixture);
  await page.waitForFunction(() => window.posterPreviewTest);
  return page;
};
const retryFirst = page => page.locator("[data-poster-template]").first().locator("..").getByRole("button", { name: "重试预览", exact: true });
const firstReady = page => page.waitForFunction(() => {
  const cards = [...document.querySelectorAll("[data-poster-template]")].slice(0, 6);
  return cards.length === 6 && cards.every(card => card.querySelector("img")?.naturalWidth > 0);
}, null, { timeout: 14_000 });
try {
  const page = await open();
  const results = await page.evaluate(() => Promise.all(window.posterPreviewTest.templateIds.map(window.posterPreviewTest.checkPoster)));
  assert.deepEqual(results.filter(result => !result.ok), [], "All template thumbnails must render");
  await firstReady(page);
  assert.equal(await page.locator('[role="tooltip"]').count(), 0);
  console.log(`PASS: all ${results.length} templates render; visible cards show previews`);

  await page.screenshot({ path: "/tmp/edgeever-poster-previews-fixed.png" });
  await page.close();

  // Use fresh pages so a previous render cannot satisfy an error assertion.
  const failed = await open(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); };
  });
  await retryFirst(failed).waitFor({ timeout: 14_000 });
  assert.equal(await failed.locator('[data-poster-template]').first().getAttribute("aria-busy"), "false");
  await failed.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });
  await retryFirst(failed).focus();
  await failed.keyboard.press("Enter");
  await failed.locator('[data-poster-template]').first().locator('img').waitFor();
  console.log("PASS: canvas export failure ends loading; retry recovers");
  await failed.close();

  // A canvas callback that never arrives must also leave loading within 15s.
  const stalled = await open(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    window.lateExports = [];
    HTMLCanvasElement.prototype.toBlob = function(callback) { window.lateExports.push([this, callback]); };
  });
  await retryFirst(stalled).waitFor({ timeout: 18_000 });
  await stalled.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });
  await retryFirst(stalled).click();
  await stalled.locator('[data-poster-template]').first().locator('img').waitFor();
  // Deliver the previous attempt's result late: it must be released, not replace
  // the successful retry or switch the card back to a failed/loading state.
  await stalled.evaluate(async () => {
    const before = document.querySelector('[data-poster-template] img')?.getAttribute('src');
    await Promise.all(window.lateExports.map(([canvas, callback]) => new Promise(resolve => {
      window.originalToBlob.call(canvas, blob => { callback(blob); resolve(); });
    })));
    await new Promise(resolve => setTimeout(resolve, 100));
    if (document.querySelector('[data-poster-template] img')?.getAttribute('src') !== before) throw new Error('Late preview replaced retry');
  });
  console.log("PASS: stalled export times out; retry succeeds; late results are ignored");
  await stalled.close();

  const slow = await browser.newPage();
  // Leave both local font assets and remote font requests unanswered. This
  // reproduced blank previews before the whole font preparation was bounded.
  await slow.route("**/*", route => ["xhr", "font"].includes(route.request().resourceType()) ? undefined : route.continue());
  await slow.goto(fixture);
  await slow.waitForFunction(() => window.posterPreviewTest);
  await firstReady(slow);
  console.log("PASS: stalled font requests still produce fallback thumbnails");
  await slow.close();
} finally {
  await browser.close();
}
