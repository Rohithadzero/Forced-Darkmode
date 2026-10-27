import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, patchSite } from '../../src/shared/settings';
import { effectiveConfig, isExcludedUrl, siteKey, siteKeyFromUrl } from '../../src/shared/site';
import { nextBoundary, scheduleAllows } from '../../src/shared/schedule';

describe('settings', () => {
  it('fills defaults from garbage', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'nope', schedule: { mode: 'x', from: '25:00' } })).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps and drops invalid site fields', () => {
    const s = normalizeSettings({ sites: { 'A.com': { brightness: 999, theme: 'bad', engine: 'filter' }, 'b.com': { x: 1 } } });
    expect(s.sites).toEqual({ 'a.com': { brightness: 150, engine: 'filter' } });
  });
  it('patchSite removes entries that become empty', () => {
    const s = normalizeSettings({ sites: { 'a.com': { enabled: false } } });
    patchSite(s, 'a.com', { enabled: undefined });
    expect(s.sites).toEqual({});
  });
  it('effective config layers site over global', () => {
    const s = normalizeSettings({ theme: 'gray', sites: { 'a.com': { theme: 'oled', enabled: false } } });
    expect(effectiveConfig(s, 'a.com')).toMatchObject({ theme: 'oled', enabled: false, engine: 'auto' });
    expect(effectiveConfig(s, 'b.com')).toMatchObject({ theme: 'gray', enabled: true });
  });
});

describe('site helpers', () => {
  it('normalizes keys', () => {
    expect(siteKey('WWW.Example.com')).toBe('example.com');
    expect(siteKeyFromUrl('chrome://settings')).toBeNull();
    expect(siteKeyFromUrl('https://www.github.com/x')).toBe('github.com');
  });
  it('excludes bot-check pages', () => {
    expect(isExcludedUrl('https://challenges.cloudflare.com/cdn-cgi/x')).toBe(true);
    expect(isExcludedUrl('https://www.google.com/recaptcha/api2/anchor')).toBe(true);
    expect(isExcludedUrl('https://www.google.com/search')).toBe(false);
  });
});

describe('schedule', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
  const night = { mode: 'time' as const, from: '19:00', to: '07:00' };
  it('handles windows crossing midnight', () => {
    expect(scheduleAllows(night, at(23))).toBe(true);
    expect(scheduleAllows(night, at(6, 59))).toBe(true);
    expect(scheduleAllows(night, at(7))).toBe(false);
    expect(scheduleAllows(night, at(12))).toBe(false);
  });
  it('handles same-day windows and always mode', () => {
    expect(scheduleAllows({ mode: 'time', from: '09:00', to: '17:00' }, at(10))).toBe(true);
    expect(scheduleAllows({ mode: 'time', from: '09:00', to: '17:00' }, at(18))).toBe(false);
    expect(scheduleAllows({ ...night, mode: 'always' }, at(12))).toBe(true);
  });
  it('finds the next boundary', () => {
    expect(nextBoundary(night, at(12))!.getHours()).toBe(19);
    expect(nextBoundary(night, at(20))!.getHours()).toBe(7);
  });
});
