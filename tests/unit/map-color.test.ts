import { describe, expect, it } from 'vitest';
import { contrastRatio, formatColor, parseColor, rgbToOklch, type RGBA } from '../../src/shared/color';
import { THEMES, THEME_IDS } from '../../src/shared/themes';
import { createMapper } from '../../src/content/css-engine/map-color';

const c = (s: string) => parseColor(s)!;
const L = (x: RGBA) => rgbToOklch(x).l;
const neutral = { brightness: 100, contrast: 100, sepia: 0 };

describe.each(THEME_IDS)('mapper (%s)', (id) => {
  const theme = THEMES[id];
  const map = createMapper({ theme, ...neutral });

  it('maps white backgrounds to the theme background', () => {
    expect(Math.abs(L(map(c('#fff'), 'bg')) - L(c(theme.bg)))).toBeLessThan(0.01);
  });
  it('maps black text to the theme text lightness', () => {
    expect(Math.abs(L(map(c('#000'), 'text')) - L(c(theme.text)))).toBeLessThan(0.02);
  });
  it('keeps typical text readable on mapped page background', () => {
    const bg = map(c('#fff'), 'bg');
    for (const t of ['#000', '#333', '#555', '#0645ad', '#d00', '#228b22']) {
      expect(contrastRatio(map(c(t), 'text'), bg)).toBeGreaterThan(4.5);
    }
  });
  it('preserves surface ordering (lighter card stays distinguishable)', () => {
    expect(L(map(c('#f0f0f0'), 'bg'))).toBeGreaterThan(L(map(c('#ffffff'), 'bg')));
  });
  it('is near-idempotent on already-dark colors', () => {
    const dark = c('#202124');
    expect(Math.abs(L(map(dark, 'bg')) - L(dark))).toBeLessThan(0.08);
    expect(L(map(c('#e8eaed'), 'text'))).toBeGreaterThan(0.75);
  });
  it('turns translucent black overlays into translucent light overlays', () => {
    const out = map(c('rgba(0,0,0,0.1)'), 'bg');
    expect(out.a).toBeCloseTo(0.1);
    expect(L(out)).toBeGreaterThan(0.9);
  });
  it('leaves dark shadows dark', () => {
    expect(L(map(c('rgba(0,0,0,0.3)'), 'shadow'))).toBeLessThan(0.05);
  });
});

describe('adjustments', () => {
  it('brightness scales output lightness', () => {
    const a = createMapper({ theme: THEMES.gray, ...neutral });
    const b = createMapper({ theme: THEMES.gray, ...neutral, brightness: 80 });
    expect(L(b(c('#000'), 'text'))).toBeLessThan(L(a(c('#000'), 'text')));
  });
  it('OLED keeps white backgrounds pure black', () => {
    const m = createMapper({ theme: THEMES.oled, ...neutral });
    expect(formatColor(m(c('#fff'), 'bg'))).toBe('#000000');
  });
});
