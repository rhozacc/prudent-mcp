/**
 * Capture the above-the-fold docs hero and write it to docs/public/docs-hero.png.
 * Used by .github/workflows/docs-hero.yml to keep the README image in sync
 * with whatever the docs landing page currently looks like.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const URL = "http://127.0.0.1:4173/prudent-mcp/";
const OUT = "docs/public/docs-hero.png";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".VPHero", { timeout: 15_000 });
// Let webfonts settle so the Caslon-style hero text renders, not a fallback.
await page.evaluate(() => (document as any).fonts?.ready);

await mkdir(dirname(OUT), { recursive: true });
await page.screenshot({
  path: OUT,
  clip: { x: 0, y: 0, width: 1440, height: 900 },
});

await browser.close();
console.log(`Wrote ${OUT}`);
