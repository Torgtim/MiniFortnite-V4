// Fortnite-style building: walls, floors and ramps on a 4x4x3 grid, three materials.

import * as THREE from '../lib/three.module.min.js';
import { clamp } from './util.js';
import { PLAYER_H, depenetrate } from './physics.js';

const CS = 4;          // grid cell size
const LV = 3;          // level height
export const COST = 10;
export const MATERIALS = [
  { id: 'wood', name: 'Wood', color: '#a8793f', hp: 150 },
  { id: 'brick', name: 'Brick', color: '#b5503c', hp: 300 },
  { id: 'metal', name: 'Metal', color: '#9aa4ad', hp: 500 },
];
const RAMP_TILT = Math.atan2(LV, CS);

export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pieces = [];
    this.byKey = new Map();
    this.cellBase = new Map();
    this.active = false;
    this.type = 'wall';
    this.matIndex = 0;
    this.valid = false;
    this.cur = null;

    this.geos = {
      wall: new THREE.BoxGeometry(CS, LV, 0.3),
      floor: new THREE.BoxGeometry(CS, 0.4, CS),
      ramp: new THREE.BoxGeometry(Math.hypot(CS, LV), 0.3, CS),
    };
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x4dff7a, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghost = new THREE.Mesh(this.geos.wall, this.ghostMat);
    this.ghost.visible = false;
    this.group.add(this.ghost);
    this.mats = MATERIALS.map((m) => new THREE.MeshLambertMaterial({ color: m.color }));
  }

  clear() {
    for (const p of this.pieces) this.group.remove(p.mesh);
    this.pieces.length = 0;
    this.byKey.clear();
    this.cellBase.clear();
    this.setActive(false);
  }

  setActive(on) {
    this.active = on;
    this.ghost.visible = on && !!this.cur;
  }

  setType(t) { this.type = t; if (!this.active) this.setActive(true); }

  cycleMaterial() { this.matIndex = (this.matIndex + 1) % MATERIALS.length; }

  // ------------------------------------------------------------------ placement maths
  findBase(gx, gz, fallbackY) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = this.cellBase.get((gx + dx) + ',' + (gz + dz));
      if (b !== undefined) return b;
    }
    return Math.round(fallbackY * 2) / 2;
  }

  compute(e) {
    const w = this.game.world;
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    const alongX = Math.abs(fx) > Math.abs(fz);       // facing mostly along the x axis?
    const sx = alongX ? Math.sign(fx) : 0, sz = alongX ? 0 : Math.sign(fz);
    // lateral aim: lets you steer into the neighbouring column/row a little
    const lx = e.x + fx * 2.4, lz = e.z + fz * 2.4;
    const out = { type: this.type, ok: true };

    if (this.type === 'wall') {
      if (alongX) {  // wall plane perpendicular to x, spanning one cell in z
        let line = (Math.floor(e.x / CS) + (sx > 0 ? 1 : 0)) * CS;
        if ((line - e.x) * sx < 1.0) line += sx * CS;
        const gz = Math.floor(lz / CS);
        out.axis = 'z'; out.cx = line; out.cz = (gz + 0.5) * CS;
      } else {
        let line = (Math.floor(e.z / CS) + (sz > 0 ? 1 : 0)) * CS;
        if ((line - e.z) * sz < 1.0) line += sz * CS;
        const gx = Math.floor(lx / CS);
        out.axis = 'x'; out.cx = (gx + 0.5) * CS; out.cz = line;
      }
      const gx = Math.floor(out.cx / CS), gz = Math.floor(out.cz / CS);
      out.base = this.findBase(gx, gz, w.heightAt(out.cx, out.cz));
      out.k = Math.max(0, Math.round((e.y - out.base) / LV));
      out.y0 = out.base + out.k * LV;
      out.key = `w${out.axis}:${Math.round(out.cx)},${Math.round(out.cz)}:${out.k}`;
      out.cells = [[gx, gz]];
    } else {
      // floors and ramps go into the cell next to the one we stand in
      let gx, gz;
      if (alongX) { gx = Math.floor(e.x / CS) + sx; gz = Math.floor(lz / CS); }
      else { gz = Math.floor(e.z / CS) + sz; gx = Math.floor(lx / CS); }
      out.cx = (gx + 0.5) * CS; out.cz = (gz + 0.5) * CS;
      out.base = this.findBase(gx, gz, w.heightAt(out.cx, out.cz));
      out.k = Math.max(0, Math.round((e.y - out.base) / LV));
      out.y0 = out.base + out.k * LV;
      out.key = `c:${gx},${gz}:${out.k}`;
      out.cells = [[gx, gz]];
      if (this.type === 'ramp') { out.dx = sx; out.dz = sz; }
    }
    // bounds for overlap checks
    if (this.type === 'wall') {
      const hx = out.axis === 'z' ? 0.15 : CS / 2, hz = out.axis === 'z' ? CS / 2 : 0.15;
      out.box = [out.cx - hx, out.y0, out.cz - hz, out.cx + hx, out.y0 + LV, out.cz + hz];
    } else if (this.type === 'floor') {
      out.box = [out.cx - CS / 2, out.y0 - 0.4, out.cz - CS / 2, out.cx + CS / 2, out.y0, out.cz + CS / 2];
    } else {
      out.box = [out.cx - CS / 2, out.y0, out.cz - CS / 2, out.cx + CS / 2, out.y0 + LV, out.cz + CS / 2];
    }
    // validity
    if (this.byKey.has(out.key)) out.ok = false;
    if (Math.hypot(out.cx, out.cz) > this.game.world.mapRadius) out.ok = false;
    if (out.ok) {
      const [x0, y0, z0, x1, y1, z1] = out.box;
      for (const o of this.game.entities) {
        if (!o.alive) continue;
        if (o.x + 0.2 > x0 && o.x - 0.2 < x1 && o.z + 0.2 > z0 && o.z - 0.2 < z1 && y1 > o.y + 0.3 && y0 < o.y + PLAYER_H) { out.ok = false; break; }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, e) {
    if (!this.active || !e || !e.alive) { this.ghost.visible = false; return; }
    const c = this.compute(e);
    this.cur = c;
    const canPay = e.mats[MATERIALS[this.matIndex].id] >= COST;
    this.valid = c.ok && canPay;
    this.ghost.geometry = this.geos[c.type];
    this.ghostMat.color.setHex(this.valid ? 0x4dff7a : 0xff4d4d);
    this.ghost.visible = true;
    this._pose(this.ghost, c, 0);
  }

  _pose(mesh, c, skirt) {
    mesh.rotation.set(0, 0, 0);
    if (c.type === 'wall') {
      mesh.rotation.y = c.axis === 'z' ? Math.PI / 2 : 0;
      mesh.position.set(c.cx, c.y0 + LV / 2 - skirt / 2, c.cz);
      mesh.scale.set(1, (LV + skirt) / LV, 1);
    } else if (c.type === 'floor') {
      mesh.position.set(c.cx, c.y0 - 0.2, c.cz);
      mesh.scale.set(1, 1, 1);
    } else {
      mesh.rotation.set(0, Math.atan2(-c.dz, c.dx), RAMP_TILT);
      mesh.position.set(c.cx, c.y0 + LV / 2 - 0.12, c.cz);
      mesh.scale.set(1, 1, 1);
    }
  }

  place(e) {
    if (!this.active || !this.cur) return false;
    this.update(0, e);
    if (!this.valid) { this.game.audio.play('deny', null); return false; }
    const c = this.cur, m = MATERIALS[this.matIndex], w = this.game.world;
    e.mats[m.id] -= COST;

    let skirt = 0;
    const collider = { piece: null };
    if (c.type === 'wall') {
      if (c.k === 0) {
        const a = c.axis === 'z' ? [[c.cx, c.cz - 2], [c.cx, c.cz], [c.cx, c.cz + 2]] : [[c.cx - 2, c.cz], [c.cx, c.cz], [c.cx + 2, c.cz]];
        const low = Math.min(...a.map(([x, z]) => w.heightAt(x, z)));
        skirt = clamp(c.y0 - low, 0, 8);
      }
      const [x0, y0, z0, x1, y1, z1] = c.box;
      Object.assign(collider, { kind: 'box', minx: x0, miny: y0 - skirt, minz: z0, maxx: x1, maxy: y1, maxz: z1 });
    } else if (c.type === 'floor') {
      const [x0, y0, z0, x1, y1, z1] = c.box;
      Object.assign(collider, { kind: 'box', minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1 });
    } else {
      const [x0, y0, z0, x1, y1, z1] = c.box;
      Object.assign(collider, { kind: 'ramp', minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1, cx: c.cx, cz: c.cz, dx: c.dx, dz: c.dz, len: CS, base: c.y0, rise: LV });
    }
    const mesh = new THREE.Mesh(this.geos[c.type], this.mats[this.matIndex].clone());
    mesh.castShadow = true; mesh.receiveShadow = true;
    this._pose(mesh, c, skirt);
    this.group.add(mesh);

    const piece = { type: c.type, key: c.key, mat: this.matIndex, hp: m.hp, maxHp: m.hp, mesh, collider, c, x: c.cx, y: c.y0 + 1.5, z: c.cz };
    collider.piece = piece;
    w.addCollider(collider);
    this.pieces.push(piece);
    this.byKey.set(c.key, piece);
    for (const [gx, gz] of c.cells) this.cellBase.set(gx + ',' + gz, c.base);
    if (c.type === 'wall') {
      const gx = Math.floor(c.cx / CS), gz = Math.floor(c.cz / CS);
      this.cellBase.set(gx + ',' + gz, c.base);
    }
    for (const o of this.game.entities) if (o.alive) depenetrate(w, o);
    this.game.audio.play('build', null);
    return true;
  }

  damage(piece, amount) {
    if (!piece || piece.dead) return;
    piece.hp -= amount;
    const k = clamp(piece.hp / piece.maxHp, 0, 1);
    piece.mesh.material.color.set(MATERIALS[piece.mat].color).multiplyScalar(0.45 + 0.55 * k);
    if (piece.hp <= 0) this.destroy(piece);
  }

  destroy(piece) {
    piece.dead = true;
    this.game.world.removeCollider(piece.collider);
    this.group.remove(piece.mesh);
    piece.mesh.material.dispose();
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
    this.byKey.delete(piece.key);
    this.game.combat.puff(piece.x, piece.y, piece.z, 0xc8b89a);
  }

  explosion(x, y, z, r, dmg) {
    for (const p of this.pieces.slice()) {
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < r + 2.2) this.damage(p, dmg * (1 - clamp(d / (r + 2.2), 0, 1) * 0.6));
    }
  }
}
