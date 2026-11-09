// Persistent user settings (localStorage) + keybind table + graphics presets.

const STORE = 'mfv4_settings_v2';

// Actions are grouped for the key-bind screen. `ctx` says when an action is active: 'any' works
// everywhere, 'combat' / 'build' / 'edit' only in that mode. Two actions may share a button only
// when their contexts differ (e.g. shoot, place a piece and select an edit tile can all be Left Mouse).
export const KEY_GROUPS = [
  ['Movement', 'move'], ['Combat', 'combat'], ['Inventory', 'inv'], ['Building', 'build'], ['Editing', 'edit'], ['Other', 'other'],
];
export const KEY_ACTIONS = [
  { id: 'forward', label: 'Move forward', def: 'KeyW', group: 'move', ctx: 'any' },
  { id: 'back', label: 'Move back', def: 'KeyS', group: 'move', ctx: 'any' },
  { id: 'left', label: 'Move left', def: 'KeyA', group: 'move', ctx: 'any' },
  { id: 'right', label: 'Move right', def: 'KeyD', group: 'move', ctx: 'any' },
  { id: 'jump', label: 'Jump / glider / mantle', def: 'Space', group: 'move', ctx: 'any' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft', group: 'move', ctx: 'any' },
  { id: 'crouch', label: 'Crouch / slide', def: 'KeyC', group: 'move', ctx: 'any' },
  { id: 'emote', label: 'Emote (dance!)', def: 'KeyB', group: 'move', ctx: 'any' },

  { id: 'fire', label: 'Shoot / swing / use item', def: 'Mouse0', group: 'combat', ctx: 'combat' },
  { id: 'aim', label: 'Aim down sights', def: 'Mouse2', group: 'combat', ctx: 'combat' },
  { id: 'reload', label: 'Reload', def: 'KeyR', group: 'combat', ctx: 'any' },
  { id: 'interact', label: 'Pick up / open', def: 'KeyE', group: 'combat', ctx: 'any' },

  { id: 'drop', label: 'Drop held weapon / item', def: 'KeyJ', group: 'inv', ctx: 'any' },
  { id: 'spawn', label: 'Spawn menu (Playground only)', def: 'KeyU', group: 'inv', ctx: 'any' },
  { id: 'pickaxe', label: 'Pickaxe (press again = last weapon)', def: 'KeyF', group: 'inv', ctx: 'any' },
  { id: 'slot1', label: 'Weapon slot 1', def: 'Digit1', group: 'inv', ctx: 'any' },
  { id: 'slot2', label: 'Weapon slot 2', def: 'Digit2', group: 'inv', ctx: 'any' },
  { id: 'slot3', label: 'Weapon slot 3', def: 'Digit3', group: 'inv', ctx: 'any' },
  { id: 'slot4', label: 'Weapon slot 4', def: 'Digit4', group: 'inv', ctx: 'any' },
  { id: 'slot5', label: 'Weapon slot 5', def: 'Digit5', group: 'inv', ctx: 'any' },
  { id: 'nextSlot', label: 'Next weapon', def: 'WheelDown', group: 'inv', ctx: 'combat' },
  { id: 'prevSlot', label: 'Previous weapon', def: 'WheelUp', group: 'inv', ctx: 'combat' },

  { id: 'buildMode', label: 'Build mode on/off', def: 'KeyQ', group: 'build', ctx: 'any' },
  { id: 'wall', label: 'Build: wall', def: 'KeyZ', group: 'build', ctx: 'any' },
  { id: 'floor', label: 'Build: floor', def: 'KeyX', group: 'build', ctx: 'any' },
  { id: 'ramp', label: 'Build: ramp', def: 'CapsLock', group: 'build', ctx: 'any' },
  { id: 'cone', label: 'Build: cone (roof)', def: 'KeyV', group: 'build', ctx: 'any' },
  { id: 'place', label: 'Place piece (hold = keep placing)', def: 'Mouse0', group: 'build', ctx: 'build' },
  { id: 'material', label: 'Cycle material', def: 'KeyT', group: 'build', ctx: 'any' },
  { id: 'material2', label: 'Cycle material (extra)', def: 'Mouse2', group: 'build', ctx: 'build' },
  { id: 'nextPiece', label: 'Next piece type', def: 'WheelDown', group: 'build', ctx: 'build' },
  { id: 'prevPiece', label: 'Previous piece type', def: 'WheelUp', group: 'build', ctx: 'build' },

  { id: 'edit', label: 'Edit build / confirm edit', def: 'KeyG', group: 'edit', ctx: 'any' },
  { id: 'editSelect', label: 'Select edit tiles (click / drag)', def: 'Mouse0', group: 'edit', ctx: 'edit' },
  { id: 'editReset', label: 'Reset edit', def: 'Mouse2', group: 'edit', ctx: 'edit' },

  { id: 'map', label: 'Big map', def: 'KeyM', group: 'other', ctx: 'any' },
  { id: 'camera', label: 'Switch 1st / 3rd person', def: 'KeyH', group: 'other', ctx: 'any' },
];

/** Two actions clash when they would both react to the same press. */
export function keysClash(a, b) {
  const A = KEY_ACTIONS.find((x) => x.id === a), B = KEY_ACTIONS.find((x) => x.id === b);
  if (!A || !B || a === b) return false;
  return A.ctx === 'any' || B.ctx === 'any' || A.ctx === B.ctx;
}

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

const MOUSE_NAMES = { Mouse0: 'LEFT MOUSE', Mouse1: 'MIDDLE MOUSE', Mouse2: 'RIGHT MOUSE', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5', WheelUp: 'WHEEL UP', WheelDown: 'WHEEL DOWN' };

export function keyLabel(code) {
  if (!code) return '-';
  if (MOUSE_NAMES[code]) return MOUSE_NAMES[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE').replace('Control', 'CTRL').replace('CapsLock', 'CAPS');
}
