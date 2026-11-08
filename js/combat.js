// Shooting, hit detection, damage, explosions, pickaxe and the little visual effects.

import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, dirFromAngles } from './util.js';
import { weaponStats } from './weapons.js';

const CLASS_KICK = { pistol: 0.004, smg: 0.0025, rifle: 0.0045, shotgun: 0.03, sniper: 0.035, launcher: 0.04 };
const BODY_R = 0.38;

function rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT) {
  let tmin = 0, tmax = maxT;
  const axes = [[ox, dx, minx, maxx], [oy, dy, miny, maxy], [oz, dz, minz, maxz]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.tracers = [];
    this.puffs = [];
    this.booms = [];
    const lineMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 48; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const l = new THREE.Line(g, lineMat(0xfff1a0));
      l.visible = false; l.frustumCulled = false;
      this.group.add(l);
      this.tracers.push({ line: l, life: 0 });
    }
    const puffGeo = new THREE.IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true }));
      m.visible = false;
      this.group.add(m);
      this.puffs.push({ mesh: m, life: 0 });
    }
    const boomGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({ color: 0xff9a30, transparent: true, opacity: 0.8 }));
      m.visible = false;
      this.group.add(m);
      this.booms.push({ mesh: m, life: 0, r: 1 });
    }
  }

  // ------------------------------------------------------------------ effects
  tracer(x0, y0, z0, x1, y1, z1, color = 0xfff1a0) {
    const t = this.tracers.find((q) => q.life <= 0);
    if (!t) return;
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, x0, y0, z0); p.setXYZ(1, x1, y1, z1);
    p.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.visible = true;
    t.life = 0.07;
  }

  puff(x, y, z, color = 0xffe9a0) {
    const q = this.puffs.find((p) => p.life <= 0);
    if (!q) return;
    q.mesh.position.set(x, y, z);
    q.mesh.material.color.setHex(color);
    q.mesh.visible = true;
    q.life = 0.25;
  }

  boom(x, y, z, r) {
    const b = this.booms.find((q) => q.life <= 0) || this.booms[0];
    b.mesh.position.set(x, y, z);
    b.mesh.visible = true;
    b.life = 0.4; b.r = r;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.07); if (t.life <= 0) t.line.visible = false; }
    }
    for (const p of this.puffs) {
      if (p.life > 0) {
        p.life -= dt;
        const s = 1 + (0.25 - p.life) * 8;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = Math.max(0, p.life / 0.25);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    for (const b of this.booms) {
      if (b.life > 0) {
        b.life -= dt;
        const k = 1 - b.life / 0.4;
        b.mesh.scale.setScalar(b.r * (0.3 + k * 0.9));
        b.mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
        if (b.life <= 0) b.mesh.visible = false;
      }
    }
  }

  // ------------------------------------------------------------------ ray helpers
  /** Closest thing along a ray: entity (with headshot flag), collider or terrain. */
  trace(shooter, ox, oy, oz, dx, dy, dz, range) {
    const w = this.game.world;
    const wh = w.raycast(ox, oy, oz, dx, dy, dz, range);
    let best = { t: wh.t, entity: null, head: false, collider: wh.collider, terrain: wh.terrain };
    for (const e of this.game.entities) {
      if (e === shooter || !e.alive || e.untargetable) continue;
      const t = rayBox(ox, oy, oz, dx, dy, dz, e.x - BODY_R, e.y, e.z - BODY_R, e.x + BODY_R, e.y + 1.8, e.z + BODY_R, best.t);
      if (t >= 0 && t < best.t) {
        const hy = oy + dy * t;
        best = { t, entity: e, head: hy > e.y + 1.45, collider: null, terrain: false };
      }
    }
    return best;
  }

  /** True when nothing solid sits between two points. */
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const r = this.game.world.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.5, 2.0);
    return r.t >= d - 0.5;
  }

  // ------------------------------------------------------------------ weapon update loop (player + bots)
  update_shooter(e, dt) {
    e.fireCd = Math.max(0, e.fireCd - dt);
    e.swingT = Math.max(0, e.swingT - dt);
    e.recoil = Math.max(0, e.recoil - dt * 8);
    const it = e.held;

    if (e.reloadT > 0) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) e.finishReload();
      return;
    }
    if (!e.wantFire) e.firedHeld = false;
    if (!it) return;

    if (it.type === 'weapon') {
      const st = weaponStats(it);
      if (e.burstLeft <= 0 && e.wantFire && e.fireCd <= 0 && (st.auto || !e.firedHeld)) {
        if (it.mag <= 0) { if (!e.startReload()) this.game.audio.play('empty', e); e.fireCd = 0.3; }
        else { e.burstLeft = st.burst || 1; e.firedHeld = true; }
      }
      if (e.burstLeft > 0 && e.fireCd <= 0) {
        if (it.mag <= 0) { e.burstLeft = 0; e.startReload(); return; }
        this.shootOnce(e, it, st);
        e.burstLeft--;
        e.fireCd = e.burstLeft > 0 ? st.burstGap : 1 / st.rate;
      }
      if (it.mag <= 0 && e.fireCd <= 0 && e.burstLeft <= 0 && !e.wantFire) e.startReload();
    } else if (it.type === 'pickaxe') {
      if (e.wantFire && e.fireCd <= 0) { this.swing(e); e.fireCd = 0.5; }
    } else if (it.type === 'item') {
      if (e.wantFire && e.canUse(e.slot)) {
        e.useT += dt;
        if (e.useT >= this.game.itemTime(it)) { e.useT = 0; e.applyItem(e.slot); }
      } else e.useT = 0;
    }
  }

  shootOnce(e, it, st) {
    it.mag--;
    const ox = e.x, oy = e.eyeY, oz = e.z;
    const d = dirFromAngles(e.yaw, e.pitch);
    // basis for the spread cone
    const rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw); // right vector (horizontal)
    let spread = st.spread;
    if (e.isPlayer) {
      if (e.ads) spread *= 0.45;
      if (!e.grounded) spread *= 2.2;
      else if (e.moving) spread *= 1.4;
    } else spread *= e.spreadMult || 1.5;

    for (let p = 0; p < st.pellets; p++) {
      const ang = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
      const tx = Math.tan(ang) * Math.cos(th), ty = Math.tan(ang) * Math.sin(th);
      // up vector perpendicular to dir and right
      const ax = rx, az = rz;
      const upx = ay_cross_x(d, ax, az), upy = ay_cross_y(d, ax, az), upz = ay_cross_z(d, ax, az);
      let dx = d.x + ax * tx + upx * ty, dy = d.y + upy * ty, dz = d.z + az * tx + upz * ty;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;

      const hit = this.trace(e, ox, oy, oz, dx, dy, dz, st.range);
      const hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t;
      // tracer starts at the muzzle
      const side = e.isPlayer ? (e.ads ? 0.04 : 0.22) : 0.1;
      const mx = ox + d.x * 0.7 + rx * side, my = oy - (e.isPlayer && !e.ads ? 0.18 : 0.12) + d.y * 0.7, mz = oz + d.z * 0.7 + rz * side;
      if (hit.t > 1.5) this.tracer(mx, my, mz, hx, hy, hz, e.isPlayer ? 0xfff1a0 : 0xffc890);

      const fall = st.fall ? lerp(1, 0.35, clamp((hit.t - st.fall[0]) / (st.fall[1] - st.fall[0]), 0, 1)) : 1;
      if (hit.entity) {
        const dmg = st.dmg * fall * (hit.head ? st.head : 1);
        this.damage(hit.entity, dmg, e, st.name, hit.head);
        this.puff(hx, hy, hz, 0xff5050);
      } else if (hit.t < st.range) {
        this.puff(hx, hy, hz);
        if (hit.collider && hit.collider.piece) this.game.build.damage(hit.collider.piece, st.dmg * fall * 0.8);
      }
      if (st.blast && hit.t < st.range) this.explode(hx - dx * 0.3, hy - dy * 0.3, hz - dz * 0.3, st.blast.r, st.blast.dmg, e, st.name);
    }
    this.game.audio.play(st.quiet ? 'quiet' : 'shoot_' + st.cls, e);
    if (e.isPlayer) {
      e.pitch += (CLASS_KICK[st.cls] || 0.004) * (0.6 + Math.random() * 0.8);
      e.yaw += (Math.random() - 0.5) * 0.002;
      e.recoil = 1;
    } else e.recoil = 1;
  }

  // ------------------------------------------------------------------ pickaxe
  swing(e) {
    e.swingT = 0.3;
    const d = dirFromAngles(e.yaw, e.pitch);
    const hit = this.trace(e, e.x, e.eyeY, e.z, d.x, d.y, d.z, 3.4);
    const g = this.game;
    g.audio.play('swing', e);
    if (hit.t >= 3.4) return;
    const hx = e.x + d.x * hit.t, hy = e.eyeY + d.y * hit.t, hz = e.z + d.z * hit.t;
    if (hit.entity) { if (hit.t < 2.6) this.damage(hit.entity, 20, e, 'Pickaxe', false); return; }
    this.puff(hx, hy, hz, 0xd8c8a0);
    if (hit.collider && hit.collider.node) {
      const n = hit.collider.node;
      n.hp -= 34;
      const gain = n.yield + Math.floor(Math.random() * 4);
      e.mats[n.res] = Math.min(999, e.mats[n.res] + gain);
      if (e.isPlayer) { g.hud.matPop(n.res, gain); g.audio.play('harvest', e); }
      if (n.hp <= 0) g.world.destroyNode(n);
    } else if (hit.collider && hit.collider.piece) {
      g.build.damage(hit.collider.piece, 45);
      g.audio.play('harvest', e);
    }
  }

  // ------------------------------------------------------------------ damage
  explode(x, y, z, r, dmg, src, name) {
    this.boom(x, y, z, r);
    this.game.audio.play('boom', { x, y, z });
    for (const e of this.game.entities) {
      if (!e.alive || e.untargetable) continue;
      const d = Math.hypot(e.x - x, e.y + 0.9 - y, e.z - z);
      if (d > r + 0.5) continue;
      const k = 1 - 0.65 * clamp(d / r, 0, 1);
      this.damage(e, dmg * k * (e === src ? 0.5 : 1), src, name, false);
    }
    this.game.build.explosion(x, y, z, r, dmg * 1.6);
  }

  damage(target, amount, src, weaponName, head = false) {
    if (!target.alive || target.untargetable || amount <= 0) return;
    amount = Math.max(1, Math.round(amount));
    const sh = Math.min(target.shield, amount);
    target.shield -= sh;
    target.hp -= amount - sh;
    target.lastHitBy = src;
    target.lastWeapon = weaponName;
    const g = this.game;
    if (src && src.isPlayer && src !== target) {
      g.hud.hitMarker(head);
      g.hud.damageNumber(target.x, target.y + 2.0, target.z, amount, head);
      g.audio.play(head ? 'hit_head' : 'hit', null);
    }
    if (target.isPlayer) g.hud.hurt(src);
    if (target.hp <= 0) { target.hp = 0; g.eliminate(target, src, weaponName); }
  }
}

// small cross-product helpers: up = right x dir  (right is horizontal, so this is perpendicular to both)
function ay_cross_x(d, ax, az) { return 0 * d.z - az * d.y; }
function ay_cross_y(d, ax, az) { return az * d.x - ax * d.z; }
function ay_cross_z(d, ax, az) { return ax * d.y - 0 * d.x; }
