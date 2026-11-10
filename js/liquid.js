// Animated water / ice water / quicksand / lava surface (custom shader with waves, ripples,
// shore foam and fog).

import * as THREE from '../lib/three.module.min.js?v=67';

const VERT = /* glsl */`
uniform float uTime;
uniform float uWave;
attribute float shore;
varying float vShore;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 0.16 + uTime * 1.1) * 0.5 + sin(wp.z * 0.21 - uTime * 0.9) * 0.35 + sin((wp.x + wp.z) * 0.07 + uTime * 0.6) * 0.6;
  wp.y += w * uWave;
  vShore = shore;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uOpacity;
uniform float uGlow;
uniform float uPixel;
varying float vShore;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // chunky pixel ripples (snap to a world grid for the retro look)
  vec2 q = floor(vWorld.xz * uPixel) / uPixel;
  float r = sin(q.x * 0.9 + uTime * 1.7) * sin(q.y * 0.8 - uTime * 1.3);
  float n = hash(floor(q * 0.5 + floor(uTime * 2.0) * 0.37));
  vec3 col = mix(uDeep, uColor, 0.55 + 0.25 * r + 0.1 * n);
  float foam = smoothstep(0.55, 0.95, vShore + 0.18 * sin(uTime * 2.0 + vWorld.x * 0.4 + vWorld.z * 0.3));
  col = mix(col, uFoam, foam * 0.8);
  col += uGlow * (0.35 + 0.35 * r + 0.3 * n) * uColor;
  gl_FragColor = vec4(col, mix(uOpacity, 1.0, foam * 0.6));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const LOOK = {
  water: { deep: '#123a6e', foam: '#e8f6ff', wave: 0.22, glow: 0, pixel: 1.0 },
  icy: { deep: '#3f8fb8', foam: '#ffffff', wave: 0.08, glow: 0, pixel: 1.0 },
  quicksand: { deep: '#7a5422', foam: '#e8cf96', wave: 0.05, glow: 0, pixel: 0.8 },
  lava: { deep: '#8a1400', foam: '#ffe27a', wave: 0.18, glow: 0.9, pixel: 0.7 },
};

/** Build the liquid meshes. heightAt is used to paint foam along the shore. */
export function buildLiquid(liquid, heightAt, mapR) {
  const look = LOOK[liquid.type] || LOOK.water;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWave: { value: look.wave }, uColor: { value: new THREE.Color(liquid.color) },
      uDeep: { value: new THREE.Color(look.deep) }, uFoam: { value: new THREE.Color(look.foam) },
      uOpacity: { value: liquid.opacity }, uGlow: { value: look.glow }, uPixel: { value: look.pixel },
    }]),
    vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: liquid.opacity < 1, depthWrite: liquid.opacity >= 0.95,
  });
  const group = new THREE.Group();
  // detailed inner sheet with shore foam
  const S = (mapR + 70) * 2, seg = 180;
  const inner = new THREE.PlaneGeometry(S, S, seg, seg).rotateX(-Math.PI / 2);
  const pos = inner.attributes.position;
  const shore = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z) - liquid.y;
    shore[i] = h > -2.2 ? Math.max(0, 1 - Math.abs(h + 0.2) / 2.0) : 0;
  }
  inner.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
  const a = new THREE.Mesh(inner, mat);
  // far ocean (no foam): four sheets around the inner square so nothing overlaps
  group.add(a);
  const H = S / 2, F = 1300;
  for (const [x0, z0, x1, z1] of [[-F, -F, F, -H], [-F, H, F, F], [-F, -H, -H, H], [H, -H, F, H]]) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 12, 12).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    g.setAttribute('shore', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    group.add(new THREE.Mesh(g, mat));
  }
  group.position.y = liquid.y;
  group.userData.mat = mat;
  return group;
}
