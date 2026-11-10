// First-person weapon model attached to the camera.
// The guns come from gunmodels.js (same detailed models the characters hold). To stop the
// gun from poking into walls it is drawn last with a fresh depth buffer: an invisible
// "sentinel" mesh clears depth right before the viewmodel meshes render (they are all in
// the transparent queue with a high renderOrder, so they come after the whole world).

import * as THREE from '../lib/three.module.min.js?v=63';
import { weaponStats, ITEM_KINDS } from './weapons.js?v=63';
import { buildGunModel, setGunRarity } from './gunmodels.js?v=63';
import { reloadPhase } from './reload.js?v=63';

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
    this.lArm = mk(sleeve, this.sleeveMat, -0.17, -0.12, 0.0, 0.35, -0.55);       // left forearm under the barrel
    this.lHand = mk(hand, glove, -0.05, -0.05, -0.24, 0, 0);
    this.lHandBase = this.lHand.position.clone();
    this.lArmOff = this.lArm.position.clone().sub(this.lHandBase);
    this.lHandPos = this.lHandBase.clone();
    this._hand = new THREE.Vector3();
    // a loose round / magazine the left hand carries while reloading
    this.carry = part(0.05, 0.08, 0.06, 0x2a2d33);
    this.carry.visible = false;
    this.arms.add(this.carry);
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
    let rx = rx0, ry = 0, rz = p.sliding ? 0.25 : 0, px = 0, py = 0, pz = 0;
    const handT = this._hand.copy(this.lHandBase);
    this.carry.visible = false;
    if (show && show.userData.mag) { show.userData.mag.visible = true; show.userData.mag.position.set(0, 0, 0); }
    this.flash.visible = !!st && p.recoil > 0.75 && !p.reloadStage;
    if (this.flash.visible) { this.flash.position.copy(show.userData.muzzle.position); this.flash.position.z -= 0.04; this.flash.material.rotation = Math.random() * 6; }
    if (st) {
      const kick = p.ads ? 0.5 : 1;
      pz += p.recoil * 0.05 * kick; rx += p.recoil * 0.07 * kick;
      if (p.reloadStage) {
        const o = this._reloadPose(p.reloadStage, show, handT);
        rx += o.rx; ry += o.ry; rz += o.rz; px += o.px; py += o.py; pz += o.pz;
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
    // left hand (and forearm) follow their target smoothly
    this.lHandPos.lerp(handT, Math.min(1, dt * 16));
    this.lHand.position.copy(this.lHandPos);
    this.lArm.position.copy(this.lHandPos).add(this.lArmOff);
    this.root.position.set(this.pos.x + px, this.pos.y + bob + py, this.pos.z + pz);
    this.root.rotation.set(rx, ry, rz);
  }

  /**
   * Pose offsets for the running reload (see reload.js for the phases). Moves the gun's magazine
   * group, sets the left-hand target `hand` (gun-local coordinates) and returns gun rotations.
   */
  _reloadPose(r, gun, hand) {
    const o = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
    const ph = reloadPhase(r);
    if (!ph) return o;
    const ease = (t) => t * t * (3 - 2 * t);
    const k = ease(Math.min(1, ph.k));
    const env = ease(Math.min(1, r.t / 0.18, (r.T - r.t) / 0.18));   // blend in / out of the reload pose
    const mag = gun.userData.mag, mc = gun.userData.magC || [0, -0.1, -0.1];
    const pouch = [-0.12, -0.5, 0.05];
    const at = (x, y, z) => hand.set(x, y, z);
    const lerp3 = (a, b, t) => hand.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    const carry = (show, c = 0x2a2d33, w = 0.05, h = 0.08, d = 0.06) => {
      if (!show) return;
      this.carry.visible = true;
      this.carry.material = mat(c);
      this.carry.scale.set(w / 0.05, h / 0.08, d / 0.06);
      this.carry.position.copy(this.lHandPos).add({ x: 0, y: 0.05, z: -0.02 });
    };
    if (r.style === 'mag') {
      // cant the gun, magazine well towards the left hand
      o.rx = 0.12 * env; o.rz = 0.3 * env; o.ry = 0.5 * env; o.px = -0.03 * env; o.py = 0.035 * env; o.pz = -0.02 * env;
      if (ph.name === 'out') { mag.position.y = -0.32 * k; mag.visible = k < 0.92; at(mc[0], mc[1] - 0.32 * k - 0.04, mc[2]); }
      else if (ph.name === 'fetch') { mag.visible = false; lerp3([mc[0], mc[1] - 0.3, mc[2]], pouch, Math.sin(k * Math.PI)); }
      else if (ph.name === 'in') { mag.position.y = -0.3 * (1 - k); at(mc[0], mc[1] - 0.3 * (1 - k) - 0.04, mc[2]); o.pz += k > 0.85 ? 0.015 : 0; }
      else if (ph.name === 'rack') { at(0.06, 0.08, 0.06 + 0.07 * Math.sin(k * Math.PI)); o.pz += 0.02 * Math.sin(k * Math.PI); o.rz -= 0.15 * env; }
    } else if (r.style === 'shell') {
      // roll the gun to show the loading port and feed rounds in one by one
      o.rz = -0.55 * env; o.rx = 0.12 * env; o.py = -0.02 * env;
      if (ph.name === 'shell') {
        const port = [0.0, -0.06, -0.12];
        const t = Math.sin(k * Math.PI);
        lerp3(pouch, port, t);
        carry(k < 0.75, r.id === 'pump' ? 0xc0392b : r.id === 'grenade' ? 0x556b2f : 0xd9a53a, 0.035, 0.035, 0.07);
        o.pz += k > 0.7 && k < 0.85 ? 0.012 : 0;
      } else if (ph.name === 'rack') { at(-0.04, -0.06, -0.33 + 0.1 * Math.sin(k * Math.PI)); o.pz += 0.03 * Math.sin(k * Math.PI); }
      else if (ph.name === 'open') lerp3(this.lHandBase.toArray(), pouch, k);
      else if (ph.name === 'close') lerp3(pouch, this.lHandBase.toArray(), k);
    } else if (r.style === 'break') {
      // break the barrels down, eject, two new shells, snap it shut
      const open = ph.name === 'open' ? k : ph.name === 'close' ? 1 - k : 1;
      o.rx = -0.38 * open; o.py = -0.06 * open; o.pz = 0.04 * open; o.rz = 0.2 * env;
      if (ph.name === 'eject') { lerp3([-0.03, 0.0, -0.3], pouch, k); o.rx -= 0.15 * Math.sin(k * Math.PI); }
      else if (ph.name === 'in') { lerp3(pouch, [0, 0.04, -0.02], Math.sin(Math.min(1, k * 1.3) * Math.PI / 2)); carry(k < 0.8, 0xc0392b, 0.07, 0.035, 0.07); }
      else at(-0.03, 0.02, -0.3);
    } else if (r.style === 'cyl') {
      // swing the cylinder out to the left, punch the ejector, speed-loader, flick it shut
      const open = ph.name === 'open' ? k : ph.name === 'close' ? 1 - k : 1;
      mag.position.x = -0.065 * open; mag.position.y = -0.01 * open;
      o.rz = 0.75 * env; o.rx = 0.25 * env;
      if (ph.name === 'eject') { at(-0.07, 0.0, -0.18); o.rx += 0.35 * Math.sin(k * Math.PI); }
      else if (ph.name === 'in') { lerp3(pouch, [-0.07, 0.03, -0.05], Math.sin(Math.min(1, k * 1.2) * Math.PI / 2)); carry(k < 0.85, 0xd9a53a, 0.08, 0.08, 0.04); }
      else at(-0.06, 0.0, -0.12);
    } else { // single
      o.rx = -0.15 * env; o.py = -0.12 * env; o.rz = 0.25 * env;
      const front = r.id === 'rocket' ? [0, 0.07, -0.8] : r.id === 'crossbow' ? [0, 0.07, -0.25] : [0.05, 0.06, -0.05];
      if (ph.name === 'lower') { if (mag && r.id !== 'sniper') mag.visible = false; lerp3(this.lHandBase.toArray(), pouch, k); }
      else if (ph.name === 'in') {
        lerp3(pouch, front, Math.sin(Math.min(1, k * 1.25) * Math.PI / 2));
        if (r.id === 'rocket' || r.id === 'crossbow') { mag.visible = k > 0.7; mag.position.z = (r.id === 'rocket' ? -0.2 : 0.15) * (1 - k); }
        carry(k < 0.7, r.id === 'rocket' ? 0xb03030 : 0xd9a53a, r.id === 'rocket' ? 0.1 : 0.03, r.id === 'rocket' ? 0.1 : 0.03, r.id === 'rocket' ? 0.22 : 0.08);
      } else if (ph.name === 'rack') { at(0.1, 0.05, 0.02 + 0.08 * Math.sin(k * Math.PI)); o.rz -= 0.3 * Math.sin(k * Math.PI); }
    }
    return o;
  }
}

export { ITEM_KINDS };
