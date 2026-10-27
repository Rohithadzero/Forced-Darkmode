import type { PageMode, StatusResult, ToContent } from '../shared/messages';
import { loadSettings, patchSite, SETTINGS_KEY, updateSettings, type Adjustments, type Engine, type Settings } from '../shared/settings';
import { effectiveConfig, siteKeyFromUrl } from '../shared/site';
import { THEMES, THEME_IDS, type ThemeId } from '../shared/themes';

type Scope = 'global' | 'site';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUS: Record<PageMode, [string, string]> = {
  css: ['Dark (CSS engine)', '#7fd19b'],
  filter: ['Dark (filter engine)', '#8ab4f8'],
  native: ['Site is already dark, left as is', '#c9b46a'],
  off: ['Off on this page', '#777'],
  excluded: ['Skipped (security check page)', '#777'],
  pending: ['Starting…', '#777'],
};

let settings: Settings;
let host: string | null = null;
let tabId: number | undefined;
let status: StatusResult | null = null;
let scope: Scope = 'global';

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  host = siteKeyFromUrl(tab?.url);
  settings = await loadSettings();
  if (host && settings.sites[host] && hasAppearanceOverrides(host)) scope = 'site';
  buildThemes();
  bind();
  render();
  await refreshStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    void loadSettings().then((s) => {
      settings = s;
      render();
      setTimeout(refreshStatus, 350);
    });
  });
}

function hasAppearanceOverrides(key: string): boolean {
  const s = settings.sites[key] ?? {};
  return ['theme', 'brightness', 'contrast', 'sepia', 'dimImages'].some((k) => k in s);
}

async function refreshStatus() {
  if (tabId === undefined || !host) return renderStatus();
  try {
    const msg: ToContent = { type: 'status:get' };
    status = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    status = null;
  }
  renderStatus();
}

function buildThemes() {
  const box = $('themes');
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    const b = document.createElement('button');
    b.className = 'theme';
    b.dataset.theme = id;
    b.innerHTML = `<div class="swatch" style="background:${t.bg}"><i style="background:${t.text}"></i><i style="background:${t.muted}"></i><i style="background:${t.link}"></i></div>`;
    b.append(t.label);
    box.append(b);
  }
}

const save = (fn: (s: Settings) => void) => updateSettings(fn).then((s) => ((settings = s), render()));

function setAppearance(patch: Partial<Adjustments> & { theme?: ThemeId }) {
  return save((s) => {
    if (scope === 'site' && host) {
      patchSite(s, host, patch);
    } else {
      if (patch.theme) s.theme = patch.theme;
      const { theme: _t, ...adj } = patch;
      Object.assign(s.defaults, adj);
    }
  });
}

function bind() {
  $<HTMLInputElement>('global').addEventListener('change', (e) => save((s) => (s.enabled = (e.target as HTMLInputElement).checked)));

  $<HTMLInputElement>('site-on').addEventListener('change', (e) => {
    if (!host) return;
    const on = (e.target as HTMLInputElement).checked;
    void save((s) => patchSite(s, host!, { enabled: on ? undefined : false }));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => {
      scope = b.dataset.scope as Scope;
      render();
    }),
  );

  $('themes').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-theme]');
    if (b) void setAppearance({ theme: b.dataset.theme as ThemeId });
  });

  for (const id of ['brightness', 'contrast', 'sepia'] as const) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('input', () => ((input.nextElementSibling as HTMLOutputElement).value = input.value));
    // Commit on release only: each commit re-themes open pages.
    input.addEventListener('change', () => void setAppearance({ [id]: +input.value }));
  }
  $<HTMLInputElement>('dim-images').addEventListener('change', (e) => void setAppearance({ dimImages: (e.target as HTMLInputElement).checked }));

  $('reset-site').addEventListener('click', () => {
    if (!host) return;
    void save((s) => patchSite(s, host!, { theme: undefined, brightness: undefined, contrast: undefined, sepia: undefined, dimImages: undefined }));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-engine]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!host) return;
      const engine = b.dataset.engine as Engine;
      void save((s) => patchSite(s, host!, { engine: engine === 'auto' ? undefined : engine, fallback: undefined }));
    }),
  );
  $('retry-css').addEventListener('click', () => host && void save((s) => patchSite(s, host!, { fallback: undefined, engine: 'css' })));

  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function render() {
  const cfg = effectiveConfig(settings, host);
  $<HTMLInputElement>('global').checked = settings.enabled;

  $('host').textContent = host ?? 'This page';
  const siteOn = $<HTMLInputElement>('site-on');
  siteOn.checked = !!host && cfg.enabled;
  siteOn.disabled = !host || !settings.enabled;

  // Scope tabs
  const canSite = !!host;
  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.scope === scope));
    if (b.dataset.scope === 'site') b.disabled = !canSite;
  });
  if (!canSite) scope = 'global';

  const view: Adjustments & { theme: ThemeId } =
    scope === 'site' ? { ...cfg } : { ...settings.defaults, theme: settings.theme };
  document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === view.theme)));
  for (const id of ['brightness', 'contrast', 'sepia'] as const) {
    const input = $<HTMLInputElement>(id);
    input.value = String(view[id]);
    (input.nextElementSibling as HTMLOutputElement).value = input.value;
  }
  $<HTMLInputElement>('dim-images').checked = view.dimImages;
  $('reset-site').hidden = !(scope === 'site' && host && hasAppearanceOverrides(host));

  // Engine (always per site)
  const site = host ? settings.sites[host] : undefined;
  const engine = site?.engine ?? 'auto';
  document.querySelectorAll<HTMLButtonElement>('[data-engine]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.engine === engine));
    b.disabled = !host;
  });
  $('engine-hint').textContent = engine === 'auto' ? 'picks the best per site' : engine === 'css' ? 'best colors' : 'works everywhere';
  $('retry-css').hidden = !(engine === 'auto' && site?.fallback === 'filter');

  const active = settings.enabled && cfg.enabled;
  $('appearance').classList.toggle('disabled', !settings.enabled);
  $('engine-box').classList.toggle('disabled', !active || !host);

  const sch = settings.schedule;
  $('schedule').textContent =
    sch.mode === 'always' ? 'Always on' : sch.mode === 'system' ? 'Follows system theme' : `Scheduled ${sch.from}–${sch.to}`;
  renderStatus();
}

function renderStatus() {
  const el = $('status');
  const note = $('site-note');
  if (!host) {
    el.textContent = 'Browser pages cannot be themed';
    el.style.setProperty('--dot', '#777');
    note.hidden = true;
    return;
  }
  if (!status) {
    el.textContent = 'Reload the page to apply';
    el.style.setProperty('--dot', '#c9b46a');
    note.hidden = true;
    return;
  }
  const [label, color] = STATUS[status.mode];
  el.textContent = label;
  el.style.setProperty('--dot', color);
  note.hidden = status.mode !== 'native';
  note.textContent = 'Choose CSS or Filter below to darken it anyway.';
}

void init();
