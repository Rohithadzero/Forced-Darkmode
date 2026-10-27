// Builds the extension into dist/:
//  - popup/options pages (Vite HTML build)
//  - background / content / hooks as standalone IIFE bundles (content scripts cannot be ES modules)
//  - manifest.json, icons, and generated pre-paint CSS per theme

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src');
const dist = resolve(root, 'dist');

await build({
  configFile: false,
  root: src,
  base: './',
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: dist,
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(src, 'popup/popup.html'),
        options: resolve(src, 'options/options.html'),
      },
    },
  },
});

const scripts = {
  background: 'background/service-worker.ts',
  content: 'content/bootstrap.ts',
  hooks: 'main-world/hooks.ts',
};

for (const [name, entry] of Object.entries(scripts)) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: 'chrome120',
      lib: {
        entry: resolve(src, entry),
        formats: ['iife'],
        name: `fdm_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });
}

// Pre-paint guard: dark html/body until the content script marks the page (data-fdm attr).
const themes = JSON.parse(readFileSync(resolve(src, 'shared/themes.json'), 'utf8'));
mkdirSync(resolve(dist, 'prepaint'), { recursive: true });
for (const [id, t] of Object.entries(themes)) {
  const rule =
    `html:not([data-fdm]){background-color:${t.bg}!important;color-scheme:dark!important}` +
    `html:not([data-fdm]) body{background-color:${t.bg}!important}`;
  writeFileSync(resolve(dist, `prepaint/${id}.css`), rule);
  writeFileSync(resolve(dist, `prepaint/${id}-system.css`), `@media (prefers-color-scheme:dark){${rule}}`);
}

copyFileSync(resolve(src, 'manifest.json'), resolve(dist, 'manifest.json'));
const iconsDir = resolve(root, 'public/icons');
if (existsSync(iconsDir)) {
  mkdirSync(resolve(dist, 'icons'), { recursive: true });
  for (const f of readdirSync(iconsDir)) copyFileSync(resolve(iconsDir, f), resolve(dist, 'icons', f));
}

console.log('built → dist/');
