// The human player: bus jump, skydive/glider, ground movement (sprint, crouch, slide, mantle,
// vault), shooting, building and editing input. PC controls.

import { Entity } from './entity.js?v=48';
import { stepEntity, findLedge, startMantle, stepMantle, canStand, GRAVITY } from './physics.js?v=48';
import { CharacterModel } from './characters.js?v=48';
import { clamp } from './util.js?v=48';

const WALK = 6.0, SPRINT = 8.6, CROUCH = 3.4, JUMP = 7.6;
const SLIDE_MIN = 10.5, SLIDE_END = 4.2;

export class Player extends Entity {
  constructor(game) {
    super(game, 'You', true);
    this.input = { f: 0, b: 0, l: 0, r: 0, jump: false, sprint: false, crouch: false };
    this.jumpEdge = false;
    this.crouchToggle = false;
    this.moving = false;
    this.buildCd = 0;
    this.mouseLeft = false;
    this.slideCd = 0;
    this.slideDir = { x: 0, z: 0 };
    this.slideSpeed = 0;
    const o = game.settings.outfit;
    this.model = new CharacterModel(3, null, { outfit: [o.shirt, o.pants], hat: o.hat, accent: o.accent, hair: o.hair });
  }

  resetInput() { this.input = { f: 0, b: 0, l: 0, r: 0, jump: false, sprint: false, crouch: false }; this.mouseLeft = false; }

  pressJump() {
    this.jumpEdge = true;
    if (this.air === 'bus') { if (this.game.bus.canDrop) this.jumpFromBus(); }
    else if (this.air === 'fall') { this.air = 'glide'; this.game.audio.play('glider', null); }
  }

  emote() {
    if (this.airborne || !this.grounded || this.mantle || this.sliding) return;
    this.emoteT = 6;
    this.setCrouch(false);
    this.game.audio.play('emote', this);
  }

  get wantCrouch() { return this.game.settings.toggleCrouch ? this.crouchToggle : this.input.crouch; }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, w = g.world, inp = this.input;
    const fwd = inp.f - inp.b, side = inp.r - inp.l;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * fwd + rx * side, wz = fz * fwd + rz * side;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    const jumpPressed = this.jumpEdge; this.jumpEdge = false;

    if (this.air === 'bus') { this.moving = false; return; }
    if (this.air) {
      this.airStep(dt, wx, wz, Math.max(0, fwd));
      this.moving = false;
      return;
    }

    // ---- emote: dance until you move, jump, shoot or build
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      if (len > 0.05 || jumpPressed || this.mouseLeft || g.build.active || !this.grounded) this.emoteT = 0;
      else {
        this.vx *= 0.8; this.vz *= 0.8;
        stepEntity(w, this, dt);
        this.moving = false;
        return;
      }
    }

    // ---- mantling takes over everything for a moment
    if (this.mantle) {
      stepMantle(w, this, dt);
      this.moving = true;
      g.combat.update_shooter(this, dt);
      return;
    }

    const liq = w.liquidAt(this.x, this.z, this.y + 0.2);
    const editing = g.edit.active;
    const sprintKey = g.settings.sprintDefault ? !inp.sprint : inp.sprint;
    this.slideCd -= dt;

    // ---- crouch / slide state
    const wantCrouch = this.wantCrouch && !this.swimming;
    const hSpeed = Math.hypot(this.vx, this.vz);
    if (wantCrouch && !this.sliding && this.grounded && this.sprinting && hSpeed > 6.5 && this.slideCd <= 0) {
      this.sliding = true;
      this.slideSpeed = Math.max(SLIDE_MIN, hSpeed * 1.2);
      this.slideDir.x = this.vx / hSpeed; this.slideDir.z = this.vz / hSpeed;
      g.audio.play('slide', this);
    }
    if (this.sliding && (!wantCrouch || !this.grounded && this.vy < -6)) { this.sliding = false; this.slideCd = 0.35; }
    const crouchNow = (wantCrouch || this.sliding) || (this.crouch && !canStand(w, this));
    if (crouchNow !== this.crouch) this.setCrouch(crouchNow);

    // ---- horizontal velocity
    if (this.sliding) {
      // slopes speed you up going down and slow you down going up
      const ahead = w.heightAt(this.x + this.slideDir.x * 0.8, this.z + this.slideDir.z * 0.8) - w.heightAt(this.x, this.z);
      this.slideSpeed += (-ahead / 0.8) * GRAVITY * 0.55 * dt - 4.2 * dt;
      this.slideSpeed = Math.min(16, this.slideSpeed);
      if (len > 0.05) {
        const k = Math.min(1, dt * 1.6);
        this.slideDir.x += (wx - this.slideDir.x) * k; this.slideDir.z += (wz - this.slideDir.z) * k;
        const l = Math.hypot(this.slideDir.x, this.slideDir.z) || 1; this.slideDir.x /= l; this.slideDir.z /= l;
      }
      this.vx = this.slideDir.x * this.slideSpeed; this.vz = this.slideDir.z * this.slideSpeed;
      if (this.slideSpeed < SLIDE_END) { this.sliding = false; this.slideCd = 0.25; }
      this.sprinting = false;
    } else {
      this.sprinting = sprintKey && fwd > 0 && !this.ads && !this.crouch && !editing && g.time - this.lastShot > 0.35 && this.useT <= 0 && this.reloadT <= 0;
      if (this.swimming) this.sprinting = false;
      let speed = this.swimming ? (liq && liq.type === 'quicksand' ? 2.6 : 4.4) : this.crouch ? CROUCH : this.sprinting ? SPRINT : WALK;
      if (this.ads) speed *= 0.6;
      if (liq && liq.type !== 'lava' && !this.swimming) speed *= 0.6;
      if (this.held && this.held.type === 'item' && this.useT > 0) speed *= 0.55;
      const onIce = this.grounded && !this.swimming && w.iceAt(this.x, this.z, this.y);
      if (onIce) speed *= 1.15;
      const k = Math.min(1, dt * (onIce ? 1.4 : this.grounded ? 14 : 2.8));
      this.vx += (wx * speed - this.vx) * k;
      this.vz += (wz * speed - this.vz) * k;
    }

    // ---- jump, vault, mantle
    if (jumpPressed && this.grounded) {
      const ledge = fwd > 0 && this.sprinting ? findLedge(w, this, fx, fz, 1.5, true) : null;
      if (ledge && ledge.vault) { startMantle(this, ledge); g.audio.play('mantle', this); return; }
      this.vy = this.sliding ? JUMP * 1.08 : JUMP;
      this.grounded = false;
      this.sprintJump = this.sprinting || this.sliding;
      if (this.sliding) { this.sliding = false; this.slideCd = 0.3; }
      else if (this.crouch && canStand(w, this)) this.setCrouch(false);
    } else if (!this.grounded && fwd > 0 && (inp.jump || this.vy < 2.5) && this.vy < 4) {
      const ledge = findLedge(w, this, fx, fz, 2.75, !!this.sprintJump);
      if (ledge) { startMantle(this, ledge); g.audio.play('mantle', this); return; }
    }
    this.moving = len > 0.05 || this.sliding;
    stepEntity(w, this, dt);
    if (this.padLaunch && this.vy < 0) { this.padLaunch = false; this.air = 'glide'; g.audio.play('glider', null); }
    if (this.grounded) { this.sprintJump = false; this.padLaunch = false; }
    if (this.landSpeed > 9 && g.fx) g.fx.landing(this.x, this.y, this.z);

    // ---- weapon / interaction
    this.wantFire = this.mouseLeft && !g.build.active && !editing && !this.swimming;
    if (this.wantFire && this.held && this.held.type === 'weapon') this.lastShot = g.time;
    g.combat.update_shooter(this, dt);

    // ---- building: click (or hold) to place
    this.buildCd -= dt;
    if (g.build.active && this.mouseLeft && this.buildCd <= 0 && !this.swimming) { g.build.placeFromUI(this); this.buildCd = 0.12; }
    g.loot.autoPickup(this);
  }
}

Player.prototype.lastShot = -9;
export { clamp };
