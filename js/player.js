// The human player: parachute drop, ground movement (PC controls), interaction and building input.

import { Entity } from './entity.js';
import { stepEntity, groundAt } from './physics.js';
import { clamp } from './util.js';

const WALK = 6.2, SPRINT = 8.8, JUMP = 7.6;

export class Player extends Entity {
  constructor(game) {
    super(game, 'You', true);
    this.input = { f: 0, b: 0, l: 0, r: 0, jump: false, sprint: false };
    this.state = 'fall'; // fall -> glide -> ground
    this.moving = false;
    this.buildCd = 0;
    this.mouseLeft = false;
    this.spawnY = 0;
  }

  drop(x, z) {
    const w = this.game.world;
    this.x = x; this.z = z;
    this.y = w.heightAt(x, z) + 175;
    this.vx = this.vz = this.vy = 0;
    this.state = 'fall';
    this.grounded = false;
    this.yaw = Math.atan2(x, z) + (Math.random() - 0.5) * 0.6; // face the island centre
    this.pitch = -0.5;
  }

  toggleGlider() {
    if (this.state === 'fall') this.state = 'glide';
    else if (this.state === 'glide') this.state = 'fall';
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, w = g.world, inp = this.input;
    const fwd = inp.f - inp.b, side = inp.r - inp.l;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * fwd + rx * side, wz = fz * fwd + rz * side;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    if (this.state !== 'ground') {
      // ---- skydive / glider: no collisions until we touch something
      const glide = this.state === 'glide';
      const targetVy = glide ? -7 : -32;
      this.vy += (targetVy - this.vy) * Math.min(1, dt * 3);
      const sp = glide ? 15 : 10;
      const tx = (fx * (glide ? 0.8 + fwd * 0.2 : 0.4 + Math.max(0, fwd) * 0.6) + rx * side * 0.6) * sp;
      const tz = (fz * (glide ? 0.8 + fwd * 0.2 : 0.4 + Math.max(0, fwd) * 0.6) + rz * side * 0.6) * sp;
      this.vx += (tx - this.vx) * Math.min(1, dt * 2.5);
      this.vz += (tz - this.vz) * Math.min(1, dt * 2.5);
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      const R = w.mapRadius + 20, rr = Math.hypot(this.x, this.z);
      if (rr > R) { this.x *= R / rr; this.z *= R / rr; }
      const gr = groundAt(w, this.x, this.z, this.y + 50);
      if (this.state === 'fall' && this.y - gr < 70) this.state = 'glide';
      if (this.y <= gr) { this.y = gr; this.vy = 0; this.vx *= 0.3; this.vz *= 0.3; this.state = 'ground'; this.grounded = true; g.onPlayerLanded(); }
      this.moving = false;
      return;
    }

    // ---- on the ground
    const liq = w.liquidAt(this.x, this.z, this.y + 0.2);
    let speed = inp.sprint && fwd > 0 && !this.ads && !g.build.active ? SPRINT : WALK;
    if (this.ads) speed *= 0.55;
    if (liq && liq.type !== 'lava') speed *= 0.6;
    if (this.reloadT > 0) speed *= 0.9;
    const k = Math.min(1, dt * (this.grounded ? 14 : 3));
    this.vx += (wx * speed - this.vx) * k;
    this.vz += (wz * speed - this.vz) * k;
    if (inp.jump && this.grounded) { this.vy = JUMP; this.grounded = false; }
    this.moving = len > 0.05;
    stepEntity(w, this, dt);

    // weapon / interaction
    this.wantFire = this.mouseLeft && !g.build.active;
    g.combat.update_shooter(this, dt);

    // building: click (or hold) to place
    this.buildCd -= dt;
    if (g.build.active && this.mouseLeft && this.buildCd <= 0) { g.build.place(this); this.buildCd = 0.14; }
    g.loot.autoPickup(this);
  }
}

export { clamp };
