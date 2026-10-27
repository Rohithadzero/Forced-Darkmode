import { oklchToRgb, parseColor, rgbToOklch, type RGBA } from '../../shared/color';
import type { Theme } from '../../shared/themes';

/**
 * Role decides how lightness is remapped:
 *  bg     — light surfaces become dark, already-dark stay dark
 *  text   — dark text becomes light, light text stays light
 *  border — like bg but kept a step above the background
 *  shadow — dark shadows untouched, light glows darkened
 */
export type Role = 'bg' | 'text' | 'border' | 'shadow';

export interface MapParams {
  theme: Theme;
  brightness: number; // 100 = neutral
  contrast: number; // 100 = neutral
  sepia: number; // 0..100
}

export type ColorMapper = (c: RGBA, role: Role) => RGBA;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const MAX_BG_CHROMA = 0.14;
const MAX_TEXT_CHROMA = 0.16;
const SEPIA_HUE = 75;

export function createMapper(p: MapParams): ColorMapper {
  const bg = rgbToOklch(parseColor(p.theme.bg)!);
  const text = rgbToOklch(parseColor(p.theme.text)!);
  const bgL = bg.l;
  const textL = text.l;
  // Warm themes tint neutral colors toward their background hue.
  const tint = bg.c > 0.005 ? { h: bg.h, c: bg.c } : null;
  const k = p.contrast / 100;
  const bright = p.brightness / 100;
  const sepia = p.sepia / 100;

  return (color, role) => {
    const { l, c, h, a } = rgbToOklch(color);
    let l2: number;
    let c2: number;
    const translucentDark = a < 0.5 && l < 0.5;

    switch (role) {
      case 'bg':
        if (translucentDark) l2 = 1 - l; // hover overlays: darken-on-light becomes lighten-on-dark
        else if (l >= 0.5) l2 = bgL + (1 - l) * 0.6;
        else l2 = Math.min(Math.max(l, bgL), bgL + 0.3);
        c2 = Math.min(c * 0.85, MAX_BG_CHROMA);
        break;
      case 'border':
        if (translucentDark) l2 = 1 - l;
        else if (l >= 0.5) l2 = bgL + 0.08 + (1 - l) * 0.5;
        else l2 = Math.min(Math.max(l, bgL + 0.08), bgL + 0.4);
        c2 = Math.min(c * 0.85, MAX_BG_CHROMA);
        break;
      case 'shadow':
        l2 = l < 0.5 ? l : bgL + (1 - l) * 0.3;
        c2 = c;
        break;
      case 'text':
        if (l < 0.6) l2 = textL - l * 0.35;
        else l2 = textL - 0.21 + ((l - 0.6) / 0.4) * 0.21;
        c2 = Math.min(c, MAX_TEXT_CHROMA);
        break;
    }

    let h2 = h;
    if (tint && c2 < 0.03) {
      h2 = tint.h;
      c2 = Math.max(c2, role === 'text' ? tint.c * 0.6 : tint.c);
    }
    if (sepia > 0 && c2 < 0.05) {
      h2 = SEPIA_HUE;
      c2 += 0.05 * sepia;
    }
    if (role !== 'shadow') {
      l2 = bgL + (l2 - bgL) * k;
      l2 *= bright;
    }
    return oklchToRgb({ l: clamp01(l2), c: c2, h: h2, a });
  };
}
