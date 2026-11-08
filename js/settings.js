// Persistent user settings (localStorage) + keybind table.

const STORE = 'mfv4_settings_v1';

export const KEY_ACTIONS = [
  { id: 'forward', label: 'Move forward', def: 'KeyW' },
  { id: 'back', label: 'Move back', def: 'KeyS' },
  { id: 'left', label: 'Move left', def: 'KeyA' },
  { id: 'right', label: 'Move right', def: 'KeyD' },
  { id: 'jump', label: 'Jump', def: 'Space' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft' },
  { id: 'interact', label: 'Pick up / open chest', def: 'KeyE' },
  { id: 'reload', label: 'Reload', def: 'KeyR' },
  { id: 'buildMode', label: 'Build mode on/off', def: 'KeyQ' },
  { id: 'wall', label: 'Build: wall', def: 'KeyZ' },
  { id: 'floor', label: 'Build: floor', def: 'KeyX' },
  { id: 'ramp', label: 'Build: ramp', def: 'KeyC' },
  { id: 'material', label: 'Cycle material', def: 'KeyT' },
];

export const DEFAULTS = {
  sens: 1.0,
  adsSens: 0.7,
  invertY: false,
  fov: 80,
  renderScale: 1.0,
  shadows: false,
  drawDist: 280,
  showFps: false,
  volume: 0.6,
  crosshair: 'cross',
  crosshairColor: '#ffffff',
  season: 1,
  keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])),
};

function load() {
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'keys') Object.assign(s.keys, raw.keys || {});
      else if (raw[k] !== undefined && typeof raw[k] === typeof DEFAULTS[k]) s[k] = raw[k];
    }
  } catch (e) { /* ignore corrupt storage */ }
  return s;
}

export const settings = load();
const listeners = [];

export function onSettingsChange(fn) { listeners.push(fn); }

export function saveSettings() {
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  listeners.forEach((f) => f(settings));
}

export function resetSettings() {
  const keepSeason = settings.season;
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)), { season: keepSeason });
  saveSettings();
}

export function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE');
}
