// Orchestrates the CSS engine: tracks stylesheets per root (document + open shadow roots),
// processes only new rules incrementally, time-slices large work, and commits the output
// through an injector. Already-processed rules are never re-walked unless the sheet changed.

import { sendToWorker, type FetchResult } from '../../shared/messages';
import { AdoptedInjector, UserCssInjector, type Injector } from '../injector';
import { CACHE_MIN_RULES, type SheetCache } from './cache';
import { InlineStyles } from './inline';
import { createMapper, type MapParams } from './map-color';
import { layered, rewriteRules, type RewriteOutput, type RewriteState, type RuleSink } from './rewrite';

type Root = Document | ShadowRoot;

const SLICE = 250; // rules per slice
const FIRST_PASS_BUDGET = 40; // ms before yielding on the initial pass
const IDLE_BUDGET = 10;
const FETCH_WAIT = 400; // ms the first commit waits for cross-origin sheets
// Beyond these the page is better served by the filter engine (roughly 3MB of CSS).
const MAX_SHEET_TEXT = 3 * 1024 * 1024;
const MAX_RULES = 60000;

interface SheetRecord {
  sheet: CSSStyleSheet;
  processed: number;
  lastRule: CSSRule | null;
  parts: string[];
  fetch?: 'pending' | 'done' | 'failed';
}

class RootState {
  records: SheetRecord[] = [];
  importParts: string[] = [];
  delta: string[] = [];
  rebuild = false;
  inline: InlineStyles;

  constructor(
    readonly root: Root,
    readonly injector: Injector,
    st: RewriteState,
  ) {
    this.inline = new InlineStyles(st);
  }

  addPart(rec: SheetRecord | null, css: string) {
    if (!css) return;
    (rec ? rec.parts : this.importParts).push(css);
    if (!this.rebuild) this.delta.push(css);
  }
}

const yieldFast = () => new Promise<void>((r) => setTimeout(r, 0));
const yieldIdle = () =>
  new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 16)));

function mediaWrap(media: string, o: RewriteOutput): RewriteOutput {
  if (!media || media === 'all') return o;
  const w = (s: string) => (s ? `@media ${media}{${s}}` : '');
  return { normal: w(o.normal), imp: w(o.imp), native: w(o.native) };
}

export interface EngineStats {
  sheets: number;
  unreadable: number;
  tooLarge: boolean;
}

export class CssEngine {
  readonly st: RewriteState;
  private roots = new Map<Root, RootState>();
  private recs = new WeakMap<CSSStyleSheet, SheetRecord>();
  private fetchedImports = new Set<string>();
  private dirtySheets = new Set<Root>();
  private dirtyInline = new Set<Element>();
  private dirtyTrees = new Set<Element>();
  private timer = 0;
  private lock: Promise<void> = Promise.resolve();
  private sliceStart = 0;
  private budget = IDLE_BUDGET;
  private pendingFetches: Promise<void>[] = [];
  private stopped = false;
  private textBytes = 0;
  private rulesSeen = 0;
  readonly stats: EngineStats = { sheets: 0, unreadable: 0, tooLarge: false };

  constructor(
    params: MapParams,
    nativeMedia: boolean,
    private cache: SheetCache,
    private baseCss: string,
  ) {
    this.st = {
      map: createMapper(params),
      cache: new Map(),
      gradientVars: new Set(),
      colorVars: new Set(),
      nativeMedia,
      darkDecls: 0,
      identity: { map: (c) => c, cache: new Map() },
    };
  }

  /** Initial pass over the document. Resolves once the first CSS is injected. */
  async start(): Promise<void> {
    const rs = this.ensureRoot(document);
    await rs.injector.setKeyed('base', this.baseCss);
    await this.locked(async () => {
      this.budget = FIRST_PASS_BUDGET;
      await this.syncRoot(rs, yieldFast);
      if (this.pendingFetches.length) {
        await Promise.race([Promise.all(this.pendingFetches), new Promise((r) => setTimeout(r, FETCH_WAIT))]);
      }
      if (document.body) rs.inline.scanAll(document);
      await this.commit(rs);
      this.budget = IDLE_BUDGET;
    });
  }

  stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    const all = [...this.roots.values()].map((rs) => {
      rs.inline.clear();
      return rs.injector.clear();
    });
    this.roots.clear();
    return Promise.all(all).then(() => undefined);
  }

  addShadowRoot(sr: ShadowRoot): void {
    if (this.stopped || this.roots.has(sr)) return;
    const rs = this.ensureRoot(sr);
    rs.inline.scanAll(sr);
    this.dirtySheets.add(sr);
    this.schedule();
  }

  /** Walks the DOM once for open shadow roots (declarative shadow DOM never calls attachShadow). */
  discoverShadowRoots(from: Root = document): void {
    const walker = document.createTreeWalker(from, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode() as Element | null; n; n = walker.nextNode() as Element | null) {
      const sr = n.shadowRoot;
      if (sr && !this.roots.has(sr)) {
        this.addShadowRoot(sr);
        this.discoverShadowRoots(sr);
      }
    }
  }

  markSheets(root?: Root): void {
    if (root) this.dirtySheets.add(root);
    else this.roots.forEach((_, r) => this.dirtySheets.add(r));
    this.schedule();
  }

  markInline(el: Element): void {
    this.dirtyInline.add(el);
    this.schedule();
  }

  /** Newly inserted subtree: its [style] descendants are scanned on the next flush. */
  markTree(el: Element): void {
    this.dirtyTrees.add(el);
    this.schedule();
  }

  private ensureRoot(root: Root): RootState {
    let rs = this.roots.get(root);
    if (!rs) {
      const injector = root instanceof Document ? new UserCssInjector() : new AdoptedInjector(root);
      rs = new RootState(root, injector, this.st);
      this.roots.set(root, rs);
    }
    return rs;
  }

  private locked(fn: () => Promise<void>): Promise<void> {
    const p = this.lock.then(fn, fn);
    this.lock = p.catch(() => undefined);
    return p;
  }

  private schedule(): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      if (document.hidden) {
        // Paused while hidden: flush once the tab is visible again.
        document.addEventListener('visibilitychange', () => ((this.timer = 0), this.schedule()), { once: true });
        return;
      }
      yieldIdle().then(() => {
        this.timer = 0;
        void this.flush();
      });
    }, 120) as unknown as number;
  }

  private flush(): Promise<void> {
    return this.locked(async () => {
      if (this.stopped) return;
      const touched = new Set<RootState>();
      const roots = [...this.dirtySheets];
      this.dirtySheets.clear();
      for (const root of roots) {
        const rs = this.roots.get(root);
        if (!rs) continue;
        if (root instanceof ShadowRoot && !root.host.isConnected) {
          this.roots.delete(root);
          continue;
        }
        await this.syncRoot(rs, yieldIdle);
        touched.add(rs);
      }
      const trees = [...this.dirtyTrees];
      this.dirtyTrees.clear();
      for (const el of trees) {
        if (!el.isConnected) continue;
        this.roots.get(el.getRootNode() as Root)?.inline.scanAll(el);
      }
      const els = [...this.dirtyInline];
      this.dirtyInline.clear();
      for (const el of els) {
        const rs = this.roots.get(el.getRootNode() as Root);
        if (!rs) continue;
        rs.inline.update(el);
        touched.add(rs);
      }
      this.roots.forEach((rs) => {
        if (rs.root instanceof ShadowRoot) (rs.injector as AdoptedInjector).ensureAdopted();
        touched.add(rs);
      });
      for (const rs of touched) await this.commit(rs);
    });
  }

  private listSheets(rs: RootState): CSSStyleSheet[] {
    const out: CSSStyleSheet[] = [];
    for (const s of Array.from(rs.root.styleSheets)) if (!s.disabled) out.push(s);
    const own = rs.injector instanceof AdoptedInjector ? rs.injector.sheet : null;
    for (const s of rs.root.adoptedStyleSheets) if (s !== own && !s.disabled) out.push(s);
    return out;
  }

  private async syncRoot(rs: RootState, yieldFn: () => Promise<void>): Promise<void> {
    this.sliceStart = performance.now();
    const ordered: SheetRecord[] = [];
    for (const sheet of this.listSheets(rs)) {
      if (this.stopped) return;
      let rec = this.recs.get(sheet);
      if (!rec) {
        rec = { sheet, processed: 0, lastRule: null, parts: [] };
        this.recs.set(sheet, rec);
        this.stats.sheets++;
      }
      ordered.push(rec);
      await this.processSheet(rs, rec, yieldFn);
    }
    for (const old of rs.records) if (old.parts.length && !ordered.includes(old)) rs.rebuild = true;
    rs.records = ordered;
  }

  private sink(rs: RootState): RuleSink {
    return {
      onBlockedImport: (href, media) => {
        if (this.fetchedImports.has(href)) return;
        this.fetchedImports.add(href);
        this.fetchText(rs, null, href, media);
      },
    };
  }

  private async processSheet(rs: RootState, rec: SheetRecord, yieldFn: () => Promise<void>): Promise<void> {
    let rules: CSSRuleList;
    try {
      rules = rec.sheet.cssRules;
    } catch {
      if (!rec.fetch) {
        if (rec.sheet.href) this.fetchText(rs, rec, rec.sheet.href, rec.sheet.media.mediaText);
        else rec.fetch = 'failed';
      }
      return;
    }
    const n = rules.length;
    // Anything other than appended rules (deleteRule, insert at index 0, replaceSync) → regenerate.
    if (rec.processed > n || (rec.processed > 0 && rules[rec.processed - 1] !== rec.lastRule)) {
      if (rec.parts.length) rs.rebuild = true;
      rec.parts = [];
      rec.processed = 0;
    }
    if (rec.processed >= n) return;

    const href = rec.sheet.href;
    const media = rec.sheet.media.mediaText;
    const whole = rec.processed === 0;
    if (whole && href && n >= CACHE_MIN_RULES) {
      const hit = this.cache.get(href, n);
      if (hit !== null) {
        rs.addPart(rec, hit);
        rec.processed = n;
        rec.lastRule = rules[n - 1];
        return;
      }
    }

    this.rulesSeen += n - rec.processed;
    if (this.rulesSeen > MAX_RULES) this.stats.tooLarge = true;
    let acc = '';
    const sink = this.sink(rs);
    while (rec.processed < n) {
      this.st.baseHref = href ?? location.href;
      const end = Math.min(n, rec.processed + SLICE);
      const css = layered(mediaWrap(media, rewriteRules(rules, this.st, rec.processed, end, sink)));
      rs.addPart(rec, css);
      acc += css;
      rec.processed = end;
      rec.lastRule = rules[end - 1];
      if (performance.now() - this.sliceStart > this.budget) {
        await yieldFn();
        if (this.stopped) return;
        this.sliceStart = performance.now();
      }
    }
    if (whole && href && n >= CACHE_MIN_RULES) this.cache.put(href, n, acc);
  }

  /** Cross-origin sheets: the service worker fetches the text (host permission bypasses CORS). */
  private fetchText(rs: RootState, rec: SheetRecord | null, href: string, media: string): void {
    if (rec) rec.fetch = 'pending';
    this.stats.unreadable++;
    const p = sendToWorker<FetchResult>({ type: 'css:fetch', url: href })
      .then((res) => {
        if (this.stopped) return;
        if (!res?.ok || res.text === undefined) {
          if (rec) rec.fetch = 'failed';
          return;
        }
        this.stats.unreadable--;
        this.textBytes += res.text.length;
        if (this.textBytes > MAX_SHEET_TEXT) this.stats.tooLarge = true;
        let css = this.cache.get(href, res.text.length);
        if (css === null) {
          this.st.baseHref = href;
          const sheet = new CSSStyleSheet({ baseURL: href });
          sheet.replaceSync(res.text);
          css = layered(mediaWrap(media, rewriteRules(sheet.cssRules, this.st, 0, sheet.cssRules.length, this.sink(rs))));
          if (sheet.cssRules.length >= CACHE_MIN_RULES) this.cache.put(href, res.text.length, css);
        }
        if (rec) rec.fetch = 'done';
        rs.addPart(rec, css);
        this.dirtySheets.add(rs.root);
        this.schedule();
      })
      .catch(() => {
        if (rec) rec.fetch = 'failed';
      });
    this.pendingFetches.push(p);
  }

  private async commit(rs: RootState): Promise<void> {
    if (this.stopped) return;
    if (rs.rebuild) {
      rs.rebuild = false;
      rs.delta = [];
      await rs.injector.replaceAll(rs.importParts.join('') + rs.records.map((r) => r.parts.join('')).join(''));
    } else if (rs.delta.length) {
      const d = rs.delta.join('');
      rs.delta = [];
      await rs.injector.append(d);
    }
    const inline = rs.inline.takeCss();
    if (inline !== null) await rs.injector.setKeyed('inline', inline);
  }
}
