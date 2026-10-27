import { formatColor, isNamedColor, parseColor } from '../../shared/color';
import type { ColorMapper, Role } from './map-color';

const ROLE_PREFIX: Record<Role, string> = { bg: 'b', text: 't', border: 'r', shadow: 's' };
export const ROLES = Object.keys(ROLE_PREFIX) as Role[];

/** Name of our mirrored custom property for a role: --x → --fdmb-x. */
export function roleVar(role: Role, name: string): string {
  return `--fdm${ROLE_PREFIX[role]}${name.slice(1)}`;
}

const COLOR_FNS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab']);
const PASSTHROUGH_FNS = new Set(['url', 'light-dark', 'image-set', 'env']);
const isIdentStart = (ch: string) => /[a-zA-Z_-]/.test(ch);
const isIdentChar = (ch: string) => /[a-zA-Z0-9_-]/.test(ch);

/** Index just past the ")" matching the "(" at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return s.length;
}

/** Splits at the first top-level comma. */
function splitFirstComma(s: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, null];
}

export interface TransformContext {
  map: ColorMapper;
  /** Memo of token+role → output, shared across a page. */
  cache: Map<string, string>;
}

function mapToken(token: string, role: Role, ctx: TransformContext): string {
  const key = role + token;
  let out = ctx.cache.get(key);
  if (out === undefined) {
    const parsed = parseColor(token);
    out = parsed ? formatColor(ctx.map(parsed, role)) : token;
    ctx.cache.set(key, out);
  }
  return out;
}

/**
 * Rewrites every color in a CSS value for the given role. var(--x, fb) becomes
 * var(--fdm<role>-x, var(--x, fb')) so a missing mirror falls back to the original.
 */
export function transformValue(value: string, role: Role, ctx: TransformContext): string {
  let out = '';
  let i = 0;
  const n = value.length;
  while (i < n) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      const end = value.indexOf(ch, i + 1);
      const stop = end < 0 ? n : end + 1;
      out += value.slice(i, stop);
      i = stop;
    } else if (ch === '#') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(value[j])) j++;
      out += j - i === 4 || j - i === 5 || j - i === 7 || j - i === 9 ? mapToken(value.slice(i, j), role, ctx) : value.slice(i, j);
      i = j;
    } else if (isIdentStart(ch) && (i === 0 || !isIdentChar(value[i - 1]))) {
      let j = i + 1;
      while (j < n && isIdentChar(value[j])) j++;
      const word = value.slice(i, j);
      const lower = word.toLowerCase();
      if (value[j] === '(') {
        const end = matchParen(value, j);
        const inner = value.slice(j + 1, end - 1);
        if (lower === 'var') {
          const [name, fallback] = splitFirstComma(inner);
          const v = name.trim();
          const fb = fallback === null ? '' : `,${transformValue(fallback, role, ctx)}`;
          out += v.startsWith('--') ? `var(${roleVar(role, v)}, var(${v}${fb}))` : value.slice(i, end);
        } else if (COLOR_FNS.has(lower)) {
          out += inner.includes('var(') ? value.slice(i, end) : mapToken(value.slice(i, end), role, ctx);
        } else if (PASSTHROUGH_FNS.has(lower)) {
          out += value.slice(i, end);
        } else {
          // gradients, color-mix(), calc() etc: transform contents
          out += `${word}(${transformValue(inner, role, ctx)})`;
        }
        i = end;
      } else {
        out += lower !== 'transparent' && isNamedColor(lower) ? mapToken(lower, role, ctx) : word;
        i = j;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Mirrors a custom property for every role; returns null when its value holds no color or var(). */
export function transformCustomProp(name: string, value: string, ctx: TransformContext): [string, string][] | null {
  const probe = transformValue(value, 'bg', ctx);
  if (probe === value) return null;
  return ROLES.map((role) => [roleVar(role, name), role === 'bg' ? probe : transformValue(value, role, ctx)]);
}

/** Names of custom properties referenced via var() in a value. */
export function referencedVars(value: string): string[] {
  const out: string[] = [];
  const re = /var\(\s*(--[\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(m[1]);
  return out;
}
