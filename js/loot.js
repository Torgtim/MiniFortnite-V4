// Loot: floor pickups, chests, season loot tables and pickup logic.

import * as THREE from '../lib/three.module.min.js';
import { weightedPick } from './util.js';
import { AMMO, ITEM_KINDS, RARITIES, WEAPONS, CLASS_COLORS, makeWeapon, weaponStats } from './weapons.js';
import { RARITY_GROUND } from './seasons.js';

const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 3.2, 8, 1, true).translate(0, 1.6, 0);
const beamMats = {};
const beamMat = (color) => beamMats[color] || (beamMats[color] = new THREE.MeshBasicMaterial({
  color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
}));
const bodyGeo = { weapon: new THREE.BoxGeometry(0.9, 0.28, 0.32), ammo: new THREE.BoxGeometry(0.4, 0.28, 0.4), item: new THREE.OctahedronGeometry(0.32, 0), chest: new THREE.BoxGeometry(1.0, 0.6, 0.7) };
const bodyMats = {};
const bodyMat = (color) => bodyMats[color] || (bodyMats[color] = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));

export class Loot {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pickups = [];
    this.chests = [];
    this._id = 0;
  }

  clear() {
    for (const p of this.pickups) this.group.remove(p.mesh);
    for (const c of this.chests) this.group.remove(c.mesh);
    this.pickups.length = 0;
    this.chests.length = 0;
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

  /** Fill the map: floor loot at every loot spot and chests at chest spots. */
  populate(world, rnd) {
    for (const spot of world.lootSpots) {
      const r = rnd();
      if (r < 0.42) this.spawnWeapon(spot.x, spot.y, spot.z, this.rollWeapon(rnd));
      else if (r < 0.72) this.spawnAmmo(spot.x, spot.y, spot.z, this.randomAmmoType(rnd), 1);
      else this.spawnItem(spot.x, spot.y, spot.z, this.rollItemId(rnd));
    }
    for (const c of world.chests) this.spawnChest(c.x, c.y, c.z);
  }

  randomAmmoType(rnd) {
    const t = this.seasonAmmoTypes();
    return t[Math.floor(rnd() * t.length)];
  }

  // -------------------------------------------------------------- spawning
  _make(kind, color, x, y, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo[kind], bodyMat(color));
    body.position.y = 0.55;
    g.add(body);
    if (kind !== 'chest') g.add(new THREE.Mesh(beamGeo, beamMat(color)));
    g.position.set(x, y, z);
    this.group.add(g);
    return g;
  }

  spawnWeapon(x, y, z, inst) {
    const color = RARITIES[inst.rarity].color;
    const p = { id: ++this._id, kind: 'weapon', inst, x, y, z, mesh: this._make('weapon', color, x, y, z) };
    p.mesh.children[0].material = bodyMat(color);
    p.mesh.children[0].scale.set(1, 1, 1);
    this.pickups.push(p);
    return p;
  }

  spawnAmmo(x, y, z, type, mult = 1) {
    const color = AMMO[type].color;
    const p = { id: ++this._id, kind: 'ammo', type, n: Math.round(AMMO[type].amount * mult), x, y, z, mesh: this._make('ammo', color, x, y, z) };
    this.pickups.push(p);
    return p;
  }

  spawnItem(x, y, z, id) {
    const color = this.game.season.items[id].color;
    const p = { id: ++this._id, kind: 'item', itemId: id, x, y, z, mesh: this._make('item', color, x, y, z) };
    this.pickups.push(p);
    return p;
  }

  spawnChest(x, y, z) {
    const mesh = this._make('chest', '#e8b020', x, y, z);
    mesh.children[0].position.y = 0.3;
    const c = { x, y, z, mesh, opened: false };
    this.chests.push(c);
    return c;
  }

  openChest(c, rnd = Math.random) {
    if (c.opened) return;
    c.opened = true;
    c.mesh.children[0].material = bodyMat('#5a4a20');
    c.mesh.rotation.y += 0.2;
    const spread = () => (rnd() - 0.5) * 2.2;
    this.spawnWeapon(c.x + spread(), c.y, c.z + spread(), this.rollWeapon(rnd, 1.4));
    this.spawnAmmo(c.x + spread(), c.y, c.z + spread(), this.randomAmmoType(rnd), 1.3);
    this.spawnItem(c.x + spread(), c.y, c.z + spread(), this.rollItemId(rnd));
    this.game.audio.play('chest', { x: c.x, y: c.y, z: c.z });
  }

  remove(p) {
    this.group.remove(p.mesh);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /** Drop everything a dead entity carried. */
  dropInventory(e) {
    let n = 0;
    for (let i = 1; i <= 5; i++) {
      const s = e.slots[i];
      if (!s) continue;
      const ox = (Math.random() - 0.5) * 2.4, oz = (Math.random() - 0.5) * 2.4;
      if (s.type === 'weapon') this.spawnWeapon(e.x + ox, e.y, e.z + oz, s);
      else this.spawnItem(e.x + ox, e.y, e.z + oz, s.id);
      n++;
    }
    for (const t of Object.keys(e.ammo)) {
      if (e.ammo[t] >= 6) this.spawnAmmo(e.x + (Math.random() - 0.5) * 2, e.y, e.z + (Math.random() - 0.5) * 2, t, Math.min(2, e.ammo[t] / AMMO[t].amount));
    }
    return n;
  }

  // -------------------------------------------------------------- pickup rules
  /** Auto-pickup of ammo for anyone walking over it. */
  autoPickup(e) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.kind !== 'ammo') continue;
      const dx = p.x - e.x, dz = p.z - e.z;
      if (dx * dx + dz * dz < 2.2 && Math.abs(p.y - e.y) < 2.5) {
        e.addAmmo(p.type, p.n);
        this.remove(p);
        if (e.isPlayer) this.game.audio.play('pickup', e);
      }
    }
  }

  /** Nearest weapon/item/chest the entity could interact with, within reach. */
  nearestInteractable(e, reach = 2.6) {
    let best = null, bd = reach * reach;
    for (const p of this.pickups) {
      if (p.kind === 'ammo') continue;
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
    if (target.type === 'chest') { this.openChest(target.c, rnd); return true; }
    const p = target.p;
    if (p.kind === 'weapon') {
      const old = e.giveWeapon(p.inst);
      if (old === p.inst) return false;
      this.remove(p);
      if (old) this.spawnWeapon(e.x + 0.6, e.y, e.z + 0.6, old);
      if (e.isPlayer) this.game.audio.play('pickup', e);
      // auto-equip the new weapon when the player has nothing better in hand
      return true;
    }
    if (p.kind === 'item') {
      if (!e.giveItem(p.itemId)) return false;
      this.remove(p);
      if (e.isPlayer) this.game.audio.play('pickup', e);
      return true;
    }
    return false;
  }

  update(dt, time) {
    for (const p of this.pickups) {
      p.mesh.children[0].rotation.y += dt * 1.6;
      p.mesh.children[0].position.y = 0.55 + Math.sin(time * 2 + p.id) * 0.08;
    }
  }
}

export { weaponStats, CLASS_COLORS, ITEM_KINDS };
