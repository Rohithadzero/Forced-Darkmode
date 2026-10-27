import { isThemeId, type ThemeId } from './themes';

export type Engine = 'auto' | 'css' | 'filter';
export type ScheduleMode = 'always' | 'system' | 'time';

export interface Adjustments {
  brightness: number; // 50..150, 100 = neutral
  contrast: number; // 50..150
  sepia: number; // 0..100
  dimImages: boolean;
}

export interface SiteSettings extends Partial<Adjustments> {
  enabled?: boolean;
  theme?: ThemeId;
  engine?: Engine;
  /** Set automatically when the CSS engine produced unreadable text on this site. */
  fallback?: 'filter';
}

export interface Schedule {
  mode: ScheduleMode;
  from: string; // "HH:MM"
  to: string;
}

export interface Settings {
  version: 1;
  enabled: boolean;
  theme: ThemeId;
  schedule: Schedule;
  defaults: Adjustments;
  sites: Record<string, SiteSettings>;
}

export const SETTINGS_KEY = 'settings';
/** Bumped by the service worker on schedule boundaries so pages re-evaluate. */
export const TICK_KEY = 'tick';

export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 100, contrast: 100, sepia: 0, dimImages: false };

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  theme: 'gray',
  schedule: { mode: 'always', from: '19:00', to: '07:00' },
  defaults: { ...DEFAULT_ADJUSTMENTS },
  sites: {},
};

const ENGINES: Engine[] = ['auto', 'css', 'filter'];
const SCHEDULE_MODES: ScheduleMode[] = ['always', 'system', 'time'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const clampNum = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function normalizeAdjustments(raw: Partial<Adjustments> | undefined, base: Adjustments): Adjustments {
  return {
    brightness: clampNum(raw?.brightness, 50, 150, base.brightness),
    contrast: clampNum(raw?.contrast, 50, 150, base.contrast),
    sepia: clampNum(raw?.sepia, 0, 100, base.sepia),
    dimImages: typeof raw?.dimImages === 'boolean' ? raw.dimImages : base.dimImages,
  };
}

function normalizeSite(raw: unknown): SiteSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: SiteSettings = {};
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  if (isThemeId(r.theme)) out.theme = r.theme;
  if (ENGINES.includes(r.engine as Engine)) out.engine = r.engine as Engine;
  if (r.fallback === 'filter') out.fallback = 'filter';
  if (typeof r.brightness === 'number') out.brightness = clampNum(r.brightness, 50, 150, 100);
  if (typeof r.contrast === 'number') out.contrast = clampNum(r.contrast, 50, 150, 100);
  if (typeof r.sepia === 'number') out.sepia = clampNum(r.sepia, 0, 100, 0);
  if (typeof r.dimImages === 'boolean') out.dimImages = r.dimImages;
  return Object.keys(out).length ? out : null;
}

/** Validates anything read from storage or imported from a file into a complete Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const sched = (r.schedule ?? {}) as Partial<Schedule>;
  const sites: Record<string, SiteSettings> = {};
  if (r.sites && typeof r.sites === 'object') {
    for (const [host, site] of Object.entries(r.sites)) {
      const s = normalizeSite(site);
      if (s && host) sites[host.toLowerCase()] = s;
    }
  }
  return {
    version: 1,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    theme: isThemeId(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    schedule: {
      mode: SCHEDULE_MODES.includes(sched.mode as ScheduleMode) ? (sched.mode as ScheduleMode) : 'always',
      from: TIME_RE.test(sched.from ?? '') ? sched.from! : DEFAULT_SETTINGS.schedule.from,
      to: TIME_RE.test(sched.to ?? '') ? sched.to! : DEFAULT_SETTINGS.schedule.to,
    },
    defaults: normalizeAdjustments(r.defaults, DEFAULT_ADJUSTMENTS),
    sites,
  };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

export async function updateSettings(fn: (s: Settings) => void): Promise<Settings> {
  const s = await loadSettings();
  fn(s);
  const clean = normalizeSettings(s);
  await saveSettings(clean);
  return clean;
}

/** Merges or clears a site's overrides; removes the entry entirely when empty. */
export function patchSite(s: Settings, host: string, patch: Partial<Record<keyof SiteSettings, unknown>>): void {
  const cur: Record<string, unknown> = { ...(s.sites[host] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete cur[k];
    else cur[k] = v;
  }
  const clean = normalizeSite(cur);
  if (clean) s.sites[host] = clean;
  else delete s.sites[host];
}
