// Menus: lobby (season switcher), settings, pause and result windows.

import { SEASONS } from './seasons.js?v=64';
import { WEAPONS, AMMO, RARITIES, weaponStats } from './weapons.js?v=64';
import { MATERIALS } from './build.js?v=64';
import { settings, saveSettings, resetSettings, applyPreset, KEY_ACTIONS, KEY_GROUPS, keysClash, keyLabel } from './settings.js?v=64';
import { stats } from './stats.js?v=64';

const TIPS = [
  'Press <b>Tab</b> to open your <b>inventory</b>: drag slots around to reorder them, or drop weapons, ammo and materials for a friend.',
  'Full inventory? Look at something on the ground and press <b>E</b> to <b>swap</b> it with what you hold.',
  'Shotguns load <b>one shell at a time</b>. Pull the trigger to stop reloading and shoot what is already in.',
  'Press <b>C</b> while sprinting to <b>slide</b>. Sliding downhill makes you even faster, and you can jump out of a slide.',
  'Jump at a ledge to <b>mantle</b> up onto it. Sprint and jump at a low wall to <b>vault</b> over it.',
  'Hit the <b>blue circle</b> with your pickaxe for double materials. It moves after every hit!',
  'Press <b>G</b> while looking at your own build to <b>edit</b> it. Drag over tiles, then press G again. Right click resets.',
  'Drag a path over a <b>ramp</b> in edit mode to turn it. A path in one column makes a <b>half ramp</b>.',
  'Wood builds fast but is weak. Metal is slow to build up, but it ends up with 450 HP.',
  'Break the piece that holds a structure up and the rest <b>collapses</b>. Bots fall too!',
  'Bots <b>hear gunshots</b> and come looking. A crossbow is silent.',
  '<b>Supply drops</b> fall from the sky when a new storm circle appears. Look for the blue squares on the map.',
  'Sniper bullets <b>travel and drop</b>. Aim a little higher at long range.',
  'Chests <b>hum</b> when you are near. Listen!',
  'Press <b>B</b> to dance. The bots will dance on you too, so don\'t lose.',
  'Crouch (<b>C</b>) for better accuracy. The crosshair shows how far your shots spread. (Crouch is not on Ctrl because Ctrl+W closes the browser tab!)',
  'Try <b>Graphics style: 1998</b> in Settings for that authentic 3D-accelerator-card look.',
  'Each season swaps the <b>whole map and loot pool</b>. Season 4 only has plasma weapons, and lava burns hard!',
  'Press <b>M</b> for the big map with the bus route, storm circles and supply drops.',
  'Somewhere out in the wild a <b>loot alpaca</b> is waiting. Find it, press E, and enjoy the pinata.',
  'Look down and throw a <b>healing splash</b> at your feet: +20, health first, then shield.',
  'Try <b>Playground</b> mode to practise building and editing with unlimited materials.',
];

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
    $('btnPlay').onclick = () => this.play();
    $('btnSettings').onclick = () => this.showSettings(true, 'lobby');
    $('pResume').onclick = () => game.resume();
    $('pSettings').onclick = () => this.showSettings(true, 'pause');
    $('pLobby').onclick = () => game.backToLobby();
    $('setClose').onclick = () => this.showSettings(false);
    $('setReset').onclick = () => { resetSettings(); this._buildSettings(); };
    $('rSpectate').onclick = () => game.startSpectating();
    $('rLobby').onclick = () => game.backToLobby();
    $('rAgain').onclick = () => this.play();
    // music + tips (sound needs a click first, browsers block autoplay)
    $('btnMusic').onclick = () => { game.audio.init(); settings.music = settings.music > 0 ? 0 : 0.35; saveSettings(); this.refreshMusic(); };
    this.tip = Math.floor(Math.random() * TIPS.length);
    $('tipNext').onclick = () => this.showTip(this.tip + 1);
    $('tipClose').onclick = $('tipX').onclick = () => $('tipwin').classList.add('hidden');
    $('tipShow').checked = settings.tips;
    $('tipShow').onchange = () => { settings.tips = $('tipShow').checked; saveSettings(); };
    this.showTip(this.tip);
    if (settings.tips) $('tipwin').classList.remove('hidden');
    addEventListener('pointerdown', () => { if (game.mode === 'lobby' && !game.audio.ctx) { game.audio.init(); this.refreshMusic(); } }, { once: true });
    this.refreshStats();
    $(settings.gameMode === 'playground' ? 'modePG' : 'modeBR').checked = true;
    for (const id of ['modeBR', 'modePG']) $(id).onchange = (ev) => { settings.gameMode = ev.target.value; saveSettings(); this.refreshMatchInfo(); };
    this._buildLocker();
    $('btnLocker').onclick = () => $('locker').classList.remove('hidden');
    $('lockClose').onclick = () => $('locker').classList.add('hidden');
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
    const readable = (c) => { const n = parseInt(c.slice(1), 16), l = ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11); return l > 170 ? '#666' : c; };
    const items = Object.values(season.items).map((i) => `<span style="color:${readable(i.color)}">${i.name}</span>`).join(', ');
    $('lootList').innerHTML = `<b>Weapons</b><ul>${weap}</ul>`;
    $('itemList').innerHTML = `<b>Items:</b> ${items}`;
    const w = this.game.world;
    $('poiList').innerHTML = `<b>Places</b><ul>${w.sites.map((s) => `<li>${s.name}</li>`).join('')}</ul><i>${LIQUID_TEXT[season.liquid.type]}</i>`;
    this.refreshMatchInfo();
    if (this.game.audio && this.game.audio.musicTimer) this.refreshMusic();
  }

  refreshMatchInfo() {
    const diff = ['Easy', 'Normal', 'Hard'][settings.botDifficulty] || 'Normal';
    if (settings.gameMode === 'playground') { $('matchInfo').innerHTML = 'Just you and 5 target dummies. No storm, unlimited materials and ammo.'; return; }
    $('matchInfo').innerHTML = `${settings.botCount + 1} players (${settings.botCount} bots, ${diff}) &middot; ${settings.thirdPerson ? '3rd' : '1st'} person &middot; ${settings.style === 'retro' ? '1998 graphics' : 'modern graphics'} <small>(change in Settings)</small>`;
  }

  showLobby(on) {
    $('lobby').classList.toggle('hidden', !on);
    if (!on) $('tipwin').classList.add('hidden');
    this.refreshStats();
    this.refreshMusic();
  }

  _buildLocker() {
    const o = settings.outfit, host = $('lockBody');
    host.innerHTML = '';
    const t = document.createElement('table'); t.className = 'srows';
    const color = (key, label) => {
      const i = document.createElement('input'); i.type = 'color'; i.value = o[key];
      i.oninput = () => { o[key] = i.value; saveSettings(); this._lockPreview(); };
      t.appendChild(this._row(label, i));
    };
    color('shirt', 'Shirt'); color('pants', 'Pants'); color('accent', 'Backpack / hat / glider'); color('hair', 'Hair');
    const hat = document.createElement('select');
    [['none', 'No hat'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['helmet', 'Army helmet'], ['band', 'Headband']].forEach(([v, n]) => { const op = document.createElement('option'); op.value = v; op.textContent = n; hat.appendChild(op); });
    hat.value = o.hat;
    hat.onchange = () => { o.hat = hat.value; saveSettings(); this._lockPreview(); };
    t.appendChild(this._row('Hat', hat));
    host.appendChild(t);
    this._lockPreview();
  }

  /** Tiny 2D paper-doll preview of the outfit (no 3D needed). */
  _lockPreview() {
    const c = $('lockPrev').getContext('2d'), o = settings.outfit;
    c.fillStyle = '#008080'; c.fillRect(0, 0, 120, 170);
    const R = (col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); c.strokeStyle = '#000'; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
    R(o.pants, 40, 100, 18, 55); R(o.pants, 62, 100, 18, 55);
    R(o.shirt, 36, 52, 48, 50); R(o.shirt, 22, 54, 14, 44); R(o.shirt, 84, 54, 14, 44);
    R('#f2c9a0', 44, 18, 32, 32);
    R(o.hair, 44, 18, 32, 7);
    c.fillStyle = '#1a1a2a'; c.fillRect(51, 31, 4, 4); c.fillRect(65, 31, 4, 4); c.fillStyle = '#7a2a2a'; c.fillRect(54, 42, 12, 2);
    if (o.hat === 'cap') { R(o.accent, 42, 12, 36, 9); R(o.accent, 66, 18, 18, 4); }
    else if (o.hat === 'beanie') R(o.accent, 42, 8, 36, 14);
    else if (o.hat === 'helmet') R('#4a5a3a', 40, 8, 40, 16);
    else if (o.hat === 'band') R('#d02020', 44, 22, 32, 4);
    R(o.accent, 50, 60, 20, 26);
  }

  /** Show a Win95 "Please wait" box with an hourglass while the island is built. */
  play() {
    const msgs = ['Building the island...', 'Painting the Party Bus...', 'Teaching bots to build...', 'Hiding the chests...', 'Calling the storm...'];
    $('loadText').textContent = msgs[Math.floor(Math.random() * msgs.length)];
    $('loadBar').style.width = '35%';
    $('loading').classList.remove('hidden');
    document.body.style.cursor = 'wait';
    setTimeout(() => { $('loadBar').style.width = '80%'; }, 10);
    setTimeout(() => {
      try { this.game.startMatch(); } finally {
        $('loading').classList.add('hidden');
        document.body.style.cursor = '';
      }
    }, 60);
  }

  showTip(i) { this.tip = (i + TIPS.length) % TIPS.length; $('tipText').innerHTML = TIPS[this.tip]; }

  refreshMusic() {
    const a = this.game.audio, on = settings.music > 0;
    $('btnMusic').innerHTML = `&#9835; Music: ${on ? 'ON' : 'OFF'}`;
    const inLobby = !$('lobby').classList.contains('hidden');
    if (on && a.ctx && inLobby) a.startMusic(this.game.season.id); else a.stopMusic();
  }

  refreshStats() {
    const pad = (n, k) => String(n).padStart(k, '0');
    $('stMatches').textContent = pad(stats.matches, 6);
    $('stWins').textContent = pad(stats.wins, 4);
    $('stKills').textContent = pad(stats.kills, 6);
    $('stBest').textContent = stats.best ? '#' + stats.best : '#--';
  }

  // -------------------------------------------------------------- pause / result
  showPause(on) { $('pause').classList.toggle('hidden', !on); }

  /** Inventory window: reorder slots (drag & drop or click-click), drop weapons/items/ammo/materials. */
  showInventory(on) {
    const el = $('inventory');
    el.classList.toggle('hidden', !on);
    this.invOpen = on;
    this.invPick = -1;
    this.invDragging = false;
    this._invSig = '';
    if (on) { this._buildInventory(); this._invSig = this._invSignature(); }
  }

  /** What the inventory shows; when it changes (ammo picked up, a heal used...) the window is redrawn. */
  _invSignature() {
    const p = this.game.player;
    if (!p) return '';
    return p.slot + '|' + p.slots.map((s) => (s ? (s.id || s.type) + ':' + (s.mag ?? '') + ':' + (s.count ?? '') + ':' + (s.rarity ?? '') : '-')).join(',')
      + '|' + Object.values(p.ammo).join(',') + '|' + Object.values(p.mats).join(',');
  }

  /** Called every frame while the (non-pausing) inventory is open. */
  tickInventory(dt) {
    const g = this.game, p = g.player;
    if (!p || !p.alive || g.mode !== 'playing') { this.showInventory(false); return; }
    this._invT = (this._invT || 0) + dt;
    if (this._invT < 0.2 || this.invDragging) return;
    this._invT = 0;
    const sig = this._invSignature();
    if (sig !== this._invSig) { this._invSig = sig; this._buildInventory(); }
  }

  _buildInventory() {
    const g = this.game, p = g.player;
    if (!p) return;
    $('invKey').textContent = keyLabel(settings.keys.inventory);
    $('invClose').onclick = () => g.closeInventory();
    $('invX').onclick = () => g.closeInventory();
    // clicking the dimmed area around the window also closes it
    $('inventory').onclick = (ev) => { if (ev.target.id === 'inventory') g.closeInventory(); };
    const host = $('invSlots');
    host.innerHTML = '';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    for (let i = 0; i <= 5; i++) {
      const s = p.slots[i];
      const box = mk('div', 'invslot' + (i === p.slot ? ' held' : '') + (i === this.invPick ? ' pick' : '') + (i === 0 ? ' fixed' : ''));
      box.appendChild(mk('i', '', i === 0 ? keyLabel(settings.keys.pickaxe) : String(i)));
      if (!s) box.appendChild(mk('b', 'empty', '(empty)'));
      else if (s.type === 'pickaxe') { box.appendChild(mk('b', '', 'Pickaxe')); box.appendChild(mk('small', '', 'always with you')); }
      else if (s.type === 'weapon') {
        const r = RARITIES[s.rarity], st = weaponStats(s);
        box.appendChild(mk('b', '', WEAPONS[s.id].name));
        const tag = mk('span', 'rtag', r.name); tag.style.background = r.color; box.appendChild(tag);
        box.appendChild(mk('small', '', `${s.mag}/${st.mag} in mag · ${Math.round(st.dps)} DPS`));
        box.style.borderBottom = '5px solid ' + r.color;
      } else {
        const it = g.season.items[s.id];
        box.appendChild(mk('b', '', it.name));
        const tag = mk('span', 'rtag', 'x' + s.count); tag.style.background = it.color; box.appendChild(tag);
        box.style.borderBottom = '5px solid ' + it.color;
      }
      if (i >= 1 && s) {
        const row = mk('div', 'invbtns');
        const d = mk('button', '', s.type === 'item' && s.count > 1 ? 'Drop all' : 'Drop');
        d.onclick = (ev) => { ev.stopPropagation(); g.dropSlot(i); this._buildInventory(); };
        row.appendChild(d);
        if (s.type === 'item' && s.count > 1) {
          const d1 = mk('button', '', 'Drop 1');
          d1.onclick = (ev) => { ev.stopPropagation(); g.dropSlot(i, 1); this._buildInventory(); };
          row.appendChild(d1);
        }
        const h = mk('button', '', 'Hold');
        h.onclick = (ev) => { ev.stopPropagation(); p.selectSlot(i); this._buildInventory(); };
        row.appendChild(h);
        box.appendChild(row);
      }
      if (i >= 1) {
        // drag & drop + click-click swapping
        box.draggable = !!s;
        box.ondragstart = (ev) => { ev.dataTransfer.setData('text/plain', String(i)); box.classList.add('drag'); this.invDragging = true; };
        box.ondragend = () => { box.classList.remove('drag'); this.invDragging = false; };
        box.ondragover = (ev) => { ev.preventDefault(); box.classList.add('over'); };
        box.ondragleave = () => box.classList.remove('over');
        box.ondrop = (ev) => { ev.preventDefault(); this.invDragging = false; const from = +ev.dataTransfer.getData('text/plain'); g.swapSlots(from, i); this.invPick = -1; this._buildInventory(); };
        box.onclick = () => {
          if (this.invPick < 0) { if (s) this.invPick = i; }
          else { g.swapSlots(this.invPick, i); this.invPick = -1; }
          this._buildInventory();
        };
      }
      host.appendChild(box);
    }
    // ammo + mats with drop buttons
    const res = (tableId, list) => {
      const t = $(tableId); t.innerHTML = '';
      for (const [label, color, have, drop, step] of list) {
        const tr = document.createElement('tr');
        const a = mk('td', '', ''); const sw = mk('span', 'swatch'); sw.style.background = color; a.append(sw, label);
        const b = mk('td', 'num', String(have));
        const c = mk('td');
        const btn = mk('button', '', 'Drop ' + step); btn.disabled = have <= 0;
        btn.onclick = () => { drop(step); this._buildInventory(); };
        c.appendChild(btn);
        tr.append(a, b, c); t.appendChild(tr);
      }
    };
    res('invAmmo', Object.keys(AMMO).map((k) => [AMMO[k].name, AMMO[k].color, p.ammo[k], (n) => g.dropResource('ammo', k, n), AMMO[k].amount]));
    res('invMats', MATERIALS.map((m) => [m.name, m.color, p.mats[m.id], (n) => g.dropResource('mats', m.id, n), 30]));
    this._invSig = this._invSignature();
  }

  /** Playground spawn menu: every weapon of the current season (pick a rarity) plus all items. */
  showSpawn(on) {
    const el = $('spawn');
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const g = this.game;
    const rsel = $('spRarity');
    if (!rsel.options.length) RARITIES.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.name; rsel.appendChild(o); rsel.value = 4; });
    const fill = (host, entries) => {
      host.innerHTML = '';
      for (const [label, fn] of entries) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; host.appendChild(b); }
    };
    fill($('spWeapons'), g.season.weapons.map(([id]) => [WEAPONS[id].name, () => g.spawnForPlayer('weapon', id, +rsel.value)]));
    fill($('spItems'), Object.keys(g.season.items).map((id) => [g.season.items[id].name, () => g.spawnForPlayer('item', id)]));
    $('spClose').onclick = () => g.resume();
  }

  showResult(r) {
    $('resTitle').textContent = r.victory ? '#1 VICTORY ROYALE!' : 'You were eliminated';
    $('resTitle').className = r.victory ? 'blink' : '';
    $('resBody').innerHTML = `<table class="stats"><tr><td>Placement</td><td><b>#${r.place}</b> / ${r.total}</td></tr>
      <tr><td>Eliminations</td><td><b>${r.kills}</b></td></tr>
      <tr><td>Season</td><td>${r.season}</td></tr>
      <tr><td>${r.victory ? 'Final blow' : 'Eliminated by'}</td><td>${r.by}</td></tr></table>`;
    $('rSpectate').style.display = r.victory ? 'none' : '';
    $('result').classList.toggle('victory', !!r.victory);
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
    input.oninput = () => {
      settings[key] = +input.value; val.textContent = fmt(settings[key]);
      if (['renderScale', 'drawDist', 'decor'].includes(key)) settings.quality = 'custom';
      saveSettings(); this.refreshMatchInfo();
    };
    return [input, val];
  }

  _check(key, after) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!settings[key];
    input.onchange = () => { settings[key] = input.checked; saveSettings(); this.refreshMatchInfo(); if (after) after(); };
    return input;
  }

  _buildSettings() {
    const host = $('setBody');
    host.innerHTML = '';
    // two tabs: the general / visual settings and the key binds
    const tab = this.settingsTab || 'general';
    const bar = document.createElement('div'); bar.className = 'settabs';
    const panes = {};
    for (const [id, name] of [['general', 'General & Visual'], ['keys', 'Key Binds']]) {
      const b = document.createElement('button');
      b.className = 'settab' + (id === tab ? ' on' : ''); b.textContent = name;
      b.onclick = () => { this.settingsTab = id; this.rebinding = null; this._buildSettings(); };
      bar.appendChild(b);
      const pane = document.createElement('div'); pane.className = 'setpane'; pane.style.display = id === tab ? '' : 'none';
      panes[id] = pane;
    }
    host.append(bar, panes.general, panes.keys);
    let pane = panes.general;
    const section = (title, rows) => {
      const f = document.createElement('fieldset');
      const l = document.createElement('legend'); l.textContent = title; f.appendChild(l);
      const t = document.createElement('table'); t.className = 'srows';
      rows.forEach((r) => t.appendChild(r));
      f.appendChild(t); pane.appendChild(f);
    };
    const S = (label, key, min, max, step, fmt) => { const [i, v] = this._slider(key, min, max, step, fmt); return this._row(label, i, v); };

    const sel = (key, opts, onChange) => {
      const el = document.createElement('select');
      opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; el.appendChild(o); });
      el.value = String(settings[key]);
      el.onchange = () => { const v = el.value; settings[key] = typeof settings[key] === 'number' ? +v : v; if (onChange) onChange(); saveSettings(); this.refreshMatchInfo(); };
      return el;
    };
    const rebuild = () => { if (this.game.mode === 'lobby') this.game.buildWorld(); };

    section('Mouse', [
      S('Sensitivity', 'sens', 0.1, 3, 0.05, (v) => (+v).toFixed(2)),
      S('Aim-down-sights multiplier', 'adsSens', 0.2, 1.5, 0.05, (v) => (+v).toFixed(2)),
      this._row('Invert Y axis', this._check('invertY')),
    ]);

    section('Gameplay', [
      this._row('Camera', sel('thirdPerson', [['true', '3rd person'], ['false', '1st person']], () => { settings.thirdPerson = settings.thirdPerson === 'true' || settings.thirdPerson === true; })),
      this._row('Sprint by default', this._check('sprintDefault')),
      this._row('Toggle crouch', this._check('toggleCrouch')),
      this._row('Confirm edit on release', this._check('editOnRelease')),
      this._row('Auto pick up weapons', this._check('autoPickup')),
      S('Bots', 'botCount', 1, 39, 1, (v) => v),
      this._row('Bot difficulty', sel('botDifficulty', [['0', 'Easy'], ['1', 'Normal'], ['2', 'Hard']])),
    ]);

    const crossSel = sel('crosshair', [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle'], ['none', 'None']]);
    const crossCol = document.createElement('input'); crossCol.type = 'color'; crossCol.value = settings.crosshairColor;
    crossCol.oninput = () => { settings.crosshairColor = crossCol.value; saveSettings(); };
    const preset = sel('quality', [['low', 'Low (fast)'], ['medium', 'Medium'], ['high', 'High'], ['custom', 'Custom']], () => { applyPreset(settings.quality); this._buildSettings(); rebuild(); });

    section('Video', [
      this._row('Quality preset', preset),
      this._row('Graphics style', sel('style', [['modern', 'Modern'], ['retro', '1998 (chunky pixels + dithering)']])),
      S('1998 mode resolution (lines)', 'retroLines', 160, 540, 20, (v) => v + 'p'),
      this._row('1998 mode scanlines', this._check('scanlines')),
      S('Field of view', 'fov', 60, 110, 1, (v) => v + '°'),
      S('Render scale', 'renderScale', 0.4, 1, 0.05, (v) => Math.round(v * 100) + '%'),
      S('Draw distance', 'drawDist', 120, 520, 20, (v) => v + 'm'),
      S('Grass & decoration', 'decor', 0, 2, 0.1, (v) => Math.round(v * 100) + '%'),
      this._row('Shadows', this._check('shadows')),
      this._row('Bloom (glow)', this._check('bloom')),
      this._row('Clouds', this._check('clouds', rebuild)),
      this._row('Weather (snow, embers...)', this._check('weather', rebuild)),
      this._row('Show FPS', this._check('showFps')),
      this._row('Crosshair', crossSel),
      this._row('Crosshair colour', crossCol),
    ]);
    // decoration density needs a world rebuild once you let go of the slider
    host.querySelectorAll('input[type=range]').forEach((r) => { if (r.max === '2') r.onchange = rebuild; });

    section('Audio', [S('Master volume', 'volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'), S('Lobby music', 'music', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')]);

    // ---- key binds tab
    pane = panes.keys;
    const hint = document.createElement('p'); hint.className = 'keyhint';
    hint.innerHTML = 'Click a button, then press a key, a mouse button or scroll the wheel. <b>Esc</b> cancels. Actions that only work in one mode (shoot, place a piece, select edit tiles) can share the same button.';
    pane.appendChild(hint);
    for (const [title, gid] of KEY_GROUPS) {
      const rows = KEY_ACTIONS.filter((a) => a.group === gid).map((a) => {
        const b = document.createElement('button');
        b.className = 'keybtn'; b.textContent = keyLabel(settings.keys[a.id]);
        b.onclick = () => {
          this.rebinding = { action: a.id, btn: b };
          b.textContent = 'press a key / button…';
        };
        return this._row(a.label, b);
      });
      section(title, rows);
    }
    const rb = document.createElement('button'); rb.textContent = 'Reset key binds to defaults';
    rb.onclick = () => { for (const a of KEY_ACTIONS) settings.keys[a.id] = a.def; saveSettings(); this._buildSettings(); };
    pane.appendChild(rb);
  }

  /** Called by the game's keydown handler while a rebind is pending. Returns true when consumed. */
  captureKey(code) {
    if (!this.rebinding) return false;
    const { action, btn } = this.rebinding;
    this.rebinding = null;
    if (code !== 'Escape') {
      // swap with any action that would clash (same button, overlapping context)
      for (const k of Object.keys(settings.keys)) if (settings.keys[k] === code && keysClash(action, k)) settings.keys[k] = settings.keys[action];
      settings.keys[action] = code;
      saveSettings();
      this._buildSettings();
    } else btn.textContent = keyLabel(settings.keys[action]);
    return true;
  }
}
