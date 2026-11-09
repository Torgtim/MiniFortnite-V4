// In-game HUD (DOM based, Windows 95 flavoured): health/shield progress bars, hotbar, LCD ammo
// counter, materials, minimap + big map, storm window, kill feed, prompts, build/edit bars,
// damage numbers, weak points, elimination popups.

import * as THREE from '../lib/three.module.min.js?v=43';
import { RARITIES, weaponStats, ITEM_KINDS } from './weapons.js?v=43';
import { MATERIALS, COST, BUILD_TYPES } from './build.js?v=43';
import { fmtTime } from './util.js?v=43';
import { settings, keyLabel } from './settings.js?v=43';

const $ = (id) => document.getElementById(id);
const ICON = { wall: '&#9646;', floor: '&#9644;', ramp: '&#9698;', cone: '&#9650;' };

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {
      hp: $('hpbar'), hpt: $('hptxt'), sh: $('shbar'), sht: $('shtxt'),
      hot: $('hotbar'), ammo: $('ammo'), ammoName: $('ammoname'), mats: $('mats'), alive: $('alive'), kills: $('kills'),
      storm: $('storm'), prompt: $('prompt'), feed: $('feed'), nums: $('dmgnums'), cross: $('crosshair'),
      hit: $('hitmarker'), vig: $('vignette'), use: $('usebar'), useFill: $('usefill'), msg: $('statusmsg'),
      fps: $('fps'), buildbar: $('buildbar'), buildbtns: $('buildbtns'), buildmat: $('buildmat'), editinfo: $('editinfo'), editkey: $('editkey'),
      scope: $('scope'), map: $('minimap'), pops: $('matpops'), wp: $('weakpoint'), piece: $('pieceinfo'),
      elim: $('elim'), elimtxt: $('elimtxt'), dmgdir: $('dmgdir'), big: $('bigmap'), bigc: $('bigmapc'), bigname: $('bigmapname'), spec: $('spectate'),
    };
    this.mapCtx = this.el.map.getContext('2d');
    this.bigCtx = this.el.bigc.getContext('2d');
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = i === 0 ? 'slot pick' : 'slot';
      d.innerHTML = `<i>${i === 0 ? keyLabel(settings.keys.pickaxe) : i}</i><b></b><u></u><div class="rar"></div>`;
      this.el.hot.appendChild(d);
      this.slotEls.push({ d, b: d.children[1], u: d.children[2], r: d.children[3], last: '' });
    }
    this.matEls = MATERIALS.map((m) => {
      const d = document.createElement('div');
      d.className = 'mat';
      d.innerHTML = `<span class="sw" style="background:${m.color}"></span><b>0</b>`;
      this.el.mats.appendChild(d);
      return { d, b: d.querySelector('b'), last: -1 };
    });
    this.buildEls = BUILD_TYPES.map((t) => {
      const d = document.createElement('div');
      d.className = 'bbtn';
      d.innerHTML = `<i></i><span class="ic">${ICON[t]}</span>${t[0].toUpperCase() + t.slice(1)}`;
      this.el.buildbtns.appendChild(d);
      return { d, t, k: d.querySelector('i') };
    });
    this.fpsAcc = 0; this.fpsN = 0;
    this.hitT = 0; this.hurtT = 0; this.elimT = 0; this.mapT = 0;
    this._v = new THREE.Vector3();
    this.applyCrosshair();
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  applyCrosshair() {
    const c = this.el.cross;
    c.className = 'ch-' + settings.crosshair;
    c.style.setProperty('--cc', settings.crosshairColor);
    this.buildEls.forEach((b) => { b.k.textContent = keyLabel(settings.keys[b.t]); });
    this.el.editkey.textContent = keyLabel(settings.keys.edit);
    document.getElementById("editreset").textContent = keyLabel(settings.keys.aim);
  }

  // ------------------------------------------------------------------ transient things
  hitMarker(head) {
    this.el.hit.className = 'on' + (head ? ' head' : '');
    this.hitT = 0.15;
  }

  hurt(src) {
    this.el.vig.classList.add('hurt'); this.hurtT = 0.25; this.game.audio.play('hurt', null);
    const p = this.game.player;
    if (src && src !== p && src.x !== undefined && p) {
      // red arc pointing at whoever shot us (0 = straight ahead)
      const d = document.createElement('div');
      d.className = 'arc';
      this.el.dmgdir.appendChild(d);
      this.arcs = (this.arcs || []).filter((a) => a.el.isConnected);
      this.arcs.push({ el: d, x: src.x, z: src.z });
      while (this.el.dmgdir.children.length > 4) this.el.dmgdir.firstChild.remove();
      setTimeout(() => d.remove(), 1000);
      this.updateArcs();
    }
  }

  feed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.firstChild);
    setTimeout(() => d.remove(), 7000);
  }

  /** Keep the damage arcs pointing at the attacker while we turn. */
  updateArcs() {
    const p = this.game.player;
    if (!this.arcs || !p) return;
    for (const a of this.arcs) {
      if (!a.el.isConnected) continue;
      const ang = Math.atan2(-(a.x - p.x), -(a.z - p.z));
      a.el.style.transform = `rotate(${p.yaw - ang}rad)`;
    }
  }

  elimBanner(name, weapon) {
    this.el.elimtxt.innerHTML = `You eliminated <b>${name}</b> <small>(${weapon})</small>`;
    this.el.elim.classList.remove('hidden');
    this.elimT = 2.6;
  }

  damageNumber(x, y, z, amount, head, shield) {
    if (this.el.nums.children.length > 14) return;
    const v = this._v.set(x, y, z).project(this.game.camera);
    if (v.z > 1) return;
    const d = document.createElement('div');
    d.className = 'dn' + (head ? ' head' : shield ? ' sh' : '');
    d.textContent = amount;
    d.style.left = ((v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
    this.el.nums.appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  matPop(res, n, crit) {
    const d = document.createElement('div');
    d.textContent = '+' + n + ' ' + res + (crit ? ' (weak point!)' : '');
    d.className = 'pop' + (crit ? ' crit' : '');
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game, p = g.player, e = this.el;
    if (!p) return;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { e.fps.textContent = settings.showFps ? Math.round(this.fpsN / this.fpsAcc) + ' FPS' : g.season.title; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) e.hit.className = ''; }
    if (this.hurtT > 0) { this.hurtT -= dt; if (this.hurtT <= 0) e.vig.classList.remove('hurt'); }
    if (this.elimT > 0) { this.elimT -= dt; if (this.elimT <= 0) e.elim.classList.add('hidden'); }
    const outside = g.storm.outside(p.x, p.z) && p.alive && !p.airborne;
    e.vig.classList.toggle('storm', outside);

    // bars
    const hp = Math.ceil(Math.max(0, p.hp)), sh = Math.ceil(Math.max(0, p.shield));
    if (this._hp !== hp) { e.hp.style.width = Math.min(100, hp) + '%'; e.hpt.textContent = hp; this._hp = hp; }
    if (this._sh !== sh) { e.sh.style.width = Math.min(100, sh) + '%'; e.sht.textContent = sh; this._sh = sh; }

    // hotbar (or build bar)
    const building = g.build.active;
    e.hot.style.display = building ? 'none' : 'flex';
    e.buildbar.classList.toggle('hidden', !building);
    if (building) {
      this.buildEls.forEach((b) => b.d.classList.toggle('sel', b.t === g.build.type));
      const m = MATERIALS[g.build.matIndex];
      e.buildmat.textContent = `${m.name} (${p.mats[m.id]}) - ${COST} per piece - ${keyLabel(settings.keys.aim)} / ${keyLabel(settings.keys.material)} = material`;
    }
    for (let i = 0; i < 6; i++) {
      const s = p.slots[i], el = this.slotEls[i];
      let label = '', sub = '', color = 'transparent';
      if (s) {
        if (s.type === 'pickaxe') { label = 'PICK'; color = '#808080'; }
        else if (s.type === 'weapon') { const st = weaponStats(s); label = st.short; sub = s.mag + '/' + p.ammo[st.ammo]; color = RARITIES[s.rarity].color; }
        else { label = ITEM_KINDS[s.id].short; sub = 'x' + s.count; color = g.season.items[s.id].color; }
      }
      const key = label + sub + color + (i === p.slot) + (i === 0 ? settings.keys.pickaxe : '');
      if (key !== el.last) {
        el.last = key;
        el.b.textContent = label; el.u.textContent = sub;
        el.r.style.background = color;
        el.b.style.color = s && s.type === 'weapon' ? shadeText(color) : '#000';
        el.d.classList.toggle('sel', i === p.slot);
        if (i === 0) el.d.children[0].textContent = keyLabel(settings.keys.pickaxe);
      }
    }

    // ammo + use bar
    const it = p.held;
    let ammoTxt = '', name = 'Pickaxe', use = 0;
    if (it && it.type === 'weapon') {
      const st = weaponStats(it);
      ammoTxt = `<b>${String(it.mag).padStart(2, '0')}</b><span> / ${String(p.ammo[st.ammo]).padStart(3, '0')}</span>`;
      name = `${st.name} - ${RARITIES[it.rarity].name}`;
      if (p.reloadT > 0) { use = 1 - p.reloadT / st.reload; ammoTxt = '<span>RELOADING</span>'; }
    } else if (it && it.type === 'item') {
      name = g.season.items[it.id].name;
      ammoTxt = `<b>x${it.count}</b>`;
      if (p.useT > 0) use = p.useT / g.itemTime(it);
    } else ammoTxt = '<span>&#9874; HARVEST</span>';
    if (e.ammo._last !== ammoTxt) { e.ammo.innerHTML = ammoTxt; e.ammo._last = ammoTxt; }
    if (e.ammoName._last !== name) { e.ammoName.textContent = name; e.ammoName._last = name; }
    e.use.style.display = use > 0 ? 'block' : 'none';
    e.useFill.style.width = (use * 100) + '%';

    // materials
    for (let i = 0; i < 3; i++) {
      const m = MATERIALS[i], el = this.matEls[i], v = p.mats[m.id];
      if (el.last !== v) { el.b.textContent = v; el.last = v; }
      el.d.classList.toggle('sel', building && g.build.matIndex === i);
    }

    // scoreboard / storm
    const al = g.aliveCount();
    if (e.alive._v !== al) { e.alive.textContent = al; e.alive._v = al; }
    if (e.kills._v !== p.kills) { e.kills.textContent = p.kills; e.kills._v = p.kills; }
    const st = g.storm.label();
    const busWait = g.bus.active && g.bus.dist <= 120;
    const stormHtml = g.playground ? 'PLAYGROUND - no storm &middot; unlimited mats' : busWait ? 'Storm forms after the bus leaves' : `${st.text} <b>${fmtTime(st.t)}</b>${outside ? ' - GET IN THE CIRCLE!' : ''}`;
    if (this._stormHtml !== stormHtml) { e.storm.innerHTML = stormHtml; this._stormHtml = stormHtml; }
    e.storm.classList.toggle('danger', outside || g.storm.state === 'shrinking');

    // prompt + status
    const pk = (g.prompt || '') + '|' + (g.promptColor || '');
    if (this._prompt !== pk) {
      this._prompt = pk;
      e.prompt.textContent = g.prompt || '';
      e.prompt.style.display = g.prompt ? 'block' : 'none';
      e.prompt.style.borderLeft = g.promptColor ? `8px solid ${g.promptColor}` : '';
    }
    let msg = '';
    if (p.air === 'bus') msg = '';
    else if (p.air === 'fall') msg = 'SKYDIVING - W to dive faster, SPACE opens the glider';
    else if (p.air === 'glide') msg = 'GLIDING - steer with mouse + WASD';
    if (e.msg._t !== msg) { e.msg.textContent = msg; e.msg._t = msg; }
    e.editinfo.classList.toggle('hidden', !g.edit.active);
    e.scope.classList.toggle('on', !!(p.ads && it && it.type === 'weapon' && weaponStats(it).zoom >= 2.4 && !p.airborne));
    e.cross.style.display = e.scope.classList.contains('on') ? 'none' : '';
    e.spec.classList.toggle('hidden', g.mode !== 'spectating');
    if (g.mode === 'spectating' && g.spectateTarget) e.spec.textContent = `Spectating ${g.spectateTarget.name} - click / A D to switch`;

    // crosshair opens up with the current spread (bloom, moving, jumping...)
    let gap = 4;
    if (it && it.type === 'weapon' && !p.airborne) {
      const st = weaponStats(it);
      const px = Math.tan(g.combat.spreadFor(p, st)) / Math.tan((g.camera.fov * Math.PI / 180) / 2) * innerHeight / 2;
      gap = Math.min(60, 3 + px);
    }
    this._gap = (this._gap || gap) + (gap - (this._gap || gap)) * Math.min(1, dt * 18);
    e.cross.style.setProperty('--g', this._gap.toFixed(1) + 'px');
    // shotguns get a circle reticle (the default cross stays for everything else)
    const want = settings.crosshair === 'cross' && it && it.type === 'weapon' && weaponStats(it).cls === 'shotgun' ? 'ch-circle' : 'ch-' + settings.crosshair;
    if (e.cross.className !== want) e.cross.className = want;

    this.updateArcs();
    this.updateWeakPoint();
    this.updatePieceInfo(p);
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.05; this.drawMap(this.mapCtx, this.el.map.width, false); }
    e.big.classList.toggle('hidden', !g.bigMap);
    if (g.bigMap) { e.bigname.textContent = g.season.name + ': ' + g.season.title; this.drawMap(this.bigCtx, this.el.bigc.width, true); }
  }

  updateWeakPoint() {
    const wp = this.game.combat.weakPoint, el = this.el.wp;
    if (!wp) { el.style.display = 'none'; return; }
    const v = this._v.set(wp.x, wp.y, wp.z).project(this.game.camera);
    if (v.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  }

  updatePieceInfo(p) {
    const g = this.game, el = this.el.piece;
    this._pieceT = (this._pieceT || 0) - 1;
    if (this._pieceT > 0) return;
    this._pieceT = 4;
    if (!p.alive || p.airborne) { el.classList.add('hidden'); return; }
    const a = g.aimRay();
    const hit = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 30 + a.back, 1.5);
    const pc = hit.collider && hit.collider.piece;
    if (!pc) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const mine = pc.owner === p && !g.edit.active ? ` \u00b7 [${keyLabel(settings.keys.edit)}] edit` : '';
    el.textContent = `${MATERIALS[pc.mat].name} ${pc.type}: ${Math.ceil(pc.hp)}/${pc.maxHp}${pc.buildLeft > 0 ? ' (building)' : ''}${mine}`;
  }

  drawMap(c, S, big) {
    const g = this.game, p = g.player, w = g.world;
    const k = S / w.minimap.worldSize;
    c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = !big;
    c.drawImage(w.minimap, 0, 0, S, S);
    const X = (x) => (x * k + S / 2), Z = (z) => (z * k + S / 2);
    // POI names on the big map
    if (big) {
      c.font = 'bold 13px "Times New Roman", serif'; c.textAlign = 'center';
      for (const s of w.sites) { c.fillStyle = '#000'; c.fillText(s.name, X(s.x) + 1, Z(s.z) + 1); c.fillStyle = '#fff'; c.fillText(s.name, X(s.x), Z(s.z)); }
      c.textAlign = 'left';
    }
    // bus route
    if (g.bus.active) {
      c.setLineDash([5, 4]); c.strokeStyle = '#ffffff'; c.lineWidth = big ? 2 : 1.2;
      c.beginPath(); c.moveTo(X(g.bus.x0), Z(g.bus.z0)); c.lineTo(X(g.bus.x1), Z(g.bus.z1)); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#2f6bff'; c.strokeStyle = '#fff';
      c.beginPath(); c.arc(X(g.bus.x), Z(g.bus.z), big ? 7 : 4, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // storm
    c.fillStyle = 'rgba(120,40,200,0.38)';
    c.beginPath(); c.rect(0, 0, S, S); c.arc(X(g.storm.cx), Z(g.storm.cz), g.storm.r * k, 0, Math.PI * 2, true); c.fill('evenodd');
    c.strokeStyle = '#b86bff'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(X(g.storm.cx), Z(g.storm.cz), g.storm.r * k, 0, Math.PI * 2); c.stroke();
    if (g.storm.toR > 0) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(X(g.storm.toX), Z(g.storm.toZ), g.storm.toR * k, 0, Math.PI * 2); c.stroke(); }
    // supply drops
    c.fillStyle = '#4da6ff'; c.strokeStyle = '#000';
    for (const ch of g.loot.chests) if (ch.supply && !ch.opened) { c.fillRect(X(ch.x) - 3, Z(ch.z) - 3, 6, 6); c.strokeRect(X(ch.x) - 3, Z(ch.z) - 3, 6, 6); }
    for (const f of g.loot.falling) { c.fillRect(X(f.x) - 3, Z(f.z) - 3, 6, 6); }
    // player arrow
    if (p && p.alive) {
      c.save();
      c.translate(X(p.x), Z(p.z));
      c.rotate(-p.yaw);
      const s = big ? 1.6 : 1;
      c.fillStyle = '#ffee33'; c.strokeStyle = '#000'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -6 * s); c.lineTo(4.5 * s, 5 * s); c.lineTo(0, 2.5 * s); c.lineTo(-4.5 * s, 5 * s); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
  }
}

/** Readable text colour for a rarity colour on the grey Win95 buttons. */
function shadeText(hex) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(hsl.l, 0.38));
  return '#' + c.getHexString();
}
