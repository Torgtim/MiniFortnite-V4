// In-game HUD (DOM based): health/shield, hotbar, ammo, materials, minimap, storm timer, feed.

import * as THREE from '../lib/three.module.min.js';
import { RARITIES, weaponStats, ITEM_KINDS } from './weapons.js';
import { MATERIALS, COST } from './build.js';
import { fmtTime } from './util.js';
import { settings } from './settings.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {
      hp: $('hpbar'), hpt: $('hptxt'), sh: $('shbar'), sht: $('shtxt'),
      hot: $('hotbar'), ammo: $('ammo'), mats: $('mats'), alive: $('alive'), kills: $('kills'),
      storm: $('storm'), prompt: $('prompt'), feed: $('feed'), nums: $('dmgnums'), cross: $('crosshair'),
      hit: $('hitmarker'), vig: $('vignette'), use: $('usebar'), useFill: $('usefill'), msg: $('statusmsg'),
      fps: $('fps'), build: $('buildinfo'), scope: $('scope'), map: $('minimap'), pops: $('matpops'),
    };
    this.mapCtx = this.el.map.getContext('2d');
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<i>${i + 1}</i><b></b><u></u>`;
      this.el.hot.appendChild(d);
      this.slotEls.push({ d, b: d.children[1], u: d.children[2], last: '' });
    }
    this.matEls = MATERIALS.map((m) => {
      const d = document.createElement('div');
      d.className = 'mat';
      d.innerHTML = `<span class="sw" style="background:${m.color}"></span><b>0</b>`;
      this.el.mats.appendChild(d);
      return { d, b: d.querySelector('b'), last: -1 };
    });
    this.fpsAcc = 0; this.fpsN = 0;
    this.hitT = 0; this.hurtT = 0;
    this._v = new THREE.Vector3();
    this.applyCrosshair();
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  applyCrosshair() {
    const c = this.el.cross;
    c.className = 'ch-' + settings.crosshair;
    c.style.setProperty('--cc', settings.crosshairColor);
  }

  // ------------------------------------------------------------------ transient things
  hitMarker(head) {
    const h = this.el.hit;
    h.className = 'on' + (head ? ' head' : '');
    this.hitT = 0.15;
  }

  hurt() { this.el.vig.classList.add('hurt'); this.hurtT = 0.25; this.game.audio.play('hurt', null); }

  feed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.firstChild);
    setTimeout(() => d.remove(), 6000);
  }

  damageNumber(x, y, z, amount, head) {
    if (this.el.nums.children.length > 14) return;
    const v = this._v.set(x, y, z).project(this.game.camera);
    if (v.z > 1) return;
    const d = document.createElement('div');
    d.className = 'dn' + (head ? ' head' : '');
    d.textContent = amount;
    d.style.left = ((v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
    this.el.nums.appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  matPop(res, n) {
    const d = document.createElement('div');
    d.textContent = '+' + n + ' ' + res;
    d.className = 'pop';
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game, p = g.player, e = this.el;
    if (!p) return;
    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { e.fps.textContent = settings.showFps ? Math.round(this.fpsN / this.fpsAcc) + ' FPS' : ''; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) e.hit.className = ''; }
    if (this.hurtT > 0) { this.hurtT -= dt; if (this.hurtT <= 0) e.vig.classList.remove('hurt'); }
    e.vig.classList.toggle('storm', g.storm.outside(p.x, p.z) && p.alive);

    // bars
    e.hp.style.width = Math.max(0, p.hp) + '%';
    e.hpt.textContent = Math.ceil(Math.max(0, p.hp));
    e.sh.style.width = Math.max(0, p.shield) + '%';
    e.sht.textContent = Math.ceil(Math.max(0, p.shield));

    // hotbar
    for (let i = 0; i < 6; i++) {
      const s = p.slots[i], el = this.slotEls[i];
      let key = '', label = '', sub = '', color = '#555';
      if (s) {
        if (s.type === 'pickaxe') { label = 'PICK'; color = '#9aa4ad'; }
        else if (s.type === 'weapon') { const st = weaponStats(s); label = st.short; sub = s.mag + '/' + p.ammo[st.ammo]; color = RARITIES[s.rarity].color; }
        else { label = ITEM_KINDS[s.id].short; sub = 'x' + s.count; color = g.season.items[s.id].color; }
      }
      key = label + sub + color + (i === p.slot);
      if (key !== el.last) {
        el.last = key;
        el.b.textContent = label; el.u.textContent = sub;
        el.d.style.borderColor = s ? color : '#3a3f48';
        el.d.style.boxShadow = s ? `inset 0 -14px 18px -10px ${color}` : 'none';
        el.d.classList.toggle('sel', i === p.slot);
      }
    }

    // ammo + use bar
    const it = p.held;
    let ammoTxt = '';
    let use = 0;
    if (it && it.type === 'weapon') {
      const st = weaponStats(it);
      ammoTxt = `<b>${it.mag}</b><span> / ${p.ammo[st.ammo]}</span><em>${st.name.toUpperCase()}</em>`;
      if (p.reloadT > 0) use = 1 - p.reloadT / st.reload;
    } else if (it && it.type === 'item') {
      ammoTxt = `<em>${g.season.items[it.id].name.toUpperCase()}</em>`;
      if (p.useT > 0) use = p.useT / g.itemTime(it);
    }
    if (e.ammo._last !== ammoTxt) { e.ammo.innerHTML = ammoTxt; e.ammo._last = ammoTxt; }
    e.use.style.display = use > 0 ? 'block' : 'none';
    e.useFill.style.width = (use * 100) + '%';

    // materials
    for (let i = 0; i < 3; i++) {
      const m = MATERIALS[i], el = this.matEls[i], v = p.mats[m.id];
      if (el.last !== v) { el.b.textContent = v; el.last = v; }
      el.d.classList.toggle('sel', g.build.active && g.build.matIndex === i);
    }

    // scoreboard / storm
    e.alive.textContent = g.aliveCount();
    e.kills.textContent = p.kills;
    const st = g.storm.label();
    e.storm.innerHTML = `${st.text} <b>${fmtTime(st.t)}</b>`;

    // prompt + status
    e.prompt.textContent = g.prompt || '';
    e.prompt.style.display = g.prompt ? 'block' : 'none';
    let msg = '';
    if (p.state === 'fall') msg = 'FREEFALL - press SPACE to open glider (auto-opens low)';
    else if (p.state === 'glide') msg = 'GLIDING - steer with the mouse + WASD, SPACE toggles';
    else if (g.build.active) msg = '';
    e.msg.textContent = msg;
    e.build.style.display = g.build.active ? 'block' : 'none';
    if (g.build.active) {
      e.build.textContent = `BUILD: ${g.build.type.toUpperCase()} · ${MATERIALS[g.build.matIndex].name} (${COST}) · click = place`;
    }
    e.scope.classList.toggle('on', !!(p.ads && it && it.type === 'weapon' && weaponStats(it).zoom >= 2.4 && p.state === 'ground'));

    this.drawMap();
  }

  drawMap() {
    const g = this.game, c = this.mapCtx, S = this.el.map.width, p = g.player, w = g.world;
    const k = S / w.minimap.worldSize;
    c.clearRect(0, 0, S, S);
    c.drawImage(w.minimap, 0, 0, S, S);
    const X = (x) => (x * k + S / 2), Z = (z) => (z * k + S / 2);
    // storm
    c.fillStyle = 'rgba(120,40,200,0.38)';
    c.beginPath(); c.rect(0, 0, S, S); c.arc(X(g.storm.cx), Z(g.storm.cz), g.storm.r * k, 0, Math.PI * 2, true); c.fill('evenodd');
    c.strokeStyle = '#b86bff'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(X(g.storm.cx), Z(g.storm.cz), g.storm.r * k, 0, Math.PI * 2); c.stroke();
    if (g.storm.toR > 0) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(X(g.storm.toX), Z(g.storm.toZ), g.storm.toR * k, 0, Math.PI * 2); c.stroke(); }
    // player arrow
    c.save();
    c.translate(X(p.x), Z(p.z));
    c.rotate(-p.yaw);
    c.fillStyle = '#ffee33'; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(0, 2.5); c.lineTo(-4.5, 5); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // season label on the map
    if (g.mode === 'playing') {
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, S - 14, S, 14);
      c.fillStyle = '#fff'; c.font = 'bold 10px Arial'; c.fillText(g.season.name + ' · ' + g.season.title, 4, S - 4);
    }
  }
}
