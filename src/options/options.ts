import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, patchSite, saveSettings, SETTINGS_KEY, updateSettings, type ScheduleMode, type Settings } from '../shared/settings';
import { THEMES, THEME_IDS } from '../shared/themes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;

const save = (fn: (s: Settings) => void) => updateSettings(fn).then((s) => ((settings = s), render()));

function render() {
  const sch = settings.schedule;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === sch.mode)));
  $('times').hidden = sch.mode !== 'time';
  $<HTMLInputElement>('from').value = sch.from;
  $<HTMLInputElement>('to').value = sch.to;
  $('schedule-hint').textContent =
    sch.mode === 'always'
      ? 'Dark mode stays on until you turn it off.'
      : sch.mode === 'system'
        ? 'Dark only while your OS or browser uses a dark theme.'
        : 'Dark between these times (local time).';
  renderSites();
}

function option(value: string, label: string, selected: boolean) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

function renderSites() {
  const body = $('sites').querySelector('tbody')!;
  body.replaceChildren();
  const hosts = Object.keys(settings.sites).sort();
  $('sites').hidden = !hosts.length;
  $('sites-empty').hidden = !!hosts.length;
  for (const host of hosts) {
    const site = settings.sites[host];
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = host;

    const on = document.createElement('td');
    const toggle = document.createElement('label');
    toggle.className = 'switch';
    toggle.innerHTML = '<input type="checkbox"><span></span>';
    const cb = toggle.querySelector('input')!;
    cb.checked = site.enabled !== false;
    cb.setAttribute('aria-label', `Dark mode on ${host}`);
    cb.addEventListener('change', () => save((s) => patchSite(s, host, { enabled: cb.checked ? undefined : false })));
    on.append(toggle);

    const theme = document.createElement('td');
    const ts = document.createElement('select');
    ts.append(option('', 'Default', !site.theme), ...THEME_IDS.map((id) => option(id, THEMES[id].label, site.theme === id)));
    ts.addEventListener('change', () => save((s) => patchSite(s, host, { theme: ts.value || undefined })));
    theme.append(ts);

    const engine = document.createElement('td');
    const es = document.createElement('select');
    const autoLabel = site.fallback === 'filter' ? 'Auto (using filter)' : 'Auto';
    es.append(option('', autoLabel, !site.engine), option('css', 'CSS', site.engine === 'css'), option('filter', 'Filter', site.engine === 'filter'));
    es.addEventListener('change', () => save((s) => patchSite(s, host, { engine: es.value || undefined, fallback: undefined })));
    engine.append(es);

    const del = document.createElement('td');
    const x = document.createElement('button');
    x.className = 'ghost';
    x.textContent = 'Remove';
    x.addEventListener('click', () => save((s) => delete s.sites[host]));
    del.append(x);

    tr.append(name, on, theme, engine, del);
    body.append(tr);
  }
}

function bind() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => save((s) => (s.schedule.mode = b.dataset.mode as ScheduleMode))),
  );
  for (const id of ['from', 'to'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v) void save((s) => (s.schedule[id] = v));
    });
  }
  $('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  const msg = $('backup-msg');
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'force-dark-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $<HTMLInputElement>('import').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      settings = normalizeSettings(JSON.parse(await file.text()));
      await saveSettings(settings);
      msg.textContent = `Imported ${Object.keys(settings.sites).length} site settings.`;
      render();
    } catch {
      msg.textContent = 'That file is not a valid settings export.';
    }
  });
  $('reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings and site overrides?')) return;
    settings = structuredClone(DEFAULT_SETTINGS);
    await saveSettings(settings);
    msg.textContent = 'Settings reset.';
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      render();
    }
  });
}

void loadSettings().then((s) => {
  settings = s;
  bind();
  render();
});
