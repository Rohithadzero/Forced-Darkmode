# Force Dark Mode

Fast, glitch-free dark mode for every website in Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi).
Themes: **Gray**, **OLED Black**, **Dim / Warm**.

## Install (unpacked)

```sh
npm install
npm run build
```

Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked** and pick the `dist/` folder.
After rebuilding, press the reload icon on the extension card.

## How it works

Each page goes through a tiered pipeline:

1. **Pre-paint guard**: a tiny registered stylesheet paints `html`/`body` in the theme color at `document_start`, so there is no white flash.
2. **Native dark detection**: pages that are already dark are left alone.
3. **CSS engine** (default): only color declarations are mirrored from the page's stylesheets, remapped in OKLab, and injected as a user-origin stylesheet.
   - Work is time-sliced and incremental: only newly added rules are processed.
   - Results for large sheets are cached per site.
   - Cross-origin sheets are fetched by the service worker.
   - Also covered: CSS variables, gradients, inline styles, legacy `bgcolor`/`<font color>` attributes, open shadow DOM, CSS-in-JS (`insertRule`) and the site's own `prefers-color-scheme: dark` rules.
4. **Filter engine** (fallback): invert + re-invert media. Used when stylesheets can't be read, the CSS is huge, or text contrast turns out poor. The choice is remembered per site.

All CSS goes in through `chrome.scripting.insertCSS` as a user-origin sheet. Page Content-Security-Policy cannot block it, and page scripts cannot remove it.
Bot-check pages (Cloudflare, reCAPTCHA, hCaptcha) are never touched. Main-world hooks use `Proxy` so patched natives still look native.

## Controls

- **Popup**: global and per-site toggles, theme, brightness / contrast / sepia, dim images, engine (Auto / CSS / Filter). Changes can apply to all sites or only the current site.
- **Settings page**: schedule (always / follow system / time range), per-site list, import / export / reset.
- **Shortcuts**:
  - <kbd>Alt+Shift+D</kbd> toggles the current site.
  - <kbd>Alt+Shift+A</kbd> toggles everywhere.
  - <kbd>Alt+Shift+T</kbd> cycles the theme.
  - Change them at `chrome://extensions/shortcuts`.

## Development

| Command | What |
| --- | --- |
| `npm run build` | Build into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Build + end-to-end tests in Chromium with the extension loaded (needs `npx playwright install chromium` once) |
| `npm run typecheck` | TypeScript check |
| `npm run icons` | Regenerate `public/icons/*.png` |

`tests/e2e/visual.manual.ts` takes screenshots and records long tasks for any URLs:
`node --experimental-strip-types tests/e2e/visual.manual.ts <outDir> <url...>`

## Known limits

- Chrome's built-in PDF viewer and `chrome://` / Web Store pages cannot be themed by any extension.
- Closed shadow roots are not reachable.
- Images are never recolored (use **Dim images** to soften bright photos).
