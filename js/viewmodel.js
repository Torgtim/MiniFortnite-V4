// First-person weapon model attached to the camera.
// The guns come from gunmodels.js (same detailed models the characters hold). To stop the
// gun from poking into walls it is drawn last with a fresh depth buffer: an invisible
// "sentinel" mesh clears depth right before the viewmodel meshes render (they are all in
// the transparent queue with a high renderOrder, so they come after the whole world).

import * as THREE from '../lib/three.module.min.js?v=46';
import { weaponStats, ITEM_KINDS } from './weapons.js?v=46';
import { buildGunModel, setGunRarity } from './gunmodels.js?v=46';

const ORDER = 1000;
// Weapons with at least this zoom have a scope: the 3D model is hidden while aiming so its scope tube cannot block the view.
const SCOPE_ZOOM = 1.5; // every weapon with a real scope hides its (scoped) 3D model while aiming
const vmMat = (m) => { m.transparent = true; m.depthTest = true; m.depthWrite = true; return m; };
const MATS = {
  lit: vmMat(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
  glow: vmMat(new THREE.MeshBasicMaterial({ vertexColors: true })),
};
const colorMats = {};
const mat = (c) => colorMats[c] || (colorMats[c] = vmMat(new THREE.MeshLambertMaterial({ color: c })));
const part = (w, h, d, c, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z);
  return m;
};

function buildPickaxe() {
  const g = new THREE.Group();
  g.add(part(0.045, 0.045, 0.62, 0x6b4a2b, 0, 0, -0.3), part(0.05, 0.05, 0.12, 0x2a2a2a, 0, 0, -0.02),
    part(0.36, 0.06, 0.06, 0xb0b6bd, 0, 0.02, -0.6), part(0.07, 0.09, 0.07, 0x8a9098, 0.19, -0.01, -0.6), part(0.07, 0.09, 0.07, 0x8a9098, -0.19, -0.01, -0.6));
  return g;
}

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.5);
    camera.add(this.root);

    // clears the depth buffer just before the viewmodel draws
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.sentinel = new THREE.Mesh(sg, vmMat(new THREE.MeshBasicMaterial({ colorWrite: false })));
    this.sentinel.renderOrder = ORDER - 1;
    this.sentinel.frustumCulled = false;
    this.sentinel.onBeforeRender = (renderer) => renderer.clearDepth();
    this.root.add(this.sentinel);

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
    this.flash.scale.setScalar(0.3); this.flash.visible = false;
    this.root.add(this.flash);
    // arms + gloves (sleeve colour follows the Locker outfit)
    this.arms = new THREE.Group();
    this.sleeveMat = vmMat(new THREE.MeshLambertMaterial({ color: 0xff8a1e }));
    const glove = mat(0x2a2a30), cuff = mat(0x1a1a1e);
    const mk = (geo, m, x, y, z, rx, ry) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); this.arms.add(o); return o; };
    const sleeve = new THREE.BoxGeometry(0.1, 0.1, 0.44), hand = new THREE.BoxGeometry(0.075, 0.09, 0.1), band = new THREE.BoxGeometry(0.105, 0.105, 0.04);
    mk(sleeve, this.sleeveMat, 0.03, -0.11, 0.24, 0.25, 0.1);          // right forearm (trigger hand)
    mk(band, cuff, 0.025, -0.085, 0.05, 0.25, 0.1);
    mk(hand, glove, 0.0, -0.065, 0.03, 0.28, 0);
    mk(sleeve, this.sleeveMat, -0.17, -0.12, 0.0, 0.35, -0.55);       // left forearm under the barrel
    mk(hand, glove, -0.05, -0.05, -0.24, 0, 0);
    this.root.add(this.arms);
    this.root.traverse((o) => { if (o.isMesh && o !== this.sentinel) o.renderOrder = ORDER; });
    this.flash.renderOrder = ORDER + 1;
    this.current = null;
    this.t = 0;
    this.hip = new THREE.Vector3(0.14, -0.13, -0.36);
    this.pos = this.hip.clone();
    this._ads = new THREE.Vector3();
  }

  _gun(id, rarity) {
    if (!this.guns[id]) {
      const g = buildGunModel(id, rarity, { mats: MATS });
      g.traverse((o) => { if (o.isMesh) o.renderOrder = ORDER; });
      this.guns[id] = g;
      this.root.add(g);
    }
    setGunRarity(this.guns[id], rarity);
    return this.guns[id];
  }

  /** World position of the first-person muzzle (for tracers and rockets). */
  muzzleWorld(out) {
    const g = this.current;
    if (!g || !this.root.visible) return null;
    this.root.updateWorldMatrix(true, true);
    return g.userData.muzzle.getWorldPosition(out);
  }

  update(dt, p, game) {
    this.t += dt;
    for (const k in this.guns) this.guns[k].visible = false;
    this.pickaxe.visible = false; this.item.visible = false;
    this.current = null;
    const it = p.held;
    let show = null, st = null;
    if (!p.alive || game.build.active || game.edit.active || p.airborne) { this.root.visible = false; return; }
    this.root.visible = true;
    if (!it) { this.root.visible = false; return; }
    // Scoped snipers: the HUD already draws the scope view. Rendering the 3D gun as well puts its
    // scope tube dead centre on screen (the sight line is aligned to the camera) and hides the target.
    if (p.ads && it.type === 'weapon' && weaponStats(it).zoom >= SCOPE_ZOOM) { this.root.visible = false; return; }
    this.arms.visible = it.type === 'weapon';
    if (game.settings.outfit) this.sleeveMat.color.set(game.settings.outfit.shirt);
    if (it.type === 'weapon') {
      st = weaponStats(it);
      show = this._gun(it.id, it.rarity);
      show.visible = true;
      this.current = show;
    } else if (it.type === 'pickaxe') { show = this.pickaxe; show.visible = true; }
    else { show = this.item; show.visible = true; show.material = mat(parseInt(game.season.items[it.id].color.slice(1), 16)); }

    // pose: hip fire on the right, aiming brings the sight line to the screen centre
    let rx0 = 0;
    const speed = Math.hypot(p.vx, p.vz);
    const bob = p.grounded ? Math.sin(this.t * (p.sprinting ? 13 : 9)) * (p.sprinting ? 0.016 : 0.008) * Math.min(1, speed / 6) : 0;
    if (p.sprinting && !p.ads) { rx0 = -0.35; }
    const tgt = p.ads && st ? this._ads.set(0, -show.userData.sightY * this.root.scale.y, -0.36) : this.hip;
    this.pos.lerp(tgt, Math.min(1, dt * 14));
    let rx = rx0, ry = 0, rz = p.sliding ? 0.25 : 0, py = 0, pz = 0;
    this.flash.visible = !!st && p.recoil > 0.75 && p.reloadT <= 0;
    if (this.flash.visible) { this.flash.position.copy(show.userData.muzzle.position); this.flash.position.z -= 0.04; this.flash.material.rotation = Math.random() * 6; }
    if (st) {
      const kick = p.ads ? 0.5 : 1;
      pz += p.recoil * 0.05 * kick; rx += p.recoil * 0.07 * kick;
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
    this.root.rotation.set(rx, ry, rz);
  }
}

export { ITEM_KINDS };
