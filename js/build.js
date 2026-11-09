// Fortnite-style building: walls, floors, ramps and cones on a 4x4x3 grid, three materials that
// build up their health over time, structural support (unsupported pieces collapse), edits.

import * as THREE from '../lib/three.module.min.js?v=45';
import { clamp } from './util.js?v=45';
import { depenetrate, PLAYER_R } from './physics.js?v=45';
import { colliderTop } from './geom.js?v=45';
import { CS, LV, defaultEdit, pieceShape, shapeColliders, shapeGeometry } from './pieces.js?v=45';
import { TEX } from './textures.js?v=45';

export const COST = 10;
export const MATERIALS = [
  { id: 'wood', name: 'Wood', color: '#c08a4e', hp: 150, start: 70, time: 3.5, tex: 'wood' },
  { id: 'brick', name: 'Brick', color: '#b5543c', hp: 300, start: 90, time: 8, tex: 'brick' },
  { id: 'metal', name: 'Metal', color: '#a7b0b8', hp: 450, start: 110, time: 14, tex: 'metal' },
];
export const BUILD_TYPES = ['wall', 'floor', 'ramp', 'cone'];
const MAX_LEVEL = 24;

export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pieces = [];
    this.byKey = new Map();
    this.cellBase = new Map();
    this.collapseQ = [];
    this._id = 0;
    // player UI state
    this.active = false;
    this.type = 'wall';
    this.matIndex = 0;
    this.valid = false;
    this.cur = null;

    this.baseMats = MATERIALS.map((m) => new THREE.MeshLambertMaterial({ map: TEX[m.tex](), side: THREE.DoubleSide }));
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghostEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.ghostEdgeMat);
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    this.ghostKey = '';
    this.group.add(this.ghost);
  }

  clear() {
    for (const p of this.pieces) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.pieces.length = 0;
    this.byKey.clear();
    this.cellBase.clear();
    this.collapseQ.length = 0;
    this.setActive(false);
  }

  setActive(on) {
    this.active = on;
    if (!on) this.ghost.visible = false;
  }

  setType(t) { this.type = t; if (!this.active) this.setActive(true); }
  cycleMaterial(dir = 1) { this.matIndex = (this.matIndex + dir + MATERIALS.length) % MATERIALS.length; }

  // ------------------------------------------------------------------ placement maths
  findBase(gx, gz, fallbackY) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = this.cellBase.get((gx + dx) + ',' + (gz + dz));
      if (b !== undefined) return b;
    }
    return Math.round(fallbackY * 2) / 2;
  }

  /** The build ramp the entity is standing on, if any. */
  rampUnder(e) {
    const list = this.game.world.query(e.x, e.z, PLAYER_R);
    for (const c of list) {
      if (c.kind !== 'ramp' || !c.piece) continue;
      if (e.x < c.minx || e.x > c.maxx || e.z < c.minz || e.z > c.maxz) continue;
      if (Math.abs(colliderTop(c, e.x, e.z) - e.y) < 0.4) return c.piece;
    }
    return null;
  }

  /** Where would a piece of `type` go for entity e looking along yaw/pitch? */
  compute(e, type, yaw = e.yaw, pitch = e.pitch) {
    const w = this.game.world;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const alongX = Math.abs(fx) > Math.abs(fz);
    const sx = alongX ? Math.sign(fx) : 0, sz = alongX ? 0 : Math.sign(fz);
    const lx = e.x + fx * 2.4, lz = e.z + fz * 2.4;
    const cgx = Math.floor(e.x / CS), cgz = Math.floor(e.z / CS);
    const baseAt = (gx, gz) => this.findBase(gx, gz, w.heightAt((gx + 0.5) * CS, (gz + 0.5) * CS));
    const levelOf = (base) => Math.max(0, Math.round((e.y - base) / LV));
    const out = { type, ok: true };
    let gx, gz;

    if (type === 'wall') {
      if (alongX) {
        let line = (Math.floor(e.x / CS) + (sx > 0 ? 1 : 0)) * CS;
        if ((line - e.x) * sx < 1.0) line += sx * CS;
        gz = Math.floor(lz / CS);
        out.axis = 'z'; out.cx = line; out.cz = (gz + 0.5) * CS;
      } else {
        let line = (Math.floor(e.z / CS) + (sz > 0 ? 1 : 0)) * CS;
        if ((line - e.z) * sz < 1.0) line += sz * CS;
        gx = Math.floor(lx / CS);
        out.axis = 'x'; out.cx = (gx + 0.5) * CS; out.cz = line;
      }
      gx = Math.floor(out.cx / CS); gz = Math.floor(out.cz / CS);
      out.base = baseAt(gx, gz);
      out.k = levelOf(out.base) + (pitch > 0.6 ? 1 : 0);
    } else {
      let cur = false;
      if (type === 'floor') cur = pitch > 0.5 || pitch < -0.75;
      else if (type === 'cone') cur = pitch > -0.6;
      if (cur) { gx = cgx; gz = cgz; }
      else if (alongX) { gx = cgx + sx; gz = Math.floor(lz / CS); }
      else { gz = cgz + sz; gx = Math.floor(lx / CS); }
      out.cx = (gx + 0.5) * CS; out.cz = (gz + 0.5) * CS;
      out.base = baseAt(gx, gz);
      out.k = levelOf(out.base);
      if ((type === 'floor' && pitch > 0.5) || (type === 'cone' && cur)) out.k++;
      if (type === 'ramp') {
        out.dx = sx; out.dz = sz;
        const r = this.rampUnder(e);
        if (r && r.edit.dx === sx && r.edit.dz === sz && Math.floor(r.c.cx / CS) === cgx && Math.floor(r.c.cz / CS) === cgz) out.k = r.c.k + 1;
      }
    }
    out.k = Math.min(MAX_LEVEL, out.k);
    out.y0 = out.base + out.k * LV;
    out.gx = gx; out.gz = gz;
    const tag = { wall: 'w' + out.axis, floor: 'f', ramp: 'r', cone: 'c' }[type];
    out.key = type === 'wall' ? `${tag}:${Math.round(out.cx * 2)},${Math.round(out.cz * 2)}:${out.k}` : `${tag}:${gx},${gz}:${out.k}`;
    if (this.byKey.has(out.key)) out.ok = false;
    if (Math.hypot(out.cx, out.cz) > w.mapRadius) out.ok = false;
    return out;
  }

  canAfford(e, mi) { return e.mats[MATERIALS[mi].id] >= COST; }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    for (const p of this.pieces) {
      if (p.buildLeft > 0) {
        const step = Math.min(dt, p.buildLeft);
        p.buildLeft -= dt;
        p.hp = Math.min(p.maxHp, p.hp + p.growth * step);
        p.mesh.material.emissiveIntensity = clamp((p.buildLeft / p.buildDur - 0.75) / 0.25, 0, 1) * 0.2;
      }
      if (p.pop < 1) {
        p.pop = Math.min(1, p.pop + dt * 7);
        const s = 0.55 + 0.45 * p.pop;
        p.mesh.scale.set(s, s, s);
      }
    }
    // staggered collapse of unsupported pieces
    for (let i = this.collapseQ.length - 1; i >= 0; i--) {
      const q = this.collapseQ[i];
      q.t -= dt;
      if (q.t <= 0) { this.collapseQ.splice(i, 1); if (!q.p.dead) this.destroy(q.p, true); }
    }
  }

  /** Player ghost preview. */
  updateGhost(e) {
    if (!this.active || !e || !e.alive) { this.ghost.visible = false; this.cur = null; return; }
    const c = this.compute(e, this.type);
    this.cur = c;
    this.valid = c.ok && this.canAfford(e, this.matIndex);
    const gkey = c.key + c.y0;
    if (gkey !== this.ghostKey) {
      this.ghostKey = gkey;
      const shape = pieceShape(c, defaultEdit(c.type, c));
      this.ghost.geometry.dispose();
      this.ghost.geometry = shapeGeometry(shape);
      this.ghostEdges.geometry.dispose();
      this.ghostEdges.geometry = new THREE.EdgesGeometry(this.ghost.geometry, 25);
    }
    this.ghostMat.color.setHex(this.valid ? 0x4da6ff : 0xff4d4d);
    this.ghost.visible = true;
  }

  // ------------------------------------------------------------------ placing
  /** Player: place the previewed piece. */
  placeFromUI(e) {
    if (!this.active) return null;
    this.updateGhost(e);
    if (!this.cur || !this.valid) { this.game.audio.play('deny', null); return null; }
    return this.place(e, this.cur, this.matIndex);
  }

  /** Bots: place a piece of `type` facing yaw with the best material they can afford. */
  placeFor(e, type, yaw = e.yaw, pitch = 0) {
    let mi = -1;
    for (let i = 0; i < MATERIALS.length; i++) if (this.canAfford(e, i)) { mi = i; break; }
    if (mi < 0) return null;
    const c = this.compute(e, type, yaw, pitch);
    if (!c.ok) return null;
    return this.place(e, c, mi);
  }

  place(e, c, mi) {
    const m = MATERIALS[mi], w = this.game.world;
    e.mats[m.id] -= COST;
    let skirt = 0;
    if (c.type === 'wall' && c.k === 0) {
      const a = c.axis === 'z' ? [[c.cx, c.cz - 2], [c.cx, c.cz], [c.cx, c.cz + 2]] : [[c.cx - 2, c.cz], [c.cx, c.cz], [c.cx + 2, c.cz]];
      const low = Math.min(...a.map(([x, z]) => w.heightAt(x, z)));
      skirt = clamp(c.y0 - low, 0, 8);
    }
    const mat = this.baseMats[mi].clone();
    mat.emissive = new THREE.Color(0x3b7bff);
    mat.emissiveIntensity = 0.2;
    const piece = {
      id: ++this._id, type: c.type, key: c.key, c, mat: mi, owner: e, skirt,
      hp: m.start, maxHp: m.hp, buildLeft: m.time, buildDur: m.time, growth: (m.hp - m.start) / m.time,
      edit: defaultEdit(c.type, c), mesh: new THREE.Mesh(new THREE.BufferGeometry(), mat), colliders: [], links: new Set(), pop: 0,
    };
    piece.mesh.castShadow = true; piece.mesh.receiveShadow = true;
    this.group.add(piece.mesh);
    this._rebuild(piece);
    this.pieces.push(piece);
    this.byKey.set(c.key, piece);
    this.cellBase.set(c.gx + ',' + c.gz, c.base);
    this._link(piece);
    for (const o of this.game.entities) if (o.alive && !o.airborne) depenetrate(w, o);
    this.game.audio.play('build', e);
    this.game.noise(e, 40);
    if (this.game.fx) this.game.fx.dust(piece.x, piece.y, piece.z, MATERIALS[mi].color);
    return piece;
  }

  /** (Re)create colliders and mesh from the piece's placement + edit state. */
  _rebuild(piece) {
    const w = this.game.world;
    for (const c of piece.colliders) w.removeCollider(c);
    piece.shape = pieceShape(piece.c, piece.edit, piece.skirt);
    piece.colliders = shapeColliders(piece.shape, piece);
    for (const c of piece.colliders) w.addCollider(c);
    const b = piece.shape.bounds;
    piece.x = (b[0] + b[3]) / 2; piece.y = (b[1] + b[4]) / 2; piece.z = (b[2] + b[5]) / 2;
    piece.bounds = b;
    const geo = shapeGeometry(piece.shape);
    geo.translate(-piece.x, -piece.y, -piece.z);
    piece.mesh.geometry.dispose();
    piece.mesh.geometry = geo;
    piece.mesh.position.set(piece.x, piece.y, piece.z);
  }

  applyEdit(piece, edit) {
    if (piece.dead) return;
    piece.edit = edit;
    this._rebuild(piece);
    this.game.audio.play('edit', piece);
    // removing tiles can disconnect things that rested on this piece
    for (const n of [...piece.links]) if (!this._supported(n, new Set())) this._collapseFrom(n);
  }

  // ------------------------------------------------------------------ structural support
  _grounded(piece) {
    const w = this.game.world, b = piece.bounds;
    const pts = [[b[0] + 0.3, b[2] + 0.3], [b[3] - 0.3, b[2] + 0.3], [b[0] + 0.3, b[5] - 0.3], [b[3] - 0.3, b[5] - 0.3], [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2]];
    let ground = -Infinity;
    for (const [x, z] of pts) ground = Math.max(ground, w.heightAt(x, z));
    if (b[1] <= ground + 0.45) return true;
    for (const c of w.query(piece.x, piece.z, 3)) {
      if (c.piece || c.node) continue;
      if (b[0] - 0.2 < c.maxx && b[3] + 0.2 > c.minx && b[2] - 0.2 < c.maxz && b[5] + 0.2 > c.minz && b[1] - 0.2 < c.maxy && b[4] + 0.2 > c.miny) return true;
    }
    return false;
  }

  _link(piece) {
    const b = piece.bounds, e = 0.3;
    for (const o of this.pieces) {
      if (o === piece || o.dead) continue;
      const q = o.bounds;
      if (b[0] - e < q[3] && b[3] + e > q[0] && b[1] - e < q[4] && b[4] + e > q[1] && b[2] - e < q[5] && b[5] + e > q[2]) {
        piece.links.add(o); o.links.add(piece);
      }
    }
    piece.grounded = this._grounded(piece);
  }

  _supported(start, seen) {
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const p = stack.pop();
      if (p.grounded) return true;
      for (const n of p.links) if (!n.dead && !seen.has(n)) { seen.add(n); stack.push(n); if (seen.size > 600) return true; }
    }
    return false;
  }

  _collapseFrom(start) {
    const comp = new Set();
    if (this._supported(start, comp)) return;
    let i = 0;
    for (const p of comp) this.collapseQ.push({ p, t: 0.06 + (i++) * 0.045 });
  }

  // ------------------------------------------------------------------ damage
  damage(piece, amount, src) {
    if (!piece || piece.dead) return;
    piece.hp -= amount;
    piece.lastHit = this.game.time;
    const k = clamp(piece.hp / piece.maxHp, 0, 1);
    piece.mesh.material.color.setScalar(0.4 + 0.6 * k);
    if (piece.hp <= 0) this.destroy(piece);
  }

  destroy(piece, collapsed = false) {
    if (piece.dead) return;
    piece.dead = true;
    const w = this.game.world;
    for (const c of piece.colliders) w.removeCollider(c);
    piece.colliders = [];
    this.group.remove(piece.mesh);
    piece.mesh.geometry.dispose();
    piece.mesh.material.dispose();
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
    if (this.byKey.get(piece.key) === piece) this.byKey.delete(piece.key);
    if (this.game.fx) this.game.fx.debris(piece.x, piece.y, piece.z, MATERIALS[piece.mat].color, collapsed ? 6 : 10);
    this.game.audio.play('break', piece);
    const ns = [...piece.links];
    for (const n of ns) n.links.delete(piece);
    piece.links.clear();
    for (const n of ns) if (!n.dead) this._collapseFrom(n);
  }

  explosion(x, y, z, r, dmg) {
    for (const p of this.pieces.slice()) {
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < r + 2.2) this.damage(p, dmg * (1 - clamp(d / (r + 2.2), 0, 1) * 0.6));
    }
  }
}
