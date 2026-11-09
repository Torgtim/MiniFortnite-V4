// The Party Bus: flies across the island at the start of a match. Everybody rides it and
// jumps out wherever they like (bots pick a spot near the place they want to land).

import * as THREE from '../lib/three.module.min.js?v=42';

const SPEED = 26;
const HEIGHT = 150;

function busModel() {
  const g = new THREE.Group();
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  const add = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Array.isArray(c) ? c : L(c)); m.position.set(x, y, z); g.add(m); return m; };
  // side panel with the name painted on it
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#2f6bff'; c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#ffe14d'; c.fillRect(0, 44, 256, 8);
  c.font = 'bold italic 30px "Times New Roman", serif'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('PARTY BUS 95', 128, 34);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshLambertMaterial({ map: tex });
  const blue = L('#2f6bff');
  add(3.0, 2.2, 8.0, [side, side, L('#f2f2f2'), blue, blue, blue], 0, 0, 0);
  add(3.05, 0.7, 6.4, '#1b2438', 0, 0.55, -0.2); // window band
  add(2.6, 0.8, 1.2, '#2f6bff', 0, -0.4, -4.4); // nose
  add(2.2, 0.5, 0.1, '#ffe14d', 0, -0.3, -5.0);
  for (const [x, z] of [[-1.5, -3], [1.5, -3], [-1.5, 2.6], [1.5, 2.6]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10).rotateZ(Math.PI / 2), L('#1a1a1a'));
    w.position.set(x, -1.15, z); g.add(w);
  }
  // hot-air balloon
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(4.6, 12, 9), new THREE.MeshLambertMaterial({ color: '#ff4040', flatShading: true }));
  balloon.position.y = 9.5; balloon.scale.y = 1.15; g.add(balloon);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(4.75, 4.75, 1.4, 12, 1, true), new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide, flatShading: true }));
  band.position.y = 9.5; g.add(band);
  for (const [x, z] of [[-1.3, -3.5], [1.3, -3.5], [-1.3, 3.5], [1.3, 3.5]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.5, 0.06), L('#333'));
    r.position.set(x * 1.2, 4.2, z * 0.55); r.rotation.x = z > 0 ? -0.35 : 0.35; g.add(r);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Bus {
  constructor(game) {
    this.game = game;
    this.mesh = busModel();
    this.mesh.visible = false;
    this.active = false;
    this.t = 0;
  }

  start(rnd) {
    const R = this.game.world.mapRadius + 70;
    const a = rnd() * Math.PI * 2;
    const off = (rnd() - 0.5) * 90;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    this.x0 = -dx * R + px * off; this.z0 = -dz * R + pz * off;
    this.x1 = dx * R + px * off; this.z1 = dz * R + pz * off;
    this.dx = dx; this.dz = dz;
    this.len = Math.hypot(this.x1 - this.x0, this.z1 - this.z0);
    this.t = 0;
    this.y = HEIGHT;
    this.active = true;
    this.mesh.visible = true;
    this.yaw = Math.atan2(-dx, -dz);
    this.update(0);
  }

  /** Distance along the path closest to (x,z). */
  along(x, z) {
    const s = (x - this.x0) * this.dx + (z - this.z0) * this.dz;
    return Math.max(0, Math.min(this.len, s));
  }

  get dist() { return this.t * SPEED; }
  get canDrop() { return this.active && this.dist > 40 && Math.hypot(this.x, this.z) < this.game.world.mapRadius + 30; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const d = this.dist;
    this.x = this.x0 + this.dx * d;
    this.z = this.z0 + this.dz * d;
    this.mesh.position.set(this.x, this.y + Math.sin(this.t * 1.3) * 0.4, this.z);
    this.mesh.rotation.set(0, this.yaw, Math.sin(this.t * 0.9) * 0.03);
    // riders follow the bus
    for (const e of this.game.entities) {
      if (e.air !== 'bus') continue;
      e.x = this.x; e.y = this.y - 1.5; e.z = this.z;
      if (d > this.len * 0.5 && Math.hypot(this.x, this.z) > this.game.world.mapRadius + 5) e.jumpFromBus();
    }
    if (d >= this.len + 120) { this.active = false; this.mesh.visible = false; }
  }
}
