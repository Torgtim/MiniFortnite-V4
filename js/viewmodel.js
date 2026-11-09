// First-person weapon model attached to the camera (built from boxes, drawn on top of the world).

import * as THREE from '../lib/three.module.min.js';
import { CLASS_COLORS, RARITIES, weaponStats, ITEM_KINDS } from './weapons.js';

const mats = {};
const mat = (c) => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c, depthTest: false, depthWrite: false }));
const part = (w, h, d, c, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z); m.renderOrder = 999;
  return m;
};

function buildGun(cls) {
  const g = new THREE.Group();
  const body = CLASS_COLORS[cls] || 0x555555, dark = 0x22262c, wood = 0x6b4a2b;
  const stripe = part(0.074, 0.016, 0.2, 0xffffff, 0, 0.056, -0.05); stripe.name = 'stripe';
  switch (cls) {
    case 'pistol':
      g.add(part(0.06, 0.09, 0.24, body, 0, 0, -0.12), part(0.05, 0.11, 0.06, dark, 0, -0.09, -0.02), part(0.03, 0.03, 0.08, dark, 0, 0.02, -0.28)); break;
    case 'smg':
      g.add(part(0.07, 0.1, 0.36, body, 0, 0, -0.18), part(0.04, 0.15, 0.05, dark, 0, -0.12, -0.2), part(0.05, 0.1, 0.06, dark, 0, -0.09, -0.02), part(0.03, 0.03, 0.1, dark, 0, 0.01, -0.42)); break;
    case 'rifle':
      g.add(part(0.07, 0.1, 0.52, body, 0, 0, -0.26), part(0.06, 0.1, 0.2, wood, 0, -0.02, 0.1), part(0.045, 0.16, 0.06, dark, 0, -0.12, -0.26), part(0.03, 0.04, 0.12, dark, 0, 0.0, -0.58), part(0.03, 0.04, 0.04, dark, 0, 0.07, -0.2)); break;
    case 'shotgun':
      g.add(part(0.06, 0.06, 0.6, dark, 0, 0.0, -0.3), part(0.08, 0.07, 0.17, wood, 0, -0.045, -0.3), part(0.07, 0.1, 0.2, body, 0, -0.01, 0.0), part(0.06, 0.09, 0.22, wood, 0, -0.04, 0.2)); break;
    case 'sniper':
      g.add(part(0.06, 0.09, 0.4, body, 0, 0, -0.1), part(0.035, 0.035, 0.55, dark, 0, 0.01, -0.58), part(0.06, 0.07, 0.2, dark, 0, 0.1, -0.1), part(0.06, 0.09, 0.24, wood, 0, -0.03, 0.2)); break;
    default: // launcher
      g.add(part(0.15, 0.15, 0.7, body, 0, 0, -0.3), part(0.05, 0.11, 0.06, dark, 0, -0.12, -0.05), part(0.17, 0.17, 0.06, dark, 0, 0, -0.66)); break;
  }
  g.add(stripe);
  return g;
}

function buildPickaxe() {
  const g = new THREE.Group();
  g.add(part(0.04, 0.04, 0.62, 0x6b4a2b, 0, 0, -0.3), part(0.34, 0.05, 0.05, 0xb0b6bd, 0, 0.02, -0.6), part(0.05, 0.08, 0.05, 0xb0b6bd, 0.18, -0.01, -0.6));
  return g;
}

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.62);
    camera.add(this.root);
    this.guns = {};
    this.pickaxe = buildPickaxe();
    this.item = part(0.12, 0.16, 0.12, 0xffffff, 0, -0.02, -0.25);
    this.root.add(this.pickaxe, this.item);
    // muzzle flash
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.4, 'rgba(255,200,80,0.8)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.22); this.flash.renderOrder = 1000; this.flash.visible = false;
    this.root.add(this.flash);
    this.current = null;
    this.t = 0;
    this.pos = new THREE.Vector3(0.2, -0.17, -0.32);
  }

  _gun(cls) {
    if (!this.guns[cls]) { this.guns[cls] = buildGun(cls); this.root.add(this.guns[cls]); }
    return this.guns[cls];
  }

  update(dt, p, game) {
    this.t += dt;
    for (const k in this.guns) this.guns[k].visible = false;
    this.pickaxe.visible = false; this.item.visible = false;
    const it = p.held;
    let show = null, st = null;
    if (!p.alive || game.build.active || game.edit.active || p.airborne) { this.root.visible = false; return; }
    this.root.visible = true;
    if (!it) { this.root.visible = false; return; }
    if (it.type === 'weapon') {
      st = weaponStats(it);
      show = this._gun(st.cls);
      show.visible = true;
      show.getObjectByName('stripe').material = mat(parseInt(RARITIES[it.rarity].color.slice(1), 16));
    } else if (it.type === 'pickaxe') { show = this.pickaxe; show.visible = true; }
    else { show = this.item; show.visible = true; show.material = mat(parseInt(game.season.items[it.id].color.slice(1), 16)); }

    // pose
    let rx0 = 0;
    const speed = Math.hypot(p.vx, p.vz);
    const bob = p.grounded ? Math.sin(this.t * (p.sprinting ? 13 : 9)) * (p.sprinting ? 0.016 : 0.008) * Math.min(1, speed / 6) : 0;
    if (p.sprinting && !p.ads) { rx0 = -0.35; }
    const tgt = p.ads && st ? new THREE.Vector3(0, -0.075, -0.24) : new THREE.Vector3(0.2, -0.17, -0.32);
    this.pos.lerp(tgt, Math.min(1, dt * 14));
    let rx = rx0, ry = 0, rz = p.sliding ? 0.25 : 0, py = 0, pz = 0;
    this.flash.visible = !!st && p.recoil > 0.75 && p.reloadT <= 0;
    if (this.flash.visible) { this.flash.position.set(0, 0.02, st.cls === 'pistol' ? -0.36 : -0.7); this.flash.material.rotation = Math.random() * 6; }
    if (st) {
      pz += p.recoil * 0.05; rx += p.recoil * 0.07;
      if (p.reloadT > 0) {
        const prog = 1 - p.reloadT / st.reload;
        const dip = Math.sin(prog * Math.PI);
        py -= dip * 0.22; rx -= dip * 0.7; rz += dip * 0.4;
      }
    } else if (it.type === 'pickaxe') {
      const s = p.swingT > 0 ? 1 - p.swingT / 0.3 : 0;
      const sw = Math.sin(s * Math.PI);
      rx -= sw * 1.2; py -= sw * 0.1; pz -= sw * 0.1;
      this.pickaxe.rotation.set(0.3 - sw * 1.0, 0.0, 0.2);
    } else if (it.type === 'item') {
      const k = p.useT > 0 ? 1 : 0;
      py += Math.sin(this.t * 20) * 0.01 * k;
    }
    this.root.position.set(this.pos.x, this.pos.y + bob + py, this.pos.z + pz);
    if (it.type === 'pickaxe') this.root.rotation.set(rx, ry, rz);
    else this.root.rotation.set(rx, ry, rz);
  }
}

export { ITEM_KINDS };
