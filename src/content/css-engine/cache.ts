// Per-stylesheet cache of generated CSS in chrome.storage.local, so revisiting a site skips
// re-processing its large sheets. Keyed by href; entry is valid only for the same rule count /
// text length and the same theme parameters. LRU-trimmed to a byte budget.

const PREFIX = 'fdmc:';
const INDEX_KEY = 'fdmc-index';
const BUDGET = 4 * 1024 * 1024;
export const CACHE_MIN_RULES = 300;

interface Entry {
  sig: string;
  css: string;
}

type Index = Record<string, { size: number; t: number }>;

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class SheetCache {
  private mem = new Map<string, Entry>();
  private writes = new Map<string, Entry>();
  private timer = 0;

  constructor(private paramsSig: string) {}

  private key(href: string) {
    return PREFIX + hash(href);
  }

  /** Loads entries for the given hrefs in a single storage read. */
  async preload(hrefs: string[]): Promise<void> {
    if (!hrefs.length) return;
    const keys = hrefs.map((h) => this.key(h));
    try {
      const got = await chrome.storage.local.get(keys);
      for (const [k, v] of Object.entries(got)) this.mem.set(k, v as Entry);
    } catch {
      /* storage unavailable: run uncached */
    }
  }

  get(href: string, sizeSig: string | number): string | null {
    const e = this.mem.get(this.key(href));
    return e && e.sig === `${sizeSig}|${this.paramsSig}` ? e.css : null;
  }

  put(href: string, sizeSig: string | number, css: string): void {
    const entry = { sig: `${sizeSig}|${this.paramsSig}`, css };
    const k = this.key(href);
    this.mem.set(k, entry);
    this.writes.set(k, entry);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 2000) as unknown as number;
  }

  private async flush(): Promise<void> {
    const writes = Object.fromEntries(this.writes);
    this.writes.clear();
    try {
      const idx = ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] ?? {}) as Index;
      const now = Date.now();
      for (const [k, e] of Object.entries(writes)) idx[k] = { size: e.css.length, t: now };
      const order = Object.entries(idx).sort((a, b) => b[1].t - a[1].t);
      let total = 0;
      const evict: string[] = [];
      for (const [k, meta] of order) {
        total += meta.size;
        if (total > BUDGET) {
          evict.push(k);
          delete idx[k];
          delete writes[k];
        }
      }
      await chrome.storage.local.set({ ...writes, [INDEX_KEY]: idx });
      if (evict.length) await chrome.storage.local.remove(evict);
    } catch {
      /* quota or context invalidated: cache is best-effort */
    }
  }
}

export function paramsSignature(parts: unknown[]): string {
  return hash(JSON.stringify(parts));
}
