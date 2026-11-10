// Shared state + inventory logic for anything that fights: the player and the bots.
// Also the shared "air" movement (bus -> skydive -> glider) and the character model hookup.

import { AMMO, ITEM_KINDS, RARITIES, WEAPONS, weaponStats, makeWeapon } from './weapons.js?v=63';
import { PLAYER_H, CROUCH_H, FALL_SAFE, groundAt, isFree } from './physics.js?v=63';
import { planReload, reloadPhase, capacity } from './reload.js?v=63';

export class Entity {
  constructor(game, name, isPlayer = false) {
    this.game = game;
    this.name = name;
    this.isPlayer = isPlayer;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.grounded = false;
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.shield = 0;
    this.alive = true;
    this.kills = 0;
    this.h = PLAYER_H;
    this.crouch = false; this.sliding = false; this.mantle = null; this.sprinting = false;
    this.air = null; // 'bus' | 'fall' | 'glide' | null (on foot)
    // slot 0 = pickaxe, 1..5 = weapons / healing items
    this.slots = [{ type: 'pickaxe' }, null, null, null, null, null];
    this.slot = 0;
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0, cells: 0 };
    this.mats = { wood: 0, brick: 0, metal: 0 };
    this.fireCd = 0; this.reloadT = 0; this.reloadStage = null; this.useT = 0; this.burstLeft = 0;
    this.swingT = 0; this.recoil = 0; this.idleT = 1; this.bloom = 0;
    this.wantFire = false; this.firedHeld = false; this.ads = false;
    this.lastDamaged = -99; this.lastAttacker = null;
    this.emoteT = 0;
    this.onFall = (speed) => this.game.combat.damage(this, (speed - FALL_SAFE) * 6, null, 'fall damage');
  }

  get eyeY() { return this.y + (this.sliding ? 0.8 : this.crouch ? 1.08 : 1.62); }
  get held() { return this.slots[this.slot]; }
  get airborne() { return this.air !== null; }

  setCrouch(on) {
    this.crouch = on;
    this.h = on ? CROUCH_H : PLAYER_H;
  }

  selectSlot(i) {
    if (i < 0 || i > 5 || i === this.slot) return;
    if (this.slot >= 1) this.lastSlot = this.slot;
    this.slot = i;
    this.cancelReload();
    this.useT = 0; this.burstLeft = 0; this.fireCd = Math.max(this.fireCd, 0.25);
    this.recoil = 0;
  }

  // ------------------------------------------------------------------ air: skydive + glider
  /** Leave the bus (or spawn in the sky) at the current position. */
  jumpFromBus() {
    this.air = 'fall';
    this.vy = -6;
    this.untargetable = false;
  }

  /**
   * One step of skydiving/gliding. (wx, wz) is the wanted horizontal direction (length <= 1),
   * `dive` 0..1 how much the entity pushes forward.
   */
  airStep(dt, wx, wz, dive) {
    const w = this.game.world;
    const glide = this.air === 'glide';
    const targetVy = glide ? -6.5 : -30 - dive * 14;
    this.vy += (targetVy - this.vy) * Math.min(1, dt * (glide ? 3 : 1.6));
    const sp = glide ? 13 + dive * 4 : 9 + dive * 13;
    this.vx += (wx * sp - this.vx) * Math.min(1, dt * 2);
    this.vz += (wz * sp - this.vz) * Math.min(1, dt * 2);
    // glide into walls / roofs / builds instead of through them
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (isFree(w, nx, this.z, this.y, this.h)) this.x = nx; else this.vx = 0;
    if (isFree(w, this.x, nz, this.y, this.h)) this.z = nz; else this.vz = 0;
    this.y += this.vy * dt;
    const R = w.mapRadius + 25, rr = Math.hypot(this.x, this.z);
    if (rr > R) { this.x *= R / rr; this.z *= R / rr; }
    const gr = groundAt(w, this.x, this.z, this.y + 60);
    if (this.air === 'fall' && this.y - gr < 62) { this.air = 'glide'; if (this.isPlayer) this.game.audio.play('glider', null); }
    if (this.y <= gr + 0.02) {
      this.y = gr; this.vy = 0; this.vx *= 0.35; this.vz *= 0.35;
      this.air = null; this.grounded = true;
      this.game.onLanded(this);
    }
  }

  // ------------------------------------------------------------------ inventory
  /** Put a weapon into the inventory. Returns the weapon that got replaced (to be dropped), or null. */
  giveWeapon(w) {
    for (let i = 1; i <= 5; i++) {
      if (!this.slots[i]) { this.slots[i] = w; return null; }
    }
    let idx = this.slot >= 1 ? this.slot : -1;
    if (idx < 0) {
      let worst = Infinity;
      for (let i = 1; i <= 5; i++) {
        const s = this.slots[i];
        if (s.type === 'weapon') { const sc = weaponStats(s).dps; if (sc < worst) { worst = sc; idx = i; } }
      }
    }
    if (idx < 0) return w;
    const old = this.slots[idx];
    this.slots[idx] = w;
    this.cancelReload(); this.useT = 0;
    return old;
  }

  /** How many more of item `id` fit (in existing stacks + free slots). */
  stackRoom(id) {
    const max = ITEM_KINDS[id].stack || 3;
    let room = 0;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (!s) room += max;
      else if (s.type === 'item' && s.id === id) room += max - s.count;
    }
    return room;
  }

  /** Add n of item `id` to stacks / free slots. Returns how many did NOT fit. */
  stackItem(id, n = 1) {
    const max = ITEM_KINDS[id].stack || 3;
    for (let i = 1; i <= 5 && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.type === 'item' && s.id === id && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
    }
    for (let i = 1; i <= 5 && n > 0; i++) {
      if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { type: 'item', id, count: k }; n -= k; }
    }
    return n;
  }

  /** Items stack (grenades up to 6, healing up to 3). Returns true when picked up. */
  giveItem(id, n = 1) {
    const max = ITEM_KINDS[id].stack || 3;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (s && s.type === 'item' && s.id === id && s.count < max) { s.count = Math.min(max, s.count + n); return true; }
    }
    for (let i = 1; i <= 5; i++) {
      if (!this.slots[i]) { this.slots[i] = { type: 'item', id, count: Math.min(max, n) }; return true; }
    }
    return false;
  }

  addAmmo(type, n) { this.ammo[type] = Math.min(999, this.ammo[type] + n); }

  hasUsableWeapon() {
    return this.slots.some((s) => s && s.type === 'weapon' && (s.mag > 0 || this.ammo[WEAPONS[s.id].ammo] > 0));
  }

  /** Start a realistic reload (see reload.js). Returns true if one started. */
  startReload() {
    const it = this.held;
    if (!it || it.type !== 'weapon' || this.reloadStage) return false;
    const st = weaponStats(it);
    const plan = planReload(it, st, this.ammo[st.ammo]);
    if (!plan) return false;
    this.reloadStage = plan;
    this.reloadT = plan.T;
    this.burstLeft = 0;
    return true;
  }

  cancelReload() { this.reloadStage = null; this.reloadT = 0; }

  /** Advance the running reload: fires its events (sounds, ammo going in, magazines dropping). */
  updateReload(dt) {
    const r = this.reloadStage, it = this.held;
    if (!r) { this.reloadT = 0; return; }
    if (!it || it.type !== 'weapon' || it.id !== r.id) { this.cancelReload(); return; }
    r.t += dt;
    this.reloadT = Math.max(0.0001, r.T - r.t);
    const st = weaponStats(it);
    while (r.events.length && r.t >= r.events[0].at) {
      const ev = r.events.shift();
      if (ev.kind === 'grant') {
        const take = Math.min(r.cap - it.mag, this.ammo[st.ammo]);
        if (take > 0) { it.mag += take; this.ammo[st.ammo] -= take; }
      } else if (ev.kind === 'grant1') {
        if (it.mag < r.cap && this.ammo[st.ammo] > 0) { it.mag++; this.ammo[st.ammo]--; }
      } else if (ev.kind === 'mag_drop' || ev.kind === 'eject') {
        if (this.game.fx) this.game.fx.reloadDrop(this, ev.kind === 'eject' ? (r.id === 'revolver' ? 6 : 2) : 0, r.id);
      } else this.game.audio.play(ev.kind, this);
    }
    if (r.t >= r.T) { this.reloadStage = null; this.reloadT = 0; }
  }

  /** Name + progress of the current reload phase, or null. */
  get reloadPhase() { return reloadPhase(this.reloadStage); }

  /** Rounds the held weapon can take right now (mag + chambered round). */
  magCapacity(it = this.held) { return it && it.type === 'weapon' ? capacity(it, weaponStats(it)) : 0; }

  /** Apply the effect of a consumed healing item. */
  applyItem(slotIdx) {
    const s = this.slots[slotIdx];
    if (!s || s.type !== 'item') return;
    const k = ITEM_KINDS[s.id];
    if (k.hp) this.hp = Math.min(Math.max(this.hp, k.max), this.hp + k.hp);
    if (k.sh) this.shield = Math.min(Math.max(this.shield, k.max), this.shield + k.sh);
    this.consume(slotIdx);
    this.game.audio.play('heal', this);
  }

  consume(slotIdx) {
    const s = this.slots[slotIdx];
    s.count--;
    if (s.count <= 0) this.slots[slotIdx] = null;
  }

  canUse(slotIdx) {
    const s = this.slots[slotIdx];
    if (!s || s.type !== 'item') return false;
    const k = ITEM_KINDS[s.id];
    if (k.throw || k.gadget) return true;
    if (k.hp) return this.hp < k.max;
    if (k.sh) return this.shield < k.max;
    return false;
  }

  /** Score used by bots to pick their favourite weapon. */
  weaponScore(w) {
    const st = weaponStats(w);
    const has = w.mag > 0 || this.ammo[st.ammo] > 0;
    return has ? st.dps + w.rarity * 4 : -1;
  }

  /** Footstep sounds (you can hear enemies sneaking up). */
  footsteps(dt) {
    if (!this.grounded || this.air || this.sliding) return;
    const v = Math.hypot(this.vx, this.vz);
    if (v < 2.5) return;
    this.stepAcc = (this.stepAcc || 0) + v * dt;
    const stride = this.crouch ? 2.6 : 1.7;
    if (this.stepAcc > stride) {
      this.stepAcc = 0;
      if (this.swimming) this.game.audio.play('splash', this);
      else if (!this.crouch || this.isPlayer) this.game.audio.play(this.isPlayer ? 'step_me' : 'step', this);
    }
  }

  /** Feed the character model with the current state. */
  animateModel(dt) {
    this.footsteps(dt);
    const m = this.model;
    if (!m) return;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.yaw;
    if (!this.isPlayer) {
      const c = this.game.camera.position;
      m.lod((c.x - this.x) ** 2 + (c.z - this.z) ** 2 > 45 * 45);
    }
    const it = this.held;
    if (!it) m.setHeld(null);
    else if (it.type === 'weapon') m.setHeld('gun', it.id, it.rarity);
    else if (it.type === 'pickaxe') m.setHeld('pickaxe');
    else m.setHeld('item', null, this.game.season.items[it.id] ? this.game.season.items[it.id].color : '#fff');
    m.animate(dt, {
      speed: Math.hypot(this.vx, this.vz), grounded: this.grounded, crouch: this.crouch, slide: this.sliding,
      air: this.air === 'bus' ? 'fall' : this.air, aiming: this.ads || this.aiming, pitch: this.pitch, recoil: this.recoil,
      swing: this.swingT, reloading: !!this.reloadStage, reload: this.reloadStage ? reloadPhase(this.reloadStage) : null, using: this.useT > 0, mantle: !!this.mantle, sprint: this.sprinting,
      kind: !it ? null : it.type === 'weapon' ? 'gun' : it.type,
      emote: this.emoteT > 0, swim: this.swimming,
      back: (this.vx * -Math.sin(this.yaw) + this.vz * -Math.cos(this.yaw)) < -0.8,
    });
  }
}

export { PLAYER_H, RARITIES, AMMO, makeWeapon };
