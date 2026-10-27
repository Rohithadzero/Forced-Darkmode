// Content script entry (isolated world, document_start, all frames).
// Decides per page: off / native-dark / filter engine / CSS engine, and keeps that decision live.

import { parseColor } from '../shared/color';
import type { PageMode, StatusResult, ToContent } from '../shared/messages';
import { sendToWorker } from '../shared/messages';
import { scheduleAllows } from '../shared/schedule';
import { loadSettings, normalizeSettings, patchSite, SETTINGS_KEY, TICK_KEY, updateSettings, type Settings } from '../shared/settings';
import { effectiveConfig, isExcludedUrl, siteKey, siteKeyFromUrl, type EffectiveConfig } from '../shared/site';
import { THEMES } from '../shared/themes';
import { paramsSignature, SheetCache } from './css-engine/cache';
import { CssEngine } from './css-engine/engine';
import { createMapper } from './css-engine/map-color';
import { contrastLooksBroken, isChallengePage, isNativelyDark, STATE_ATTR } from './detect';
import { UserCssInjector } from './injector';
import { DomWatcher } from './observer';
import { baseCss, filterCss } from './page-css';

const ENGINE_VERSION = 1;
const UNREADABLE_LIMIT = 0.4;
const CONTRAST_CHECK_DELAY = 1500;

const html = document.documentElement;
const isTop = window === window.top;
const host = pageSiteKey();
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let settings: Settings;
let mode: PageMode = 'pending';
let engine: CssEngine | null = null;
let watcher: DomWatcher | null = null;
let filterInjector: UserCssInjector | null = null;
let appliedKey = '';
let generation = 0;

function pageSiteKey(): string | null {
  const key = siteKeyFromUrl(location.href);
  if (key) return key;
  // about:blank / srcdoc frames inherit their embedder's site.
  const origin = location.ancestorOrigins?.[0];
  try {
    return origin ? siteKey(new URL(origin).hostname) : null;
  } catch {
    return null;
  }
}

function setMode(m: PageMode): void {
  mode = m;
  // Any value lifts the pre-paint guard (it matches html:not([data-fdm])).
  if (m !== 'pending') html.setAttribute(STATE_ATTR, m);
  if (isTop) sendToWorker({ type: 'status', mode: m }).catch(() => undefined);
}

function isActive(cfg: EffectiveConfig): boolean {
  if (!cfg.enabled) return false;
  if (!scheduleAllows(settings.schedule, new Date())) return false;
  return settings.schedule.mode !== 'system' || darkQuery.matches;
}

function bodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      mo.disconnect();
      resolve();
    };
    const mo = new MutationObserver(() => document.body && done());
    mo.observe(html, { childList: true });
    document.addEventListener('DOMContentLoaded', done, { once: true });
  });
}

async function teardown(): Promise<void> {
  watcher?.disconnect();
  watcher = null;
  const e = engine;
  engine = null;
  const f = filterInjector;
  filterInjector = null;
  await Promise.all([e?.stop(), f?.clear()]);
}

async function apply(): Promise<void> {
  const cfg = effectiveConfig(settings, host);
  const active = isActive(cfg);
  const key = JSON.stringify([cfg, active]);
  if (key === appliedKey) return;
  appliedKey = key;
  const gen = ++generation;
  await teardown();
  if (gen !== generation) return;

  if (!active) return setMode('off');
  // Re-arm the pre-paint guard while the new engine spins up, so switching themes doesn't flash.
  if (mode !== 'pending') html.removeAttribute(STATE_ATTR);
  const choice = cfg.engine === 'auto' ? (cfg.fallback ?? 'auto') : cfg.engine;
  if (choice === 'auto' && isNativelyDark()) return setMode('native');
  if (choice === 'filter') return startFilter(cfg);
  return startCss(cfg, gen, choice === 'css');
}

async function startFilter(cfg: EffectiveConfig): Promise<void> {
  filterInjector = new UserCssInjector();
  await filterInjector.setKeyed('filter', filterCss(THEMES[cfg.theme], cfg));
  setMode('filter');
}

async function startCss(cfg: EffectiveConfig, gen: number, forced: boolean): Promise<void> {
  const theme = THEMES[cfg.theme];
  const params = { theme, brightness: cfg.brightness, contrast: cfg.contrast, sepia: cfg.sepia };
  const map = createMapper(params);
  const cache = new SheetCache(paramsSignature([ENGINE_VERSION, theme, params.brightness, params.contrast, params.sepia]));
  await cache.preload(Array.from(document.styleSheets, (s) => s.href).filter((h): h is string => !!h));
  if (gen !== generation) return;

  const e = new CssEngine(params, true, cache, baseCss(theme, cfg, map));
  engine = e;
  await e.start();
  if (gen !== generation) return;

  if (!forced && (e.stats.tooLarge || (e.stats.sheets > 2 && e.stats.unreadable / e.stats.sheets > UNREADABLE_LIMIT))) {
    return fallBackToFilter();
  }
  setMode('css');

  watcher = new DomWatcher(e);
  watcher.observe(document);
  const refresh = () => {
    if (engine !== e) return;
    e.markSheets();
    e.discoverShadowRoots();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  const onLoad = () => {
    refresh();
    if (!forced) setTimeout(() => runContrastCheck(e, cfg), CONTRAST_CHECK_DELAY);
  };
  if (document.readyState === 'complete') onLoad();
  else addEventListener('load', onLoad, { once: true });
}

function runContrastCheck(e: CssEngine, cfg: EffectiveConfig): void {
  if (engine !== e || document.hidden) return;
  const pageBg = createMapper({ theme: THEMES[cfg.theme], brightness: cfg.brightness, contrast: cfg.contrast, sepia: cfg.sepia })(
    parseColor('#fff')!,
    'bg',
  );
  if (contrastLooksBroken(pageBg)) void fallBackToFilter();
}

/** Switches this page to the filter engine; the top frame remembers it for the site. */
async function fallBackToFilter(): Promise<void> {
  if (isTop && host) {
    await updateSettings((s) => patchSite(s, host, { fallback: 'filter' })).catch(() => undefined);
    return; // storage change re-runs apply()
  }
  settings = { ...settings, sites: { ...settings.sites, [host ?? '']: { ...(host ? settings.sites[host] : {}), fallback: 'filter' } } };
  await apply();
}

// Engine-side events from the main-world hooks.
document.addEventListener(
  '__fdm_dirty',
  () => engine?.markSheets(),
  true,
);
document.addEventListener(
  '__fdm_shadow',
  (ev) => {
    const hostEl = ev.composedPath()[0] as Element | undefined;
    const sr = hostEl?.shadowRoot;
    if (!sr || !engine) return;
    engine.addShadowRoot(sr);
    watcher?.observe(sr);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, respond) => {
  if (msg?.type !== 'status:get') return;
  const res: StatusResult = { mode, host, nativeMedia: (engine?.st.darkDecls ?? 0) > 0 };
  respond(res);
});

async function main(): Promise<void> {
  if (!(document instanceof HTMLDocument) || html?.localName !== 'html') return;
  if (isExcludedUrl(location.href)) return setMode('excluded');
  try {
    settings = await loadSettings();
  } catch {
    return; // extension context gone
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    // apply() is a no-op unless this page's effective config or active state changed.
    if (changes[SETTINGS_KEY] || changes[TICK_KEY]) void apply();
  });
  darkQuery.addEventListener('change', () => {
    if (settings.schedule.mode === 'system') void apply();
  });
  await bodyReady();
  if (isChallengePage()) return setMode('excluded');
  await apply();
}

void main();
