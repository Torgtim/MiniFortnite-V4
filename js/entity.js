// Shared state + inventory logic for anything that fights: the player and the bots.

import { AMMO, ITEM_KINDS, RARITIES, WEAPONS, weaponStats, makeWeapon } from './weapons.js';
import { PLAYER_H } from './physics.js';

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
    // slot 0 = pickaxe, 1..5 = weapons / healing items
    this.slots = [{ type: 'pickaxe' }, null, null, null, null, null];
    this.slot = 0;
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0, cells: 0 };
    this.mats = { wood: 0, brick: 0, metal: 0 };
    this.fireCd = 0; this.reloadT = 0; this.useT = 0; this.burstLeft = 0;
    this.swingT = 0; this.recoil = 0;
    this.wantFire = false; this.firedHeld = false; this.ads = false;
    this.onFall = (speed) => this.game.combat.damage(this, (speed - 13) * 5, null, 'fall damage');
  }

  get eyeY() { return this.y + 1.62; }
  get held() { return this.slots[this.slot]; }

  selectSlot(i) {
    if (i < 0 || i > 5 || i === this.slot) return;
    this.slot = i;
    this.reloadT = 0; this.useT = 0; this.burstLeft = 0; this.fireCd = Math.max(this.fireCd, 0.25);
    this.recoil = 0;
  }

  /** Put a weapon into the inventory. Returns the weapon that got replaced (to be dropped), or null. */
  giveWeapon(w) {
    for (let i = 1; i <= 5; i++) {
      if (!this.slots[i]) { this.slots[i] = w; return null; }
    }
    // full: replace the held weapon slot, else the lowest-value weapon
    let idx = this.slot >= 1 && this.slots[this.slot] && this.slots[this.slot].type === 'weapon' ? this.slot : -1;
    if (idx < 0) {
      let worst = Infinity;
      for (let i = 1; i <= 5; i++) {
        const s = this.slots[i];
        if (s.type === 'weapon') { const sc = weaponStats(s).dps; if (sc < worst) { worst = sc; idx = i; } }
      }
    }
    if (idx < 0) return w; // inventory is all items; nothing to swap
    const old = this.slots[idx];
    this.slots[idx] = w;
    return old;
  }

  /** Items stack up to 3 per slot. Returns true when picked up. */
  giveItem(id) {
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (s && s.type === 'item' && s.id === id && s.count < 3) { s.count++; return true; }
    }
    for (let i = 1; i <= 5; i++) {
      if (!this.slots[i]) { this.slots[i] = { type: 'item', id, count: 1 }; return true; }
    }
    return false;
  }

  addAmmo(type, n) { this.ammo[type] = Math.min(999, this.ammo[type] + n); }

  hasUsableWeapon() {
    return this.slots.some((s) => s && s.type === 'weapon' && (s.mag > 0 || this.ammo[WEAPONS[s.id].ammo] > 0));
  }

  startReload() {
    const it = this.held;
    if (!it || it.type !== 'weapon' || this.reloadT > 0) return false;
    const st = weaponStats(it);
    if (it.mag >= st.mag || this.ammo[st.ammo] <= 0) return false;
    this.reloadT = st.reload;
    this.burstLeft = 0;
    this.game.audio.play('reload', this);
    return true;
  }

  finishReload() {
    const it = this.held;
    if (!it || it.type !== 'weapon') return;
    const st = weaponStats(it);
    const need = st.mag - it.mag;
    const take = Math.min(need, this.ammo[st.ammo]);
    it.mag += take;
    this.ammo[st.ammo] -= take;
  }

  /** Apply the effect of a consumed healing item. */
  applyItem(slotIdx) {
    const s = this.slots[slotIdx];
    if (!s || s.type !== 'item') return;
    const k = ITEM_KINDS[s.id];
    if (k.hp) this.hp = Math.min(Math.max(this.hp, k.max), this.hp + k.hp);
    if (k.sh) this.shield = Math.min(Math.max(this.shield, k.max), this.shield + k.sh);
    s.count--;
    if (s.count <= 0) this.slots[slotIdx] = null;
    this.game.audio.play('heal', this);
  }

  canUse(slotIdx) {
    const s = this.slots[slotIdx];
    if (!s || s.type !== 'item') return false;
    const k = ITEM_KINDS[s.id];
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
}

export { PLAYER_H, RARITIES, AMMO, makeWeapon };
