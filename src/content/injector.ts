// Delivers generated CSS. Document CSS goes through chrome.scripting.insertCSS as a USER-origin
// stylesheet: page CSP cannot block it and page scripts cannot remove it. Shadow roots (which
// document-level sheets cannot reach) get a constructed sheet appended to adoptedStyleSheets.

import { sendToWorker } from '../shared/messages';

export interface Injector {
  /** Replaces all bulk CSS with one sheet. */
  replaceAll(css: string): Promise<void>;
  /** Adds CSS after what is already injected. */
  append(css: string): Promise<void>;
  /** Sets an independently-replaceable keyed sheet (base, inline styles). */
  setKeyed(key: string, css: string): Promise<void>;
  clear(): Promise<void>;
}

const MAX_CHUNKS = 24;

export class UserCssInjector implements Injector {
  private chunks: string[] = [];
  private keyed = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private insert(css: string) {
    return sendToWorker({ type: 'css:insert', css });
  }

  private remove(css: string) {
    return sendToWorker({ type: 'css:remove', css });
  }

  replaceAll(css: string) {
    return this.run(async () => {
      const old = this.chunks;
      this.chunks = css ? [css] : [];
      if (css) await this.insert(css);
      await Promise.all(old.map((c) => this.remove(c)));
    });
  }

  append(css: string) {
    if (!css) return Promise.resolve();
    if (this.chunks.length >= MAX_CHUNKS) return this.replaceAll(this.chunks.join('') + css);
    return this.run(async () => {
      this.chunks.push(css);
      await this.insert(css);
    });
  }

  setKeyed(key: string, css: string) {
    return this.run(async () => {
      const old = this.keyed.get(key);
      if (old === css) return;
      if (css) {
        this.keyed.set(key, css);
        await this.insert(css);
      } else this.keyed.delete(key);
      if (old) await this.remove(old);
    });
  }

  clear() {
    return this.run(async () => {
      const all = [...this.chunks, ...this.keyed.values()];
      this.chunks = [];
      this.keyed.clear();
      await Promise.all(all.map((c) => this.remove(c)));
    });
  }
}

export class AdoptedInjector implements Injector {
  readonly sheet = new CSSStyleSheet();
  private bulk = '';
  private keyed = new Map<string, string>();

  constructor(private root: ShadowRoot) {}

  /** Re-appends our sheet if the page replaced adoptedStyleSheets. */
  ensureAdopted(): void {
    const list = this.root.adoptedStyleSheets;
    if (!list.includes(this.sheet)) this.root.adoptedStyleSheets = [...list, this.sheet];
  }

  private commit() {
    this.sheet.replaceSync(this.bulk + [...this.keyed.values()].join(''));
    this.ensureAdopted();
    return Promise.resolve();
  }

  replaceAll(css: string) {
    this.bulk = css;
    return this.commit();
  }

  append(css: string) {
    this.bulk += css;
    return this.commit();
  }

  setKeyed(key: string, css: string) {
    if (css) this.keyed.set(key, css);
    else this.keyed.delete(key);
    return this.commit();
  }

  clear() {
    this.bulk = '';
    this.keyed.clear();
    this.root.adoptedStyleSheets = this.root.adoptedStyleSheets.filter((s) => s !== this.sheet);
    return Promise.resolve();
  }
}
