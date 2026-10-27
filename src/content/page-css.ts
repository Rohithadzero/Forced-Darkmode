// CSS builders for the base layer (CSS engine) and the filter engine. Pure functions.

import { formatColor, parseColor } from '../shared/color';
import type { EffectiveConfig } from '../shared/site';
import type { Theme } from '../shared/themes';
import type { ColorMapper } from './css-engine/map-color';
import { LAYER_ORDER } from './css-engine/rewrite';

/**
 * Base sheet for the CSS engine. Unlayered normal declarations only fill gaps the page leaves
 * (user-origin normal loses to any author rule); color-scheme flips UA widgets and scrollbars.
 */
export function baseCss(theme: Theme, cfg: EffectiveConfig, map: ColorMapper): string {
  const bg = formatColor(map(parseColor('#ffffff')!, 'bg'));
  const text = formatColor(map(parseColor('#000000')!, 'text'));
  let css =
    LAYER_ORDER +
    `:root{color-scheme:dark!important}` +
    `html{background-color:${bg};color:${text}}` +
    `:link{color:${theme.link}}:visited{color:${theme.visited}}` +
    `::selection{background-color:${theme.selection}!important;color:${text}!important}`;
  if (cfg.dimImages) css += `img,video,picture,svg image{filter:brightness(.8) contrast(1.1)}`;
  return css;
}

const MEDIA = 'img,video,canvas,embed,object,iframe,svg image,[style*="background-image"],[style*="background:url"],[style*="background: url"]';

/**
 * Filter engine: invert the whole page, then re-invert media so photos look normal.
 * contrast() after the invert lifts pure black to the theme background (gray/dim) or keeps it (OLED).
 */
export function filterCss(theme: Theme, cfg: EffectiveConfig): string {
  const contrast = +(theme.filterContrast * (cfg.contrast / 100)).toFixed(3);
  const brightness = +(cfg.brightness / 100).toFixed(3);
  const sepia = +Math.max(theme.filterSepia, cfg.sepia / 100).toFixed(3);
  const f = `invert(1) hue-rotate(180deg) contrast(${contrast}) brightness(${brightness}) sepia(${sepia})`;
  const back = `invert(1) hue-rotate(180deg)${cfg.dimImages ? ' brightness(.85)' : ''}`;
  return (
    `html{filter:${f}!important;background-color:#fff!important}` +
    // Media nested inside other re-inverted media must not flip twice.
    `:is(${MEDIA}):not(:is(${MEDIA}) *){filter:${back}!important}` +
    // Top-layer elements render outside <html>, so they need the page filter themselves.
    `dialog:modal,[popover]:popover-open{filter:${f}!important}` +
    `html:has(:fullscreen){filter:none!important}:fullscreen,:fullscreen :is(${MEDIA}){filter:none!important}`
  );
}
