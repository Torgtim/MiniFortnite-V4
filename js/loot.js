// Loot: floor pickups, chests, ammo boxes, supply drops, material drops, season loot tables
// and pickup logic.

import * as THREE from '../lib/three.module.min.js?v=48';
import { weightedPick } from './util.js?v=48';
import { AMMO, ITEM_KINDS, RARITIES, WEAPONS, CLASS_COLORS, makeWeapon, weaponStats } from './weapons.js?v=48';
import { RARITY_GROUND } from './seasons.js?v=48';
import { buildGunModel } from './gunmodels.js?v=48';
import { TEX } from './textures.js?v=48';
import { MATERIALS } from './build.js?v=48';

const beamGeo = new THREE.CylinderGeometry(0.22, 0.3, 3.4, 6, 1, true).translate(0, 1.7, 0);
const beamMats = {};
const beamMat = (color) => beamMats[color] || (beamMats[color] = new THREE.MeshBasicMaterial({
  color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
}));
const geo = {
  ammo: new THREE.BoxGeometry(0.42, 0.3, 0.42), item: new THREE.OctahedronGeometry(0.3, 0), mats: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  chest: new THREE.BoxGeometry(1.0, 0.62, 0.7), lid: new THREE.BoxGeometry(1.04, 0.16, 0.74), abox: new THREE.BoxGeometry(0.9, 0.5, 0.6),
  supply: new THREE.BoxGeometry(1.3, 1.1, 1.3), balloon: new THREE.SphereGeometry(1.3, 10, 8),
  glow: new THREE.CircleGeometry(0.55, 12).rotateX(-Math.PI / 2),
};
const glowMats = {};
const glowMat = (color) => glowMats[color] || (glowMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
const mats = {};
const lam = (color, emissive = 0.3) => mats[color + emissive] || (mats[color + emissive] = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: emissive }));
const texMat = (name, color) => mats['t' + name + color] || (mats['t' + name + color] = new THREE.MeshLambertMaterial({ map: TEX[name](), color, emissive: color, emissiveIntensity: 0.15 }));

export class Loot {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pickups = [];
    this.chests = [];
    this.falling = [];
    this._id = 0;
    this.cullT = 0;
    this.humT = 0;
  }

  clear() {
    for (const p of this.pickups) this.group.remove(p.mesh);
    for (const c of this.chests) this.group.remove(c.mesh);
    for (const f of this.falling) this.group.remove(f.mesh);
    this.pickups.length = 0;
    this.chests.length = 0;
    this.falling.length = 0;
  }

  // -------------------------------------------------------------- rolling loot from the season table
  rollRarity(rnd, boost = 0) {
    const w = RARITY_GROUND.map((v, i) => ({ w: v * (1 + boost * i * 0.6), i }));
    return weightedPick(rnd, w).i;
  }

  rollWeapon(rnd, boost = 0) {
    const s = this.game.season;
    const id = weightedPick(rnd, s.weapons.map(([id, w]) => ({ id, w }))).id;
    return makeWeapon(id, this.rollRarity(rnd, boost));
  }

  rollItemId(rnd) {
    const s = this.game.season;
    return weightedPick(rnd, Object.entries(s.items).map(([id, v]) => ({ id, w: v.w }))).id;
  }

  seasonAmmoTypes() {
    return [...new Set(this.game.season.weapons.map(([id]) => WEAPONS[id].ammo))];
  }

  randomAmmoType(rnd) {
    const t = this.seasonAmmoTypes();
    return t[Math.floor(rnd() * t.length)];
  }

  /** Fill the map: floor loot at every loot spot, chests and ammo boxes at chest spots. */
  populate(world, rnd) {
    for (const spot of world.lootSpots) {
      const r = rnd();
      if (r < 0.42) this.spawnWeapon(spot.x, spot.y, spot.z, this.rollWeapon(rnd));
      else if (r < 0.7) this.spawnAmmo(spot.x, spot.y, spot.z, this.randomAmmoType(rnd), 1);
      else this.spawnItem(spot.x, spot.y, spot.z, this.rollItemId(rnd));
    }
    for (const c of world.chests) {
      if (rnd() < 0.3) this.spawnChest(c.x, c.y, c.z, 'ammo');
      else this.spawnChest(c.x, c.y, c.z, 'chest');
    }
    // one or two loot alpacas hidden out in the wild
    const n = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) { const q = world.randomLandPoint(rnd, 40); this.spawnChest(q.x, q.y, q.z, 'alpaca'); }
  }

  // -------------------------------------------------------------- spawning
  _group(x, y, z, beamColor) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (beamColor) g.add(new THREE.Mesh(beamGeo, beamMat(beamColor)));
    this.group.add(g);
    return g;
  }

  spawnWeapon(x, y, z, inst) {
    const color = RARITIES[inst.rarity].color;
    const g = this._group(x, y, z, color);
    const body = new THREE.Group();
    const gun = buildGunModel(inst.id, inst.rarity);
    gun.scale.setScalar(1.4);
    body.add(gun);
    const glow = new THREE.Mesh(geo.glow, glowMat(color));
    glow.position.y = -0.48;
    body.add(glow);
    body.position.y = 0.55;
    g.add(body);
    const p = { id: ++this._id, kind: 'weapon', inst, x, y, z, mesh: g, body };
    this.pickups.push(p);
    return p;
  }

  spawnAmmo(x, y, z, type, mult = 1) {
    const color = AMMO[type].color;
    const g = this._group(x, y, z, null);
    const body = new THREE.Mesh(geo.ammo, lam(color)); body.position.y = 0.3; g.add(body);
    const p = { id: ++this._id, kind: 'ammo', type, n: Math.round(AMMO[type].amount * mult), x, y, z, mesh: g, body };
    this.pickups.push(p);
    return p;
  }

  spawnItem(x, y, z, id) {
    const color = this.game.season.items[id].color;
    const g = this._group(x, y, z, color);
    const body = new THREE.Mesh(geo.item, lam(color, 0.45)); body.position.y = 0.55; g.add(body);
    const p = { id: ++this._id, kind: 'item', itemId: id, x, y, z, mesh: g, body };
    this.pickups.push(p);
    return p;
  }

  spawnMats(x, y, z, res, n) {
    const m = MATERIALS.find((q) => q.id === res);
    const g = this._group(x, y, z, null);
    const body = new THREE.Mesh(geo.mats, texMat(m.tex, '#ffffff')); body.position.y = 0.3; g.add(body);
    const p = { id: ++this._id, kind: 'mats', res, n, x, y, z, mesh: g, body };
    this.pickups.push(p);
    return p;
  }

  spawnChest(x, y, z, kind = 'chest') {
    const g = this._group(x, y, z, null);
    let body;
    if (kind === 'alpaca') {
      // loot alpaca pinata: stripy, wobbly, full of goodies
      body = new THREE.Group();
      const stripe = ['#9b59ff', '#3fb5ff', '#ff4fd8', '#ffd84a'];
      const add = (w, h, d, x0, y0, z0, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c, 0.25)); m.position.set(x0, y0, z0); body.add(m); return m; };
      for (let i = 0; i < 4; i++) add(0.62, 0.62, 0.3, 0, 1.0, -0.45 + i * 0.3, stripe[i]);
      add(0.36, 0.9, 0.36, 0, 1.6, -0.55, stripe[1]); add(0.42, 0.36, 0.6, 0, 2.15, -0.7, stripe[0]);
      add(0.1, 0.25, 0.1, -0.13, 2.45, -0.55, stripe[2]); add(0.1, 0.25, 0.1, 0.13, 2.45, -0.55, stripe[2]);
      for (const [lx, lz] of [[-0.2, -0.35], [0.2, -0.35], [-0.2, 0.35], [0.2, 0.35]]) add(0.14, 0.7, 0.14, lx, 0.35, lz, '#f5e6c8');
      add(0.12, 0.12, 0.3, 0, 1.2, 0.7, stripe[3]);
      g.add(new THREE.Mesh(beamGeo, beamMat('#ff4fd8')));
    } else if (kind === 'ammo') {
      body = new THREE.Mesh(geo.abox, texMat('crate', '#6f8a4a')); body.position.y = 0.25;
    } else if (kind === 'supply') {
      body = new THREE.Mesh(geo.supply, texMat('crate', '#4da6ff')); body.position.y = 0.55;
      g.add(new THREE.Mesh(beamGeo, beamMat('#4da6ff')));
    } else {
      body = new THREE.Mesh(geo.chest, texMat('crate', '#ffd040')); body.position.y = 0.31;
      const lid = new THREE.Mesh(geo.lid, lam('#c8961c', 0.4)); lid.position.y = 0.66; g.add(lid);
      g.userData.lid = lid;
    }
    g.add(body);
    g.rotation.y = Math.random() * Math.PI * 2;
    const c = { x, y, z, mesh: g, body, opened: false, kind, supply: kind === 'supply' };
    this.chests.push(c);
    return c;
  }

  /** A supply drop falls slowly from the sky under a balloon. */
  spawnSupplyDrop(x, z) {
    const w = this.game.world;
    const y = w.heightAt(x, z);
    const g = new THREE.Group();
    const crate = new THREE.Mesh(geo.supply, texMat('crate', '#4da6ff')); crate.position.y = 0.55;
    const balloon = new THREE.Mesh(geo.balloon, new THREE.MeshLambertMaterial({ color: '#ff4040', flatShading: true })); balloon.position.y = 4.2;
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 0.05), lam('#333', 0)); rope.position.y = 2.3;
    g.add(crate, balloon, rope);
    g.position.set(x, y + 110, z);
    this.group.add(g);
    this.falling.push({ x, z, y: y + 110, ground: y, mesh: g });
    this.game.hud.feed('<span class="me">*** SUPPLY DROP incoming! ***</span>');
    this.game.audio.play('supply', null);
  }

  openChest(c, opener, rnd = Math.random) {
    if (c.opened) return;
    c.opened = true;
    const spread = () => (rnd() - 0.5) * 2.2;
    if (c.kind === 'alpaca') {
      for (let i = 0; i < 3; i++) this.spawnWeapon(c.x + spread() * 1.5, c.y, c.z + spread() * 1.5, this.rollWeapon(rnd, 2));
      for (let i = 0; i < 2; i++) this.spawnItem(c.x + spread() * 1.5, c.y, c.z + spread() * 1.5, this.rollItemId(rnd));
      for (let i = 0; i < 3; i++) this.spawnAmmo(c.x + spread() * 1.5, c.y, c.z + spread() * 1.5, this.randomAmmoType(rnd), 1.5);
      for (const m of MATERIALS) this.spawnMats(c.x + spread() * 1.5, c.y, c.z + spread() * 1.5, m.id, 100);
      this.group.remove(c.mesh);
      if (this.game.fx) { this.game.fx.eliminate(c.x, c.y + 0.5, c.z, ['#9b59ff', '#3fb5ff', '#ff4fd8', '#ffd84a']); this.game.fx.flash(c.x, c.y + 1.2, c.z, 4, 0.3); }
      this.game.audio.play('alpaca', { x: c.x, y: c.y, z: c.z });
      return;
    }
    if (c.kind === 'ammo') {
      for (let i = 0; i < 2; i++) this.spawnAmmo(c.x + spread(), c.y, c.z + spread(), this.randomAmmoType(rnd), 1.5);
      if (rnd() < 0.4) this.spawnItem(c.x + spread(), c.y, c.z + spread(), 'nade');
      c.body.material = lam('#3a3a2a', 0);
    } else if (c.kind === 'supply') {
      this.spawnWeapon(c.x + spread(), c.y, c.z + spread(), this.rollWeapon(rnd, 3.5));
      this.spawnWeapon(c.x + spread(), c.y, c.z + spread(), this.rollWeapon(rnd, 2.5));
      this.spawnAmmo(c.x + spread(), c.y, c.z + spread(), this.randomAmmoType(rnd), 2);
      this.spawnItem(c.x + spread(), c.y, c.z + spread(), 'shield_l');
      this.spawnMats(c.x + spread(), c.y, c.z + spread(), MATERIALS[Math.floor(rnd() * 3)].id, 60);
      this.group.remove(c.mesh);
    } else {
      this.spawnWeapon(c.x + spread(), c.y, c.z + spread(), this.rollWeapon(rnd, 1.4));
      this.spawnAmmo(c.x + spread(), c.y, c.z + spread(), this.randomAmmoType(rnd), 1.3);
      this.spawnItem(c.x + spread(), c.y, c.z + spread(), this.rollItemId(rnd));
      this.spawnMats(c.x + spread(), c.y, c.z + spread(), 'wood', 30);
      c.body.material = lam('#5a4a20', 0);
      if (c.mesh.userData.lid) { c.mesh.userData.lid.rotation.x = -1.2; c.mesh.userData.lid.position.set(0, 0.85, 0.3); }
    }
    if (this.game.fx) this.game.fx.chips(c.x, c.y + 0.8, c.z, 0xffe070, 12);
    this.game.audio.play('chest', { x: c.x, y: c.y, z: c.z });
  }

  remove(p) {
    this.group.remove(p.mesh);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /** Drop everything a dead entity carried (weapons, items, ammo and materials). */
  dropInventory(e) {
    let n = 0;
    for (let i = 1; i <= 5; i++) {
      const s = e.slots[i];
      if (!s) continue;
      const ox = (Math.random() - 0.5) * 2.4, oz = (Math.random() - 0.5) * 2.4;
      if (s.type === 'weapon') this.spawnWeapon(e.x + ox, e.y, e.z + oz, s);
      else for (let k = 0; k < Math.min(s.count, 3); k++) this.spawnItem(e.x + ox + k * 0.3, e.y, e.z + oz, s.id);
      n++;
    }
    for (const t of Object.keys(e.ammo)) {
      if (e.ammo[t] >= 6) this.spawnAmmo(e.x + (Math.random() - 0.5) * 2, e.y, e.z + (Math.random() - 0.5) * 2, t, Math.min(2.5, e.ammo[t] / AMMO[t].amount));
    }
    for (const m of MATERIALS) {
      if (e.mats[m.id] >= 10) this.spawnMats(e.x + (Math.random() - 0.5) * 2, e.y, e.z + (Math.random() - 0.5) * 2, m.id, e.mats[m.id]);
    }
    return n;
  }

  // -------------------------------------------------------------- pickup rules
  /** Auto-pickup of ammo and materials for anyone walking over them. */
  autoPickup(e) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.kind === 'weapon' && e.isPlayer && this.game.settings.autoPickup && !p.dropped) {
        // Fortnite-style: walk over a weapon with a free slot and it is yours
        const dx = p.x - e.x, dz = p.z - e.z;
        if (dx * dx + dz * dz < 1.6 && Math.abs(p.y - e.y) < 2 && e.slots.slice(1).some((s) => !s)) {
          const wasPick = e.slot === 0;
          e.giveWeapon(p.inst); this.remove(p); this.game.audio.play('pickup', e);
          if (wasPick) for (let k = 1; k <= 5; k++) if (e.slots[k] === p.inst) { e.selectSlot(k); break; }
        }
        continue;
      }
      if (p.kind !== 'ammo' && p.kind !== 'mats') continue;
      const dx = p.x - e.x, dz = p.z - e.z;
      if (dx * dx + dz * dz < 2.4 && Math.abs(p.y - e.y) < 2.5) {
        if (p.kind === 'ammo') e.addAmmo(p.type, p.n);
        else {
          const take = Math.min(p.n, 999 - e.mats[p.res]);
          if (take <= 0) continue;
          e.mats[p.res] += take;
          if (e.isPlayer) this.game.hud.matPop(p.res, take);
          if (take < p.n) { p.n -= take; continue; }
        }
        this.remove(p);
        if (e.isPlayer) this.game.audio.play('pickup', e);
      }
    }
  }

  /** Nearest weapon/item/chest the entity could interact with, within reach. */
  nearestInteractable(e, reach = 2.6) {
    let best = null, bd = reach * reach;
    for (const p of this.pickups) {
      if (p.kind === 'ammo' || p.kind === 'mats') continue;
      const dx = p.x - e.x, dz = p.z - e.z, dy = p.y - e.y;
      const d = dx * dx + dz * dz;
      if (d < bd && Math.abs(dy) < 2.5) { bd = d; best = { type: 'pickup', p }; }
    }
    for (const c of this.chests) {
      if (c.opened) continue;
      const dx = c.x - e.x, dz = c.z - e.z, dy = c.y - e.y;
      const d = dx * dx + dz * dz;
      if (d < bd && Math.abs(dy) < 2.5) { bd = d; best = { type: 'chest', c }; }
    }
    return best;
  }

  /** Perform the interaction. Returns true if something happened. */
  interact(e, target, rnd = Math.random) {
    if (!target) return false;
    if (target.type === 'chest') { this.openChest(target.c, e, rnd); return true; }
    const p = target.p;
    if (p.kind === 'weapon') {
      const old = e.giveWeapon(p.inst);
      if (old === p.inst) return false;
      this.remove(p);
      if (old) {
        if (old.type === 'weapon') this.spawnWeapon(e.x + 0.6, e.y, e.z + 0.6, old).dropped = true;
        else for (let k = 0; k < old.count; k++) this.spawnItem(e.x + 0.6 + k * 0.3, e.y, e.z + 0.6, old.id);
      }
      if (e.isPlayer) this.game.audio.play('pickup', e);
      return true;
    }
    if (p.kind === 'item') {
      if (!e.giveItem(p.itemId)) {
        // inventory full: the player swaps the item with the held slot (or the weakest weapon when holding the pickaxe)
        if (!e.isPlayer) return false;
        let idx = e.slot >= 1 ? e.slot : -1;
        if (idx < 0) {
          let worst = Infinity;
          for (let i = 1; i <= 5; i++) { const s = e.slots[i]; const sc = s && s.type === 'weapon' ? weaponStats(s).dps : 0; if (sc < worst) { worst = sc; idx = i; } }
        }
        const old = e.slots[idx], max = ITEM_KINDS[p.itemId].stack || 3;
        e.slots[idx] = { type: 'item', id: p.itemId, count: 1 };
        e.reloadT = 0; e.useT = 0; e.burstLeft = 0;
        this.remove(p);
        if (old.type === 'weapon') this.spawnWeapon(e.x + 0.6, e.y, e.z + 0.6, old).dropped = true;
        else for (let k = 0; k < old.count; k++) this.spawnItem(e.x + 0.6 + k * 0.3, e.y, e.z + 0.6, old.id);
        if (max) e.selectSlot(idx);
        this.game.audio.play('pickup', e);
        return true;
      }
      this.remove(p);
      if (e.isPlayer) this.game.audio.play('pickup', e);
      return true;
    }
    return false;
  }

  update(dt, time) {
    const cam = this.game.camera.position;
    this.cullT -= dt;
    const cull = this.cullT <= 0;
    if (cull) this.cullT = 0.25;
    for (const p of this.pickups) {
      if (cull) {
        const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
        p.mesh.visible = d2 < 140 * 140;
        if (p.mesh.children[0] && p.mesh.children[0].geometry === beamGeo) p.mesh.children[0].visible = d2 < 70 * 70;
      }
      if (!p.mesh.visible) continue;
      p.body.rotation.y += dt * 1.6;
      p.body.position.y = (p.kind === 'ammo' || p.kind === 'mats' ? 0.3 : 0.55) + Math.sin(time * 2 + p.id) * 0.08;
    }
    for (const c of this.chests) if (c.kind === 'alpaca' && !c.opened) { c.body.rotation.z = Math.sin(time * 3 + c.x) * 0.06; c.body.position.y = Math.abs(Math.sin(time * 2 + c.z)) * 0.1; }
    // supply drops floating down
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.y -= dt * 5;
      f.mesh.position.y = f.y;
      f.mesh.rotation.y += dt * 0.5;
      if (f.y <= f.ground) {
        this.group.remove(f.mesh);
        this.falling.splice(i, 1);
        this.spawnChest(f.x, f.ground, f.z, 'supply');
        if (this.game.fx) this.game.fx.landing(f.x, f.ground, f.z);
      }
    }
    // chests hum when you are close (like in the real thing)
    const pl = this.game.player;
    this.humT -= dt;
    if (pl && pl.alive && this.humT <= 0) {
      this.humT = 1.3;
      let best = null, bd = 16 * 16;
      for (const c of this.chests) {
        if (c.opened || c.kind === 'ammo') continue;
        const d = (c.x - pl.x) ** 2 + (c.z - pl.z) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) this.game.audio.play('hum', best);
    }
  }
}

export { weaponStats, CLASS_COLORS, ITEM_KINDS };
