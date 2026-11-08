// Menus: lobby (season switcher), settings, pause and result windows.

import { SEASONS } from './seasons.js';
import { WEAPONS, AMMO } from './weapons.js';
import { settings, saveSettings, resetSettings, KEY_ACTIONS, keyLabel } from './settings.js';

const $ = (id) => document.getElementById(id);

const LIQUID_TEXT = {
  water: 'Water slows you down.',
  icy: 'Icy water slows you down and hurts (3/s).',
  quicksand: 'Quicksand slows you down.',
  lava: 'LAVA burns hard (28/s). Stay out!',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.rebinding = null;
    this.settingsFrom = 'lobby';
    this._buildSeasonBar();
    this._buildSettings();
    $('btnPlay').onclick = () => game.startMatch();
    $('btnSettings').onclick = () => this.showSettings(true, 'lobby');
    $('pResume').onclick = () => game.resume();
    $('pSettings').onclick = () => this.showSettings(true, 'pause');
    $('pLobby').onclick = () => game.backToLobby();
    $('setClose').onclick = () => this.showSettings(false);
    $('setReset').onclick = () => { resetSettings(); this._buildSettings(); };
    $('rSpectate').onclick = () => game.startSpectating();
    $('rLobby').onclick = () => game.backToLobby();
    $('rAgain').onclick = () => game.startMatch();
  }

  // -------------------------------------------------------------- lobby
  _buildSeasonBar() {
    const row = $('seasonRow');
    row.innerHTML = '';
    SEASONS.forEach((s) => {
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'seasonbtn';
      b.dataset.season = s.id;
      b.innerHTML = `<span class="sn">${s.name}</span><br><span class="st">${s.title}</span>`;
      b.onclick = () => this.game.selectSeason(s.id);
      td.appendChild(b);
      row.appendChild(td);
    });
  }

  refreshSeason(season) {
    document.querySelectorAll('.seasonbtn').forEach((b) => b.classList.toggle('sel', +b.dataset.season === season.id));
    $('seasonTitle').textContent = `${season.name}: ${season.title}`;
    $('seasonBlurb').textContent = season.blurb;
    const weap = season.weapons.map(([id]) => `<li>${WEAPONS[id].name} <small>(${AMMO[WEAPONS[id].ammo].name})</small></li>`).join('');
    const items = Object.values(season.items).map((i) => `<li style="color:${i.color === '#f4f4f4' ? '#fff' : i.color}">${i.name}</li>`).join('');
    $('lootList').innerHTML = `<b>Weapons</b><ul>${weap}</ul><b>Healing</b><ul>${items}</ul>`;
    const w = this.game.world;
    $('poiList').innerHTML = `<b>Places</b><ul>${w.sites.map((s) => `<li>${s.name}</li>`).join('')}</ul><i>${LIQUID_TEXT[season.liquid.type]}</i>`;
  }

  showLobby(on) { $('lobby').classList.toggle('hidden', !on); }

  // -------------------------------------------------------------- pause / result
  showPause(on) { $('pause').classList.toggle('hidden', !on); }

  showResult(r) {
    $('resTitle').textContent = r.victory ? '*** VICTORY ROYALE ***' : 'You were eliminated';
    $('resTitle').className = r.victory ? 'blink' : '';
    $('resBody').innerHTML = `<table class="stats"><tr><td>Placement</td><td><b>#${r.place}</b> / ${r.total}</td></tr>
      <tr><td>Eliminations</td><td><b>${r.kills}</b></td></tr>
      <tr><td>Season</td><td>${r.season}</td></tr>
      <tr><td>${r.victory ? 'Final blow' : 'Eliminated by'}</td><td>${r.by}</td></tr></table>`;
    $('rSpectate').style.display = r.victory ? 'none' : '';
    $('result').classList.remove('hidden');
  }

  hideResult() { $('result').classList.add('hidden'); }

  // -------------------------------------------------------------- settings
  showSettings(on, from) {
    if (from) this.settingsFrom = from;
    $('settings').classList.toggle('hidden', !on);
    if (!on) this.rebinding = null;
  }

  _row(label, control, valueEl) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = label;
    const b = document.createElement('td'); b.appendChild(control);
    const c = document.createElement('td'); if (valueEl) c.appendChild(valueEl);
    tr.append(a, b, c);
    return tr;
  }

  _slider(key, min, max, step, fmt = (v) => v) {
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = settings[key];
    const val = document.createElement('span'); val.textContent = fmt(settings[key]);
    input.oninput = () => { settings[key] = +input.value; val.textContent = fmt(settings[key]); saveSettings(); };
    return [input, val];
  }

  _check(key) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!settings[key];
    input.onchange = () => { settings[key] = input.checked; saveSettings(); };
    return input;
  }

  _buildSettings() {
    const host = $('setBody');
    host.innerHTML = '';
    const section = (title, rows) => {
      const f = document.createElement('fieldset');
      const l = document.createElement('legend'); l.textContent = title; f.appendChild(l);
      const t = document.createElement('table'); t.className = 'srows';
      rows.forEach((r) => t.appendChild(r));
      f.appendChild(t); host.appendChild(f);
    };
    const S = (label, key, min, max, step, fmt) => { const [i, v] = this._slider(key, min, max, step, fmt); return this._row(label, i, v); };

    section('Mouse', [
      S('Sensitivity', 'sens', 0.1, 3, 0.05, (v) => (+v).toFixed(2)),
      S('Aim-down-sights multiplier', 'adsSens', 0.2, 1.5, 0.05, (v) => (+v).toFixed(2)),
      this._row('Invert Y axis', this._check('invertY')),
    ]);

    const crossSel = document.createElement('select');
    [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle'], ['none', 'None']].forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; crossSel.appendChild(o); });
    crossSel.value = settings.crosshair;
    crossSel.onchange = () => { settings.crosshair = crossSel.value; saveSettings(); };
    const crossCol = document.createElement('input'); crossCol.type = 'color'; crossCol.value = settings.crosshairColor;
    crossCol.oninput = () => { settings.crosshairColor = crossCol.value; saveSettings(); };

    section('Video', [
      S('Field of view', 'fov', 60, 110, 1, (v) => v + '°'),
      S('Render scale', 'renderScale', 0.4, 1, 0.05, (v) => Math.round(v * 100) + '%'),
      S('Draw distance', 'drawDist', 100, 500, 20, (v) => v + 'm'),
      this._row('Shadows (slower)', this._check('shadows')),
      this._row('Show FPS', this._check('showFps')),
      this._row('Crosshair', crossSel),
      this._row('Crosshair colour', crossCol),
    ]);

    section('Audio', [S('Master volume', 'volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')]);

    const keyRows = KEY_ACTIONS.map((a) => {
      const b = document.createElement('button');
      b.className = 'keybtn'; b.textContent = keyLabel(settings.keys[a.id]);
      b.onclick = () => {
        this.rebinding = { action: a.id, btn: b };
        b.textContent = 'press a key…';
      };
      return this._row(a.label, b);
    });
    keyRows.push(this._row('Hotbar slots', Object.assign(document.createElement('span'), { textContent: '1-6 / mouse wheel' })));
    section('Controls (click, then press a key)', keyRows);
  }

  /** Called by the game's keydown handler while a rebind is pending. Returns true when consumed. */
  captureKey(code) {
    if (!this.rebinding) return false;
    const { action, btn } = this.rebinding;
    this.rebinding = null;
    if (code !== 'Escape') {
      for (const k of Object.keys(settings.keys)) if (settings.keys[k] === code && k !== action) settings.keys[k] = settings.keys[action]; // swap if already used
      settings.keys[action] = code;
      saveSettings();
      this._buildSettings();
    } else btn.textContent = keyLabel(settings.keys[action]);
    return true;
  }
}
