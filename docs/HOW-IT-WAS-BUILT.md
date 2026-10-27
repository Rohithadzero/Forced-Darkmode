# How Force Dark Mode Was Built

This guide explains, step by step and in simple words, how this browser extension was planned, built and tested.
Read it from top to bottom the first time. Later you can jump to any section.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [Step 1: Research — what other extensions do wrong](#2-step-1-research--what-other-extensions-do-wrong)
3. [Step 2: Decisions we made before coding](#3-step-2-decisions-we-made-before-coding)
4. [Step 3: The big idea — three ways to force dark mode](#4-step-3-the-big-idea--three-ways-to-force-dark-mode)
5. [Step 4: Tools and project setup](#5-step-4-tools-and-project-setup)
6. [Folder tour — what every file does](#6-folder-tour--what-every-file-does)
7. [What happens when you open a web page (timeline)](#7-what-happens-when-you-open-a-web-page-timeline)
8. [CSS ideas you need to understand this project](#8-css-ideas-you-need-to-understand-this-project)
9. [Each part explained](#9-each-part-explained)
10. [How we kept it fast](#10-how-we-kept-it-fast)
11. [Testing — how we proved it works](#11-testing--how-we-proved-it-works)
12. [Bugs we found and how we fixed them](#12-bugs-we-found-and-how-we-fixed-them)
13. [Known limits and ideas for later](#13-known-limits-and-ideas-for-later)
14. [Glossary (word list)](#14-glossary-word-list)

---

## 1. What we built

A **Chromium extension**. It works in Chrome, Edge, Brave, Opera and Vivaldi, because they are all built on Chromium.
It makes **every website dark**, even sites that have no dark mode of their own.

Main features:

- **3 themes:**
  - **Gray** — soft dark gray.
  - **OLED Black** — pure black. Black pixels are switched off on OLED screens, which saves battery.
  - **Dim / Warm** — brownish dark with warm text, for reading at night.
- **No white flash** when a page loads.
- **Works on strict websites** that try to block style changes (CSP).
- **Leaves already-dark websites alone.**
- **Per-site settings.** Each site can have its own on/off, theme, brightness, contrast, sepia and engine.
- **Schedule:** always on, follow your system's dark mode, or a time range (for example 19:00 → 07:00).
- **Keyboard shortcuts:**
  - `Alt+Shift+D` turns the current site on or off.
  - `Alt+Shift+A` turns it on or off everywhere.
  - `Alt+Shift+T` changes the theme.
- **Low CPU and memory use.**

---

## 2. Step 1: Research — what other extensions do wrong

Before writing any code, we searched the web to see what people complain about in existing dark mode extensions.

| Extension | Problem people report |
|---|---|
| **Dark Reader** (most popular) | Slow on heavy sites like Reddit, Facebook and Amazon. High memory use (its own blog mentions up to 10 GB on some sites). White flash when pages load. Breaks Cloudflare's "verify you are human" check. Some sites become unreadable. |
| **Night Eye** | You must pay after a free trial. |
| **Midnight Lizard** | Uses fixed themes, not automatic. Feels old. |
| **Turn Off the Lights** | Made mainly for video sites. |
| **Simple "invert" extensions** | Colors look strange and photos look wrong. |

**Lesson learned:** the biggest problems are
(1) being **slow**,
(2) the **white flash**,
(3) **breaking some sites**, and
(4) **breaking bot checks**.
We designed every part of this project to avoid these four.

---

## 3. Step 2: Decisions we made before coding

We asked questions first, so we wouldn't build the wrong thing. These were the answers:

| Question | Answer |
|---|---|
| Who is it for? | Personal use first. Built so it can be published to the Chrome Web Store later. |
| Extra features? | Native-dark detection, per-site memory, schedule, keyboard shortcuts. |
| Themes? | Gray, OLED Black, Dim / Warm. |
| Engine approach? | **Tiered hybrid** (explained in the next section). |
| Code language? | TypeScript + Vite. |

---

## 4. Step 3: The big idea — three ways to force dark mode

There are 3 known ways to make a website dark. Each one has good and bad sides.

### Way A: Invert filter (simple)

Put `filter: invert(1)` on the whole page. White becomes black and black becomes white.

- ✅ Very fast. Works on every site.
- ❌ Photos turn into negatives, so you must "re-invert" them.
- ❌ Colors shift: red becomes cyan. That's why we also add `hue-rotate(180deg)`, which turns the colors back.
- ❌ OLED black is harder to get exactly right.

### Way B: Rewrite all CSS (what Dark Reader does)

Read every style rule on the page and replace each color with a dark version.

- ✅ Looks the best.
- ❌ Slow and memory-hungry when done naively. This is exactly what people complain about.

### Way C: Our choice — tiered hybrid

We use Way B, but done **smartly and lazily**, and we keep Way A as a **backup**:

1. Paint a dark background **before** the page shows (no white flash).
2. If the page is **already dark** → do nothing.
3. Otherwise use the **CSS engine** (smart Way B):
   - Only copy **color** rules, never layout rules.
   - Only process **new** rules, never the same rule twice.
   - Do the work in **small pieces** when the browser is idle.
   - **Cache** big results.
4. If the CSS engine can't do a good job → switch to the **filter engine** (Way A) and remember that choice for the site.

---

## 5. Step 4: Tools and project setup

| Tool | Why we use it |
|---|---|
| **Node.js** | Runs the build and test tools on your computer. |
| **npm** | Installs those tools (`npm install`). |
| **TypeScript** | JavaScript with types. It catches mistakes before running (for example, passing a number where text is expected). |
| **Vite** | Bundles our many `.ts` files into a few `.js` files the browser can load. |
| **Vitest** | Runs **unit tests**, small tests of single functions. |
| **Playwright** | Opens a real Chromium browser with our extension loaded and checks that pages really turn dark (**end-to-end tests**). |
| **@types/chrome** | Gives TypeScript knowledge of the `chrome.*` extension APIs. |

We added **no libraries to the extension itself**. All the code that runs in your browser is ours. That keeps it small (about 33 KB).

### Commands

```sh
npm install          # download tools (once)
npm run build        # build the extension into dist/
npm test             # run unit tests
npm run test:e2e     # build + run browser tests (run `npx playwright install chromium` once first)
npm run typecheck    # check TypeScript types
npm run icons        # re-draw the icon PNG files
```

### Why a custom build script (`scripts/build.mjs`)?

Chrome has a rule: **content scripts cannot be ES modules**, so they can't use `import`.
So the build script builds in three steps:

1. Builds the **popup** and **options** pages normally with Vite.
2. Builds `background.js`, `content.js` and `hooks.js` each as **one self-contained file**. This is called an "IIFE": everything is wrapped in one function, with no imports.
3. Copies `manifest.json` and the icons, and **generates the 6 pre-paint CSS files** from `themes.json`. Those 6 are: 3 themes × 2 versions ("always" and "follow system").

---

## 6. Folder tour — what every file does

```
Force-Darkmode/
├── src/
│   ├── manifest.json            ← the extension's "ID card" for Chrome
│   ├── shared/                  ← code used by every part
│   │   ├── color.ts             ← read colors, convert to OKLab, measure contrast
│   │   ├── themes.json/.ts      ← the 3 theme palettes
│   │   ├── settings.ts          ← what settings exist, defaults, validation
│   │   ├── site.ts              ← site names, bot-check exclusions, final per-site config
│   │   ├── schedule.ts          ← "is it dark time now?" math
│   │   └── messages.ts          ← message types between parts
│   ├── background/
│   │   └── service-worker.ts    ← the extension's "brain" running in the background
│   ├── content/                 ← code that runs inside every web page
│   │   ├── bootstrap.ts         ← entry point: decides what to do on this page
│   │   ├── detect.ts            ← "is this page already dark?", contrast check
│   │   ├── page-css.ts          ← base CSS + filter-engine CSS
│   │   ├── injector.ts          ← puts our CSS into the page
│   │   ├── observer.ts          ← watches the page for changes
│   │   └── css-engine/
│   │       ├── map-color.ts     ← turns one light color into one dark color
│   │       ├── transform.ts     ← finds colors inside a CSS value and replaces them
│   │       ├── rewrite.ts       ← walks the page's CSS rules and copies only color parts
│   │       ├── inline.ts        ← handles style="..." and old bgcolor="..." attributes
│   │       ├── cache.ts         ← remembers results for big stylesheets
│   │       └── engine.ts        ← the manager: tracks stylesheets, time-slices work
│   ├── main-world/
│   │   └── hooks.ts             ← tiny spy inside the page's own JavaScript world
│   ├── popup/                   ← the small window when you click the icon
│   ├── options/                 ← the full settings page
│   └── ui/ui.css                ← shared look for popup + options
├── scripts/
│   ├── build.mjs                ← builds everything into dist/
│   └── gen-icons.mjs            ← draws the moon icon without any image library
├── tests/
│   ├── unit/                    ← fast tests of pure functions
│   └── e2e/                     ← real-browser tests + test web pages
└── public/icons/                ← generated icon PNGs
```

---

## 7. What happens when you open a web page (timeline)

Follow one page from start to finish:

```
You type a URL and press Enter
│
├─ 0 ms   Chrome starts loading the page.
│         ① Pre-paint CSS is applied immediately (registered earlier by the service worker).
│            → html and body are already painted dark. NO white flash.
│         ② hooks.js starts in the page's own world (it watches for style changes later).
│         ③ content.js (bootstrap.ts) starts and reads your settings from storage.
│
├─ when <body> exists
│         ④ Is this a Cloudflare/captcha page? → do nothing, step away.
│         ⑤ Is dark mode on for this site and time? If not → remove the guard and stop.
│         ⑥ Is the page already dark? → mark it "native" and stop.
│         ⑦ Start the CSS engine:
│            - read all stylesheets
│            - copy only color rules, turned dark
│            - fetch blocked cross-origin stylesheets through the service worker
│            - send the result to the service worker, which injects it
│         ⑧ Mark the page `data-fdm="css"` → the pre-paint guard turns off.
│            The real dark styles are already in place, so you see no jump.
│
├─ while you use the page
│         ⑨ The observer + hooks notice new styles, new elements and shadow DOM.
│            Changes are collected and processed together ~0.1 s later, when the browser is idle.
│
└─ 1.5 s after page load
          ⑩ Contrast check: is the text readable? If too much text is hard to read
             → switch this site to the filter engine and remember that.
```

---

## 8. CSS ideas you need to understand this project

### 8.1 Origins: who wrote the style?

The browser has 3 sources of styles:

1. **User-agent**: the browser's own default styles (for example, links are blue).
2. **User**: styles from the user. Extensions can add these with `chrome.scripting.insertCSS({ origin: 'USER' })`.
3. **Author**: the website's own styles.

Normal rules: **author beats user**.
But for `!important` rules, the order **flips**: **user `!important` beats author `!important`**. It even beats inline styles.

So we inject **user-origin `!important`** rules. The website can't override them, and its CSP can't block them. That's our main trick for "works on every site."

### 8.2 Specificity: which rule wins inside the same origin?

`#id` beats `.class`, and `.class` beats `div`. We **copy the site's own selectors exactly**, so the same rules keep winning as before. Only the colors change.

### 8.3 Cascade layers (`@layer`)

A layer is a named group of rules. For `!important` rules, **the earlier layer wins**. We use 4 layers, in this order:

```css
@layer fdm-inline, fdm-native, fdm-imp, fdm-sheet;
```

- `fdm-inline`: colors from `style="..."`. This must win, just like a real inline style wins.
- `fdm-native`: the site's own dark-mode rules (designers made them, so we trust them).
- `fdm-imp`: rules the site marked `!important`.
- `fdm-sheet`: all other copied rules.

This keeps the site's original "who wins" order, even though all our rules are `!important`.

### 8.4 Shorthand vs. longhand

- `background: #fff url(a.png) no-repeat` is a **shorthand**. One property sets many things.
- `background-color: #fff` is a **longhand**. It sets one thing.

We only write **longhands**, like `background-color`. If we wrote the shorthand `background`, we would accidentally erase the site's background images. (This would be a real glitch.)

### 8.5 CSS variables

Modern sites write `:root { --bg: #fff }` and then `body { background: var(--bg) }`.
We create a **dark twin** for each color variable. For example, `--bg` gets the twin `--fdmb-bg`, where `b` = background role.
Then we rewrite every use of it as:

```css
background-color: var(--fdmb-bg, var(--bg)) !important;
```

The part after the comma is a **safety net**: if our twin is missing, the original value is used instead of "nothing."

### 8.6 CSP (Content Security Policy)

CSP is a security header. Sites use it to block injected `<style>` tags and inline styles.
Our CSS doesn't come through the page; it comes from the browser's extension system (`insertCSS`), so CSP doesn't apply to it.

### 8.7 Shadow DOM

Some sites use "web components" that hide their insides in a **shadow root**. Page-level CSS can't reach inside.
For those, we put a separate sheet **inside** each shadow root using `adoptedStyleSheets`.

---

## 9. Each part explained

### 9.1 `manifest.json`: the ID card

It tells Chrome:

- **Permissions:**
  - `storage` to save settings.
  - `scripting` to inject CSS.
  - `alarms` for the schedule.
  - `<all_urls>` to work on every site.
- **Scripts:**
  - `background.js` runs as the background service worker.
  - Two scripts run on every page and every frame at `document_start`, as early as possible:
    - `hooks.js` runs in the page's **MAIN world**.
    - `content.js` runs in the extension's **isolated world**.
- **Bot-check exclusions:** Cloudflare, reCAPTCHA and hCaptcha pages are excluded, so we never break them.
- **Shortcuts** and the **popup** / **options** pages.

### 9.2 `service-worker.ts`: the background brain

- **Registers the pre-paint CSS** with `chrome.scripting.registerContentScripts`.
  Chrome applies this CSS by itself, instantly, with no waiting. That's why there's no white flash.
  Disabled sites are skipped through `excludeMatches`.
- **Injects and removes our CSS** when a page asks, with `insertCSS` / `removeCSS` using origin `USER`.
- **Fetches cross-origin stylesheets.** A page can't read CSS from another domain (CORS rules), but the extension can, because it has host permission.
- **Schedule:** sets an **alarm** for the next on/off time. When it fires, it tells all pages to re-check.
- **Shortcuts:** handles `toggle-site`, `toggle-global` and `cycle-theme`.
- **Badge** on the icon:
  - `F` = filter engine.
  - `N` = native dark.
  - `off` = disabled.

### 9.3 Pre-paint CSS (generated in `build.mjs`)

```css
html:not([data-fdm]) { background-color: #1e1f22 !important; color-scheme: dark !important }
html:not([data-fdm]) body { background-color: #1e1f22 !important }
```

`:not([data-fdm])` means "only until the content script adds the `data-fdm` attribute." Once the real engine is ready, it sets that attribute and the guard switches off by itself.

### 9.4 `bootstrap.ts`: the decision maker

It decides one mode per page:

| Mode | Meaning |
|---|---|
| `off` | Dark mode is off here (disabled, outside schedule, or system is light) |
| `excluded` | Bot-check page, never touched |
| `native` | Page is already dark, left alone |
| `css` | CSS engine is running |
| `filter` | Filter engine is running |

It also listens for settings changes, so the page updates **live** without a reload.
It compares a "key" of the settings, so changes to **other** sites don't rebuild **this** page.

### 9.5 `detect.ts`

- **`isNativelyDark()`**: briefly lifts our guard, reads the page's real background color, then puts the guard back.
  This all happens in the same instant, so nothing flickers.
  If the background is dark (OKLab lightness < 0.4), the page is already dark.
- **`isChallengePage()`**: finds Cloudflare challenge pages that run on the site's own domain.
- **`contrastLooksBroken()`**: checks up to 40 visible pieces of text.
  If more than 25% have a contrast below 3:1 → the CSS engine did a bad job → switch to the filter engine.

### 9.6 `color.ts` + `map-color.ts`: the color math

Colors are converted to **OKLab / OKLCH**. These are color spaces where "lightness" matches what human eyes see.
(Plain RGB does not: yellow and blue with the same RGB "brightness" look very different to us.)

Each color gets a **role**, because the same color needs a different result depending on its job:

| Role | Used for | What happens |
|---|---|---|
| `bg` | backgrounds | white → theme background; already-dark stays dark |
| `text` | text, icons | black → light text; light text stays light |
| `border` | borders, outlines | like bg, but a bit lighter so lines stay visible |
| `shadow` | box/text shadows | dark shadows stay dark |

Extra smart rules:

- **See-through black hover overlays** (`rgba(0,0,0,0.1)`) become **see-through white**. Otherwise hover effects would vanish on a dark page.
- **Very bright colors are softened** (lower chroma). Otherwise they glow on dark backgrounds.
- **Dim theme**: gray colors get tinted warm.
- **Brightness / contrast / sepia** are done **in the math**, not with a CSS filter. That costs zero extra GPU work.

### 9.7 `transform.ts`: finding colors inside values

A CSS value like `0 1px 2px rgba(0,0,0,.3), inset 0 0 0 1px #000` has colors hidden inside. We scan it character by character and handle each kind of piece:

| Found | What we do |
|---|---|
| `#fff`, `rgb()`, `hsl()`, `oklch()`, `white` | map the color |
| `var(--x)` | point it at our dark twin, with the original as safety net |
| `linear-gradient(...)` | go inside and map its colors |
| `url(...)`, `light-dark(...)` | leave alone |

Results are cached in a `Map`, so the same color is never calculated twice.

### 9.8 `rewrite.ts`: copying only color rules

It walks through every CSS rule:

- **Normal style rules**: copy the selector, keep only color properties, and map them.
- **`@media`, `@supports`, `@container`, nested CSS**: keep the wrapper, go inside.
- **`@import`**: go into the imported sheet. If it's blocked, ask the service worker to fetch it.
- **`@media (prefers-color-scheme: dark)`**: this is the **site's own dark mode**! We copy these rules **raw** (unchanged) into the `fdm-native` layer, so you get the designer's real dark theme. This is why GitHub looks exactly like its official dark mode.

### 9.9 `inline.ts`: `style="..."` and old HTML

- Elements with `style="background:#fff"` get a marker attribute (`data-fdm-i="12"`) and a matching rule.
- **Old HTML** like `<td bgcolor="#ff6600">` or `<font color="black">` (Hacker News uses these!) is handled too.
- **"Hot element" protection:** if an element changes its style more than 12 times per second (an animation), we ignore it for 5 seconds. This stops CPU waste. It was a real Dark Reader problem.

### 9.10 `engine.ts`: the manager

- Keeps a record for every stylesheet: **how many rules we already processed**.
- When a site adds rules (CSS-in-JS libraries do this all the time), we **only process the new ones**.
- If a rule was removed or inserted in the middle, we redo just that one sheet.
- **Time slicing:**
  - It processes 250 rules at a time.
  - If more than ~10 ms have passed (40 ms on the first pass), it **pauses** and lets the page breathe.
- **Pauses completely while the tab is hidden.**
- Big new pieces are **appended** as new chunks. Every 24 chunks, they're merged into one.

### 9.11 `injector.ts`: delivering CSS

- **Page:** sends CSS to the service worker → `insertCSS` (user origin, CSP-proof).
  It inserts the new CSS **first** and removes the old CSS **after**, so there's never a moment without styles.
- **Shadow roots:** a constructed `CSSStyleSheet` added to that root's `adoptedStyleSheets`.

### 9.12 `cache.ts`

For big stylesheets (300+ rules), the generated dark CSS is saved in `chrome.storage.local`.

- The cache key includes: the sheet's URL, its size, and your theme settings. If any of these change, the cache is not used.
- Total size limit is 4 MB. The oldest entries are removed first (this is called **LRU**).

### 9.13 `hooks.ts`: the spy in the main world

Some changes don't touch the HTML, so a `MutationObserver` can't see them:

- `sheet.insertRule(...)`, used by CSS-in-JS libraries.
- `adoptedStyleSheets = [...]`
- `attachShadow(...)`, which creates new shadow roots.

So we wrap these browser functions to send a small signal event.

**Clever part:** we wrap them with a JavaScript `Proxy`. Bot-detection scripts check whether browser functions were changed by calling `.toString()`. A normal wrapper would show our code. A Proxy still prints `function insertRule() { [native code] }`. So we don't look suspicious, and bot checks keep working.

Many signals in a row are combined into **one** event (using `queueMicrotask`).

### 9.14 `observer.ts`

One `MutationObserver` watches the whole page (and each shadow root). It **only writes down** what changed:

- New `<style>` or `<link>` elements.
- Changed `style="..."` attributes.
- Newly added elements.

The heavy work happens later, in the engine's idle flush. Keeping the callback tiny keeps scrolling smooth.

### 9.15 `page-css.ts`: base CSS and filter CSS

**Base CSS:**

- `color-scheme: dark` makes the browser's own parts dark: scrollbars, inputs and checkboxes.
- It also adds default link colors and text-selection colors.

**Filter CSS:**

```css
html { filter: invert(1) hue-rotate(180deg) contrast(0.76) ... }
img, video, ... { filter: invert(1) hue-rotate(180deg) }   /* flip photos back */
```

Extra fixes:

- Images that sit inside other images are not flipped twice.
- Popups and dialogs live outside `<html>` (in the "top layer"), so they get the filter separately.
- Fullscreen video gets **no** filter.

### 9.16 Popup and options

- **Popup:**
  - On/off switches for "everywhere" and for the current site.
  - 3 theme preview cards.
  - Sliders for brightness, contrast and sepia, plus "Dim images".
  - Engine choice: Auto / CSS / Filter.
  - An **"All sites / This site"** switch decides where your changes are saved.
  - Sliders save when you **let go** (`change` event), not while dragging. Every save re-themes your open pages, so this saves work.
- **Options page:**
  - Schedule.
  - A list of all your site settings.
  - Shortcut info.
  - Export / import / reset.

### 9.17 `settings.ts`: safe settings

Everything read from storage or from an imported file goes through `normalizeSettings()`. It:

- Fixes wrong types.
- Limits numbers to safe ranges (brightness 50–150).
- Fills in missing values with defaults.

So a broken or hand-edited file can never crash the extension.

### 9.18 `gen-icons.mjs`: drawing an icon with zero libraries

It draws the moon pixel by pixel:

- The moon is a circle minus a second, offset circle.
- Each pixel is sampled 16 times (4×4) so the edges look smooth (anti-aliasing).
- Then it writes a real PNG file by hand: header, zlib-compressed pixel data, and a CRC checksum.

It's a good small example of how image files actually work.

---

## 10. How we kept it fast

| Trick | Why it helps |
|---|---|
| Only copy **color** properties | Much less CSS for the browser to handle |
| Process only **new** rules | Fast on sites that keep adding styles |
| **Time slicing** + idle callbacks | The page never freezes |
| **Pause when tab hidden** | Zero work in background tabs |
| **Batch** changes (~120 ms) | 1,000 small changes → 1 update |
| **Cache** big sheets | Second visit is faster |
| Color result **memo** (`Map`) | Same color never calculated twice |
| **Hot element** ignore | Animations don't burn CPU |
| Brightness/contrast in **math, not filters** | No extra GPU work |
| Early exit on disabled sites | Almost zero cost |
| No libraries | Small 33 KB content script |

**Measured on real sites:** about +30–50 ms of extra main-thread work during page load. After that it's quiet.

---

## 11. Testing — how we proved it works

### Unit tests (`tests/unit/`, 50 tests, run with `npm test`)

These test the pure math and logic, with no browser needed:

- Color reading (hex, rgb, hsl, oklch, named colors).
- OKLab round-trip: convert there and back, and get the same color.
- Every theme keeps text readable: contrast above 4.5, the WCAG standard.
- OLED white → exactly `#000000`.
- Value transform: gradients, shadows, `var()`; urls left alone.
- Settings validation, schedule across midnight, site name rules.
- The manifest's bot-check list matches the code's list.

### End-to-end tests (`tests/e2e/extension.spec.ts`, 12 tests)

Playwright opens real Chromium **with the extension loaded** and checks real computed colors on test pages in `tests/e2e/fixtures/`:

- A light page turns dark (cards, buttons, links, vars, gradients, inline styles, `!important`).
- A cross-origin stylesheet is fetched and darkened.
- The site's own dark-mode rules are used.
- An already-dark page is left alone.
- A strict-CSP page still turns dark.
- `insertRule`, late elements and shadow DOM are tracked.
- Old `bgcolor` / `<font color>` work.
- OLED is pure black, and the filter engine works.
- Turning a site off restores it live.
- Patched functions still look `[native code]`.

### Real-site checks (`tests/e2e/visual.manual.ts`)

We took screenshots of Wikipedia, GitHub, Hacker News, MDN and BBC, and measured "long tasks" (moments where the page is busy for over 50 ms) with and without the extension.

---

## 12. Bugs we found and how we fixed them

Real testing found real problems. This is normal. It's why we test.

1. **Red text was too dark to read.**
   - A unit test showed `#d00` red had contrast 4.45 (it needs 4.5+).
   - **Fix:** changed the text lightness curve in `map-color.ts`, so dark colors become a bit lighter.
2. **Wikipedia had white fade bars.**
   - A probe script found they came from `::after` pseudo-elements with `background: linear-gradient(..., var(--x))`.
   - When a shorthand uses `var()`, the browser reports its longhands as empty, so we skipped it.
   - **Fix:** read the shorthand, pull out the gradient layers, and write them as `background-image`.
3. **Hacker News switched to the filter engine.**
   - It uses 1990s-style HTML (`<td bgcolor="#ff6600">`), which isn't CSS, so our engine didn't see it. The contrast check then failed.
   - **Fix:** added support for `bgcolor`, `<font color>` and `<body text>`. These rules get zero specificity, so real CSS still wins over them.
4. **Relative image paths could break.**
   - Our CSS isn't loaded from the site's CSS file location, so `url(img/a.png)` could point to the wrong place.
   - **Fix:** turn every url into a full address based on the original sheet.

---

## 13. Known limits and ideas for later

**Can't be done by any extension:**

- Chrome's built-in PDF viewer.
- `chrome://` pages.
- The Chrome Web Store itself.

**Not done yet:**

- **Closed** shadow roots are unreachable on purpose (the browser hides them).
- Photos are never recolored (use "Dim images" to soften them).
- Sunset-based schedule (needs your location).
- Store-ready polish: onboarding page, privacy policy, translations (i18n), store screenshots.

---

## 14. Glossary (word list)

| Word | Simple meaning |
|---|---|
| **Extension** | A small add-on program for the browser |
| **Manifest** | The extension's settings/ID file that Chrome reads first |
| **MV3** | Manifest Version 3, the current Chrome extension format |
| **Service worker** | Background script of the extension; wakes up when needed |
| **Content script** | Our script that runs inside each web page |
| **Isolated world / Main world** | Content scripts see the page but have their own JavaScript space (isolated). The "main world" is the page's own JavaScript space |
| **CSS** | The language that styles web pages (colors, sizes, layout) |
| **Selector** | The part of a CSS rule that picks elements, like `.card` |
| **Specificity** | How "strong" a selector is when two rules fight |
| **Cascade** | The browser's rules for deciding which style wins |
| **Origin** | Who wrote a style: browser, user (extension), or website |
| **`!important`** | Makes a style declaration stronger |
| **Cascade layer** | A named group of CSS rules with its own priority |
| **CSP** | Content Security Policy, a website's security rules about what code/styles may load |
| **CORS** | Browser rule stopping a page from reading files of another website |
| **Shadow DOM** | Hidden inside part of a web component |
| **CSS-in-JS** | Libraries that create CSS from JavaScript while the page runs |
| **MutationObserver** | Browser tool that tells you when the page's HTML changes |
| **Proxy** | A JavaScript wrapper that can watch calls to a function |
| **OKLab / OKLCH** | Color spaces where lightness matches what eyes see |
| **Contrast ratio** | How different text and background brightness are (WCAG says 4.5+ for normal text) |
| **Time slicing** | Splitting long work into small pieces so the page stays smooth |
| **Cache** | Saved results so you don't redo work |
| **LRU** | "Least Recently Used": delete what was used longest ago first |
| **IIFE** | A file where all code is wrapped in one function that runs once; needed for content scripts |
| **Unit test** | Test of one small function |
| **E2E test** | "End-to-end" test of the whole thing in a real browser |
| **Long task** | Moment the page is busy for over 50 ms (can feel laggy) |
