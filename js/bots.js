// Bot opponents: loot, run from the storm, find and fight whoever they can see.

import * as THREE from '../lib/three.module.min.js';
import { Entity } from './entity.js';
import { stepEntity, isFree } from './physics.js';
import { WEAPONS, weaponStats, ITEM_KINDS } from './weapons.js';
import { angleDiff, clamp } from './util.js';

export const BOT_NAMES = ['Skelly', 'Voltage', 'NoScope', 'Pixel', 'Toast', 'Gigabyte', 'Raven', 'Moose', 'Blitz', 'Zed',
  'Cobalt', 'Mango', 'Echo', 'Rusty', 'Nova', 'Spud', 'Ghost', 'Turbo', 'Waffles', 'Ziggy', 'Bonk', 'Glitch'];

const COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6fa5, 0x95a5a6, 0x6c5ce7];

// preferred fighting distance per weapon class
const IDEAL = { pistol: 16, smg: 13, rifle: 24, shotgun: 7, sniper: 55, launcher: 28 };

function makeBotMesh(color, name) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0c8a0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.32), mat); body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skin); head.position.y = 1.72;
  const hat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), dark); hat.position.y = 1.95;
  const mkLimb = (w, h, x, y, m) => {
    const piv = new THREE.Group(); piv.position.set(x, y, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m); l.position.y = -h / 2;
    piv.add(l); return piv;
  };
  const legL = mkLimb(0.26, 0.78, -0.16, 0.78, dark), legR = mkLimb(0.26, 0.78, 0.16, 0.78, dark);
  const armL = mkLimb(0.2, 0.7, -0.42, 1.5, mat), armR = mkLimb(0.2, 0.7, 0.42, 1.5, mat);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), new THREE.MeshLambertMaterial({ color: 0x333a44 }));
  gun.position.set(0, -0.55, -0.35);
  armR.add(gun);
  g.add(body, head, hat, legL, legR, armL, armR);
  g.userData = { legL, legR, armL, armR, gun };

  // name tag
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 34px Arial'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 6;
  c.strokeText(name, 128, 42); c.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.45; sp.renderOrder = 10;
  g.add(sp);
  g.userData.tag = sp;
  return g;
}

export class Bot extends Entity {
  constructor(game, name, index) {
    super(game, name, false);
    this.skill = 0.35 + Math.random() * 0.5;
    this.mesh = makeBotMesh(COLORS[index % COLORS.length], name);
    this.thinkT = Math.random() * 0.4;
    this.mode = 'roam';
    this.goal = null; this.goalT = 0;
    this.enemy = null; this.enemySeen = 0; this.lastSeen = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.lastX = 0; this.lastZ = 0; this.stuckT = 0; this.unstickT = 0; this.unstickDir = 1;
    this.aimErrYaw = 0; this.aimErrPitch = 0; this.aimErrT = 0;
    this.spreadMult = 1.2 + (1 - this.skill) * 1.6;
    this.blacklist = new Map();
    this.fireBurstT = 0; this.fireRestT = 0;
    this.walkPhase = Math.random() * 6;
    this.healing = false;
  }

  // ------------------------------------------------------------------ decision making (a few times a second)
  think() {
    const g = this.game, now = g.time, w = g.world;
    const prevMode = this.mode;
    g.loot.autoPickup(this);

    // 1) find the closest visible enemy
    let best = null, bd = 85 * 85;
    for (const o of g.entities) {
      if (o === this || !o.alive || o.untargetable) continue;
      const dx = o.x - this.x, dz = o.z - this.z, d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      if (!g.combat.los(this.x, this.eyeY, this.z, o.x, o.y + 1.1, o.z)) continue;
      bd = d2; best = o;
    }
    if (best) {
      if (this.enemy !== best) { this.enemy = best; this.enemySeen = now; }
      this.lastSeen = now;
    } else if (now - this.lastSeen > 3) this.enemy = null;

    // 2) pick the best weapon we can actually shoot
    let bi = -1, bs = -1;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (s && s.type === 'weapon') { const sc = this.weaponScore(s); if (sc > bs) { bs = sc; bi = i; } }
    }
    const hasGun = bi > 0;

    // 3) heal when safe
    this.healing = false;
    if (!this.enemy || now - this.lastSeen > 1.5) {
      for (let i = 1; i <= 5; i++) {
        if (this.canUse(i) && (this.hp < 60 || this.shield < 25)) { this.selectSlot(i); this.healing = true; break; }
      }
    }

    if (!this.healing) {
      if (this.enemy && hasGun && now - this.lastSeen < 2.5) { if (this.slot !== bi) this.selectSlot(bi); }
      else if (hasGun && this.slot !== bi && !this.enemy) { this.selectSlot(bi); }
      else if (!hasGun && this.slot !== 0) this.selectSlot(0);
    }

    // 4) high-level mode
    const st = g.storm;
    const toC = Math.hypot(this.x - st.toX, this.z - st.toZ);
    const dCur = Math.hypot(this.x - st.cx, this.z - st.cz);
    const inDanger = st.outside(this.x, this.z) || (st.state === 'shrinking' && dCur > st.r - 6);
    const stormSoon = st.state === 'waiting' && st.timeLeft < 12 && toC > st.toR - 4;

    if (this.healing) { this.mode = 'heal'; this.goal = null; }
    else if (inDanger || stormSoon) { this.mode = 'storm'; this.goal = { x: st.toX, z: st.toZ }; this.goalT = 8; }
    else if (this.enemy && hasGun) { this.mode = 'fight'; }
    else if (this.enemy && !hasGun) { this.mode = 'flee'; this.goal = { x: this.x - (this.enemy.x - this.x), z: this.z - (this.enemy.z - this.z) }; this.goalT = 3; }
    else {
      // keep chasing the current loot target while it still exists, otherwise look for new loot
      const t = this.goal && this.goal.target;
      const stillThere = prevMode === 'loot' && t && this.goalT > 0 && (t.kind === 'c' ? !t.ref.opened : g.loot.pickups.includes(t.ref));
      if (stillThere) this.mode = 'loot';
      else {
        const wantGun = !hasGun || bs < 20;
        const target = this.findLoot(wantGun);
        if (target) { this.mode = 'loot'; this.goal = { x: target.x, z: target.z, target }; this.goalT = 12; }
        else if (!this.goal || this.goal.target || this.goalT <= 0 || Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 3) {
          this.mode = 'roam';
          const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 45;
          let gx = this.x + Math.cos(a) * r, gz = this.z + Math.sin(a) * r;
          if (Math.hypot(gx - st.toX, gz - st.toZ) > st.toR * 0.8) { gx = st.toX + (Math.random() - 0.5) * st.toR; gz = st.toZ + (Math.random() - 0.5) * st.toR; }
          this.goal = { x: gx, z: gz }; this.goalT = 10;
        } else this.mode = 'roam';
      }
    }

    // 5) grab nearby loot we want
    const near = g.loot.nearestInteractable(this, 2.4);
    if (near) {
      if (near.type === 'chest') g.loot.interact(this, near);
      else {
        const p = near.p;
        const want = p.kind === 'item' ? this.itemWanted(p.itemId) : this.weaponWanted(p.inst);
        if (want && g.loot.interact(this, near)) { this.blacklist.clear(); }
      }
    }
    if (this.mode !== 'fight' && this.reloadT <= 0 && this.held && this.held.type === 'weapon' && this.held.mag === 0) this.startReload();
  }

  itemWanted(id) {
    const k = ITEM_KINDS[id];
    let have = 0;
    for (let i = 1; i <= 5; i++) { const s = this.slots[i]; if (s && s.type === 'item' && s.id === id) have += s.count; }
    if (have >= 3) return false;
    return !!(k.hp || k.sh);
  }

  weaponWanted(inst) {
    const sc = this.weaponScore(inst);
    let worst = Infinity, free = false;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (!s) free = true;
      else if (s.type === 'weapon') worst = Math.min(worst, this.weaponScore(s));
    }
    if (free) return true;
    return sc > worst + 6;
  }

  findLoot(wantGun) {
    const g = this.game, now = g.time;
    let best = null, bd = 70 * 70;
    const consider = (o, kind) => {
      const bl = this.blacklist.get(o);
      if (bl && bl > now) return;
      const dx = o.x - this.x, dz = o.z - this.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x: o.x, z: o.z, y: o.y, ref: o, kind }; }
    };
    for (const p of g.loot.pickups) {
      if (p.kind === 'weapon' && (wantGun || this.weaponWanted(p.inst))) consider(p, 'p');
      else if (p.kind === 'ammo') { const hasUser = this.slots.some((s) => s && s.type === 'weapon' && WEAPONS[s.id].ammo === p.type); if (hasUser && this.ammo[p.type] < 90) consider(p, 'p'); }
      else if (p.kind === 'item' && this.itemWanted(p.itemId) && !wantGun) consider(p, 'p');
    }
    if (wantGun || Math.random() < 0.3) for (const c of g.loot.chests) if (!c.opened) consider(c, 'c');
    if (best) this.blacklist.set(best.ref, now + 25); // don't chase the same thing forever
    return best;
  }

  // ------------------------------------------------------------------ per-frame movement + shooting
  /** Is (x,z) a damaging liquid (lava, icy water...) that bots should not wade into? */
  _hazard(w, x, z) {
    const liq = w.season.liquid;
    return !!(liq && liq.dps >= 3 && w.heightAt(x, z) < w.liquidY);
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, w = g.world;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.2 + Math.random() * 0.15; this.think(); }
    this.goalT -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0.7 + Math.random() * 1.3; }

    let wx = 0, wz = 0, speed = 6;
    this.wantFire = false;
    const held = this.held;
    const st = held && held.type === 'weapon' ? weaponStats(held) : null;

    if (this.mode === 'fight' && this.enemy && this.enemy.alive && st) {
      const e = this.enemy;
      const dx = e.x - this.x, dz = e.z - this.z, dist = Math.hypot(dx, dz);
      const ty = e.y + 1.35 - this.eyeY;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(ty, dist);
      // human-ish aim error that changes every so often
      this.aimErrT -= dt;
      if (this.aimErrT <= 0) {
        this.aimErrT = 0.35 + Math.random() * 0.4;
        const m = (1 - this.skill) * 0.07;
        this.aimErrYaw = (Math.random() - 0.5) * m * 2; this.aimErrPitch = (Math.random() - 0.5) * m;
      }
      const turn = (3.5 + this.skill * 7) * dt;
      this.yaw += clamp(angleDiff(this.yaw, wantYaw + this.aimErrYaw), -turn, turn);
      this.pitch += clamp(wantPitch + this.aimErrPitch - this.pitch, -turn, turn);
      const aimed = Math.abs(angleDiff(this.yaw, wantYaw)) < 0.12 + (1 - this.skill) * 0.1;
      const react = g.time - this.enemySeen > 0.35 + (1 - this.skill) * 0.7;
      // movement: keep a comfortable distance and strafe
      const ideal = IDEAL[st.cls] || 18;
      const fwd = dist > ideal * 1.25 ? 1 : dist < ideal * 0.6 ? -1 : 0;
      const sx = Math.cos(this.yaw) * this.strafe, sz = -Math.sin(this.yaw) * this.strafe;
      wx = -Math.sin(this.yaw) * fwd * 0.9 + sx * 0.7;
      wz = -Math.cos(this.yaw) * fwd * 0.9 + sz * 0.7;
      speed = 5.2;
      // trigger discipline
      if (aimed && react && dist < st.range * 0.75 && held.mag > 0) {
        if (st.auto) {
          this.fireBurstT -= dt;
          if (this.fireBurstT <= 0) { this.fireRestT = 0.25 + Math.random() * 0.4; this.fireBurstT = 0.6 + Math.random() * 0.9; }
          this.fireRestT -= dt;
          this.wantFire = this.fireRestT <= 0 ? true : false;
        } else this.wantFire = Math.random() < 0.8;
      }
      if (held.mag === 0 && this.reloadT <= 0) this.startReload();
      if (this.grounded && Math.random() < dt * 0.35) { this.vy = 7.2; this.grounded = false; }
    } else if (this.mode === 'heal') {
      speed = 0;
      this.wantFire = true;
    } else if (this.goal) {
      const dx = this.goal.x - this.x, dz = this.goal.z - this.z, dist = Math.hypot(dx, dz);
      if (dist > 1.2) {
        const want = Math.atan2(-dx, -dz);
        this.yaw += clamp(angleDiff(this.yaw, want), -dt * 7, dt * 7);
        this.pitch += (0 - this.pitch) * Math.min(1, dt * 5);
        wx = dx / dist; wz = dz / dist;
        speed = this.mode === 'storm' || this.mode === 'flee' ? 8.6 : 7.0;
      } else { this.goalT = 0; }
      if (this.goal.target && this.goal.target.ref) {
        const r = this.goal.target.ref;
        if ((r.opened) || (r.kind && !g.loot.pickups.includes(r))) { this.goalT = 0; this.goal = null; }
      }
    }

    // ---- steering with feelers + stuck handling
    const len = Math.hypot(wx, wz);
    if (len > 0.01) {
      wx /= len; wz /= len;
      if (this.unstickT > 0) {
        this.unstickT -= dt;
        const a = Math.atan2(wz, wx) + this.unstickDir * 1.2;
        wx = Math.cos(a); wz = Math.sin(a);
        if (this.grounded && Math.random() < dt * 3) { this.vy = 7.2; this.grounded = false; }
      } else {
        let ok = false;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const a = Math.atan2(wz, wx) + off;
          const cx = Math.cos(a), cz = Math.sin(a);
          if (isFree(w, this.x + cx * 1.1, this.z + cz * 1.1, this.y) && isFree(w, this.x + cx * 2.2, this.z + cz * 2.2, this.y)
            && !this._hazard(w, this.x + cx * 2.4, this.z + cz * 2.4) && !this._hazard(w, this.x + cx * 4.5, this.z + cz * 4.5)) { wx = cx; wz = cz; ok = true; break; }
        }
        if (!ok && this.grounded) { this.vy = 7.2; this.grounded = false; }
      }
    }
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.stuckT += dt;
    if (this.stuckT > 0.7) {
      if (len > 0.01 && moved < 0.5 && speed > 0) { this.unstickT = 0.9; this.unstickDir = Math.random() < 0.5 ? -1 : 1; if (this.goal && this.goalT > 3) this.goalT -= 2; }
      this.stuckT = 0; this.lastX = this.x; this.lastZ = this.z;
    }

    // ---- apply velocity + physics
    const liq = w.liquidAt(this.x, this.z, this.y + 0.2);
    const sp = liq && liq.type !== 'lava' ? speed * 0.6 : speed;
    const k = Math.min(1, dt * (this.grounded ? 12 : 3));
    this.vx += (wx * sp - this.vx) * k;
    this.vz += (wz * sp - this.vz) * k;
    stepEntity(w, this, dt);
    this.moving = len > 0.01 && speed > 0;

    g.combat.update_shooter(this, dt);

    // ---- mesh
    const m = this.mesh, d = m.userData;
    m.position.set(this.x, this.y, this.z);
    m.rotation.y = this.yaw;
    const hv = Math.hypot(this.vx, this.vz);
    this.walkPhase += dt * hv * 1.6;
    const sw = Math.sin(this.walkPhase) * Math.min(1, hv / 6) * 0.9;
    d.legL.rotation.x = sw; d.legR.rotation.x = -sw;
    d.armL.rotation.x = -sw * 0.6;
    const aiming = this.mode === 'fight';
    d.armR.rotation.x = aiming ? -1.45 + this.pitch * 0.9 + this.recoil * 0.2 : sw * 0.6;
    d.gun.visible = !!(held && held.type === 'weapon');
    const pl = g.player;
    const dd = pl ? Math.hypot(pl.x - this.x, pl.z - this.z) : 99;
    d.tag.visible = dd < 45 && !(pl && !pl.alive && false);
  }
}
