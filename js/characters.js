// Low-poly character models (player + bots): random outfits, pixel-art faces, gliders,
// held weapon models and a small procedural animation system.

import * as THREE from '../lib/three.module.min.js?v=41';
import { CLASS_COLORS } from './weapons.js?v=41';

const SKINS = ['#f2c9a0', '#e0ac7e', '#c68955', '#9a6640', '#6e4529', '#f6d7bd'];
const OUTFITS = [
  ['#e74c3c', '#2c3e50'], ['#3498db', '#1d2b3a'], ['#2ecc71', '#3b3b3b'], ['#f1c40f', '#5a4632'], ['#9b59b6', '#2b2440'],
  ['#e67e22', '#33302b'], ['#1abc9c', '#24384a'], ['#ff6fa5', '#3a2a40'], ['#95a5a6', '#2f3640'], ['#6c5ce7', '#202036'],
  ['#d35400', '#1e272e'], ['#00a8ff', '#353b48'], ['#c0392b', '#f5f6fa'], ['#27ae60', '#6d4c2f'], ['#fbc531', '#192a56'],
];
const HAIR = ['#2b1b10', '#5a3a1a', '#d8b25a', '#a83a1a', '#1a1a1a', '#8a8a8a', '#ff4fd8', '#2de2ff'];
const HATS = ['none', 'cap', 'beanie', 'helmet', 'none', 'band'];

const geoCache = {};
const box = (w, h, d) => {
  const k = w + ',' + h + ',' + d;
  return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d));
};
const matCache = {};
const lam = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));

/** 16x16 pixel-art face, drawn on a canvas (very 1996). */
function faceTexture(skin, hair, variant) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = skin; g.fillRect(0, 0, 16, 16);
  g.fillStyle = hair; g.fillRect(0, 0, 16, 3 + (variant % 3 === 0 ? 1 : 0));
  if (variant % 4 === 1) g.fillRect(0, 3, 2, 5), g.fillRect(14, 3, 2, 5);
  // eyes
  g.fillStyle = '#fff'; g.fillRect(3, 6, 4, 3); g.fillRect(9, 6, 4, 3);
  g.fillStyle = '#1a1a2a'; g.fillRect(5 - (variant % 2), 7, 2, 2); g.fillRect(11 - (variant % 2), 7, 2, 2);
  // brows
  g.fillStyle = hair; g.fillRect(3, 5, 4, 1); g.fillRect(9, 5, 4, 1);
  // mouth
  g.fillStyle = '#7a2a2a';
  if (variant % 3 === 0) { g.fillRect(5, 12, 6, 1); g.fillRect(4, 11, 1, 1); g.fillRect(11, 11, 1, 1); }
  else if (variant % 3 === 1) g.fillRect(6, 12, 4, 1);
  else { g.fillRect(6, 11, 4, 2); g.fillStyle = '#fff'; g.fillRect(6, 11, 4, 1); }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTag(name) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 34px "Times New Roman", serif'; c.textAlign = 'center';
  c.fillStyle = 'rgba(0,0,128,0.75)'; const w = Math.min(250, c.measureText(name).width + 24);
  c.fillRect(128 - w / 2, 12, w, 40);
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(128 - w / 2, 12, w, 40);
  c.fillStyle = '#fff'; c.fillText(name, 128, 43);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.0, 0.5, 1); sp.position.y = 2.5; sp.renderOrder = 10;
  return sp;
}

/** Third-person weapon model (one per weapon class). */
export function heldGun(cls) {
  const g = new THREE.Group();
  const body = CLASS_COLORS[cls] || 0x555555, dark = 0x22262c, wood = 0x6b4a2b;
  const add = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(box(w, h, d), lam(c)); m.position.set(x, y, z); g.add(m); return m; };
  switch (cls) {
    case 'pistol': add(0.08, 0.1, 0.3, body, 0, 0, -0.12); add(0.06, 0.14, 0.07, dark, 0, -0.09, 0); break;
    case 'smg': add(0.09, 0.12, 0.45, body, 0, 0, -0.18); add(0.05, 0.18, 0.06, dark, 0, -0.13, -0.2); break;
    case 'rifle': add(0.09, 0.12, 0.7, body, 0, 0, -0.25); add(0.07, 0.12, 0.25, wood, 0, -0.02, 0.18); add(0.05, 0.18, 0.07, dark, 0, -0.13, -0.25); break;
    case 'shotgun': add(0.08, 0.08, 0.8, dark, 0, 0.01, -0.3); add(0.1, 0.09, 0.22, wood, 0, -0.05, -0.3); add(0.08, 0.11, 0.28, wood, 0, -0.03, 0.15); break;
    case 'sniper': add(0.08, 0.1, 0.55, body, 0, 0, -0.1); add(0.04, 0.04, 0.6, dark, 0, 0.01, -0.62); add(0.07, 0.08, 0.25, dark, 0, 0.11, -0.12); break;
    default: add(0.18, 0.18, 0.9, body, 0, 0.02, -0.25); add(0.2, 0.2, 0.06, dark, 0, 0.02, -0.72); break;
  }
  g.userData.muzzle = new THREE.Object3D();
  g.userData.muzzle.position.set(0, 0.02, cls === 'shotgun' ? -0.72 : cls === 'pistol' ? -0.28 : -0.65);
  g.add(g.userData.muzzle);
  return g;
}

function heldPickaxe(color = 0xb0b6bd) {
  const g = new THREE.Group();
  const h = new THREE.Mesh(box(0.05, 0.05, 0.85), lam(0x6b4a2b)); h.position.z = -0.32; g.add(h);
  const a = new THREE.Mesh(box(0.45, 0.07, 0.07), lam(color)); a.position.set(0, 0.02, -0.72); g.add(a);
  return g;
}

function glider(color) {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.35, -1.4, -2.1, 0, 0.6, 0, 0.1, 0.25,
    0, 0.35, -1.4, 0, 0.1, 0.25, 2.1, 0, 0.6,
  ], 3));
  geo.computeVertexNormals();
  const sail = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
  g.add(sail);
  const bar = new THREE.Mesh(box(1.2, 0.05, 0.05), lam(0x333333)); bar.position.set(0, -0.9, 0); g.add(bar);
  const s1 = new THREE.Mesh(box(0.04, 0.95, 0.04), lam(0x333333)); s1.position.set(-0.55, -0.45, 0.05); s1.rotation.z = -0.5; g.add(s1);
  const s2 = s1.clone(); s2.position.x = 0.55; s2.rotation.z = 0.5; g.add(s2);
  g.position.y = 2.55;
  g.visible = false;
  return g;
}

export class CharacterModel {
  constructor(index, name, opts = {}) {
    const rnd = (n) => Math.floor(Math.abs(Math.sin(index * 91.7 + n * 13.3) * 10000)) ;
    const skin = SKINS[rnd(1) % SKINS.length];
    const [shirt, pants] = opts.outfit || OUTFITS[index % OUTFITS.length];
    const hair = opts.hair || HAIR[rnd(2) % HAIR.length];
    const hat = opts.hat || HATS[rnd(3) % HATS.length];
    const accent = opts.accent || OUTFITS[(index + 5) % OUTFITS.length][0];
    this.colors = { skin, shirt, pants, hair, accent };

    const root = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso);
    const chest = new THREE.Mesh(box(0.62, 0.72, 0.34), lam(shirt)); chest.position.y = 0.38; torso.add(chest);
    const belt = new THREE.Mesh(box(0.64, 0.1, 0.36), lam('#2a2a2a')); belt.position.y = 0.04; torso.add(belt);
    const details = [belt];
    const pack = new THREE.Mesh(box(0.44, 0.5, 0.2), lam(accent)); pack.position.set(0, 0.42, 0.26); torso.add(pack); details.push(pack);
    const neck = new THREE.Group(); neck.position.y = 0.76; torso.add(neck);
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(skin, hair, index) });
    this.faceMat = faceMat;
    const skinM = lam(skin), hairM = lam(hair);
    const head = new THREE.Mesh(box(0.42, 0.42, 0.42), [skinM, skinM, hairM, skinM, hairM, faceMat]);
    head.position.y = 0.23; neck.add(head);
    if (hat === 'cap') { const c = new THREE.Mesh(box(0.46, 0.12, 0.46), lam(accent)); c.position.y = 0.48; const b = new THREE.Mesh(box(0.4, 0.04, 0.22), lam(accent)); b.position.set(0, 0.43, -0.3); neck.add(c, b); }
    else if (hat === 'beanie') { const c = new THREE.Mesh(box(0.46, 0.2, 0.46), lam(accent)); c.position.y = 0.48; neck.add(c); }
    else if (hat === 'helmet') { const c = new THREE.Mesh(box(0.5, 0.26, 0.5), lam('#4a5a3a')); c.position.y = 0.46; neck.add(c); }
    else if (hat === 'band') { const c = new THREE.Mesh(box(0.45, 0.07, 0.45), lam('#d02020')); c.position.y = 0.36; neck.add(c); }

    for (const ch of neck.children) if (ch !== head) details.push(ch);
    const limb = (w, h, x, y, color, parent) => {
      const piv = new THREE.Group(); piv.position.set(x, y, 0);
      const m = new THREE.Mesh(box(w, h, w), lam(color)); m.position.y = -h / 2; piv.add(m);
      parent.add(piv); return piv;
    };
    const legL = limb(0.27, 0.9, -0.16, 0, pants, hips), legR = limb(0.27, 0.9, 0.16, 0, pants, hips);
    const shoe = (leg) => { const s = new THREE.Mesh(box(0.29, 0.12, 0.38), lam('#1e1e1e')); s.position.set(0, -0.86, -0.05); leg.add(s); details.push(s); };
    shoe(legL); shoe(legR);
    const armL = limb(0.2, 0.68, -0.42, 0.7, shirt, torso), armR = limb(0.2, 0.68, 0.42, 0.7, shirt, torso);
    const hand = (arm) => { const h = new THREE.Mesh(box(0.18, 0.16, 0.18), skinM); h.position.y = -0.72; arm.add(h); details.push(h); };
    hand(armL); hand(armR);
    const grip = new THREE.Group(); grip.position.set(0, -0.72, 0); grip.rotation.x = -Math.PI / 2; armR.add(grip);

    this.root = root;
    this.p = { hips, torso, neck, head, legL, legR, armL, armR, grip };
    this.guns = {};
    this.pick = heldPickaxe(); this.pick.visible = false; grip.add(this.pick);
    this.itemCube = new THREE.Mesh(box(0.18, 0.24, 0.18), lam('#ffffff')); this.itemCube.visible = false; grip.add(this.itemCube);
    this.glider = glider(accent); root.add(this.glider);
    if (name) { this.tag = nameTag(name); root.add(this.tag); }
    this.details = details; this.lodFar = false;
    this.heldKey = '';
    this.walk = Math.random() * 6;
    this.flash = null;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }

  /** Hide small details far from the camera (fewer draw calls with many bots around). */
  lod(far) {
    if (far === this.lodFar) return;
    this.lodFar = far;
    for (const d of this.details) d.visible = !far;
  }

  /** Free the per-character GPU resources (face texture, name tag). */
  dispose() {
    this.root.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if (m.map && (m === this.faceMat || o === this.tag)) { m.map.dispose(); m.dispose(); }
    });
  }

  /** Show the right model in the hand. kind: 'gun' | 'pickaxe' | 'item' | null */
  setHeld(kind, cls, color) {
    const key = kind + ':' + cls + ':' + color;
    if (key === this.heldKey) return;
    this.heldKey = key;
    for (const k in this.guns) this.guns[k].visible = false;
    this.pick.visible = false; this.itemCube.visible = false;
    if (kind === 'gun') {
      if (!this.guns[cls]) { this.guns[cls] = heldGun(cls); this.guns[cls].traverse((o) => { if (o.isMesh) o.castShadow = true; }); this.p.grip.add(this.guns[cls]); }
      this.guns[cls].visible = true;
      this.curGun = this.guns[cls];
    } else if (kind === 'pickaxe') { this.pick.visible = true; this.curGun = null; }
    else if (kind === 'item') { this.itemCube.visible = true; this.itemCube.material = lam(color || '#ffffff'); this.curGun = null; }
    else this.curGun = null;
  }

  /** World position of the current gun muzzle (falls back to the hand). */
  muzzleWorld(out) {
    const o = this.curGun ? this.curGun.userData.muzzle : this.p.grip;
    return o.getWorldPosition(out);
  }

  /**
   * Procedural animation. s = {speed, grounded, crouch, slide, air ('fall'|'glide'|null),
   * aiming, pitch, recoil, swing, reloading, using, mantle, sprint}
   */
  animate(dt, s) {
    const P = this.p;
    const lerpR = (o, x, y, z, k = 12) => {
      const f = Math.min(1, dt * k);
      o.rotation.x += (x - o.rotation.x) * f; o.rotation.y += (y - o.rotation.y) * f; o.rotation.z += (z - o.rotation.z) * f;
    };
    const run = Math.min(1, s.speed / 7);
    this.walk += dt * (4 + s.speed * 1.35);
    const sw = Math.sin(this.walk);
    let hipsY = 0.92, rootPitch = 0;
    let legLx = sw * 0.85 * run, legRx = -sw * 0.85 * run;
    let torsoX = s.sprint ? -0.18 : -0.05 * run, torsoY = 0;
    let armLx = -sw * 0.6 * run, armRx = sw * 0.6 * run, armLz = 0.08, armRz = -0.08, armLy = 0, armRy = 0;
    let neckX = 0;
    this.glider.visible = s.air === 'glide';
    if (s.emote) {
      // "The Floppy Disk": an original 90s-style dance
      this.dance = (this.dance || 0) + dt;
      const t = this.dance * 7.5, beat = Math.sin(t), half = Math.sin(t * 0.5);
      P.hips.position.y = 0.92 + Math.abs(beat) * 0.08;
      this.root.rotation.x += (0 - this.root.rotation.x) * Math.min(1, dt * 6);
      lerpR(P.torso, 0.05, half * 0.45, beat * 0.12, 18);
      lerpR(P.legL, beat > 0 ? 0.7 * beat : 0, 0, -0.15, 18); lerpR(P.legR, beat < 0 ? -0.7 * beat : 0, 0, 0.15, 18);
      lerpR(P.armL, 2.4 + beat * 0.7, 0, 0.5 + half * 0.4, 20); lerpR(P.armR, 2.4 - beat * 0.7, 0, -0.5 + half * 0.4, 20);
      lerpR(P.neck, -0.1 + Math.abs(beat) * 0.25, half * 0.3, 0, 18);
      for (const k in this.guns) this.guns[k].visible = false;
      this.pick.visible = false; this.itemCube.visible = false; this.heldKey = '';
      return;
    }
    this.dance = 0;
    if (s.swim) {
      const t = this.walk * 0.6, st = Math.sin(t);
      P.hips.position.y += (0.92 - P.hips.position.y) * Math.min(1, dt * 8);
      this.root.rotation.x += (-0.5 - this.root.rotation.x) * Math.min(1, dt * 5);
      lerpR(P.torso, 0, 0, 0); lerpR(P.neck, 0.45, 0, 0);
      lerpR(P.armL, 2.6 + st * 0.5, 0, 0.6 + st * 0.5, 10); lerpR(P.armR, 2.6 + st * 0.5, 0, -0.6 - st * 0.5, 10);
      lerpR(P.legL, -0.3 + st * 0.5, 0, 0, 12); lerpR(P.legR, -0.3 - st * 0.5, 0, 0, 12);
      for (const k in this.guns) this.guns[k].visible = false;
      this.pick.visible = false; this.itemCube.visible = false; this.heldKey = '';
      return;
    }

    if (s.air === 'fall') {
      rootPitch = -1.25; legLx = 0.2 + Math.sin(this.walk * 0.5) * 0.15; legRx = 0.2 - Math.sin(this.walk * 0.5) * 0.15;
      armLx = -0.3; armRx = -0.3; armLz = 1.25; armRz = -1.25; neckX = 0.9; hipsY = 0.92;
    } else if (s.air === 'glide') {
      armLx = 2.9; armRx = 2.9; armLz = 0.25; armRz = -0.25; legLx = 0.25; legRx = 0.1; torsoX = 0.05;
    } else if (s.mantle) {
      armLx = 2.8; armRx = 2.8; legLx = 0.9; legRx = -0.3; torsoX = -0.3;
    } else if (s.slide) {
      hipsY = 0.42; torsoX = 0.55; legLx = 1.35; legRx = 1.05; armLx = 0.4; armRx = 0.4; armLz = 0.7; armRz = -0.7;
    } else {
      if (s.crouch) { hipsY = 0.62; torsoX = -0.35; legLx = legLx * 0.6 + 0.9; legRx = legRx * 0.6 + 0.9; }
      if (!s.grounded) { legLx = 0.6; legRx = -0.25; }
    }
    // upper body: holding / aiming
    if (!s.air) {
      const aimX = Math.PI / 2 + (s.pitch || 0) * 0.95 + (s.recoil || 0) * 0.25;
      if (s.kind === 'gun' && !s.mantle) {
        if (s.aiming || !s.sprint) {
          armRx = aimX; armRy = 0; armRz = 0.05;
          armLx = aimX - 0.1; armLy = 0.6; armLz = 0.25;
          neckX = (s.pitch || 0) * 0.5;
        } else { armRx = 0.9 + sw * 0.25; armLx = 0.8 - sw * 0.25; armLy = 0.5; }
        if (s.reloading) { armLx = aimX - 0.7 + Math.sin(this.walk * 3) * 0.2; }
      } else if (s.kind === 'pickaxe' && !s.mantle) {
        const prog = s.swing > 0 ? 1 - s.swing / 0.3 : 1;
        armRx = s.swing > 0 ? 2.7 - 2.3 * prog : 0.9; armRz = -0.1;
      } else if (s.kind === 'item') {
        armRx = s.using ? 2.2 + Math.sin(this.walk * 2) * 0.1 : 1.0;
      }
    }
    const f = Math.min(1, dt * 12);
    P.hips.position.y += (hipsY - P.hips.position.y) * f;
    this.root.rotation.x += (rootPitch - this.root.rotation.x) * Math.min(1, dt * 6);
    lerpR(P.torso, torsoX, torsoY, 0);
    lerpR(P.legL, legLx, 0, 0, 16); lerpR(P.legR, legRx, 0, 0, 16);
    lerpR(P.armL, armLx, armLy, armLz, 16); lerpR(P.armR, armRx, armRy, armRz, 18);
    lerpR(P.neck, neckX, 0, 0);
  }
}
