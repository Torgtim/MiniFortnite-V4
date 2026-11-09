// The shrinking storm circle (battle-royale zone).

import * as THREE from '../lib/three.module.min.js?v=41';
import { lerp, mulberry32 } from './util.js?v=41';
import { MAP_R } from './world.js?v=41';

const PHASES = [
  { wait: 75, shrink: 40, r: 140, dmg: 1 },
  { wait: 40, shrink: 30, r: 90, dmg: 2 },
  { wait: 35, shrink: 25, r: 55, dmg: 4 },
  { wait: 30, shrink: 22, r: 28, dmg: 6 },
  { wait: 25, shrink: 18, r: 12, dmg: 8 },
  { wait: 15, shrink: 15, r: 0, dmg: 10 },
];

export class Storm {
  constructor(game) {
    this.game = game;
    const geo = new THREE.CylinderGeometry(1, 1, 220, 72, 1, true);
    // vertical fade + swirling stripes, drawn into a small texture
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    const g = cv.getContext('2d');
    for (let y = 0; y < 128; y++) {
      const k = Math.pow(y / 127, 1.6); // 0 at the top of the texture, 1 at the bottom
      for (let x = 0; x < 64; x++) {
        const stripe = 0.75 + 0.25 * Math.sin((x / 64) * Math.PI * 8 + y * 0.15);
        g.fillStyle = `rgba(255,255,255,${(0.05 + 0.6 * k) * stripe})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.wrapS = THREE.RepeatWrapping; this.tex.repeat.set(10, 1);
    this.wall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x8a3dff, map: this.tex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.wall.position.y = 70;
    this.wall.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.wall);
    this.reset();
  }

  reset(seed = 1) {
    this.rnd = mulberry32(seed * 977 + 13);
    this.phase = -1;
    this.t = 0;
    this.state = 'idle'; // idle -> waiting -> shrinking
    this.cx = 0; this.cz = 0; this.r = MAP_R + 130;
    this.fromX = 0; this.fromZ = 0; this.fromR = this.r;
    this.toX = 0; this.toZ = 0; this.toR = this.r;
    this.dmg = 0;
    this.timeLeft = 0;
    this._next();
    this._apply();
  }

  _next() {
    this.phase++;
    const p = PHASES[Math.min(this.phase, PHASES.length - 1)];
    this.fromX = this.cx; this.fromZ = this.cz; this.fromR = this.r;
    const slack = Math.max(0, Math.min(this.r, MAP_R) - p.r) * 0.85;
    const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * slack;
    this.toX = this.cx + Math.cos(a) * d;
    this.toZ = this.cz + Math.sin(a) * d;
    this.toR = p.r;
    this.dmg = p.dmg;
    this.state = 'waiting';
    this.t = 0;
    this.dur = p.wait;
    this.shrinkDur = p.shrink;
  }

  update(dt) {
    if (this.state === 'waiting') {
      this.t += dt;
      this.timeLeft = this.dur - this.t;
      if (this.t >= this.dur) { this.state = 'shrinking'; this.t = 0; }
    } else if (this.state === 'shrinking') {
      this.t += dt;
      const k = Math.min(1, this.t / this.shrinkDur);
      this.cx = lerp(this.fromX, this.toX, k);
      this.cz = lerp(this.fromZ, this.toZ, k);
      this.r = lerp(this.fromR, this.toR, k);
      this.timeLeft = this.shrinkDur - this.t;
      if (k >= 1) {
        if (this.phase >= PHASES.length - 1) this.timeLeft = 0;
        else this._next();
      }
    }
    this._apply();
  }

  _apply() {
    if (this.tex) this.tex.offset.x = (this.tex.offset.x + 0.0006) % 1;
    const r = Math.max(0.5, this.r);
    this.wall.scale.set(r, 1, r);
    this.wall.position.x = this.cx;
    this.wall.position.z = this.cz;
  }

  outside(x, z) {
    return Math.hypot(x - this.cx, z - this.cz) > this.r;
  }

  label() {
    if (this.state === 'waiting') return { text: 'STORM CLOSES IN', t: this.timeLeft };
    return { text: 'STORM SHRINKING', t: this.timeLeft };
  }
}
