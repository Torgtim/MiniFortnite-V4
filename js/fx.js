// Particle effects: one instanced mesh of little cubes (sparks, chips, debris, smoke,
// elimination "pixels") plus a few additive flashes (muzzle, explosions).

import * as THREE from '../lib/three.module.min.js?v=64';

const MAX = 900;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class FX {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.parts = [];
    for (let i = 0; i < MAX; i++) {
      this.parts.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, g: 0, rot: 0, grow: 0, drag: 0 });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
    this.group.add(this.mesh);
    this.next = 0;
    this.live = 0;

    // additive flashes
    const flashTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,230,150,0.8)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    this.flashes = [];
    for (let i = 0; i < 24; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      sp.visible = false;
      this.group.add(sp);
      this.flashes.push({ sp, life: 0, max: 0.05, size: 1 });
    }
    this.balls = [];
    const ballGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.balls.push({ m, life: 0, r: 1 });
    }
  }

  clear() {
    for (const p of this.parts) p.life = 0;
    for (const f of this.flashes) { f.life = 0; f.sp.visible = false; }
    for (const b of this.balls) { b.life = 0; b.m.visible = false; }
  }

  _emit(x, y, z, vx, vy, vz, color, size, life, grav = 9, opts = {}) {
    // skip work when far from the camera
    const cam = this.game.camera.position;
    const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
    if (d2 > 160 * 160) return;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const p = this.parts[i];
    p.life = p.max = life; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.s = size; p.g = grav; p.rot = Math.random() * 6; p.grow = opts.grow || 0; p.drag = opts.drag || 0;
    this.mesh.setColorAt(i, _c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }

  spark(x, y, z, color = 0xffe9a0) {
    for (let i = 0; i < 4; i++) this._emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, color, 0.06, 0.25, 12);
  }

  chips(x, y, z, color, n = 5) {
    for (let i = 0; i < n; i++) this._emit(x, y, z, (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6, color, 0.1 + Math.random() * 0.08, 0.6, 16);
  }

  debris(x, y, z, color, n = 10) {
    for (let i = 0; i < n; i++) this._emit(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 6, 1 + Math.random() * 5, (Math.random() - 0.5) * 6, color, 0.22 + Math.random() * 0.25, 0.9 + Math.random() * 0.4, 18);
    this.smoke(x, y, z, 1.2);
  }

  dust(x, y, z, color) {
    for (let i = 0; i < 6; i++) this._emit(x + (Math.random() - 0.5) * 3, y - 0.5 + Math.random(), z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, color, 0.12, 0.35, 2);
  }

  smoke(x, y, z, size = 0.5) {
    const k = 0.55 + Math.random() * 0.25;
    this._emit(x, y, z, (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6, _c.setRGB(k, k, k).getHex(), size, 1.1, -0.5, { grow: size * 1.2, drag: 1.5 });
  }

  landing(x, y, z) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this._emit(x, y + 0.1, z, Math.cos(a) * 3, 0.6, Math.sin(a) * 3, 0xd8d0c0, 0.18, 0.5, 2, { grow: 0.3, drag: 3 });
    }
  }

  /** Fortnite-ish "eliminated" effect: the body breaks into glowing pixels that float away. */
  eliminate(x, y, z, colors) {
    for (let i = 0; i < 46; i++) {
      const c = colors[i % colors.length];
      this._emit(x + (Math.random() - 0.5) * 0.7, y + Math.random() * 1.8, z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5, c, 0.12 + Math.random() * 0.1, 1.4 + Math.random() * 0.6, -1.2, { drag: 0.8 });
    }
    this.flash(x, y + 1, z, 3, 0.25);
  }

  /** A spent casing flicked out to the right of the shooter (rx, rz = shooter's right vector). */
  casing(x, y, z, rx, rz, shell = false) {
    const s = 0.9 + Math.random() * 0.6;
    this._emit(x, y, z, rx * 2.6 * s + (Math.random() - 0.5) * 0.6, 1.8 + Math.random() * 1.2, rz * 2.6 * s + (Math.random() - 0.5) * 0.6,
      shell ? 0xc0392b : 0xd9a53a, shell ? 0.05 : 0.032, 0.75, 14);
  }

  /** Reload leftovers: an empty magazine falling (n = 0) or n ejected shells / casings. */
  reloadDrop(e, n, id) {
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = -fz, rz = fx;
    const fp = e.isPlayer && !this.game.thirdPerson;
    const x = e.x + fx * (fp ? 0.45 : 0.35) + rx * 0.12, z = e.z + fz * (fp ? 0.45 : 0.35) + rz * 0.12;
    const y = e.y + (e.h || 1.8) * (fp ? 0.62 : 0.55);
    if (n === 0) {
      const energy = id === 'plasma_rifle' || id === 'pulse_smg' || id === 'laser_sniper' || id === 'arc_shotgun' || id === 'blaster';
      this._emit(x, y, z, rx * 0.4 + fx * 0.3, -0.5, rz * 0.4 + fz * 0.3, energy ? 0x40f0ff : 0x2a2d33, 0.09, 1.1, 18);
      return;
    }
    const shell = id === 'double_barrel';
    for (let i = 0; i < n; i++) this._emit(x, y, z, (Math.random() - 0.5) * 1.2 - fx * 0.6, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2 - fz * 0.6, shell ? 0xc0392b : 0xd9a53a, shell ? 0.05 : 0.03, 0.9, 16);
  }

  flash(x, y, z, size, life = 0.06) {
    const f = this.flashes.find((q) => q.life <= 0) || this.flashes[0];
    f.sp.position.set(x, y, z);
    f.sp.scale.setScalar(size);
    f.sp.visible = true;
    f.life = f.max = life; f.size = size;
  }

  muzzle(x, y, z, color, firstPerson) {
    if (firstPerson) return; // the viewmodel draws its own flash
    this.flash(x, y, z, 0.9, 0.05);
  }

  explosion(x, y, z, r) {
    const b = this.balls.find((q) => q.life <= 0) || this.balls[0];
    b.m.position.set(x, y, z); b.m.visible = true; b.life = 0.45; b.r = r;
    this.flash(x, y, z, r * 2.6, 0.18);
    for (let i = 0; i < 18; i++) this._emit(x, y, z, (Math.random() - 0.5) * 14, Math.random() * 10, (Math.random() - 0.5) * 14, i % 2 ? 0xffa030 : 0x553322, 0.18 + Math.random() * 0.2, 0.8, 14);
    for (let i = 0; i < 6; i++) this.smoke(x + (Math.random() - 0.5) * r, y + Math.random(), z + (Math.random() - 0.5) * r, 1.2);
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); any = true; continue; }
      p.vy -= p.g * dt;
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += dt * 5;
      const k = p.life / p.max;
      const s = (p.s + p.grow * (1 - k)) * Math.min(1, k * 3);
      _e.set(p.rot, p.rot * 0.7, 0); _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      any = true;
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.sp.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) f.sp.visible = false;
    }
    for (const b of this.balls) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = 1 - b.life / 0.45;
      b.m.scale.setScalar(b.r * (0.3 + k * 0.9));
      b.m.material.opacity = Math.max(0, 0.85 * (1 - k));
      b.m.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.2);
      if (b.life <= 0) b.m.visible = false;
    }
  }
}
