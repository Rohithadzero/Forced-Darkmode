// Inline style="" colors. Each element with color declarations gets a marker attribute and a rule
// in the fdm-inline layer, which (for !important) outranks every other layer we emit.

import { formatColor, parseColor } from '../../shared/color';
import { declsFromStyle, formatDecls, LAYER_ORDER, type RewriteState } from './rewrite';

const ATTR = 'data-fdm-i';
const HOT_LIMIT = 12; // style changes per second before an element is ignored for a while
const HOT_COOLDOWN = 5000;

const SELECTOR = '[style],[bgcolor],font[color],body[text]';

interface Entry {
  id: number;
  sig: string;
  rule: string;
  legacy: string;
}

export class InlineStyles {
  private entries = new Map<Element, Entry>();
  private heat = new WeakMap<Element, { n: number; t: number; until: number }>();
  private nextId = 1;
  private changed = false;

  constructor(private st: RewriteState) {}

  /** Scans every [style] element inside a root. */
  scanAll(root: Document | ShadowRoot | Element): void {
    if (root instanceof Element && root.matches(SELECTOR)) this.update(root, false);
    root.querySelectorAll(SELECTOR).forEach((el) => this.update(el, false));
  }

  /** Re-evaluates one element. `fromMutation` enables hot-element throttling. */
  update(el: Element, fromMutation = true): void {
    if (fromMutation && this.isHot(el)) return;
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    const prev = this.entries.get(el);
    const inline = style?.length ? formatDecls(declsFromStyle(style, this.st), true) : '';
    const legacy = this.legacyDecls(el);
    if (!inline && !legacy) {
      if (prev) this.drop(el);
      return;
    }
    const sig = inline + '|' + legacy;
    if (prev?.sig === sig) return;
    const id = prev?.id ?? this.nextId++;
    if (!prev) el.setAttribute(ATTR, String(id));
    this.entries.set(el, {
      id,
      sig,
      rule: inline ? `[${ATTR}="${id}"]{${inline}}` : '',
      // Presentational attributes rank below any author rule, so they get zero specificity.
      legacy: legacy ? `:where([${ATTR}="${id}"]){${legacy}}` : '',
    });
    this.changed = true;
  }

  /** bgcolor="", <font color>, <body text>: pre-CSS color attributes still used by old sites. */
  private legacyDecls(el: Element): string {
    let s = '';
    const bg = el.getAttribute('bgcolor');
    const fg = el.localName === 'font' ? el.getAttribute('color') : el.localName === 'body' ? el.getAttribute('text') : null;
    const color = (v: string) => parseColor(v) ?? parseColor('#' + v);
    if (bg) {
      const c = color(bg);
      if (c) s += `background-color:${formatColor(this.st.map(c, 'bg'))}!important;`;
    }
    if (fg) {
      const c = color(fg);
      if (c) s += `color:${formatColor(this.st.map(c, 'text'))}!important;`;
    }
    return s;
  }

  private isHot(el: Element): boolean {
    const now = performance.now();
    let h = this.heat.get(el);
    if (!h) this.heat.set(el, (h = { n: 0, t: now, until: 0 }));
    if (now < h.until) return true;
    if (now - h.t > 1000) {
      h.n = 0;
      h.t = now;
    }
    if (++h.n > HOT_LIMIT) {
      h.until = now + HOT_COOLDOWN;
      return true;
    }
    return false;
  }

  private drop(el: Element) {
    this.entries.delete(el);
    el.removeAttribute(ATTR);
    this.changed = true;
  }

  /** Returns new CSS if anything changed since the last call, else null. Prunes detached elements. */
  takeCss(): string | null {
    for (const el of this.entries.keys()) {
      if (!el.isConnected) {
        this.entries.delete(el);
        this.changed = true;
      }
    }
    if (!this.changed) return null;
    this.changed = false;
    if (!this.entries.size) return '';
    let rules = '';
    let legacy = '';
    for (const e of this.entries.values()) {
      rules += e.rule;
      legacy += e.legacy;
    }
    return `${LAYER_ORDER}${rules ? `@layer fdm-inline{${rules}}` : ''}${legacy ? `@layer fdm-sheet{${legacy}}` : ''}`;
  }

  clear(): void {
    for (const el of this.entries.keys()) el.removeAttribute(ATTR);
    this.entries.clear();
    this.changed = false;
  }
}
