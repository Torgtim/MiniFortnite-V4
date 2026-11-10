// "1998 mode": renders the scene into a small render target and blows it up with chunky
// pixels, 15-bit colour and ordered (Bayer) dithering, plus optional CRT scanlines.

import * as THREE from '../lib/three.module.min.js?v=61';

const FRAG = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uLevels;
uniform float uScan;
varying vec2 vUv;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
  return 0.0;
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  #ifdef TONE_MAPPING
  c = toneMapping(c);
  #endif
  vec4 o = linearToOutputTexel(vec4(c, 1.0));
  vec2 px = floor(vUv * uRes);
  o.rgb = floor(o.rgb * uLevels + bayer(px) + 0.5) / uLevels;
  if (uScan > 0.0) {
    float line = mod(gl_FragCoord.y, 3.0) < 1.0 ? 1.0 - uScan : 1.0;
    vec2 v = vUv - 0.5;
    o.rgb *= line * (1.0 - dot(v, v) * 0.45);
  }
  gl_FragColor = vec4(o.rgb, 1.0);
}`;

export class RetroPass {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(320, 240, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(320, 240) }, uLevels: { value: 31 }, uScan: { value: 0.18 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, lines = 300, scanlines = true) {
    const H = Math.max(120, Math.round(lines)), W = Math.max(160, Math.round(H * w / h));
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
    this.mat.uniforms.uRes.value.set(W, H);
    this.mat.uniforms.uScan.value = scanlines ? 0.18 : 0;
  }

  render(renderer, scene, camera) {
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
