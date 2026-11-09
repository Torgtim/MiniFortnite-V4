// Bot opponents. Each bot drops from the bus toward a place it picked, loots, harvests
// materials, rotates with the storm, hears gunfire, fights with range-appropriate weapons,
// builds walls / ramps / boxes, shoots through enemy builds and throws grenades.

import { Entity } from './entity.js?v=48';
import { stepEntity, isFree, findLedge, startMantle, stepMantle } from './physics.js?v=48';
import { WEAPONS, weaponStats, ITEM_KINDS } from './weapons.js?v=48';
import { CharacterModel } from './characters.js?v=48';
import { angleDiff, clamp, dirFromAngles } from './util.js?v=48';

export const BOT_NAMES = ['Skelly', 'Voltage', 'NoScope', 'Pixel', 'Toast', 'Gigabyte', 'Raven', 'Moose', 'Blitz', 'Zed',
  'Cobalt', 'Mango', 'Echo', 'Rusty', 'Nova', 'Spud', 'Ghost', 'Turbo', 'Waffles', 'Ziggy', 'Bonk', 'Glitch',
  'Dial-Up', 'Floppy', 'Modem', 'Tamagotchi', 'Pager', 'Nintendo64', 'Winamp', 'Clippy', 'Geocity', 'Y2K',
  'Pogo', 'Beanie', 'Discman', 'Furby', 'Netscape', 'Walkman', 'Skater', 'Jigsaw'];

const SKILL = [[0.12, 0.42], [0.32, 0.72], [0.6, 0.95]];

/** How good a weapon class is at a given distance (0..1). */
function rangeFit(cls, d) {
  switch (cls) {
    case 'shotgun': return d < 7 ? 1 : d < 14 ? 0.7 : d < 22 ? 0.25 : 0.05;
    case 'smg': return d < 18 ? 0.9 : d < 30 ? 0.55 : 0.2;
    case 'pistol': return d < 25 ? 0.6 : d < 50 ? 0.45 : 0.2;
    case 'rifle': return d < 6 ? 0.55 : d < 70 ? 0.85 : 0.6;
    case 'sniper': return d < 12 ? 0.15 : d < 35 ? 0.55 : 1;
    case 'launcher': return d < 8 ? 0 : d < 60 ? 0.7 : 0.4;
    default: return 0.3;
  }
}
const IDEAL = { pistol: 16, smg: 11, rifle: 24, shotgun: 5, sniper: 55, launcher: 26 };

export class Bot extends Entity {
  constructor(game, name, index, difficulty = 1) {
    super(game, name, false);
    const [lo, hi] = SKILL[clamp(difficulty, 0, 2)];
    this.skill = lo + Math.random() * (hi - lo);
    this.aggro = 0.3 + Math.random() * 0.7;       // how eager it is to take fights / push
    this.builder = Math.random() < 0.35 + this.skill * 0.6; // some bots never build
    this.model = new CharacterModel(index, name);
    this.mesh = this.model.root;
    this.thinkT = Math.random() * 0.3;
    this.mode = 'roam';
    this.goal = null; this.goalT = 0; this.path = [];
    this.enemy = null; this.enemySeen = 0; this.lastSeen = -99; this.enemyPos = null;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.lastX = 0; this.lastZ = 0; this.stuckT = 0; this.unstickT = 0; this.unstickDir = 1; this.stuckCount = 0;
    this.aimErr = { yaw: 0, pitch: 0 }; this.aimSettle = 0;
    this.spreadMult = 1.15 + (1 - this.skill) * 1.5;
    this.blacklist = new Map();
    this.fireRestT = 0; this.fireBurstT = 0;
    this.buildCd = 0; this.rampT = 0; this.boxPlan = null; this.nadeCd = 5;
    this.hunt = null; this.harvestNode = null;
    this.headAim = Math.random() < this.skill * 0.6;
    this.crouchT = 0;
    this.dropTarget = null; this.jumpAlong = 0;
  }

  // ------------------------------------------------------------------ bus
  planDrop(bus, rnd) {
    const w = this.game.world;
    let t;
    if (w.sites.length && rnd() < 0.75) {
      const s = w.sites[Math.floor(rnd() * w.sites.length)];
      t = { x: s.x + (rnd() - 0.5) * 30, z: s.z + (rnd() - 0.5) * 30 };
    } else t = w.randomLandPoint(rnd);
    this.dropTarget = t;
    this.jumpAlong = clamp(bus.along(t.x, t.z) - 30 + (rnd() - 0.5) * 40, 45, bus.len - 10);
  }

  onDamaged(src) {
    if (src && src !== this && src.alive) {
      if (!this.enemy || this.enemy === src || !this.canSee(this.enemy)) { this.enemy = src; this.enemyPos = { x: src.x, y: src.y, z: src.z }; this.lastSeen = this.game.time - 0.5; }
      if (this.mode !== 'fight') this.enemySeen = Math.min(this.enemySeen, this.game.time - 0.2);
      this.wantCover = this.game.time;
    }
  }

  /** Someone made noise (gunshot, explosion, building) at (x,z). */
  hear(x, z, src) {
    if (this.enemy && this.game.time - this.lastSeen < 4) return;
    if (this.mode === 'storm' || this.mode === 'heal') return;
    if (Math.random() > this.aggro * 0.8) return;
    this.hunt = { x, z, until: this.game.time + 10, src };
  }

  canSee(o) {
    return this.game.combat.los(this.x, this.eyeY, this.z, o.x, o.y + o.h * 0.6, o.z);
  }

  // ------------------------------------------------------------------ decision making (a few times a second)
  think() {
    const g = this.game, now = g.time;
    const prevMode = this.mode;
    g.loot.autoPickup(this);

    // 1) perception: closest visible enemy (things behind us far away are noticed less)
    let best = null, bd = 90 * 90;
    for (const o of g.entities) {
      if (o === this || !o.alive || o.untargetable || o.air === 'bus') continue;
      const dx = o.x - this.x, dz = o.z - this.z, d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      const behind = Math.abs(angleDiff(this.yaw, Math.atan2(-dx, -dz))) > 1.9;
      if (behind && d2 > 25 * 25 && o !== this.enemy && o !== this.lastAttacker && Math.random() > 0.3) continue;
      if (!this.canSee(o)) continue;
      const score = d2 * (o === this.lastAttacker && now - this.lastDamaged < 3 ? 0.4 : 1);
      if (score < bd) { bd = score; best = o; }
    }
    if (best) {
      if (this.enemy !== best) { this.enemy = best; this.enemySeen = now; this.aimSettle = 0; }
      this.lastSeen = now;
      this.enemyPos = { x: best.x, y: best.y, z: best.z };
      this.hunt = null;
    } else if (this.enemy && (!this.enemy.alive || now - this.lastSeen > 7)) this.enemy = null;
    const visible = !!best;
    const dist = this.enemy ? Math.hypot(this.enemy.x - this.x, this.enemy.z - this.z) : 999;

    // 2) weapon for the current range
    let bi = -1, bs = -1;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (!s || s.type !== 'weapon') continue;
      const st = weaponStats(s);
      if (s.mag <= 0 && this.ammo[st.ammo] <= 0) continue;
      const sc = (st.dps * 0.02 + s.rarity * 0.15 + 1) * rangeFit(st.cls, this.enemy ? dist : 30) * (s.mag > 0 ? 1 : 0.6);
      if (sc > bs) { bs = sc; bi = i; }
    }
    const hasGun = bi > 0;
    const nadeSlot = this.slots.findIndex((s, i) => i > 0 && s && s.type === 'item' && ITEM_KINDS[s.id].blast);

    // 3) heal when nobody is shooting at us (box up first if a fight is near)
    this.healing = false;
    const recentlyHit = now - this.lastDamaged < 2.5;
    const hurt = this.hp < 70 || this.shield < 40;
    if (hurt && (!visible || this.boxed) && !recentlyHit) {
      // shields first when healthy, health first when low
      const order = [];
      for (let i = 1; i <= 5; i++) { const k = this.slots[i] && ITEM_KINDS[this.slots[i].id]; if (k && (k.hp || k.sh) && this.canUse(i)) order.push(i); }
      order.sort((a, b) => {
        const ka = ITEM_KINDS[this.slots[a].id], kb = ITEM_KINDS[this.slots[b].id];
        const va = this.hp < 50 ? (ka.hp ? 1 : 0) : (ka.sh ? 1 : 0), vb = this.hp < 50 ? (kb.hp ? 1 : 0) : (kb.sh ? 1 : 0);
        return vb - va;
      });
      if (order.length) {
        if (this.boxPlan) { /* already boxing up */ }
        else if (this.enemy && now - this.lastSeen < 8 && this.builder && !this.boxed && this.totalMats() >= 50) this.planBox();
        else { if (this.slot !== order[0]) this.selectSlot(order[0]); this.healing = true; }
      }
    }

    // 4) high-level mode
    const st = g.storm;
    const toC = Math.hypot(this.x - st.toX, this.z - st.toZ);
    const travel = Math.max(0, toC - st.toR * 0.8) / 8;
    const outside = st.outside(this.x, this.z);
    const inDanger = outside || (st.state === 'shrinking' && Math.hypot(this.x - st.cx, this.z - st.cz) > st.r - 8);
    const rotateNow = st.state === 'waiting' && toC > st.toR - 4 && st.timeLeft < travel + 8 + (1 - this.skill) * 6;

    // far outside the storm with a sky portal? rift out and glide to safety
    if (outside && toC - st.toR > 55) {
      const ri = this.slots.findIndex((q, i) => i > 0 && q && q.type === 'item' && q.id === 'rift');
      if (ri > 0) { this.dropTarget = { x: st.toX, z: st.toZ }; g.gadgets.use(this, ri); return; }
    }
    // box fighting: in our own box with an enemy around -> edit a window, peek, close it again
    if (this.boxed && !this.healing && this.enemy && now - this.lastSeen < 8 && dist < 40 && hasGun) {
      if (this.peek && now > this.peek.until) {
        if (!this.peek.piece.dead) g.build.applyEdit(this.peek.piece, { removed: [] });
        this.peek = null; this.peekCd = now + 1.5 + Math.random() * 2;
      } else if (!this.peek && now > (this.peekCd || 0)) {
        const ex = this.enemyPos ? this.enemyPos.x : this.enemy.x, ez = this.enemyPos ? this.enemyPos.z : this.enemy.z;
        const yaw = this.snapYaw(Math.atan2(-(ex - this.x), -(ez - this.z)));
        const c = g.build.compute(this, 'wall', yaw, 0);
        const wall = g.build.byKey.get(c.key);
        if (wall && wall.owner === this && !wall.dead) {
          g.build.applyEdit(wall, { removed: [4] });
          this.peek = { piece: wall, until: now + 2 + Math.random() * 1.5 };
        }
      }
    } else if (this.peek) {
      if (!this.peek.piece.dead) g.build.applyEdit(this.peek.piece, { removed: [] });
      this.peek = null;
    }
    // badly hurt with nothing to heal: run, and build walls behind us
    const lowNoHeal = this.hp + this.shield < 35 && !this.slots.some((q, i) => i > 0 && q && q.type === 'item' && (ITEM_KINDS[q.id].hp || ITEM_KINDS[q.id].sh));
    if (!this.boxed && visible && dist < 30 && lowNoHeal && !(this.enemy.hp + this.enemy.shield < 40)) {
      this.mode = 'flee';
      this.goal = { x: this.x - (this.enemy.x - this.x) * 2, z: this.z - (this.enemy.z - this.z) * 2, kind: 'flee' }; this.goalT = 4; this.path = [];
      if (this.builder && this.buildCd <= 0 && this.totalMats() >= 10 && Math.random() < 0.6) { if (this.buildWallToward(this.enemy.x, this.enemy.z)) this.buildCd = 1.2; }
      return;
    }
    if (this.boxPlan) this.mode = 'box';
    else if (this.healing) { this.mode = 'heal'; this.goal = null; }
    else if ((inDanger || rotateNow) && !(this.enemy && visible && dist < 18 && !outside)) {
      this.mode = 'storm';
      if (!this.goal || this.goal.kind !== 'storm' || this.goalT <= 0) {
        const a = Math.atan2(this.z - st.toZ, this.x - st.toX), r = st.toR * (0.3 + Math.random() * 0.4);
        this.goal = { x: st.toX + Math.cos(a) * r, z: st.toZ + Math.sin(a) * r, kind: 'storm' }; this.goalT = 10; this.path = [];
      }
    } else if (this.enemy && hasGun && (visible || now - this.lastSeen < 5)) this.mode = 'fight';
    else if (this.enemy && !hasGun && visible && dist < 30) {
      this.mode = 'flee';
      this.goal = { x: this.x - (this.enemy.x - this.x), z: this.z - (this.enemy.z - this.z), kind: 'flee' }; this.goalT = 3; this.path = [];
    } else if (this.hunt && now < this.hunt.until && hasGun) {
      this.mode = 'hunt';
      if (!this.goal || this.goal.kind !== 'hunt') { this.goal = { x: this.hunt.x, z: this.hunt.z, kind: 'hunt' }; this.goalT = 10; this.path = []; }
    } else {
      this.hunt = null;
      const t = this.goal && this.goal.target;
      const stillThere = prevMode === 'loot' && t && this.goalT > 0 && (t.kind === 'c' ? !t.ref.opened : g.loot.pickups.includes(t.ref));
      const wantGun = !hasGun || bs < 0.5;
      if (stillThere) this.mode = 'loot';
      else if (this.mode === 'harvest' && this.harvestNode && !this.harvestNode.dead && this.totalMats() < 260) { /* keep harvesting */ }
      else if (this.builder && hasGun && this.totalMats() < 120 && Math.random() < 0.7 && (this.harvestNode = this.findNode())) {
        // armed but broke: farm some materials before looting more
        this.mode = 'harvest'; this.harvestT = 0; this.goal = { x: this.harvestNode.x, z: this.harvestNode.z, kind: 'harvest' }; this.goalT = 12; this.path = [];
      } else {
        const target = this.findLoot(wantGun);
        if (target) { this.mode = 'loot'; this.goal = { x: target.x, z: target.z, target, kind: 'loot' }; this.goalT = 14; this.path = []; }
        else if (this.builder && this.totalMats() < 120 && (this.harvestNode = this.findNode())) {
          this.mode = 'harvest'; this.harvestT = 0; this.goal = { x: this.harvestNode.x, z: this.harvestNode.z, kind: 'harvest' }; this.goalT = 12; this.path = [];
        } else if (!this.goal || this.goal.target || this.goal.kind !== 'roam' || this.goalT <= 0 || Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 3) {
          this.mode = 'roam';
          const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 45;
          let gx = this.x + Math.cos(a) * r, gz = this.z + Math.sin(a) * r;
          if (Math.hypot(gx - st.toX, gz - st.toZ) > st.toR * 0.8) { gx = st.toX + (Math.random() - 0.5) * st.toR; gz = st.toZ + (Math.random() - 0.5) * st.toR; }
          this.goal = { x: gx, z: gz, kind: 'roam' }; this.goalT = 12; this.path = [];
        } else this.mode = 'roam';
      }
    }

    // 5) weapon in hand for the mode
    if (this.mode === 'harvest' || (!hasGun && this.mode !== 'heal')) { if (this.slot !== 0 && !this.healing) this.selectSlot(0); }
    else if (this.mode !== 'heal' && this.mode !== 'box' && hasGun && this.slot !== bi && this.reloadT <= 0) {
      // don't swap every think: only when the new pick is clearly better
      const cur = this.held && this.held.type === 'weapon' ? this.held : null;
      const curSc = cur ? (rangeFit(WEAPONS[cur.id].cls, this.enemy ? dist : 30) * (cur.mag > 0 ? 1 : 0.6)) : -1;
      if (!cur || bs > curSc * 1.25 + 0.05) this.selectSlot(bi);
    }

    // 6) grenade at someone hiding behind cover
    this.nadeCd -= 0.25;
    if (nadeSlot > 0 && this.mode === 'fight' && !visible && this.enemyPos && this.nadeCd <= 0 && dist > 7 && dist < 32 && Math.random() < 0.5) {
      this.throwAt = { slot: nadeSlot, x: this.enemyPos.x, y: this.enemyPos.y, z: this.enemyPos.z };
      this.nadeCd = 7 + Math.random() * 6;
    }

    // 7) grab nearby loot we want
    const near = g.loot.nearestInteractable(this, 2.4);
    if (near && this.mode !== 'fight') {
      if (near.type === 'chest' || near.type === 'box') g.loot.interact(this, near);
      else {
        const p = near.p;
        const want = p.kind === 'item' ? this.itemWanted(p.itemId) : this.weaponWanted(p.inst);
        if (want && g.loot.interact(this, near)) this.blacklist.clear();
      }
    }
    if (this.mode !== 'fight' && this.reloadT <= 0 && this.held && this.held.type === 'weapon' && this.held.mag < weaponStats(this.held).mag * 0.5) this.startReload();
    if (this.boxed && (now - this.boxed > 9 || !this.enemy)) this.boxed = 0;
  }

  totalMats() { return this.mats.wood + this.mats.brick + this.mats.metal; }

  itemWanted(id) {
    const k = ITEM_KINDS[id];
    let have = 0;
    for (let i = 1; i <= 5; i++) { const s = this.slots[i]; if (s && s.type === 'item' && s.id === id) have += s.count; }
    if (have >= (k.stack || 3)) return false;
    if (k.gadget === 'rift') return have < 1;
    if (k.heal) return false; // area heals: leave them for the player
    return !!(k.hp || k.sh || k.throw);
  }

  weaponWanted(inst) {
    const sc = this.weaponScore(inst);
    let worst = Infinity, free = false, sameCls = null;
    const cls = WEAPONS[inst.id].cls;
    for (let i = 1; i <= 5; i++) {
      const s = this.slots[i];
      if (!s) free = true;
      else if (s.type === 'weapon') { worst = Math.min(worst, this.weaponScore(s)); if (WEAPONS[s.id].cls === cls) sameCls = s; }
    }
    if (sameCls) return sc > this.weaponScore(sameCls) + 8;
    if (free) return true;
    return sc > worst + 6;
  }

  findLoot(wantGun) {
    const g = this.game, now = g.time;
    let best = null, bd = 70 * 70;
    const consider = (o, kind, bias = 1) => {
      const bl = this.blacklist.get(o);
      if (bl && bl > now) return;
      if (o.y - this.y > 2.5) return; // up a tower / on a roof: not worth the climb
      const dx = o.x - this.x, dz = o.z - this.z, d = (dx * dx + dz * dz) * bias;
      if (d < bd) { bd = d; best = { x: o.x, z: o.z, y: o.y, ref: o, kind }; }
    };
    for (const p of g.loot.pickups) {
      if (p.kind === 'weapon' && (wantGun || this.weaponWanted(p.inst))) consider(p, 'p', wantGun ? 0.6 : 1);
      else if (p.kind === 'ammo') { const hasUser = this.slots.some((s) => s && s.type === 'weapon' && WEAPONS[s.id].ammo === p.type); if (hasUser && this.ammo[p.type] < 90) consider(p, 'p'); }
      else if (p.kind === 'item' && this.itemWanted(p.itemId) && !wantGun) consider(p, 'p');
      else if (p.kind === 'mats' && this.builder && this.totalMats() < 400) consider(p, 'p', 0.8);
    }
    for (const c of g.loot.chests) if (!c.opened && (wantGun || Math.random() < 0.5)) consider(c, 'c', c.supply ? 0.25 : 0.7);
    if (best) this.blacklist.set(best.ref, now + 25);
    return best;
  }

  findNode() {
    const w = this.game.world;
    let best = null, bd = 45 * 45;
    const now = this.game.time;
    for (const n of w.nodes) {
      if (n.dead) continue;
      const bl = this.blacklist.get(n);
      if (bl && bl > now) continue;
      const d = (n.x - this.x) ** 2 + (n.z - this.z) ** 2;
      const k = n.res === 'wood' ? 0.7 : 1;
      if (d * k < bd) { bd = d * k; best = n; }
    }
    return best;
  }

  // ------------------------------------------------------------------ building helpers
  /** Face direction snapped to the grid axis closest to the given angle. */
  snapYaw(yaw) { return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); }

  buildWallToward(tx, tz) {
    const yaw = Math.atan2(-(tx - this.x), -(tz - this.z));
    return this.game.build.placeFor(this, 'wall', yaw, 0);
  }

  planBox() {
    const base = this.snapYaw(this.yaw);
    this.boxPlan = [
      ['wall', base], ['wall', base + Math.PI / 2], ['wall', base + Math.PI], ['wall', base - Math.PI / 2], ['cone', base, 0.4],
    ];
    this.boxT = 0;
    // stand in the middle of the cell so the walls go around us
    const CS = 4;
    this.boxCenter = { x: (Math.floor(this.x / CS) + 0.5) * CS, z: (Math.floor(this.z / CS) + 0.5) * CS };
  }

  // ------------------------------------------------------------------ per-frame movement + shooting
  _hazard(w, x, z) {
    const liq = w.season.liquid;
    return !!(liq && liq.dps >= 3 && w.heightAt(x, z) < w.liquidY);
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, w = g.world;
    if (this.dummy) {
      // practice target: strafes slowly left and right, never shoots back
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 1.2 + Math.random() * 1.5; }
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      this.vx = rx * this.strafe * 2.5; this.vz = rz * this.strafe * 2.5;
      stepEntity(w, this, dt);
      if (Math.random() < dt * 0.3 && this.grounded) { this.vy = 7; this.grounded = false; }
      this.animateModel(dt);
      if (this.model.tag) this.model.tag.visible = true;
      return;
    }

    // ---- bus / sky
    if (this.air === 'bus') {
      if (g.bus.dist >= this.jumpAlong && g.bus.canDrop) this.jumpFromBus();
      this.animateModel(dt);
      return;
    }
    if (this.air) {
      const t = this.dropTarget || { x: 0, z: 0 };
      let dx = t.x - this.x, dz = t.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      const ty = Math.atan2(-dx, -dz);
      this.yaw += clamp(angleDiff(this.yaw, ty), -dt * 3, dt * 3);
      const k = clamp(d / 30, 0, 1);
      this.airStep(dt, dx / d * k, dz / d * k, d > 40 ? 1 : 0.3);
      this.animateModel(dt);
      return;
    }
    if (this.mantle) { stepMantle(w, this, dt); this.animateModel(dt); return; }

    if (this.emoteT > 0) {
      this.emoteT -= dt;
      const danger = g.time - this.lastDamaged < 1 || g.storm.outside(this.x, this.z);
      if (!danger) {
        this.vx *= 0.8; this.vz *= 0.8; stepEntity(w, this, dt);
        this.wantFire = false; this.animateModel(dt);
        return;
      }
      this.emoteT = 0;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.18 + Math.random() * 0.14; this.think(); }
    this.goalT -= dt;
    this.strafeT -= dt;
    this.buildCd -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0.35 + Math.random() * (1.4 - this.skill * 0.8); }

    let wx = 0, wz = 0, speed = 6;
    this.wantFire = false;
    this.aiming = false;
    this.sprinting = false;
    let crouch = false;
    const held = this.held;
    const st = held && held.type === 'weapon' ? weaponStats(held) : null;

    if (this.throwAt) {
      // lob a grenade toward the last known position
      const t = this.throwAt; this.throwAt = null;
      if (this.slots[t.slot] && ITEM_KINDS[this.slots[t.slot].id] && ITEM_KINDS[this.slots[t.slot].id].throw) {
        const dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = clamp(0.12 + d * 0.012 + (t.y - this.y) * 0.02, -0.2, 0.8);
        g.combat.throwNade(this, t.slot);
      }
    }

    if (this.mode === 'box' && this.boxPlan) {
      // walk to the cell centre, then place the pieces one by one
      const c = this.boxCenter;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d > 0.6 && this.boxT < 1.2) { wx = (c.x - this.x) / d; wz = (c.z - this.z) / d; speed = 4; this.boxT += dt; }
      else if (this.buildCd <= 0) {
        const [type, yaw, pitch] = this.boxPlan.shift();
        g.build.placeFor(this, type, yaw, pitch || 0);
        this.buildCd = 0.16 + (1 - this.skill) * 0.2;
        if (!this.boxPlan.length) { this.boxPlan = null; this.boxed = g.time; this.mode = 'heal'; }
      }
    } else if (this.mode === 'fight' && this.enemy && this.enemy.alive && st) {
      const r = this.fight(dt, st, held);
      wx = r.wx; wz = r.wz; speed = r.speed; crouch = r.crouch;
    } else if (this.mode === 'heal') {
      speed = 0;
      this.wantFire = true;
      crouch = true;
    } else if (this.mode === 'harvest' && this.harvestNode && !this.harvestNode.dead) {
      const n = this.harvestNode;
      this.harvestT = (this.harvestT || 0) + dt;
      if (this.harvestT > 14) { this.blacklist.set(n, this.game.time + 40); this.harvestNode = null; this.harvestT = 0; this.mode = 'roam'; this.goal = null; }
      const dx = n.x - this.x, dz = n.z - this.z, d = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      this.yaw += clamp(angleDiff(this.yaw, want), -dt * 8, dt * 8);
      const reach = (n.collider.maxx - n.collider.minx) / 2 + 1.6;
      if (d > reach) { wx = dx / d; wz = dz / d; speed = 7; }
      else {
        this.pitch += (clamp(Math.atan2(n.y + 1 - this.eyeY, d), -0.6, 0.6) - this.pitch) * Math.min(1, dt * 6);
        speed = 0; this.wantFire = this.slot === 0;
        if (this.totalMats() > 280) this.harvestNode = null;
      }
    } else if (this.goal) {
      const wp = this.nextWaypoint();
      const dx = wp.x - this.x, dz = wp.z - this.z, dist = Math.hypot(dx, dz);
      if (dist > 1.2) {
        const want = Math.atan2(-dx, -dz);
        this.yaw += clamp(angleDiff(this.yaw, want), -dt * 7, dt * 7);
        this.pitch += (0 - this.pitch) * Math.min(1, dt * 5);
        wx = dx / dist; wz = dz / dist;
        const urgent = this.mode === 'storm' || this.mode === 'flee' || this.mode === 'hunt';
        speed = urgent || dist > 12 ? 8.6 : 6.4;
        this.sprinting = speed > 8;
      } else if (wp === this.goal) this.goalT = 0;
      else this.path.shift();
      if (this.goal && this.goal.target && this.goal.target.ref) {
        const r = this.goal.target.ref;
        if ((r.opened) || (r.kind && !g.loot.pickups.includes(r))) { this.goalT = 0; this.goal = null; }
      }
    }

    // ---- something built in our way? break it (or edit a door into our own wall)
    if (this.breakT && (this.breakT.until < g.time || this.breakT.piece.dead)) this.breakT = null;
    if (this.breakT && this.mode !== 'fight') {
      const pc = this.breakT.piece;
      const dx = pc.x - this.x, dz = pc.z - this.z, d = Math.hypot(dx, dz);
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = clamp(Math.atan2(pc.y - this.eyeY, d), -0.8, 0.8);
      const h = this.held;
      const canShoot = h && h.type === 'weapon' && (h.mag > 0 || this.ammo[WEAPONS[h.id].ammo] > 0) && WEAPONS[h.id].cls !== 'launcher';
      if (!canShoot && this.slot !== 0) this.selectSlot(0);
      if (this.slot === 0 && d > 2.4) { wx = dx / d; wz = dz / d; speed = 4; } else { wx = 0; wz = 0; speed = 0; this.wantFire = true; }
    }
    const goalX = wx, goalZ = wz;

    // ---- steering with feelers + stuck handling (+ mantling, + ramps over cliffs)
    const len = Math.hypot(wx, wz);
    if (len > 0.01) {
      wx /= len; wz /= len;
      if (this.unstickT > 0) {
        this.unstickT -= dt;
        const a = Math.atan2(wz, wx) + this.unstickDir * 1.2;
        wx = Math.cos(a); wz = Math.sin(a);
      } else {
        let ok = false;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const a = Math.atan2(wz, wx) + off;
          const cx = Math.cos(a), cz = Math.sin(a);
          if (isFree(w, this.x + cx * 1.1, this.z + cz * 1.1, this.y, this.h) && isFree(w, this.x + cx * 2.2, this.z + cz * 2.2, this.y, this.h)
            && !this._hazard(w, this.x + cx * 2.4, this.z + cz * 2.4) && !this._hazard(w, this.x + cx * 4.5, this.z + cz * 4.5)) { wx = cx; wz = cz; ok = true; break; }
        }
        if (!ok && this.grounded) {
          const ledge = findLedge(w, this, wx, wz, 2.75, true);
          if (ledge) { startMantle(this, ledge); this.animateModel(dt); return; }
          this.vy = 7.2; this.grounded = false;
        }
      }
    }
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.stuckT += dt;
    if (this.stuckT > 0.7) {
      if (len > 0.01 && moved < 0.5 && speed > 0) {
        this.stuckCount++;
        this.unstickT = 0.9; this.unstickDir = Math.random() < 0.5 ? -1 : 1;
        if (this.goal && this.goalT > 3) this.goalT -= 2;
        const gl = Math.hypot(goalX, goalZ) || 1;
        const blocker = this.blockingPiece(goalX / gl, goalZ / gl);
        if (blocker) {
          // our own wall (e.g. we boxed up): edit a door into it. Anybody else's: break it.
          if (blocker.owner === this && blocker.type === 'wall') {
            g.build.applyEdit(blocker, { removed: [1, 4] });
            this.unstickT = 0;
            // walk straight through the new door
            const c = blocker.c, ax = c.axis === 'z';
            const side = ax ? Math.sign(c.cx - this.x) || 1 : Math.sign(c.cz - this.z) || 1;
            const pt = (k) => (ax ? { x: c.cx + side * k, z: c.cz } : { x: c.cx, z: c.cz + side * k });
            this.path = [pt(-0.9), pt(1.6)].concat(this.goal ? [this.goal] : []);
          }
          else if (!this.breakT) this.breakT = { piece: blocker, until: g.time + 4 };
        } else if (this.stuckCount >= 2 && this.builder && this.totalMats() >= 10 && this.buildCd <= 0) {
          // stuck at a cliff? build our way up
          const yaw = this.snapYaw(Math.atan2(-wx, -wz));
          if (g.build.placeFor(this, 'ramp', yaw, 0)) { this.unstickT = 0; this.buildCd = 0.8; }
        }
      } else this.stuckCount = 0;
      this.stuckT = 0; this.lastX = this.x; this.lastZ = this.z;
    }

    // ---- crouch (healing, careful shots)
    if (crouch !== this.crouch) { if (crouch || isFree(w, this.x, this.z, this.y, 1.8)) this.setCrouch(crouch); }

    // ---- apply velocity + physics
    const liq = w.liquidAt(this.x, this.z, this.y + 0.2);
    let sp = liq && liq.type !== 'lava' ? speed * 0.6 : speed;
    if (this.crouch) sp = Math.min(sp, 3.4);
    const onIce = this.grounded && !this.swimming && w.iceAt(this.x, this.z, this.y);
    const k = Math.min(1, dt * (onIce ? 1.6 : this.grounded ? 12 : 3));
    this.vx += (wx * sp - this.vx) * k;
    this.vz += (wz * sp - this.vz) * k;
    stepEntity(w, this, dt);
    if (this.padLaunch && this.vy < 0) { this.padLaunch = false; this.air = 'glide'; this.dropTarget = { x: this.x + this.vx * 3, z: this.z + this.vz * 3 }; }
    if (this.grounded) this.padLaunch = false;
    this.moving = len > 0.01 && speed > 0;

    if (this.swimming) this.wantFire = false;
    g.combat.update_shooter(this, dt);
    this.animateModel(dt);
    const pl = g.player;
    if (this.model.tag) this.model.tag.visible = !!pl && Math.hypot(pl.x - this.x, pl.z - this.z) < 40;
  }

  /** Would an explosive fired right now hit something within blast range of ourselves? */
  blastTooClose() {
    const d = dirFromAngles(this.yaw, this.pitch);
    const hit = this.game.world.raycast(this.x, this.eyeY, this.z, d.x, d.y, d.z, 9, 1.0);
    return hit.t < 9;
  }

  /** First build piece directly in front of us (waist height), if any. */
  blockingPiece(dx, dz) {
    const hit = this.game.world.raycast(this.x, this.y + 0.9, this.z, dx, 0, dz, 1.8, 2.0);
    const pc = hit.collider && hit.collider.piece;
    return pc && !pc.dead ? pc : null;
  }

  /** Route around building walls: go through the door when the goal is inside a house. */
  nextWaypoint() {
    const goal = this.goal;
    if (!this.path.length && goal) {
      const w = this.game.world;
      const inside = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
      for (const b of w.buildings) {
        const gi = inside(b, goal.x, goal.z), si = inside(b, this.x, this.z);
        if (gi && !si) { this.path = [{ x: b.door.ox, z: b.door.oz }, { x: b.door.x, z: b.door.z }]; break; }
        if (!gi && si) { this.path = [{ x: b.door.x, z: b.door.z }, { x: b.door.ox, z: b.door.oz }]; break; }
      }
      if (!this.path.length) this.path = [goal];
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - this.x, this.path[0].z - this.z) < 1.3) this.path.shift();
    return this.path[0] || goal;
  }

  /** Combat movement + aiming + trigger + build fighting. */
  fight(dt, st, held) {
    const g = this.game, e = this.enemy, now = g.time;
    const visible = now - this.lastSeen < 0.4;
    const tgt = visible ? e : this.enemyPos;
    const dx = tgt.x - this.x, dz = tgt.z - this.z, dist = Math.hypot(dx, dz);
    this.aiming = true;
    let wx = 0, wz = 0, speed = 5.4, crouch = false;

    // where to aim: chest or head, or the build that blocks our view
    let ay = tgt.y + (e.h || 1.8) * (this.headAim ? 0.9 : 0.62);
    let aimX = tgt.x, aimZ = tgt.z;
    let shootBuild = false;
    if (!visible) {
      const d0 = Math.hypot(dx, ay - this.eyeY, dz) || 1;
      const hit = g.world.raycast(this.x, this.eyeY, this.z, dx / d0, (ay - this.eyeY) / d0, dz / d0, d0, 2.0);
      const pc = hit.collider && hit.collider.piece;
      if (pc && pc.owner !== this && hit.t < Math.min(st.range, 60)) {
        aimX = pc.x; ay = pc.y; aimZ = pc.z; shootBuild = true;
      }
    }
    if (st.proj && visible) {
      // lead moving targets (projectiles take time to arrive)
      const tt = Math.hypot(aimX - this.x, aimZ - this.z) / st.proj.speed * (0.6 + this.skill * 0.4);
      aimX += (e.vx || 0) * tt; aimZ += (e.vz || 0) * tt;
      ay += 0.5 * (st.proj.grav || 0) * tt * tt; // and aim a little higher for the drop
    }
    const adx = aimX - this.x, adz = aimZ - this.z, ad = Math.hypot(adx, adz) || 1;
    const wantYaw = Math.atan2(-adx, -adz);
    const wantPitch = Math.atan2(ay - this.eyeY, ad);

    // aim error: big when the target is new / moving sideways, settles while tracking
    this.aimSettle = Math.min(1, this.aimSettle + dt * (0.4 + this.skill * 1.2));
    const lat = Math.abs((e.vx || 0) * Math.cos(wantYaw) - (e.vz || 0) * Math.sin(wantYaw));
    const errMag = (0.02 + (1 - this.skill) * 0.09) * (1.6 - this.aimSettle) + lat * 0.004 * (1 - this.skill * 0.5);
    this.aimErrT = (this.aimErrT || 0) - dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = 0.25 + Math.random() * 0.35;
      this.aimErr.yaw = (Math.random() - 0.5) * 2 * errMag;
      this.aimErr.pitch = (Math.random() - 0.5) * errMag;
    }
    const turn = (3 + this.skill * 8) * dt;
    this.yaw += clamp(angleDiff(this.yaw, wantYaw + this.aimErr.yaw), -turn, turn);
    this.pitch += clamp(wantPitch + this.aimErr.pitch - this.pitch, -turn, turn);
    const aimed = Math.abs(angleDiff(this.yaw, wantYaw)) < 0.1 + (1 - this.skill) * 0.12;
    const react = now - this.enemySeen > 0.25 + (1 - this.skill) * 0.65;

    // ---- movement: hold the ideal distance, strafe, sometimes jump / crouch
    const ideal = (IDEAL[st.cls] || 18) * (1.25 - this.aggro * 0.5);
    let fwd = dist > ideal * 1.3 ? 1 : dist < ideal * 0.6 ? -1 : 0;
    if (!visible && !shootBuild) fwd = this.boxed ? 0 : 1; // push to where we last saw them (unless we boxed up)
    const lowEnemy = e.hp + e.shield < 60 && this.aggro > 0.5;
    if (lowEnemy && visible) fwd = 1;
    const fx = -Math.sin(wantYaw), fz = -Math.cos(wantYaw), sx = Math.cos(wantYaw) * this.strafe, sz = -Math.sin(wantYaw) * this.strafe;
    wx = fx * fwd * 0.9 + sx * 0.75;
    wz = fz * fwd * 0.9 + sz * 0.75;
    if (st.cls === 'sniper' && visible && dist > 30) { wx *= 0.2; wz *= 0.2; crouch = this.skill > 0.4; }
    if (this.grounded && visible && Math.random() < dt * (0.15 + this.skill * 0.5)) { this.vy = 7.4; this.grounded = false; }

    // ---- building in fights
    if (this.builder && this.buildCd <= 0 && this.totalMats() >= 10) {
      const higher = e.y - this.y;
      if (this.wantCover && now - this.wantCover < 2.5 && visible && dist > 6 && Math.random() < 0.4 + this.skill * 0.5) {
        // pop a wall between us and them
        if (this.buildWallToward(e.x, e.z)) this.buildCd = 1.0 + Math.random() * (1.4 - this.skill);
        this.wantCover = 0;
      } else if (higher > 2.6 && dist < 26 && Math.random() < 0.6) {
        // ramp-rush up to them (ramp + wall)
        const yaw = this.snapYaw(wantYaw);
        if (g.build.placeFor(this, 'ramp', yaw, 0)) {
          if (Math.random() < 0.5) g.build.placeFor(this, 'wall', yaw, 0.7);
          this.buildCd = 0.45;
        } else this.buildCd = 0.3;
        wx = fx; wz = fz; speed = 6.2;
      }
    }

    // ---- trigger discipline
    if (aimed && react && (visible || shootBuild) && dist < st.range * 0.8 && held.mag > 0) {
      if (st.cls === 'launcher' && (dist < 7 || this.blastTooClose())) this.wantFire = false;
      else if (st.auto) {
        this.fireBurstT -= dt;
        if (this.fireBurstT <= 0) { this.fireRestT = 0.2 + Math.random() * 0.35 * (1.3 - this.skill); this.fireBurstT = 0.5 + Math.random() * 0.9; }
        this.fireRestT -= dt;
        this.wantFire = this.fireRestT <= 0;
      } else this.wantFire = st.cls === 'sniper' ? this.aimSettle > 0.7 : Math.random() < 0.85;
    }
    if (held.mag === 0 && this.reloadT <= 0) this.startReload();
    if (this.reloadT > 0 && visible && this.builder && this.buildCd <= 0 && dist < 25 && this.totalMats() >= 10 && Math.random() < this.skill * 0.5) {
      if (this.buildWallToward(e.x, e.z)) this.buildCd = 1.5;
    }
    return { wx, wz, speed, crouch };
  }
}
