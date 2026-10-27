// One MutationObserver for the document and every tracked shadow root. The callback only
// classifies mutations into dirty sets; real work happens later in the engine's idle flush.

import type { CssEngine } from './css-engine/engine';

const INLINE_ATTRS = new Set(['style', 'bgcolor', 'color', 'text']);

const isSheetNode = (el: Element) =>
  el.localName === 'style' || (el.localName === 'link' && /\bstylesheet\b/i.test(el.getAttribute('rel') ?? ''));

export class DomWatcher {
  private mo = new MutationObserver((list) => this.onMutations(list));

  constructor(private engine: CssEngine) {}

  observe(root: Document | ShadowRoot): void {
    this.mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'media', 'disabled', 'rel', 'bgcolor', 'color', 'text'],
    });
  }

  disconnect(): void {
    this.mo.disconnect();
  }

  private onMutations(list: MutationRecord[]): void {
    const e = this.engine;
    for (const m of list) {
      const target = m.target as Element;
      if (m.type === 'attributes') {
        if (INLINE_ATTRS.has(m.attributeName!)) e.markInline(target);
        else if (isSheetNode(target)) e.markSheets(target.getRootNode() as Document | ShadowRoot);
        continue;
      }
      // Text replaced inside a <style>: its sheet object is recreated.
      if (target.nodeType === 1 && target.localName === 'style') {
        e.markSheets(target.getRootNode() as Document | ShadowRoot);
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const el = n as Element;
        if (isSheetNode(el)) {
          e.markSheets(el.getRootNode() as Document | ShadowRoot);
          // <link> sheets exist only after load.
          if (el.localName === 'link') el.addEventListener('load', () => e.markSheets(el.getRootNode() as Document | ShadowRoot), { once: true });
        } else if (el.attributes.length || el.firstElementChild) {
          e.markTree(el);
        }
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && isSheetNode(n as Element)) e.markSheets(target.getRootNode() as Document | ShadowRoot);
      }
    }
  }
}
