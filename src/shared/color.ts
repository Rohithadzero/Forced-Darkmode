// Color parsing, OKLab/OKLCH conversion and WCAG helpers. Pure, no DOM.

export interface RGBA {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

export interface OKLCH {
  l: number; // 0..1
  c: number; // 0..~0.4
  h: number; // degrees
  a: number;
}

const NAMED_SRC =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,' +
  'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
  'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,' +
  'lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,' +
  'mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,' +
  'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
  'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,' +
  'peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,' +
  'royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
  'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,' +
  'steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,' +
  'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

export const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  NAMED_SRC.split(',').map((pair) => pair.split(':') as [string, string]),
);

export function isNamedColor(word: string): boolean {
  const w = word.toLowerCase();
  return w === 'transparent' || NAMED_COLORS.has(w);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function parseHex(hex: string): RGBA | null {
  let h = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

// Splits "a, b, c / d" or "a b c / d" into channel strings and optional alpha.
function splitArgs(body: string): { parts: string[]; alpha?: string } | null {
  let alpha: string | undefined;
  let main = body.trim();
  const slash = main.indexOf('/');
  if (slash >= 0) {
    alpha = main.slice(slash + 1).trim();
    main = main.slice(0, slash).trim();
  }
  const parts = main.includes(',') ? main.split(',').map((s) => s.trim()) : main.split(/\s+/);
  if (parts.length === 4 && alpha === undefined) alpha = parts.pop();
  if (parts.length !== 3 || parts.some((p) => p === '')) return null;
  return { parts, alpha };
}

function num(s: string, percentScale: number): number {
  if (s === 'none') return 0;
  if (s.endsWith('%')) return (parseFloat(s) / 100) * percentScale;
  return parseFloat(s);
}

function parseAlpha(s: string | undefined): number {
  if (s === undefined) return 1;
  return clamp(num(s, 1), 0, 1);
}

function parseHue(s: string): number {
  if (s.endsWith('turn')) return parseFloat(s) * 360;
  if (s.endsWith('rad')) return (parseFloat(s) * 180) / Math.PI;
  if (s.endsWith('grad')) return parseFloat(s) * 0.9;
  return parseFloat(s);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parses hex, rgb(a), hsl(a), oklch, oklab, named colors and `transparent`. Returns null for anything else. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) return parseHex(s);
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS.get(s);
  if (named) return parseHex('#' + named);

  const m = /^([a-z]+)\((.*)\)$/.exec(s);
  if (!m) return null;
  const [, fn, body] = m;
  if (body.includes('var(') || body.includes('calc(') || body.includes('from ')) return null;
  const args = splitArgs(body);
  if (!args) return null;
  const { parts, alpha } = args;
  const a = parseAlpha(alpha);
  if ([...parts, alpha ?? '0'].some((p) => p !== 'none' && Number.isNaN(parseFloat(p)))) return null;

  switch (fn) {
    case 'rgb':
    case 'rgba': {
      const [r, g, b] = parts.map((p) => clamp(num(p, 255), 0, 255));
      return { r, g, b, a };
    }
    case 'hsl':
    case 'hsla': {
      const [r, g, b] = hslToRgb(parseHue(parts[0]), clamp(num(parts[1], 100) / 100, 0, 1), clamp(num(parts[2], 100) / 100, 0, 1));
      return { r, g, b, a };
    }
    case 'oklch': {
      const l = num(parts[0], 1);
      const c = num(parts[1], 0.4);
      return oklchToRgb({ l, c, h: parseHue(parts[2]), a });
    }
    case 'oklab': {
      const [L, A, B] = [num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4)];
      const [r, g, b] = oklabToLinear(L, A, B).map((v) => clamp(linearToSrgb(v), 0, 255));
      return { r, g, b, a };
    }
    default:
      return null;
  }
}

const srgbToLinear = (v: number) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055) * 255;

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgbToOklch({ r, g, b, a }: RGBA): OKLCH {
  const [L, A, B] = linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h, a };
}

/** Converts back to sRGB, reducing chroma until the color fits the gamut. */
export function oklchToRgb({ l, c, h, a }: OKLCH): RGBA {
  const rad = (h * Math.PI) / 180;
  let lin: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 12; i++) {
    lin = oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad));
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) break;
    c *= 0.8;
  }
  const [r, g, b] = lin.map((v) => clamp(linearToSrgb(clamp(v, 0, 1)), 0, 255));
  return { r, g, b, a };
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, '0');

export function formatColor({ r, g, b, a }: RGBA): string {
  if (a >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance({ r, g, b }: RGBA): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Alpha-composites `top` over an opaque `bottom`. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}
