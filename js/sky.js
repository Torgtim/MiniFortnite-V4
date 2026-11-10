// Sky dome (gradient + sun glow + stars), drifting low-poly clouds and per-season weather
// particles (snow, dust, embers...). Everything follows the camera.

import * as THREE from '../lib/three.module.min.js?v=56';
import { mulberry32 } from './util.js?v=56';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir; uniform float uStars; uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSun * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25);
  if (uStars > 0.0) {
    vec3 c = floor(d * 260.0);
    float st = step(0.9965, hash(c)) * smoothstep(0.05, 0.4, d.y);
    col += vec3(st) * uStars * (0.6 + 0.4 * sin(uTime * 3.0 + hash(c) * 40.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WEATHER = {
  1: { n: 120, color: '#fff7c0', size: 0.09, fall: -0.2, drift: 0.6, opacity: 0.5 },   // pollen
  2: { n: 1400, color: '#ffffff', size: 0.09, fall: 2.2, drift: 0.9, opacity: 0.9 },  // snow
  3: { n: 400, color: '#e8c890', size: 0.07, fall: 0.15, drift: 3.5, opacity: 0.5 },    // dust
  4: { n: 600, color: '#ff8a3d', size: 0.1, fall: -1.4, drift: 0.8, opacity: 0.85 },  // embers
};

let _dot = null;
function dotTexture() {
  if (_dot) return _dot;
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill();
  _dot = new THREE.CanvasTexture(cv);
  _dot.magFilter = THREE.NearestFilter;
  return _dot;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) }, uStars: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.clouds = null;
    this.weather = null;
    scene.add(this.group);
  }

  /** Apply a season's colours and rebuild clouds/weather. */
  setSeason(s, sunDir, opts = {}) {
    const top = new THREE.Color(s.sky);
    const hsl = {}; top.getHSL(hsl);
    top.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * 0.78);
    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.set(s.fog);
    this.uniforms.uSun.value.set(s.sun);
    this.uniforms.uSunDir.value.copy(sunDir).normalize();
    this.uniforms.uStars.value = s.id === 4 ? 1 : 0;

    if (this.clouds) { this.group.remove(this.clouds); this.clouds.geometry.dispose(); this.clouds = null; }
    if (opts.clouds !== false) {
      const rnd = mulberry32(s.seed * 3 + 1);
      const N = 34 * 6;
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: s.id === 4 ? 0x2a0a40 : 0x8a8a8a }), N);
      const dummy = new THREE.Object3D(), col = new THREE.Color(s.id === 4 ? '#4a2a6a' : s.id === 3 ? '#fff1dc' : '#ffffff');
      this.cloudData = [];
      let k = 0;
      for (let c = 0; c < 34; c++) {
        const cx = (rnd() - 0.5) * 900, cz = (rnd() - 0.5) * 900, cy = 95 + rnd() * 50, sz = 6 + rnd() * 9;
        for (let p = 0; p < 6; p++) {
          const o = { x: cx + (rnd() - 0.5) * sz * 2.4, y: cy + (rnd() - 0.5) * sz * 0.4, z: cz + (rnd() - 0.5) * sz * 1.2, s: sz * (0.5 + rnd() * 0.6) };
          this.cloudData.push(o);
          dummy.position.set(o.x, o.y, o.z); dummy.scale.set(o.s * 1.4, o.s * 0.55, o.s); dummy.updateMatrix();
          m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, col); k++;
        }
      }
      m.frustumCulled = false;
      this.clouds = m;
      this.group.add(m);
    }

    if (this.weather) { this.group.remove(this.weather); this.weather.geometry.dispose(); this.weather = null; }
    const W = WEATHER[s.id];
    if (W && opts.weather !== false) {
      const rnd = mulberry32(99);
      const pos = new Float32Array(W.n * 3);
      for (let i = 0; i < W.n; i++) { pos[i * 3] = (rnd() - 0.5) * 60; pos[i * 3 + 1] = rnd() * 30; pos[i * 3 + 2] = (rnd() - 0.5) * 60; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.weather = new THREE.Points(g, new THREE.PointsMaterial({ color: W.color, size: W.size, map: dotTexture(), alphaTest: 0.3, transparent: true, opacity: W.opacity, depthWrite: false }));
      this.weather.frustumCulled = false;
      this.weatherDef = W;
      this.weatherBase = pos.slice();
      this.group.add(this.weather);
    }
  }

  update(dt, time, camera) {
    this.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    if (this.clouds) {
      // slow wind drift, wrapped around the camera
      const m = this.clouds, dummy = this._d || (this._d = new THREE.Object3D());
      const off = time * 1.6;
      for (let i = 0; i < this.cloudData.length; i++) {
        const o = this.cloudData[i];
        let x = ((o.x + off - camera.position.x + 450) % 900 + 900) % 900 - 450 + camera.position.x;
        dummy.position.set(x, o.y, o.z); dummy.scale.set(o.s * 1.4, o.s * 0.55, o.s); dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.weather) {
      const W = this.weatherDef, p = this.weather.geometry.attributes.position, b = this.weatherBase;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < p.count; i++) {
        const sway = Math.sin(time * 0.7 + i) * W.drift;
        let x = b[i * 3] + sway + time * W.drift * 0.6, y = b[i * 3 + 1] - time * W.fall, z = b[i * 3 + 2] + Math.cos(time * 0.5 + i * 1.3) * W.drift * 0.5;
        x = ((x - cx + 30) % 60 + 60) % 60 - 30 + cx;
        y = ((y - cy + 12) % 30 + 30) % 30 - 12 + cy;
        z = ((z - cz + 30) % 60 + 60) % 60 - 30 + cz;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    }
  }
}
