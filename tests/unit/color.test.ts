import { describe, expect, it } from 'vitest';
import { contrastRatio, formatColor, oklchToRgb, parseColor, rgbToOklch } from '../../src/shared/color';

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00000080')!.a).toBeCloseTo(0.502, 2);
    expect(parseColor('#12345')).toBeNull();
  });
  it('parses rgb/rgba in comma and space syntax', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(0 128 255 / 50%)')).toEqual({ r: 0, g: 128, b: 255, a: 0.5 });
  });
  it('parses hsl, named, transparent', () => {
    const c = parseColor('hsl(120, 100%, 50%)')!;
    expect([Math.round(c.r), Math.round(c.g), Math.round(c.b)]).toEqual([0, 255, 0]);
    expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')!.a).toBe(0);
  });
  it('parses oklch', () => {
    expect(Math.round(parseColor('oklch(1 0 0)')!.r)).toBe(255);
  });
  it('rejects unparseable values', () => {
    expect(parseColor('rgb(var(--r), 0, 0)')).toBeNull();
    expect(parseColor('currentcolor')).toBeNull();
    expect(parseColor('notacolor')).toBeNull();
  });
});

describe('oklch round trip', () => {
  it('round-trips sRGB colors', () => {
    for (const hex of ['#ff0000', '#1e1f22', '#e3e3e3', '#336699', '#000000', '#ffffff']) {
      expect(formatColor(oklchToRgb(rgbToOklch(parseColor(hex)!)))).toBe(hex);
    }
  });
});

describe('contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 1);
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1);
  });
});
