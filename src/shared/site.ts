import type { Adjustments, Engine, Settings } from './settings';
import type { ThemeId } from './themes';

/** Pages where touching styles breaks things (bot checks) or that are already dark UIs. */
export const EXCLUDED_HOSTS = [
  'challenges.cloudflare.com',
  'hcaptcha.com',
  'newassets.hcaptcha.com',
  'www.recaptcha.net',
  'recaptcha.net',
];
const EXCLUDED_URL_PREFIXES = ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'];

/** Match patterns for the same exclusions, used by registered content scripts. */
export const EXCLUDED_MATCHES = [
  ...EXCLUDED_HOSTS.map((h) => `*://${h}/*`),
  ...EXCLUDED_URL_PREFIXES.map((p) => p + '*'),
];

/** Storage key for a site: lowercase hostname without a leading "www.". */
export function siteKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function siteKeyFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return null;
    return u.protocol === 'file:' ? 'file' : siteKey(u.hostname);
  } catch {
    return null;
  }
}

export function isExcludedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return EXCLUDED_HOSTS.includes(u.hostname) || EXCLUDED_URL_PREFIXES.some((p) => url.startsWith(p));
  } catch {
    return false;
  }
}

export function siteMatchPatterns(key: string): string[] {
  if (key === 'file') return ['file:///*'];
  return [`*://${key}/*`, `*://www.${key}/*`];
}

export interface EffectiveConfig extends Adjustments {
  enabled: boolean;
  theme: ThemeId;
  engine: Engine;
  /** Engine forced by an earlier failed contrast check (only used when engine is auto). */
  fallback: 'filter' | null;
}

export function effectiveConfig(s: Settings, key: string | null): EffectiveConfig {
  const site = (key && s.sites[key]) || {};
  return {
    enabled: s.enabled && site.enabled !== false,
    theme: site.theme ?? s.theme,
    engine: site.engine ?? 'auto',
    fallback: site.fallback ?? null,
    brightness: site.brightness ?? s.defaults.brightness,
    contrast: site.contrast ?? s.defaults.contrast,
    sepia: site.sepia ?? s.defaults.sepia,
    dimImages: site.dimImages ?? s.defaults.dimImages,
  };
}
