// Runs in the page's MAIN world at document_start. Reports stylesheet mutations that produce no
// DOM mutation (insertRule from CSS-in-JS, adoptedStyleSheets) and new open shadow roots.
// Patches use Proxy so patched natives still stringify as "[native code]" (bot checks look at that).

(() => {
  const FLAG = Symbol.for('fdm.hooks');
  const w = window as unknown as Record<symbol, boolean>;
  if (w[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      document.dispatchEvent(new CustomEvent('__fdm_dirty'));
    });
  };

  const wrap = <F extends (...args: never[]) => unknown>(fn: F, after: (self: unknown, args: unknown[], result: unknown) => void): F =>
    new Proxy(fn, {
      apply(target, self, args) {
        const result = Reflect.apply(target, self, args);
        after(self, args, result);
        return result;
      },
    });

  const sheetProto = CSSStyleSheet.prototype as unknown as Record<string, (...a: never[]) => unknown>;
  for (const name of ['insertRule', 'deleteRule', 'addRule', 'removeRule', 'replaceSync', 'replace']) {
    const orig = sheetProto[name];
    if (typeof orig !== 'function') continue;
    sheetProto[name] = wrap(orig, (_s, _a, result) => {
      notify();
      if (result instanceof Promise) result.then(notify, () => undefined);
    });
  }

  for (const proto of [Document.prototype, ShadowRoot.prototype]) {
    const d = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
    if (d?.set) Object.defineProperty(proto, 'adoptedStyleSheets', { ...d, set: wrap(d.set, notify) });
  }

  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = wrap(attach, (self, args) => {
    const init = args[0] as ShadowRootInit | undefined;
    if (init?.mode !== 'open') return;
    const host = self as Element;
    // Deferred: custom element constructors must not observe side effects.
    queueMicrotask(() => host.dispatchEvent(new CustomEvent('__fdm_shadow', { bubbles: true, composed: true })));
  });
})();
