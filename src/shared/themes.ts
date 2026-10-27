import data from './themes.json';

export type ThemeId = keyof typeof data;

export interface Theme {
  label: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  link: string;
  visited: string;
  selection: string;
  /** contrast() applied after invert in filter mode; lifts black to the theme background. */
  filterContrast: number;
  filterSepia: number;
}

export const THEMES: Record<ThemeId, Theme> = data;
export const THEME_IDS = Object.keys(data) as ThemeId[];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in data;
}
