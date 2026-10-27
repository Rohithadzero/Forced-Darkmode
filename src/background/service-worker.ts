// Service worker: owns the pre-paint registration, schedule alarms, keyboard commands,
// USER-origin CSS injection on behalf of pages, cross-origin stylesheet fetches and the badge.

import type { FetchResult, PageMode, ToWorker } from '../shared/messages';
import { nextBoundary, scheduleAllows } from '../shared/schedule';
import { loadSettings, patchSite, SETTINGS_KEY, TICK_KEY, updateSettings, type Settings } from '../shared/settings';
import { effectiveConfig, EXCLUDED_MATCHES, siteKeyFromUrl, siteMatchPatterns } from '../shared/site';
import { THEME_IDS } from '../shared/themes';

const PREPAINT_ID = 'fdm-prepaint';
const ALARM = 'fdm-schedule';
const MAX_CSS_BYTES = 3 * 1024 * 1024;

// ---------- pre-paint guard ----------

async function syncPrepaint(s: Settings): Promise<void> {
  const active = s.enabled && scheduleAllows(s.schedule, new Date());
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PREPAINT_ID] });
  if (!active) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [PREPAINT_ID] });
    return;
  }
  const disabled = Object.entries(s.sites)
    .filter(([, site]) => site.enabled === false)
    .flatMap(([key]) => siteMatchPatterns(key));
  const script: chrome.scripting.RegisteredContentScript = {
    id: PREPAINT_ID,
    matches: ['<all_urls>'],
    excludeMatches: [...EXCLUDED_MATCHES, ...disabled],
    css: [`prepaint/${s.theme}${s.schedule.mode === 'system' ? '-system' : ''}.css`],
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  };
  try {
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (err) {
    console.warn('prepaint registration failed', err);
  }
}

async function syncSchedule(s: Settings): Promise<void> {
  await chrome.alarms.clear(ALARM);
  const next = s.enabled ? nextBoundary(s.schedule, new Date()) : null;
  if (next) await chrome.alarms.create(ALARM, { when: next.getTime() + 1000 });
}

async function syncAll(): Promise<void> {
  const s = await loadSettings();
  await Promise.all([syncPrepaint(s), syncSchedule(s)]);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') await updateSettings(() => undefined); // persist defaults
  await syncAll();
});
chrome.runtime.onStartup.addListener(() => void syncAll());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) void syncAll();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await syncAll();
  await chrome.storage.local.set({ [TICK_KEY]: Date.now() });
});

// ---------- messages from pages ----------

const BADGE: Record<PageMode, { text: string; color: string }> = {
  css: { text: '', color: '#000' },
  filter: { text: 'F', color: '#5b6b8c' },
  native: { text: 'N', color: '#3d7a57' },
  off: { text: 'off', color: '#777' },
  excluded: { text: '–', color: '#777' },
  pending: { text: '', color: '#000' },
};

async function fetchCss(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) return { ok: false };
    const type = res.headers.get('content-type') ?? '';
    if (type && !/css|text\/plain|octet-stream/.test(type)) return { ok: false };
    const text = await res.text();
    return text.length > MAX_CSS_BYTES ? { ok: false } : { ok: true, text };
  } catch {
    return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((msg: ToWorker, sender, respond) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const target: chrome.scripting.InjectionTarget = sender.documentId
    ? { tabId, documentIds: [sender.documentId] }
    : { tabId, frameIds: [sender.frameId ?? 0] };

  switch (msg.type) {
    case 'css:insert':
      chrome.scripting.insertCSS({ target, css: msg.css, origin: 'USER' }).then(
        () => respond(true),
        () => respond(false),
      );
      return true;
    case 'css:remove':
      chrome.scripting.removeCSS({ target, css: msg.css, origin: 'USER' }).then(
        () => respond(true),
        () => respond(false),
      );
      return true;
    case 'css:fetch':
      fetchCss(msg.url).then(respond);
      return true;
    case 'status': {
      const b = BADGE[msg.mode];
      chrome.action.setBadgeText({ tabId, text: b.text }).catch(() => undefined);
      if (b.text) chrome.action.setBadgeBackgroundColor({ tabId, color: b.color }).catch(() => undefined);
      return;
    }
  }
});

// ---------- keyboard commands ----------

chrome.commands.onCommand.addListener(async (command, tab) => {
  const key = siteKeyFromUrl(tab?.url);
  await updateSettings((s) => {
    if (command === 'toggle-global') s.enabled = !s.enabled;
    else if (command === 'cycle-theme') s.theme = THEME_IDS[(THEME_IDS.indexOf(s.theme) + 1) % THEME_IDS.length];
    else if (command === 'toggle-site' && key) {
      const on = effectiveConfig(s, key).enabled;
      if (!s.enabled && !on) {
        s.enabled = true;
        patchSite(s, key, { enabled: undefined });
      } else patchSite(s, key, { enabled: on ? false : undefined });
    }
  });
});
