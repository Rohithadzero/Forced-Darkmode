// Manual visual + perf probe (not part of the test suite):
//   node --experimental-strip-types tests/e2e/visual.manual.ts <outDir> [url ...]
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [outDir, ...urls] = process.argv.slice(2);
const dist = resolve(import.meta.dirname, '../../dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fdm-v-')), {
  channel: 'chromium',
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;

for (const [i, url] of urls.entries()) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    (window as any).__longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__longTasks.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => console.log('nav', url, e.message));
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    mode: document.documentElement.dataset.fdm,
    body: getComputedStyle(document.body).backgroundColor,
    longTasks: (window as any).__longTasks,
  }));
  console.log(url, `${Date.now() - t0}ms`, JSON.stringify(info));
  await page.screenshot({ path: join(outDir, `site-${i}.png`) });
  await page.close();
}

const popup = await ctx.newPage();
await popup.setViewportSize({ width: 320, height: 560 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForTimeout(500);
await popup.screenshot({ path: join(outDir, 'popup.png') });
const opts = await ctx.newPage();
await opts.goto(`chrome-extension://${extId}/options/options.html`);
await opts.waitForTimeout(500);
await opts.screenshot({ path: join(outDir, 'options.png'), fullPage: true });
await ctx.close();
