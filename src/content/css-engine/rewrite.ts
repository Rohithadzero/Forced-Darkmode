// Walks CSSOM rules and emits mirrored rules that carry only remapped color declarations.
// Output keeps author selectors so specificity and ordering relations survive.

import type { Role } from './map-color';
import { referencedVars, transformCustomProp, transformValue, type TransformContext } from './transform';

export const PROP_ROLES: Record<string, Role> = {
  color: 'text',
  '-webkit-text-fill-color': 'text',
  '-webkit-text-stroke-color': 'text',
  'caret-color': 'text',
  'text-decoration-color': 'text',
  'text-emphasis-color': 'text',
  fill: 'text',
  stroke: 'text',
  'background-color': 'bg',
  'background-image': 'bg',
  'stop-color': 'bg',
  'box-shadow': 'shadow',
  'text-shadow': 'shadow',
  'border-top-color': 'border',
  'border-right-color': 'border',
  'border-bottom-color': 'border',
  'border-left-color': 'border',
  'border-block-start-color': 'border',
  'border-block-end-color': 'border',
  'border-inline-start-color': 'border',
  'border-inline-end-color': 'border',
  'outline-color': 'border',
  'column-rule-color': 'border',
};

// Longhand → shorthands to consult when the longhand is pending var() substitution.
const SHORTHANDS: Record<string, string[]> = {
  'background-color': ['background'],
  'background-image': ['background'],
  'border-top-color': ['border-top', 'border-color', 'border'],
  'border-right-color': ['border-right', 'border-color', 'border'],
  'border-bottom-color': ['border-bottom', 'border-color', 'border'],
  'border-left-color': ['border-left', 'border-color', 'border'],
  'border-block-start-color': ['border-block-start', 'border-block-color', 'border-block'],
  'border-block-end-color': ['border-block-end', 'border-block-color', 'border-block'],
  'border-inline-start-color': ['border-inline-start', 'border-inline-color', 'border-inline'],
  'border-inline-end-color': ['border-inline-end', 'border-inline-color', 'border-inline'],
  'outline-color': ['outline'],
  'text-decoration-color': ['text-decoration'],
  'column-rule-color': ['column-rule'],
};

const SKIP_VALUES = new Set(['', 'initial', 'inherit', 'unset', 'revert', 'revert-layer', 'currentcolor', 'transparent', 'none', 'auto']);
const DARK_SCHEME_RE = /prefers-color-scheme\s*:\s*dark/i;

export interface RewriteState extends TransformContext {
  /** Custom properties seen holding gradients/urls (background shorthand must not become background-color). */
  gradientVars: Set<string>;
  /** Custom properties seen holding colors. */
  colorVars: Set<string>;
  /** Copy rules inside `prefers-color-scheme: dark` unconditionally into the native layer. */
  nativeMedia: boolean;
  /** Count of color declarations seen inside dark-scheme media rules. */
  darkDecls: number;
  /** Identity transform used for native rules. */
  identity: TransformContext;
  /** URL of the sheet being processed, for resolving relative url() values. */
  baseHref?: string;
}

export function absolutizeUrls(value: string, base: string): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q: string, u: string) => {
    if (/^(data|blob|https?|chrome-extension):|^#/.test(u)) return m;
    try {
      return `url(${q}${new URL(u, base).href}${q})`;
    } catch {
      return m;
    }
  });
}

export interface Decl {
  p: string;
  v: string;
  imp: boolean;
  custom: boolean;
}

export interface RewriteOutput {
  normal: string;
  imp: string;
  native: string;
}

const emptyOut = (): RewriteOutput => ({ normal: '', imp: '', native: '' });

/** Top-level whitespace split, keeping function arguments intact. */
function topLevelTokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function splitCommas(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

const isGradientVar = (t: string, st: RewriteState) => t.startsWith('var(') && referencedVars(t).some((v) => st.gradientVars.has(v));

function shorthandColorPart(value: string, st: RewriteState): string | null {
  const vars = topLevelTokens(value).filter((t) => t.startsWith('var(') && !isGradientVar(t, st));
  if (!vars.length) return null;
  return vars.find((t) => referencedVars(t).some((v) => st.colorVars.has(v))) ?? vars[vars.length - 1];
}

/** background-image layers of a var()-based `background` shorthand, or null if none carry color. */
function shorthandImageLayers(value: string, st: RewriteState): string | null {
  const layers = splitCommas(value).map(
    (layer) => topLevelTokens(layer).find((t) => /gradient\(|^url\(|^image-set\(/.test(t) || isGradientVar(t, st)) ?? 'none',
  );
  return layers.some((l) => /gradient\(|var\(/.test(l)) ? layers.join(', ') : null;
}

/** Extracts remapped declarations from a style block. `native` emits raw values (identity map). */
export function declsFromStyle(style: CSSStyleDeclaration, st: RewriteState, native = false): Decl[] {
  const ctx = native ? st.identity : st;
  const out: Decl[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    const imp = style.getPropertyPriority(name) === 'important';

    if (name.startsWith('--')) {
      const value = style.getPropertyValue(name).trim();
      if (/gradient\(|url\(/.test(value)) st.gradientVars.add(name);
      const mirrored = transformCustomProp(name, value, ctx);
      if (!mirrored) continue;
      st.colorVars.add(name);
      if (native) out.push({ p: name, v: value, imp: true, custom: true });
      for (const [p, v] of mirrored) out.push({ p, v, imp: native || imp, custom: true });
      continue;
    }

    const role = PROP_ROLES[name];
    if (!role) continue;
    let value = style.getPropertyValue(name).trim();

    if (!value) {
      // Longhand pending var() substitution: recover its part from the shorthand.
      const sh = SHORTHANDS[name]?.map((s) => style.getPropertyValue(s).trim()).find((v) => v.includes('var('));
      if (!sh) continue;
      const part =
        name === 'background-image'
          ? shorthandImageLayers(sh, st)
          : shorthandColorPart(name === 'background-color' ? splitCommas(sh).pop()! : sh, st);
      if (!part) continue;
      value = part;
    } else if (name === 'background-image' && !/gradient\(|var\(/.test(value)) {
      continue;
    }

    if (SKIP_VALUES.has(value.toLowerCase())) continue;
    let mapped = transformValue(value, role, ctx);
    if (mapped === value && !native) continue;
    // Our sheet is not served from the author sheet's URL, so relative urls must be resolved.
    if (st.baseHref && mapped.includes('url(')) mapped = absolutizeUrls(mapped, st.baseHref);
    out.push({ p: name, v: mapped, imp: native || imp, custom: false });
  }
  return out;
}

/** Serializes declarations; color props get !important (user-origin important beats author styles). */
export function formatDecls(decls: Decl[], forceImportant: boolean): string {
  let s = '';
  for (const d of decls) s += `${d.p}:${d.v}${!d.custom || forceImportant ? '!important' : ''};`;
  return s;
}

function groupHeader(rule: CSSRule): string | null {
  if (rule instanceof CSSMediaRule) return `@media ${rule.media.mediaText}`;
  if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`;
  if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) return '';
  if ('cssRules' in rule) {
    const text = rule.cssText;
    const brace = text.indexOf('{');
    return brace > 0 ? text.slice(0, brace).trim() : null;
  }
  return null;
}

function wrap(header: string, inner: RewriteOutput, into: RewriteOutput) {
  for (const k of ['normal', 'imp', 'native'] as const) {
    if (inner[k]) into[k] += header ? `${header}{${inner[k]}}` : inner[k];
  }
}

export interface RuleSink {
  /** Called for @import rules whose sheet is not readable (cross-origin). */
  onBlockedImport?(href: string, media: string): void;
}

/** Rewrites rules[start..end). Nested rules are handled recursively. */
export function rewriteRules(
  rules: CSSRuleList,
  st: RewriteState,
  start = 0,
  end = rules.length,
  sink: RuleSink = {},
  inDarkMedia = false,
): RewriteOutput {
  const out = emptyOut();
  for (let i = start; i < end; i++) {
    const rule = rules[i];
    if (rule instanceof CSSStyleRule) {
      const decls = declsFromStyle(rule.style, st);
      const nested = rule.cssRules?.length ? rewriteRules(rule.cssRules, st, 0, rule.cssRules.length, sink, inDarkMedia) : null;
      const normal = decls.filter((d) => !d.imp);
      const imp = decls.filter((d) => d.imp);
      if (normal.length || nested?.normal) out.normal += `${rule.selectorText}{${formatDecls(normal, false)}${nested?.normal ?? ''}}`;
      if (imp.length || nested?.imp) out.imp += `${rule.selectorText}{${formatDecls(imp, false)}${nested?.imp ?? ''}}`;
      if (inDarkMedia) {
        st.darkDecls += decls.length;
        if (st.nativeMedia) {
          const raw = declsFromStyle(rule.style, st, true);
          if (raw.length) out.native += `${rule.selectorText}{${formatDecls(raw, true)}}`;
        }
      }
    } else if (typeof CSSNestedDeclarations !== 'undefined' && rule instanceof CSSNestedDeclarations) {
      const decls = declsFromStyle(rule.style, st);
      out.normal += formatDecls(decls.filter((d) => !d.imp), false);
      out.imp += formatDecls(decls.filter((d) => d.imp), false);
    } else if (rule instanceof CSSImportRule) {
      const media = rule.media.mediaText;
      let inner: RewriteOutput | null = null;
      try {
        const sub = rule.styleSheet?.cssRules;
        if (sub) inner = rewriteRules(sub, st, 0, sub.length, sink, inDarkMedia);
      } catch {
        if (rule.href) sink.onBlockedImport?.(new URL(rule.href, rule.parentStyleSheet?.href ?? location.href).href, media);
      }
      if (inner) wrap(media && media !== 'all' ? `@media ${media}` : '', inner, out);
    } else if ('cssRules' in rule) {
      const header = groupHeader(rule);
      if (header === null) continue;
      const dark = inDarkMedia || (rule instanceof CSSMediaRule && DARK_SCHEME_RE.test(rule.media.mediaText));
      const childRules = (rule as CSSGroupingRule).cssRules;
      const inner = rewriteRules(childRules, st, 0, childRules.length, sink, dark);
      // Native copies drop the dark-scheme condition so they apply regardless of OS setting.
      const native = inner.native;
      inner.native = '';
      wrap(header, inner, out);
      if (native) out.native += dark && !inDarkMedia ? native : header ? `${header}{${native}}` : native;
    }
  }
  return out;
}

export const LAYER_ORDER = '@layer fdm-inline,fdm-native,fdm-imp,fdm-sheet;';

/** Wraps rewrite output into the cascade layers our injected sheets use. */
export function layered(o: RewriteOutput): string {
  let s = '';
  if (o.native) s += `@layer fdm-native{${o.native}}`;
  if (o.imp) s += `@layer fdm-imp{${o.imp}}`;
  if (o.normal) s += `@layer fdm-sheet{${o.normal}}`;
  return s ? LAYER_ORDER + s : '';
}

