// Shooting (hitscan + projectiles), spread/bloom, hit detection, damage, explosions,
// grenades and the pickaxe (with Fortnite-style weak points).

import * as THREE from '../lib/three.module.min.js?v=59';
import { clamp, lerp, dirFromAngles } from './util.js?v=59';
import { weaponStats, ITEM_KINDS, BLOOM } from './weapons.js?v=59';
import { rayBox } from './geom.js?v=59';

const CLASS_KICK = { pistol: 0.004, smg: 0.0025, rifle: 0.0045, shotgun: 0.03, sniper: 0.035, launcher: 0.04 };
const BODY_R = 0.38;
const NOISE = { pistol: 70, smg: 70, rifle: 90, shotgun: 75, sniper: 140, launcher: 110 };
const _v = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.tracers = [];
    this.projectiles = [];
    const lineMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 64; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const l = new THREE.Line(g, lineMat(0xfff1a0));
      l.visible = false; l.frustumCulled = false;
      this.group.add(l);
      this.tracers.push({ line: l, life: 0 });
    }
    this.projGeo = { rocket: new THREE.CylinderGeometry(0.09, 0.12, 0.7, 6).rotateX(Math.PI / 2), grenade: new THREE.IcosahedronGeometry(0.16, 0) };
    this.weakPoint = null; // {target, x, y, z, t}
  }

  clear() {
    for (const p of this.projectiles) if (p.mesh) this.group.remove(p.mesh);
    this.projectiles.length = 0;
    this.weakPoint = null;
  }

  // ------------------------------------------------------------------ effects
  tracer(x0, y0, z0, x1, y1, z1, color = 0xfff1a0) {
    const t = this.tracers.find((q) => q.life <= 0);
    if (!t) return;
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, x0, y0, z0); p.setXYZ(1, x1, y1, z1);
    p.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.line.material.color.setHex(color);
    t.line.visible = true;
    t.life = 0.07;
  }

  puff(x, y, z, color = 0xffe9a0) { if (this.game.fx) this.game.fx.spark(x, y, z, color); }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.07); if (t.life <= 0) t.line.visible = false; }
    }
    this.updateProjectiles(dt);
    if (this.weakPoint && (this.game.time - this.weakPoint.t > 6 || (this.weakPoint.target && this.weakPoint.target.dead))) this.weakPoint = null;
  }

  // ------------------------------------------------------------------ ray helpers
  /** Closest thing along a ray: entity (with headshot flag), collider or terrain. */
  trace(shooter, ox, oy, oz, dx, dy, dz, range) {
    const w = this.game.world;
    const wh = w.raycast(ox, oy, oz, dx, dy, dz, range);
    let best = { t: wh.t, entity: null, head: false, collider: wh.collider, terrain: wh.terrain };
    for (const e of this.game.entities) {
      if (e === shooter || !e.alive || e.untargetable || e.air === 'bus') continue;
      const h = e.sliding ? 1.0 : e.h;
      const t = rayBox(ox, oy, oz, dx, dy, dz, e.x - BODY_R, e.y, e.z - BODY_R, e.x + BODY_R, e.y + h, e.z + BODY_R, best.t);
      if (t >= 0 && t < best.t) {
        const hy = oy + dy * t;
        best = { t, entity: e, head: hy > e.y + h - 0.36, collider: null, terrain: false };
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

  /** Where an entity's shots start and which way they go (third-person aims through the crosshair). */
  aimOf(e, out = {}) {
    out.ox = e.x; out.oy = e.eyeY; out.oz = e.z;
    if (e.isPlayer && this.game.thirdPerson) {
      const a = this.game.aimRay();
      const hit = this.trace(e, a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 600);
      const px = a.ox + a.dx * hit.t, py = a.oy + a.dy * hit.t, pz = a.oz + a.dz * hit.t;
      let dx = px - out.ox, dy = py - out.oy, dz = pz - out.oz;
      const l = Math.hypot(dx, dy, dz);
      if (l > 0.5) { out.dx = dx / l; out.dy = dy / l; out.dz = dz / l; return out; }
    }
    const d = dirFromAngles(e.yaw, e.pitch);
    out.dx = d.x; out.dy = d.y; out.dz = d.z;
    return out;
  }

  // ------------------------------------------------------------------ weapon update loop (player + bots)
  update_shooter(e, dt) {
    e.fireCd = Math.max(0, e.fireCd - dt);
    e.swingT = Math.max(0, e.swingT - dt);
    e.recoil = Math.max(0, e.recoil - dt * 8);
    e.idleT += dt;
    e.bloom = Math.max(0, e.bloom - dt * 1.6);
    const it = e.held;

    if (!e.wantFire) e.firedHeld = false;
    if (e.reloadStage) {
      // loading shells one by one: pull the trigger to stop and shoot what is already in
      const r = e.reloadStage;
      if (r.style === 'shell' && e.wantFire && !e.firedHeld && it && it.mag > 0 && r.t > 0.2) e.cancelReload();
      else { e.updateReload(dt); return; }
    }
    if (!it || e.mantle) return;

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
      if (e.wantFire && e.fireCd <= 0) { this.swing(e); e.fireCd = 0.45; }
    } else if (it.type === 'item') {
      const k = ITEM_KINDS[it.id];
      if (k.gadget) {
        if (e.wantFire && !e.firedHeld && e.fireCd <= 0) { e.firedHeld = true; e.fireCd = 0.5; this.game.gadgets.use(e, e.slot); }
      } else if (k.throw) {
        if (e.wantFire && !e.firedHeld && e.fireCd <= 0) { e.firedHeld = true; this.throwNade(e, e.slot); e.fireCd = 0.7; }
      } else if (e.wantFire && e.canUse(e.slot)) {
        e.useT += dt;
        if (e.useT >= this.game.itemTime(it)) { e.useT = 0; e.applyItem(e.slot); }
      } else e.useT = 0;
    }
  }

  /** Spent brass flies out of the ejection port (not for energy weapons, launchers, revolvers or break actions). */
  _casing(e, it, st, fp) {
    if (!this.game.fx || st.ammo === 'cells' || st.ammo === 'rockets' || it.id === 'revolver' || it.id === 'double_barrel' || it.id === 'crossbow') return;
    const c = this.game.camera.position;
    if ((c.x - e.x) ** 2 + (c.z - e.z) ** 2 > 40 * 40) return;
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = -fz, rz = fx;
    const up = fp ? -0.22 : -0.45;
    this.game.fx.casing(e.x + fx * (fp ? 0.5 : 0.45) + rx * (fp ? 0.22 : 0.3), e.y + (e.h || 1.8) + up, e.z + fz * (fp ? 0.5 : 0.45) + rz * (fp ? 0.22 : 0.3), rx, rz, st.ammo === 'shells');
  }

  spreadFor(e, st) {
    let spread = st.spread * (1 + e.bloom);
    if (e.isPlayer) {
      if (e.ads) spread *= 0.45;
      if (e.crouch) spread *= 0.72;
      if (!e.grounded) spread *= 2.2;
      else if (e.sliding) spread *= 1.6;
      else if (e.moving) spread *= 1.35;
    } else spread *= e.spreadMult || 1.5;
    // first-shot accuracy for precise weapons
    if (e.idleT > 0.45 && (st.cls === 'rifle' || st.cls === 'pistol' || st.cls === 'sniper') && e.grounded) spread *= 0.15;
    return spread;
  }

  shootOnce(e, it, st) {
    it.mag--;
    const aim = this.aimOf(e);
    const { ox, oy, oz } = aim;
    const d = { x: aim.dx, y: aim.dy, z: aim.dz };
    // basis for the spread cone
    let rx = -d.z, rz = d.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * d.y, uy = rz * d.x - rx * d.z, uz = rx * d.y;
    const spread = this.spreadFor(e, st);
    e.idleT = 0;
    e.bloom = Math.min(2.2, e.bloom + (BLOOM[st.cls] || 0));
    e.sprinting = false;

    // muzzle position for tracers / flashes
    const fp = e.isPlayer && !this.game.thirdPerson;
    this._casing(e, it, st, fp);
    const mz = fp ? this.game.viewmodel.muzzleWorld(_v) : e.model ? e.model.muzzleWorld(_v) : null;
    const mx0 = mz ? mz.x : ox + d.x * 0.7, my0 = mz ? mz.y : oy - 0.1 + d.y * 0.7, mz0 = mz ? mz.z : oz + d.z * 0.7;
    if (this.game.fx) this.game.fx.muzzle(mx0, my0, mz0, st.cls === 'launcher' ? 0xffa040 : 0xfff0a0, e.isPlayer && !this.game.thirdPerson);

    if (st.proj) {
      // rockets leave the barrel but fly at the point under the crosshair
      let lx = d.x, ly = d.y, lz = d.z;
      if (st.proj.kind !== 'bullet') {
        const aimHit = this.trace(e, ox, oy, oz, d.x, d.y, d.z, 300);
        const tx = ox + d.x * aimHit.t - mx0, ty = oy + d.y * aimHit.t - my0, tz = oz + d.z * aimHit.t - mz0;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 2) { lx = tx / tl; ly = ty / tl; lz = tz / tl; }
      }
      this.launch(e, st, mx0, my0, mz0, lx, ly, lz);
    } else {
      const hits = new Map();
      for (let p = 0; p < st.pellets; p++) {
        const ang = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
        const tx = Math.tan(ang) * Math.cos(th), ty = Math.tan(ang) * Math.sin(th);
        let dx = d.x + rx * tx + ux * ty, dy = d.y + uy * ty, dz = d.z + rz * tx + uz * ty;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;

        const hit = this.trace(e, ox, oy, oz, dx, dy, dz, st.range);
        const hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t;
        if (hit.t > 1.5 && (p < 4 || Math.random() < 0.3)) this.tracer(mx0, my0, mz0, hx, hy, hz, e.isPlayer ? 0xfff1a0 : 0xffc890);

        const fall = st.fall ? lerp(1, 0.35, clamp((hit.t - st.fall[0]) / (st.fall[1] - st.fall[0]), 0, 1)) : 1;
        if (hit.entity) {
          const h = hits.get(hit.entity) || { dmg: 0, head: false, x: hx, y: hy, z: hz };
          h.dmg += st.dmg * fall * (hit.head ? st.head : 1);
          h.head = h.head || hit.head;
          hits.set(hit.entity, h);
          this.puff(hx, hy, hz, 0xff5050);
        } else if (hit.t < st.range) {
          this.puff(hx, hy, hz, hit.collider && hit.collider.piece ? 0xd8c8a0 : 0xffe9a0);
          if (hit.collider && hit.collider.piece) this.game.build.damage(hit.collider.piece, st.dmg * fall * 0.8, e);
        }
        if (st.blast && hit.t < st.range) this.explode(hx - dx * 0.3, hy - dy * 0.3, hz - dz * 0.3, st.blast.r, st.blast.dmg, e, st.name);
      }
      for (const [target, h] of hits) this.damage(target, h.dmg, e, st.name, h.head);
    }
    this.game.audio.play(st.quiet ? 'quiet' : 'shoot_' + st.cls, e);
    if (!st.quiet) this.game.noise(e, NOISE[st.cls] || 80);
    if (e.isPlayer) {
      e.pitch += (CLASS_KICK[st.cls] || 0.004) * (0.6 + Math.random() * 0.8) * (e.crouch ? 0.7 : 1);
      e.yaw += (Math.random() - 0.5) * 0.002;
    }
    e.recoil = 1;
  }

  // ------------------------------------------------------------------ projectiles (rockets, grenades)
  launch(e, st, x, y, z, dx, dy, dz) {
    const pr = st.proj;
    if (pr.kind === 'bullet') {
      // sniper rounds travel and drop; they start at the eye so they go where the crosshair points
      const a = this.aimOf(e);
      const sp = this.spreadFor(e, st);
      const jx = (Math.random() - 0.5) * sp, jy = (Math.random() - 0.5) * sp, jz = (Math.random() - 0.5) * sp;
      this.projectiles.push({
        owner: e, kind: 'bullet', x: a.ox, y: a.oy, z: a.oz, vx: (a.dx + jx) * pr.speed, vy: (a.dy + jy) * pr.speed, vz: (a.dz + jz) * pr.speed,
        grav: pr.grav, bounce: false, fuse: st.range / pr.speed + 0.5, dmg: st.dmg, head: st.head, name: st.name, mesh: null, tx: x, ty: y, tz: z,
      });
      return;
    }
    const mesh = new THREE.Mesh(this.projGeo[pr.kind] || this.projGeo.grenade, new THREE.MeshBasicMaterial({ color: pr.kind === 'rocket' ? 0xdddddd : 0x5a8a3a }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.projectiles.push({
      owner: e, kind: pr.kind, x, y, z, vx: dx * pr.speed, vy: dy * pr.speed + (pr.grav ? 2.5 : 0), vz: dz * pr.speed,
      grav: pr.grav || 0, bounce: !!pr.bounce, fuse: pr.fuse || 6, blast: st.blast, name: st.name, mesh, trailT: 0,
    });
  }

  throwNade(e, slotIdx) {
    const it = e.slots[slotIdx];
    const k = ITEM_KINDS[it.id];
    const a = this.aimOf(e);
    const down = a.dy < -0.5; // looking at your feet: drop it there instead of lobbing it
    const sp = down ? 6 : 21;
    const mesh = new THREE.Mesh(this.projGeo.grenade, new THREE.MeshLambertMaterial({ color: this.game.season.items[it.id].color, emissive: 0x331100 }));
    const x = e.x + a.dx * 0.6, y = e.eyeY - 0.1, z = e.z + a.dz * 0.6;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.projectiles.push({
      owner: e, kind: 'nade', x, y, z, vx: a.dx * sp + e.vx * 0.5, vy: a.dy * sp + (down ? 1 : 4.5), vz: a.dz * sp + e.vz * 0.5,
      grav: 22, bounce: !k.heal, fuse: k.fuse, blast: k.blast, heal: k.heal, name: this.game.season.items[it.id].name, mesh, trailT: 0,
      color: this.game.season.items[it.id].color,
    });
    e.consume(slotIdx);
    this.game.audio.play('throw', e);
  }

  updateProjectiles(dt) {
    const w = this.game.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      p.vy -= p.grav * dt;
      const sx = p.vx * dt, sy = p.vy * dt, sz = p.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      let boom = p.fuse <= 0;
      if (p.kind === 'bullet') {
        if (p.fuse <= 0 || len < 1e-5) { this.projectiles.splice(i, 1); continue; }
        const dx = sx / len, dy = sy / len, dz = sz / len;
        const hit = this.trace(p.owner, p.x, p.y, p.z, dx, dy, dz, len);
        const ex = p.x + dx * Math.min(hit.t, len), ey = p.y + dy * Math.min(hit.t, len), ez = p.z + dz * Math.min(hit.t, len);
        this.tracer(p.tx, p.ty, p.tz, ex, ey, ez, p.owner.isPlayer ? 0xfff1a0 : 0xffc890);
        p.tx = ex; p.ty = ey; p.tz = ez;
        if (hit.t < len) {
          if (hit.entity) { this.damage(hit.entity, p.dmg * (hit.head ? p.head : 1), p.owner, p.name, hit.head); this.puff(ex, ey, ez, 0xff5050); }
          else { this.puff(ex, ey, ez); if (hit.collider && hit.collider.piece) this.game.build.damage(hit.collider.piece, p.dmg * 0.8, p.owner); }
          this.projectiles.splice(i, 1);
        } else { p.x += sx; p.y += sy; p.z += sz; }
        continue;
      }
      if (!boom && len > 1e-5) {
        const dx = sx / len, dy = sy / len, dz = sz / len;
        const hit = this.trace(p.owner, p.x, p.y, p.z, dx, dy, dz, len + 0.15);
        if (hit.t < len + 0.15) {
          const hx = p.x + dx * hit.t, hy = p.y + dy * hit.t, hz = p.z + dz * hit.t;
          if (!p.bounce || hit.entity || (p.kind === 'grenade' && Math.hypot(p.vx, p.vy, p.vz) > 25)) {
            p.x = hx - dx * 0.2; p.y = hy - dy * 0.2; p.z = hz - dz * 0.2; boom = true;
          } else {
            // bounce: figure out which way the surface faces
            let nx = 0, ny = 1, nz = 0;
            const c = hit.collider;
            if (c && c.kind === 'box') {
              const d = [Math.abs(hx - c.minx), Math.abs(hx - c.maxx), Math.abs(hy - c.miny), Math.abs(hy - c.maxy), Math.abs(hz - c.minz), Math.abs(hz - c.maxz)];
              const m = d.indexOf(Math.min(...d));
              nx = m === 0 ? -1 : m === 1 ? 1 : 0; ny = m === 2 ? -1 : m === 3 ? 1 : 0; nz = m === 4 ? -1 : m === 5 ? 1 : 0;
            } else if (hit.terrain) {
              const h0 = w.heightAt(hx, hz);
              nx = h0 - w.heightAt(hx + 0.5, hz); nz = h0 - w.heightAt(hx, hz + 0.5); ny = 0.5;
              const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
            }
            const vn = p.vx * nx + p.vy * ny + p.vz * nz;
            p.vx = (p.vx - 2 * vn * nx) * 0.55; p.vy = (p.vy - 2 * vn * ny) * 0.45; p.vz = (p.vz - 2 * vn * nz) * 0.55;
            p.x = hx + nx * 0.12; p.y = hy + ny * 0.12; p.z = hz + nz * 0.12;
            if (Math.hypot(p.vx, p.vy, p.vz) > 3) this.game.audio.play('bounce', p);
          }
        } else { p.x += sx; p.y += sy; p.z += sz; }
      }
      if (p.y < w.liquidY - 1) boom = true;
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.kind === 'rocket') p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      p.trailT -= dt;
      if (p.trailT <= 0 && this.game.fx) { p.trailT = p.kind === 'rocket' ? 0.02 : 0.08; this.game.fx.smoke(p.x, p.y, p.z, p.kind === 'rocket' ? 0.5 : 0.25); }
      if (boom) {
        this.group.remove(p.mesh); p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        if (p.heal) this.splashHeal(p.x, p.y, p.z, p.heal, p.color);
        else this.explode(p.x, p.y, p.z, p.blast.r, p.blast.dmg, p.owner, p.name);
      }
    }
  }

  // ------------------------------------------------------------------ pickaxe
  swing(e) {
    e.swingT = 0.3;
    const a = this.aimOf(e);
    const reach = 3.4;
    const hit = this.trace(e, a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, reach);
    const g = this.game;
    g.audio.play('swing', e);
    if (hit.t >= reach) return;
    const hx = a.ox + a.dx * hit.t, hy = a.oy + a.dy * hit.t, hz = a.oz + a.dz * hit.t;
    if (hit.entity) { if (hit.t < 2.8) this.damage(hit.entity, 20, e, 'Pickaxe', false); return; }
    const target = hit.collider ? (hit.collider.node || hit.collider.piece) : null;
    if (!target) { this.puff(hx, hy, hz, 0xd8c8a0); return; }
    // weak point: hitting the blue circle doubles the damage (and the materials)
    let crit = false;
    if (e.isPlayer) {
      const wp = this.weakPoint;
      if (wp && wp.target === target && Math.hypot(wp.x - hx, wp.y - hy, wp.z - hz) < 0.65) crit = true;
      this._newWeakPoint(target, hit.collider, hx, hy, hz, a);
    }
    if (g.fx) g.fx.chips(hx, hy, hz, crit ? 0x5fd0ff : 0xd8c8a0, crit ? 8 : 4);
    if (hit.collider.node) {
      const n = hit.collider.node;
      n.hp -= crit ? 68 : 34;
      const gain = (n.yield + Math.floor(Math.random() * 4)) * (crit ? 2 : 1);
      e.mats[n.res] = Math.min(999, e.mats[n.res] + gain);
      if (e.isPlayer) { g.hud.matPop(n.res, gain, crit); g.audio.play(crit ? 'crit' : 'harvest', e); }
      g.world.shakeNode(n);
      if (n.hp <= 0) { g.world.destroyNode(n); if (this.weakPoint && this.weakPoint.target === n) this.weakPoint = null; }
    } else {
      g.build.damage(hit.collider.piece, crit ? 100 : 50, e);
      if (e.isPlayer) g.audio.play(crit ? 'crit' : 'harvest', e);
    }
  }

  _newWeakPoint(target, c, hx, hy, hz, a) {
    // random spot on the face we are looking at, inside the target's bounds
    let rx = -a.dz, rz = a.dx; const l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
    for (let i = 0; i < 6; i++) {
      const u = (Math.random() - 0.5) * 1.6, v = (Math.random() - 0.5) * 1.4;
      const x = hx + rx * u - a.dx * 0.05, y = hy + v, z = hz + rz * u - a.dz * 0.05;
      if (x > c.minx - 0.05 && x < c.maxx + 0.05 && z > c.minz - 0.05 && z < c.maxz + 0.05 && y > c.miny + 0.2 && y < c.maxy - 0.1) {
        this.weakPoint = { target, x, y, z, t: this.game.time };
        return;
      }
    }
    this.weakPoint = { target, x: hx - a.dx * 0.05, y: hy + 0.5, z: hz - a.dz * 0.05, t: this.game.time };
  }

  /** Healing splash: +amt to everyone close by (health first, the rest becomes shield). */
  splashHeal(x, y, z, h, color) {
    const g = this.game;
    if (g.fx) { g.fx.flash(x, y + 0.5, z, h.r * 1.6, 0.3); g.fx.chips(x, y + 0.3, z, parseInt(color.slice(1), 16), 24); }
    g.audio.play('heal', { x, y, z });
    for (const e of g.entities) {
      if (!e.alive || e.airborne) continue;
      if (Math.hypot(e.x - x, e.y + 0.9 - y, e.z - z) > h.r + 0.5) continue;
      let amt = h.amt;
      const toHp = Math.min(amt, 100 - e.hp); e.hp += toHp; amt -= toHp;
      e.shield = Math.min(100, e.shield + amt);
    }
  }

  // ------------------------------------------------------------------ damage
  explode(x, y, z, r, dmg, src, name) {
    if (this.game.fx) this.game.fx.explosion(x, y, z, r);
    this.game.audio.play('boom', { x, y, z });
    this.game.noise({ x, z }, 120);
    for (const e of this.game.entities) {
      if (!e.alive || e.untargetable || e.air === 'bus') continue;
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
    const hadShield = target.shield > 0;
    target.shield -= sh;
    target.hp -= amount - sh;
    target.lastHitBy = src;
    target.lastWeapon = weaponName;
    const g = this.game;
    if (src && src !== target) { target.lastDamaged = g.time; target.lastAttacker = src; }
    if (src && src.isPlayer && src !== target) {
      g.hud.hitMarker(head);
      g.hud.damageNumber(target.x, target.y + target.h + 0.2, target.z, amount, head, sh >= amount);
      g.audio.play(head ? 'hit_head' : 'hit', null);
      if (hadShield && target.shield <= 0) g.audio.play('shield_break', null);
    }
    if (target.isPlayer) g.hud.hurt(src);
    if (target.onDamaged) target.onDamaged(src, amount);
    if (target.hp <= 0) { target.hp = 0; g.eliminate(target, src, weaponName); }
  }
}
