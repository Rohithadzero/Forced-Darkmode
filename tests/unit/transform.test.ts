import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/shared/themes';
import { createMapper } from '../../src/content/css-engine/map-color';
import { referencedVars, roleVar, transformCustomProp, transformValue, type TransformContext } from '../../src/content/css-engine/transform';

const ctx = (): TransformContext => ({
  map: createMapper({ theme: THEMES.oled, brightness: 100, contrast: 100, sepia: 0 }),
  cache: new Map(),
});

describe('transformValue', () => {
  it('maps hex, functional and named colors', () => {
    const t = ctx();
    expect(transformValue('#fff', 'bg', t)).toBe('#000000');
    expect(transformValue('rgb(255, 255, 255)', 'bg', t)).toBe('#000000');
    expect(transformValue('white', 'bg', t)).toBe('#000000');
  });
  it('maps colors inside gradients and shadows, keeps other tokens', () => {
    const out = transformValue('linear-gradient(to right, #fff 0%, rgba(255,255,255,0.5) 100%)', 'bg', ctx());
    expect(out).toBe('linear-gradient(to right, #000000 0%, rgba(0, 0, 0, 0.5) 100%)');
    const sh = transformValue('0 1px 2px rgba(0,0,0,0.3), inset 0 0 0 1px #000', 'shadow', ctx());
    expect(sh).toContain('0 1px 2px rgba(0, 0, 0, 0.3)');
  });
  it('rewrites var() with a role mirror and original fallback', () => {
    expect(transformValue('var(--bg)', 'bg', ctx())).toBe('var(--fdmb-bg, var(--bg))');
    expect(transformValue('var(--c, #fff)', 'bg', ctx())).toBe('var(--fdmb-c, var(--c, #000000))');
  });
  it('leaves urls, light-dark() and unparseable functions untouched', () => {
    const t = ctx();
    expect(transformValue('url("white.png")', 'bg', t)).toBe('url("white.png")');
    expect(transformValue('light-dark(#fff, #000)', 'bg', t)).toBe('light-dark(#fff, #000)');
    expect(transformValue('rgb(var(--r) 0 0)', 'bg', t)).toBe('rgb(var(--r) 0 0)');
  });
  it('does not treat identifiers inside words as colors', () => {
    expect(transformValue('redbox', 'text', ctx())).toBe('redbox');
    expect(transformValue('1px solid', 'border', ctx())).toBe('1px solid');
  });
});

describe('custom properties', () => {
  it('mirrors color props for every role', () => {
    const out = transformCustomProp('--surface', '#fff', ctx())!;
    expect(out.map(([n]) => n)).toEqual([roleVar('bg', '--surface'), '--fdmt-surface', '--fdmr-surface', '--fdms-surface']);
    expect(out[0][1]).toBe('#000000');
  });
  it('skips non-color props', () => {
    expect(transformCustomProp('--gap', '4px', ctx())).toBeNull();
    expect(transformCustomProp('--font', 'Arial, sans-serif', ctx())).toBeNull();
  });
  it('finds referenced vars', () => {
    expect(referencedVars('1px solid var(--a, var(--b))')).toEqual(['--a', '--b']);
  });
});
