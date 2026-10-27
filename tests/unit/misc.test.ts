import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { absolutizeUrls } from '../../src/content/css-engine/rewrite';
import { EXCLUDED_MATCHES } from '../../src/shared/site';

describe('absolutizeUrls', () => {
  it('resolves relative urls against the sheet', () => {
    expect(absolutizeUrls('url(img/a.png), linear-gradient(#000, #111)', 'https://cdn.x.com/css/s.css')).toBe(
      'url(https://cdn.x.com/css/img/a.png), linear-gradient(#000, #111)',
    );
    expect(absolutizeUrls('url("../b.svg")', 'https://x.com/a/c.css')).toBe('url("https://x.com/b.svg")');
  });
  it('leaves absolute, data and fragment urls', () => {
    for (const v of ['url(data:image/png;base64,AA)', 'url(https://a.com/x.png)', 'url(#grad)']) {
      expect(absolutizeUrls(v, 'https://x.com/')).toBe(v);
    }
  });
});

describe('manifest', () => {
  it('static content scripts skip the same bot-check pages as the shared list', () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../src/manifest.json'), 'utf8'));
    for (const cs of manifest.content_scripts) expect([...cs.exclude_matches].sort()).toEqual([...EXCLUDED_MATCHES].sort());
  });
});
