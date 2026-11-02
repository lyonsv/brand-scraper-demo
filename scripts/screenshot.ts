/**
 * Drives the UI in headless Chromium: submits a URL, waits for the scan to complete and saves
 * screenshots (mid-scan, full page, demo preview).
 *
 *   pnpm shot stripe.com [outDir]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const target = process.argv[2] ?? "stripe.com";
const outDir = path.resolve(process.argv[3] ?? "screenshots");
const width = Number(process.env.WIDTH ?? 1440);

async function main() {
  mkdirSync(outDir, { recursive: true });
  const slug = target.replace(/[^a-z0-9]+/gi, "-");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, `${slug}-${width}-0-idle.png`) });
  await page.fill("#url", target);
  await page.click("button[type=submit]");
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(outDir, `${slug}-${width}-1-scanning.png`) });
  await page.waitForSelector("text=Complete, text=Try another URL", { timeout: 100_000 }).catch(() => undefined);
  await page.waitForFunction(() => /Complete|Try another URL/.test(document.body.innerText), undefined, { timeout: 100_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `${slug}-${width}-2-full.png`), fullPage: true });
  const demo = page.locator("#demo-title");
  if (await demo.count()) {
    await demo.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await page.locator("section[aria-labelledby=demo-title]").screenshot({ path: path.join(outDir, `${slug}-${width}-3-demo.png`) });
    await page.getByRole("radio", { name: /mobile/i }).click();
    await page.waitForTimeout(1500);
    await page.locator("section[aria-labelledby=demo-title]").screenshot({ path: path.join(outDir, `${slug}-${width}-4-demo-mobile.png`) });
  }
  console.log(`saved to ${outDir}`);
  if (errors.length) console.log("console errors:\n" + errors.slice(0, 10).join("\n"));
  await browser.close();
}

void main();
