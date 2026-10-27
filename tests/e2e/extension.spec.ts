import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = 4517;
const ORIGIN = `http://localhost:${PORT}`;
const fixtures = resolve(import.meta.dirname, 'fixtures');
const dist = resolve(import.meta.dirname, '../../dist');

let server: Server;
let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    try {
      const body = readFileSync(join(fixtures, path));
      const headers: Record<string, string> = {
        'content-type': path.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
      };
      if (path === '/csp.html') headers['content-security-policy'] = "style-src 'self'; script-src 'none'";
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(PORT);

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fdm-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

async function setSettings(patch: Record<string, unknown>) {
  await worker.evaluate(async (p) => {
    const cur = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...cur, ...p } });
  }, patch);
}

async function resetSettings() {
  await worker.evaluate(() => chrome.storage.local.clear());
  await setSettings({ enabled: true, theme: 'gray', sites: {} });
}

/** OKLab-ish lightness proxy from a computed rgb() string (0..1). */
async function lum(page: Page, selector: string, prop: 'backgroundColor' | 'color') {
  const v = await page.$eval(selector, (el, p) => getComputedStyle(el)[p], prop);
  const [r, g, b] = v.match(/[\d.]+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function open(path: string) {
  const page = await context.newPage();
  await page.goto(ORIGIN + path);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-fdm') && document.documentElement.dataset.fdm !== 'probe');
  return page;
}

test.beforeEach(resetSettings);

test('registers the pre-paint guard', async () => {
  const ids = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  expect(ids).toContain('fdm-prepaint');
});

test('CSS engine darkens a light page', async () => {
  const page = await open('/light.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'css');
  expect(await lum(page, 'body', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#text', 'color')).toBeGreaterThan(0.6);
  expect(await lum(page, '#card', 'backgroundColor')).toBeLessThan(0.25);
  expect(await lum(page, '#var-card', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#var-card', 'color')).toBeGreaterThan(0.6);
  expect(await lum(page, '#shorthand', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#imp', 'color')).toBeGreaterThan(0.6);
  expect(await lum(page, '#inline', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#inline', 'color')).toBeGreaterThan(0.6);
  expect(await lum(page, '#btn', 'color')).toBeGreaterThan(0.6);
  // shorthand background keeps its image
  expect(await page.$eval('#shorthand', (el) => getComputedStyle(el).backgroundImage)).toContain('url(');
  // gradients remapped, including var() inside a background shorthand on a pseudo-element
  expect(await page.$eval('#grad', (el) => getComputedStyle(el).backgroundImage)).not.toContain('255, 255, 255');
  expect(await page.$eval('#fade', (el) => getComputedStyle(el, '::after').backgroundImage)).not.toContain('rgb(255, 255, 255)');
  await page.close();
});

test('cross-origin stylesheets are fetched and remapped', async () => {
  const page = await open('/light.html');
  await expect.poll(() => lum(page, '#cross', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#cross', 'color')).toBeGreaterThan(0.6);
  await page.close();
});

test('site dark-scheme rules are applied natively', async () => {
  const page = await open('/light.html');
  expect(await page.$eval('#native-dark', (el) => getComputedStyle(el).color)).toBe('rgb(1, 2, 3)');
  await page.close();
});

test('already-dark sites are left alone', async () => {
  const page = await open('/dark.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'native');
  expect(await page.$eval('body', (el) => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 18, 18)');
  await page.close();
});

test('works under a strict CSP', async () => {
  const page = await open('/csp.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'css');
  expect(await lum(page, 'body', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#text', 'color')).toBeGreaterThan(0.6);
  await page.close();
});

test('tracks insertRule, late inline styles and shadow DOM', async () => {
  const page = await open('/dynamic.html');
  await page.waitForSelector('#late');
  await expect.poll(() => lum(page, '#late', 'backgroundColor'), { timeout: 5000 }).toBeLessThan(0.2);
  await expect.poll(() => lum(page, '#late-inline', 'backgroundColor'), { timeout: 5000 }).toBeLessThan(0.2);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('x-card')!.shadowRoot!.querySelector('.in')!).backgroundColor), { timeout: 5000 })
    .not.toBe('rgb(255, 255, 255)');
  await page.close();
});

test('legacy color attributes (bgcolor, font color) are remapped', async () => {
  const page = await open('/legacy.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'css');
  expect(await lum(page, '#tbl', 'backgroundColor')).toBeLessThan(0.2);
  expect(await lum(page, '#font', 'color')).toBeGreaterThan(0.6);
  expect(await lum(page, '#hdr', 'backgroundColor')).toBeLessThan(0.45);
  await page.close();
});

test('OLED theme uses pure black', async () => {
  await setSettings({ theme: 'oled' });
  const page = await open('/light.html');
  expect(await page.$eval('body', (el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.close();
});

test('filter engine when chosen for a site', async () => {
  await setSettings({ sites: { localhost: { engine: 'filter' } } });
  const page = await open('/light.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'filter');
  expect(await page.$eval('html', (el) => getComputedStyle(el).filter)).toContain('invert(1)');
  await page.close();
});

test('disabling a site restores it live', async () => {
  const page = await open('/light.html');
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'css');
  await setSettings({ sites: { localhost: { enabled: false } } });
  await expect(page.locator('html')).toHaveAttribute('data-fdm', 'off');
  await expect.poll(() => page.$eval('body', (el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.close();
});

test('main-world hooks keep natives looking native', async () => {
  const page = await open('/light.html');
  const s = await page.evaluate(() => [CSSStyleSheet.prototype.insertRule.toString(), Element.prototype.attachShadow.toString()]);
  for (const v of s) expect(v).toContain('[native code]');
  await page.close();
});
