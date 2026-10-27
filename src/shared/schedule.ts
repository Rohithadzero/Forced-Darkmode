import type { Schedule } from './settings';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when a time-range schedule is inside its window. "always"/"system" return true (system is checked by the page). */
export function scheduleAllows(s: Schedule, now: Date): boolean {
  if (s.mode !== 'time') return true;
  const from = toMinutes(s.from);
  const to = toMinutes(s.to);
  if (from === to) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/** Next Date at which a time-range schedule flips on or off. */
export function nextBoundary(s: Schedule, now: Date): Date | null {
  if (s.mode !== 'time' || s.from === s.to) return null;
  const candidates = [s.from, s.to].map((t) => {
    const d = new Date(now);
    const mins = toMinutes(t);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  });
  return candidates[0] < candidates[1] ? candidates[0] : candidates[1];
}
