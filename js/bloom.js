// Small bloom post-process: scene -> HDR target, bright pass at 1/4 size, separable blur,
// composite with tone mapping + sRGB output. Makes neon, lava, loot beams and flashes glow.

import * as THREE from '../lib/three.module.min.js?v=41';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = /* glsl */`
uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
}`;

const BLUR = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;
  s += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uStrength;
  #ifdef TONE_MAPPING
  c = toneMapping(c);
  #endif
  gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
}`;

export class BloomPass {
  constructor() {
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.scene = new THREE.WebGLRenderTarget(4, 4, { ...opt, samples: 4 });
    this.a = new THREE.WebGLRenderTarget(4, 4, opt);
    this.b = new THREE.WebGLRenderTarget(4, 4, opt);
    const mk = (frag, uniforms, toneMapped = false) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped });
    this.bright = mk(BRIGHT, { tSrc: { value: null }, uThreshold: { value: 0.85 } });
    this.blur = mk(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.comp = mk(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, uStrength: { value: 0.7 } }, true);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bright);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    w = Math.max(4, Math.floor(w)); h = Math.max(4, Math.floor(h));
    this.scene.setSize(w, h);
    const qw = Math.max(4, w >> 2), qh = Math.max(4, h >> 2);
    this.a.setSize(qw, qh); this.b.setSize(qw, qh);
    this.texel = [1 / qw, 1 / qh];
  }

  _pass(renderer, mat, target) {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.qscene, this.cam);
  }

  render(renderer, scene, camera, strength = 0.7, threshold = 0.85) {
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);
    this.bright.uniforms.tSrc.value = this.scene.texture;
    this.bright.uniforms.uThreshold.value = threshold;
    this._pass(renderer, this.bright, this.a);
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc.value = this.a.texture; this.blur.uniforms.uDir.value.set(this.texel[0] * (1 + i), 0);
      this._pass(renderer, this.blur, this.b);
      this.blur.uniforms.tSrc.value = this.b.texture; this.blur.uniforms.uDir.value.set(0, this.texel[1] * (1 + i));
      this._pass(renderer, this.blur, this.a);
    }
    this.comp.uniforms.tScene.value = this.scene.texture;
    this.comp.uniforms.tBloom.value = this.a.texture;
    this.comp.uniforms.uStrength.value = strength;
    this._pass(renderer, this.comp, null);
  }
}
