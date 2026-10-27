// Page inspection: native dark detection, bot-check pages, and the post-apply contrast check.

import { composite, contrastRatio, parseColor, rgbToOklch, type RGBA } from '../shared/color';

export const STATE_ATTR = 'data-fdm';

/** Runs `fn` with the pre-paint guard lifted so computed styles show the page's own colors. */
function withoutGuard<T>(fn: () => T): T {
  const html = document.documentElement;
  const prev = html.getAttribute(STATE_ATTR);
  html.setAttribute(STATE_ATTR, 'probe');
  try {
    return fn();
  } finally {
    if (prev === null) html.removeAttribute(STATE_ATTR);
    else html.setAttribute(STATE_ATTR, prev);
  }
}

function opaqueBg(el: Element | null): RGBA | null {
  if (!el) return null;
  const c = parseColor(getComputedStyle(el).backgroundColor);
  return c && c.a > 0.5 ? c : null;
}

/** True when the page already renders dark by itself. */
export function isNativelyDark(): boolean {
  return withoutGuard(() => {
    const html = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content ?? '';
    const metaDarkOnly = /\bdark\b/.test(meta) && !/\blight\b/.test(meta);
    const scheme = getComputedStyle(html).colorScheme;
    const bg = opaqueBg(document.body) ?? opaqueBg(html);
    if (!bg) return metaDarkOnly || (scheme.includes('dark') && !scheme.includes('light'));
    return rgbToOklch(bg).l < 0.4;
  });
}

/** Cloudflare / bot-check interstitials served on the site's own domain. */
export function isChallengePage(): boolean {
  return !!document.querySelector('script[src*="/cdn-cgi/challenge-platform/"], #challenge-form, #cf-challenge-running');
}

/**
 * Samples visible text and reports whether too much of it ended up low-contrast.
 * Elements over background images are skipped (their real backdrop is unknown).
 */
export function contrastLooksBroken(pageBg: RGBA): boolean {
  const body = document.body;
  if (!body) return false;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  let samples = 0;
  let bad = 0;
  const vh = innerHeight;
  for (let n = walker.nextNode(), scanned = 0; n && scanned < 600 && samples < 40; n = walker.nextNode(), scanned++) {
    if ((n.textContent ?? '').trim().length < 3) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > vh) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity < 0.3) continue;
    const fg = parseColor(cs.color);
    if (!fg || fg.a < 0.3) continue;
    const bg = effectiveBg(el, pageBg);
    if (!bg) continue;
    samples++;
    if (contrastRatio(composite(fg, bg), bg) < 3) bad++;
  }
  return samples >= 8 && bad / samples > 0.25;
}

function effectiveBg(el: Element, pageBg: RGBA): RGBA | null {
  const layers: RGBA[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cs = getComputedStyle(cur);
    if (cs.backgroundImage !== 'none') return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) {
      layers.push(c);
      if (c.a >= 1) break;
    }
  }
  let out = pageBg;
  for (let i = layers.length - 1; i >= 0; i--) out = composite(layers[i], out);
  return out;
}
