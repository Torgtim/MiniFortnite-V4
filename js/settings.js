// Persistent user settings (localStorage) + keybind table + graphics presets.

const STORE = 'mfv4_settings_v2';

export const KEY_ACTIONS = [
  { id: 'forward', label: 'Move forward', def: 'KeyW' },
  { id: 'back', label: 'Move back', def: 'KeyS' },
  { id: 'left', label: 'Move left', def: 'KeyA' },
  { id: 'right', label: 'Move right', def: 'KeyD' },
  { id: 'jump', label: 'Jump / glider / mantle', def: 'Space' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft' },
  { id: 'crouch', label: 'Crouch / slide', def: 'ControlLeft' },
  { id: 'interact', label: 'Pick up / open', def: 'KeyE' },
  { id: 'reload', label: 'Reload', def: 'KeyR' },
  { id: 'buildMode', label: 'Build mode on/off', def: 'KeyQ' },
  { id: 'wall', label: 'Build: wall', def: 'KeyZ' },
  { id: 'floor', label: 'Build: floor', def: 'KeyX' },
  { id: 'ramp', label: 'Build: ramp', def: 'KeyC' },
  { id: 'cone', label: 'Build: cone (roof)', def: 'KeyV' },
  { id: 'edit', label: 'Edit build', def: 'KeyG' },
  { id: 'material', label: 'Cycle material', def: 'KeyT' },
  { id: 'map', label: 'Big map', def: 'KeyM' },
  { id: 'camera', label: 'Switch 1st / 3rd person', def: 'KeyH' },
  { id: 'emote', label: 'Emote (dance!)', def: 'KeyB' },
];

export const DEFAULTS = {
  sens: 1.0,
  adsSens: 0.7,
  invertY: false,
  fov: 80,
  thirdPerson: true,
  sprintDefault: false,
  toggleCrouch: false,
  editOnRelease: false,
  quality: 'medium',
  renderScale: 1.0,
  shadows: true,
  drawDist: 300,
  decor: 1,
  clouds: true,
  weather: true,
  style: 'modern',      // 'modern' | 'retro'
  retroLines: 300,
  scanlines: true,
  showFps: false,
  volume: 0.6,
  crosshair: 'cross',
  crosshairColor: '#ffffff',
  botCount: 19,
  botDifficulty: 1,
  season: 1,
  keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])),
};

/** Quality presets set several video options at once. */
export const PRESETS = {
  low: { renderScale: 0.7, shadows: false, drawDist: 200, decor: 0.3, clouds: false, weather: false },
  medium: { renderScale: 1.0, shadows: true, drawDist: 300, decor: 1, clouds: true, weather: true },
  high: { renderScale: 1.0, shadows: true, drawDist: 420, decor: 1.6, clouds: true, weather: true },
};

function load() {
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem('mfv4_settings_v1') || '{}');
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

export function applyPreset(name) {
  if (!PRESETS[name]) return;
  Object.assign(settings, PRESETS[name], { quality: name });
  saveSettings();
}

export function resetSettings() {
  const keepSeason = settings.season;
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)), { season: keepSeason });
  saveSettings();
}

export function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE').replace('Control', 'CTRL');
}
