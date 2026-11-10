// Low-poly character models (player + bots): random outfits, pixel-art faces, gliders,
// held weapon models and a small procedural animation system.

import * as THREE from '../lib/three.module.min.js?v=59';
import { buildGunModel, setGunRarity } from './gunmodels.js?v=59';

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

const PISTOLS = new Set(['pistol', 'hand_cannon', 'blaster', 'revolver']);

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
    // legs: hip joint -> thigh -> knee joint -> shin + shoe (so knees can really bend)
    const leg = (x) => {
      const hip = new THREE.Group(); hip.position.set(x, 0, 0); hips.add(hip);
      const th = new THREE.Mesh(box(0.27, 0.47, 0.27), lam(pants)); th.position.y = -0.225; hip.add(th);
      const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee);
      const sh = new THREE.Mesh(box(0.26, 0.46, 0.26), lam(pants)); sh.position.y = -0.225; knee.add(sh);
      const s = new THREE.Mesh(box(0.29, 0.12, 0.38), lam('#1e1e1e')); s.position.set(0, -0.41, -0.05); knee.add(s); details.push(s);
      return { hip, knee };
    };
    const lL = leg(-0.16), lR = leg(0.16);
    const legL = lL.hip, legR = lR.hip, kneeL = lL.knee, kneeR = lR.knee;
    // arms: shoulder -> upper arm -> elbow -> forearm + hand, so both hands can really hold a gun
    const arm = (x) => {
      const sh = new THREE.Group(); sh.position.set(x, 0.7, 0); torso.add(sh);
      const up = new THREE.Mesh(box(0.2, 0.36, 0.2), lam(shirt)); up.position.y = -0.17; sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
      const fa = new THREE.Mesh(box(0.19, 0.4, 0.19), lam(shirt)); fa.position.y = -0.17; el.add(fa);
      const h = new THREE.Mesh(box(0.18, 0.16, 0.18), skinM); h.position.y = -0.38; el.add(h); details.push(h);
      return { sh, el };
    };
    const aL = arm(-0.42), aR = arm(0.42);
    const armL = aL.sh, armR = aR.sh, elbowL = aL.el, elbowR = aR.el;
    const grip = new THREE.Group(); grip.position.set(0, -0.38, 0); grip.rotation.x = -Math.PI / 2; elbowR.add(grip);
    const gunMount = new THREE.Group(); torso.add(gunMount);   // guns live in front of the chest, both hands reach for it

    this.root = root;
    this.p = { hips, torso, neck, head, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, grip };
    this.gunMount = gunMount; this.gm = { x: 0.05, y: 0.62, z: -0.3, p: 0 };
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

  /** Show the right model in the hand. kind: 'gun' (cls = weapon id, color = rarity) | 'pickaxe' | 'item' | null */
  setHeld(kind, cls, color) {
    const key = kind + ':' + cls + ':' + color;
    if (key === this.heldKey) return;
    this.heldKey = key;
    for (const k in this.guns) this.guns[k].visible = false;
    this.pick.visible = false; this.itemCube.visible = false;
    if (kind === 'gun') {
      // cls = weapon id, color = rarity index
      const id = cls; this.heldId = id;
      if (!this.guns[id]) { this.guns[id] = buildGunModel(id, color || 0); this.guns[id].traverse((o) => { if (o.isMesh) o.castShadow = true; }); this.gunMount.add(this.guns[id]); }
      setGunRarity(this.guns[id], color || 0);
      this.guns[id].visible = true;
      this.curGun = this.guns[id];
    } else if (kind === 'pickaxe') { this.pick.visible = true; this.curGun = null; }
    else if (kind === 'item') { this.itemCube.visible = true; this.itemCube.material = lam(color || '#ffffff'); this.curGun = null; }
    else this.curGun = null;
  }

  /**
   * Third-person reload: where the left hand goes (torso space). `fo` = the normal fore-grip spot in
   * gun space, `G` converts gun space to torso space. Also moves the magazine / cylinder itself.
   */
  _reloadHand(r, fo, G) {
    const V3 = THREE.Vector3;
    const mag = this.curGun && this.curGun.userData.mag;
    if (mag) { mag.visible = true; mag.position.set(0, 0, 0); }
    const k = r.k, sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const V = (x, y, z) => G(new V3(x, y, z));
    const lerp = (a, b, t) => a.clone().lerp(b, sm(t));
    const fore = V(fo[0], fo[1], fo[2]);
    const belt = new V3(-0.2, 0.2, -0.28);                // pouch / belt, torso space
    const trip = (a, pouch, b) => (k < 0.5 ? lerp(a, pouch, k * 2) : lerp(pouch, b, k * 2 - 1));   // there and back
    if (r.style === 'mag') {
      const W = (dy) => V(0, -0.17 + dy, -0.1);
      if (r.name === 'out') { if (mag) { mag.position.y = -0.3 * k; mag.visible = k < 0.9; } return lerp(fore, W(-0.3 * k), k * 4); }
      if (r.name === 'fetch') { if (mag) mag.visible = false; return lerp(W(-0.3), belt, k * 1.6); }
      if (r.name === 'in') { if (mag) mag.position.y = -0.3 * (1 - k); return lerp(belt, W(-0.3 * (1 - k)), k * 2.2); }
      if (r.name === 'rack') return lerp(fore, V(0, 0.04, -0.14), Math.sin(k * Math.PI));
      return fore;
    }
    if (r.style === 'shell') {
      const port = V(0, -0.06, -0.14);
      if (r.name === 'open') return lerp(fore, port, k);
      if (r.name === 'shell') return trip(port, belt, port);
      if (r.name === 'rack') return V(fo[0], fo[1], fo[2] + 0.12 * Math.sin(k * Math.PI));
      return fore;
    }
    if (r.style === 'break' || r.style === 'cyl') {
      const cy = r.style === 'cyl';
      const bp = cy ? V(0, -0.02, -0.1) : V(0, -0.04, -0.2);
      if (cy && mag) mag.position.x = -0.065 * (r.name === 'open' ? k : r.name === 'close' ? 1 - k : 1);
      if (r.name === 'in') return trip(bp, belt, bp);
      if (r.name === 'close') return lerp(bp, fore, k);
      return bp;
    }
    // single round (rocket, bolt, rail slug)
    const port = V(0, -0.08, -0.16);
    if (mag && (r.name === 'lower' || (r.name === 'in' && k < 0.7)) && r.id !== 'sniper') mag.visible = false;
    if (r.name === 'lower') return lerp(fore, port, k);
    if (r.name === 'in') return trip(port, belt, port);
    if (r.name === 'rack') return V(fo[0], fo[1], fo[2] + 0.12 * Math.sin(k * Math.PI));
    return fore;
  }

  /** Two-bone IK: put the hand of arm (shoulder sh, elbow el) on T, all in torso space. */
  _arm(sh, el, S, T, pole, k) {
    const V3 = THREE.Vector3, L1 = 0.34, L2 = 0.38;
    const to = T.clone().sub(S);
    const dist = Math.min(L1 + L2 - 0.004, Math.max(0.12, to.length()));
    const dir = to.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, a).addScaledVector(pp, h);
    const u = E.clone().sub(S).normalize();
    const f = S.clone().addScaledVector(dir, dist).sub(E).normalize();
    const DOWN = new V3(0, -1, 0);
    const qs = new THREE.Quaternion().setFromUnitVectors(DOWN, u);
    const qe = new THREE.Quaternion().setFromUnitVectors(DOWN, f.applyQuaternion(qs.clone().invert()));
    sh.quaternion.slerp(qs, k); el.quaternion.slerp(qe, k);
  }

  /** Hold the current gun with both hands (aim, hip, sprint carry, reload). */
  _holdGun(s, sw, torsoX, dt) {
    const V3 = THREE.Vector3, P = this.p, gm = this.gm, gun = this.curGun;
    if (!gun) return;
    const aimG = (s.pitch || 0) * 0.95 + (s.recoil || 0) * 0.25 - torsoX;   // gun elevation relative to the torso
    const carry = !s.aiming && s.sprint;
    // where the right hand / gun sits (torso space) and how it points
    let mx = 0.3, my = 0.64, mz = -0.3, gp = aimG;
    if (carry) { mx = 0.16; my = 0.42; mz = -0.26; gp = -0.85 + sw * 0.06 - torsoX; }
    else {
      const oy = my - 0.7;                                   // rotate the offset around the chest so it stays in front when looking up / down
      my = 0.7 + oy * Math.cos(gp) - mz * Math.sin(gp); mz = oy * Math.sin(gp) + mz * Math.cos(gp);
    }
    mz += (s.recoil || 0) * 0.07;
    const f = Math.min(1, dt * 18);
    gm.x += (mx - gm.x) * f; gm.y += (my - gm.y) * f; gm.z += (mz - gm.z) * f; gm.p += (gp - gm.p) * f;
    this.gunMount.position.set(gm.x, gm.y, gm.z);
    this.gunMount.rotation.set(gm.p, 0, 0);
    this.gunMount.updateMatrix();
    const G = (v) => v.applyMatrix4(this.gunMount.matrix);
    // fore-grip spot in gun space: pistols are cupped, long guns reach out along the barrel
    const mz0 = Math.abs(gun.userData.muzzle.position.z);
    const pistol = PISTOLS.has(this.heldId);
    const fo = pistol ? [-0.045, -0.035, -0.01] : [0, -0.085, -Math.min(0.42, mz0 * 0.42)];
    const SL = new V3(-0.42, 0.7, 0), SR = new V3(0.42, 0.7, 0);
    let target = s.reload ? this._reloadHand(s.reload, fo, G) : null;
    if (!target) {
      target = G(new V3(fo[0], fo[1], fo[2]));
      // too far for the arm? slide the hand back along the gun until it can reach
      for (let i = 0; i < 6 && target.distanceTo(SL) > 0.7 && !pistol; i++) { fo[2] *= 0.8; target = G(new V3(fo[0], fo[1], fo[2])); }
    }
    const right = G(new V3(0.0, -0.01, 0.0));
    this._arm(P.armR, P.elbowR, SR, right, new V3(0.5, -1, 0.35), Math.min(1, dt * 20));
    this._arm(P.armL, P.elbowL, SL, target, new V3(-0.5, -1, 0.35), Math.min(1, dt * 18));
  }

  /** World position of the current gun muzzle (falls back to the hand). */
  muzzleWorld(out) {
    const o = this.curGun ? this.curGun.userData.muzzle : this.p.grip;
    return o.getWorldPosition(out);
  }

  /** Tilting the whole body (freefall, swimming) pivots around the hips instead of the feet. */
  _pivot() {
    const a = this.root.rotation.x;
    if (Math.abs(a) < 0.001) return;
    const yaw = this.root.rotation.y, dz = 0.92 * Math.sin(a) * -1, dy = 0.92 * (1 - Math.cos(a));
    this.root.position.y += dy;
    this.root.position.x += Math.sin(yaw) * dz; this.root.position.z += Math.cos(yaw) * dz;
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
    const dir = s.back ? -1 : 1;              // walking backwards plays the cycle in reverse
    this.walk += dir * dt * (4 + s.speed * 1.35);
    const sw = Math.sin(this.walk), cw = Math.cos(this.walk) * dir;
    let hipsY = 0.92, rootPitch = 0, hipsZ = 0;
    let legLx = sw * 0.85 * run, legRx = -sw * 0.85 * run;
    let torsoX = s.sprint ? -0.18 : -0.05 * run, torsoY = 0;
    let armLx = -sw * 0.6 * run, armRx = sw * 0.6 * run, armLz = 0.08, armRz = -0.08, armLy = 0, armRy = 0;
    let neckX = 0, ik = false;
    let elbowLb = 0.12 + 0.55 * run * Math.max(0, -sw), elbowRb = 0.12 + 0.55 * run * Math.max(0, sw);
    // knees bend while the leg swings forward (cw > 0 = left leg moving forward, < 0 = right)
    let kneeLb = run * (0.12 + 0.95 * Math.max(0, cw)), kneeRb = run * (0.12 + 0.95 * Math.max(0, -cw));
    this.glider.visible = s.air === 'glide';
    if (s.emote) {
      // "The Floppy Disk": an original 90s-style dance
      this.dance = (this.dance || 0) + dt;
      const t = this.dance * 7.5, beat = Math.sin(t), half = Math.sin(t * 0.5);
      P.hips.position.y = 0.92 + Math.abs(beat) * 0.08;
      this.root.rotation.x += (0 - this.root.rotation.x) * Math.min(1, dt * 6);
      lerpR(P.torso, 0.05, half * 0.45, beat * 0.12, 18);
      lerpR(P.legL, beat > 0 ? 0.7 * beat : 0, 0, -0.15, 18); lerpR(P.legR, beat < 0 ? -0.7 * beat : 0, 0, 0.15, 18);
      lerpR(P.kneeL, beat > 0 ? -1.0 * beat : 0, 0, 0, 18); lerpR(P.kneeR, beat < 0 ? 1.0 * beat : 0, 0, 0, 18);
      P.hips.position.z += (0 - P.hips.position.z) * Math.min(1, dt * 8);
      this._pivot();
      lerpR(P.elbowL, 0.4, 0, 0, 18); lerpR(P.elbowR, 0.4, 0, 0, 18);
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
      lerpR(P.elbowL, 0.3, 0, 0, 10); lerpR(P.elbowR, 0.3, 0, 0, 10);
      lerpR(P.armL, 2.6 + st * 0.5, 0, 0.6 + st * 0.5, 10); lerpR(P.armR, 2.6 + st * 0.5, 0, -0.6 - st * 0.5, 10);
      lerpR(P.legL, -0.3 + st * 0.5, 0, 0, 12); lerpR(P.legR, -0.3 - st * 0.5, 0, 0, 12);
      lerpR(P.kneeL, -(0.3 + Math.max(0, -st) * 0.6), 0, 0, 12); lerpR(P.kneeR, -(0.3 + Math.max(0, st) * 0.6), 0, 0, 12);
      P.hips.position.z += (0 - P.hips.position.z) * Math.min(1, dt * 8);
      this._pivot();
      for (const k in this.guns) this.guns[k].visible = false;
      this.pick.visible = false; this.itemCube.visible = false; this.heldKey = '';
      return;
    }

    if (s.air === 'fall') {
      rootPitch = -1.25; legLx = 0.2 + Math.sin(this.walk * 0.5) * 0.15; legRx = 0.2 - Math.sin(this.walk * 0.5) * 0.15; kneeLb = 0.3; kneeRb = 0.3;
      armLx = -0.3; armRx = -0.3; armLz = 1.25; armRz = -1.25; neckX = 0.9; hipsY = 0.92;
    } else if (s.air === 'glide') {
      armLx = 2.9; armRx = 2.9; armLz = 0.25; armRz = -0.25; legLx = 0.25; legRx = 0.1; torsoX = 0.05; kneeLb = 0.35; kneeRb = 0.15;
    } else if (s.mantle) {
      // climbing up: one knee up on the ledge, arms reaching forward / up
      armLx = 2.5 + sw * 0.15; armRx = 2.5 - sw * 0.15; armLy = 0; armRy = 0; legLx = 1.25; legRx = -0.15; kneeLb = 1.2; kneeRb = 0.2; torsoX = -0.35;
    } else if (s.slide) {
      hipsY = 0.4; torsoX = 0.5; legLx = 1.4; legRx = 1.1; kneeLb = 0.15; kneeRb = 0.5; armLx = 0.4; armRx = 0.4; armLz = 0.7; armRz = -0.7;
    } else {
      if (s.crouch) {
        // deep knee bend with the hips pushed back and the chest forward
        const w = run * 0.25;
        hipsY = 0.64; hipsZ = 0.38; torsoX = -0.5;
        legLx = 1.15 + sw * w; legRx = 1.15 - sw * w; kneeLb = 0.7 - sw * w; kneeRb = 0.7 + sw * w;
      }
      if (!s.grounded) { legLx = 0.7; legRx = -0.2; kneeLb = 0.9; kneeRb = 0.35; }
    }
    // upper body: holding / aiming
    if (!s.air) {
      if (s.kind === 'gun' && !s.mantle) {
        ik = true;
        neckX = (s.pitch || 0) * 0.5 - torsoX * 0.7;
        if (!s.reload && this.curGun && this.curGun.userData.mag) { this.curGun.userData.mag.visible = true; this.curGun.userData.mag.position.set(0, 0, 0); }
      } else if (s.kind === 'pickaxe' && !s.mantle) {
        const prog = s.swing > 0 ? 1 - s.swing / 0.3 : 1;
        armRx = s.swing > 0 ? 2.7 - 2.3 * prog : 0.5; armRz = -0.1;
        elbowRb = s.swing > 0 ? 1.4 - 1.25 * prog : 0.8;
      } else if (s.kind === 'item') {
        armRx = s.using ? 1.2 + Math.sin(this.walk * 2) * 0.08 : 0.75; elbowRb = s.using ? 1.9 : 0.85;
      }
    }
    // never wave a gun / pickaxe around while climbing
    const held = this.heldKey.startsWith('gun') ? this.curGun : this.heldKey.startsWith('pickaxe') ? this.pick : this.heldKey.startsWith('item') ? this.itemCube : null;
    if (held) held.visible = !(s.mantle || s.air);
    const f = Math.min(1, dt * 12);
    P.hips.position.y += (hipsY - P.hips.position.y) * f;
    P.hips.position.z += (hipsZ - P.hips.position.z) * f;
    this.root.rotation.x += (rootPitch - this.root.rotation.x) * Math.min(1, dt * 6);
    this._pivot();
    lerpR(P.torso, torsoX, torsoY, 0);
    lerpR(P.legL, legLx, 0, 0, 16); lerpR(P.legR, legRx, 0, 0, 16);
    lerpR(P.kneeL, -kneeLb, 0, 0, 18); lerpR(P.kneeR, -kneeRb, 0, 0, 18);
    if (!ik) { lerpR(P.elbowL, elbowLb, 0, 0, 16); lerpR(P.elbowR, elbowRb, 0, 0, 16); }
    if (ik) this._holdGun(s, sw, torsoX, dt);
    else { lerpR(P.armL, armLx, armLy, armLz, 16); lerpR(P.armR, armRx, armRy, armRz, 18); }
    lerpR(P.neck, neckX, 0, 0);
  }
}
