// Persistent user settings (localStorage) + keybind table + graphics presets.

const STORE = 'mfv4_settings_v2';

export const KEY_ACTIONS = [
  { id: 'forward', label: 'Move forward', def: 'KeyW' },
  { id: 'back', label: 'Move back', def: 'KeyS' },
  { id: 'left', label: 'Move left', def: 'KeyA' },
  { id: 'right', label: 'Move right', def: 'KeyD' },
  { id: 'jump', label: 'Jump / glider / mantle', def: 'Space' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft' },
  { id: 'crouch', label: 'Crouch / slide', def: 'KeyC' },
  { id: 'interact', label: 'Pick up / open', def: 'KeyE' },
  { id: 'reload', label: 'Reload', def: 'KeyR' },
  { id: 'pickaxe', label: 'Pickaxe (press again = last weapon)', def: 'KeyF' },
  { id: 'buildMode', label: 'Build mode on/off', def: 'KeyQ' },
  { id: 'wall', label: 'Build: wall', def: 'KeyZ' },
  { id: 'floor', label: 'Build: floor', def: 'KeyX' },
  { id: 'ramp', label: 'Build: ramp', def: 'CapsLock' },
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
  bloom: true,
  style: 'modern',      // 'modern' | 'retro'
  retroLines: 300,
  scanlines: true,
  showFps: false,
  volume: 0.6,
  music: 0.35,
  tips: true,
  crosshair: 'cross',
  crosshairColor: '#ffffff',
  autoPickup: true,
  outfit: { shirt: '#ff8a1e', pants: '#23324a', accent: '#2f6bff', hair: '#5a3a1a', hat: 'cap' },
  gameMode: 'br',      // 'br' (battle royale) | 'playground' (practice)
  botCount: 19,
  botDifficulty: 1,
  season: 1,
  keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])),
};

/** Quality presets set several video options at once. */
export const PRESETS = {
  low: { renderScale: 0.7, shadows: false, drawDist: 200, decor: 0.3, clouds: false, weather: false, bloom: false },
  medium: { renderScale: 1.0, shadows: true, drawDist: 300, decor: 1, clouds: true, weather: true, bloom: true },
  high: { renderScale: 1.0, shadows: true, drawDist: 420, decor: 1.6, clouds: true, weather: true, bloom: true },
};

function load() {
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  let hadPickKey = true;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem('mfv4_settings_v1') || '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'keys') { Object.assign(s.keys, raw.keys || {}); hadPickKey = !!(raw.keys && raw.keys.pickaxe); }
      else if (k === 'outfit') Object.assign(s.outfit, raw.outfit || {});
      else if (raw[k] !== undefined && typeof raw[k] === typeof DEFAULTS[k]) s[k] = raw[k];
    }
  } catch (e) { /* ignore corrupt storage */ }
  // Ctrl+W closes the browser tab, so crouch must not live on Ctrl (old saves get moved)
  if (s.keys.crouch === 'ControlLeft' || s.keys.crouch === 'ControlRight') {
    s.keys.crouch = 'KeyC';
    if (s.keys.ramp === 'KeyC') s.keys.ramp = 'KeyF';
  }
  // v4.2: the pickaxe got its own key (F); ramp moves off F in older saves
  if (!hadPickKey && s.keys.ramp === 'KeyF') s.keys.ramp = 'CapsLock';
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
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE').replace('Control', 'CTRL').replace('CapsLock', 'CAPS');
}
