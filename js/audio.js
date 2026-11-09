// Tiny WebAudio synth: every sound effect is generated, no audio files needed.

import { clamp } from './util.js';
import { settings } from './settings.js';

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.0;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolume();
    } catch (e) { this.ctx = null; }
  }

  applyVolume() { if (this.master) this.master.gain.value = settings.volume; }

  _noise(dur, freq, q, gain, type = 'bandpass') {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  _tone(freq, dur, type, gain, slideTo) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** pos: entity / {x,y,z} for positional falloff, null for UI sounds. */
  play(name, pos) {
    if (!this.ctx || settings.volume <= 0) return;
    let v = 1;
    const p = this.game.player;
    if (pos && p && pos !== p && pos.x !== undefined && this.game.mode !== 'lobby') {
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      v = clamp(1 - d / 110, 0, 1);
      v *= v;
      if (v < 0.02) return;
    }
    switch (name) {
      case 'shoot_pistol': this._noise(0.09, 1700, 0.8, 0.5 * v); break;
      case 'shoot_smg': this._noise(0.06, 2100, 0.8, 0.4 * v); break;
      case 'shoot_rifle': this._noise(0.1, 1300, 0.7, 0.55 * v); this._tone(160, 0.06, 'square', 0.12 * v, 90); break;
      case 'shoot_shotgun': this._noise(0.22, 700, 0.5, 0.85 * v); this._tone(90, 0.15, 'sawtooth', 0.2 * v, 40); break;
      case 'shoot_sniper': this._noise(0.32, 500, 0.4, 0.9 * v); this._tone(70, 0.3, 'sawtooth', 0.25 * v, 35); break;
      case 'shoot_launcher': this._noise(0.35, 300, 0.4, 0.8 * v); this._tone(120, 0.3, 'sawtooth', 0.2 * v, 50); break;
      case 'quiet': this._noise(0.05, 3200, 1, 0.25 * v); break;
      case 'hit': this._tone(900, 0.05, 'square', 0.12, 700); break;
      case 'hit_head': this._tone(1500, 0.08, 'square', 0.14, 1000); break;
      case 'reload': this._noise(0.04, 2500, 2, 0.3 * v); setTimeout(() => this.ctx && this._noise(0.05, 1800, 2, 0.3 * v), 280); break;
      case 'empty': this._noise(0.03, 3000, 3, 0.25 * v); break;
      case 'pickup': this._tone(520, 0.08, 'triangle', 0.25, 880); break;
      case 'chest': [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.14, 'triangle', 0.22 * v), i * 70)); break;
      case 'build': this._tone(180, 0.09, 'square', 0.22, 90); this._noise(0.05, 900, 1, 0.2); break;
      case 'deny': this._tone(110, 0.1, 'sawtooth', 0.15); break;
      case 'boom': this._noise(0.7, 260, 0.5, 1.0 * v, 'lowpass'); this._tone(70, 0.5, 'sine', 0.4 * v, 28); break;
      case 'harvest': this._noise(0.07, 900, 1.2, 0.35 * v); this._tone(300, 0.06, 'square', 0.1 * v, 200); break;
      case 'swing': this._noise(0.1, 700, 0.6, 0.12 * v); break;
      case 'heal': this._tone(440, 0.25, 'sine', 0.22, 880); break;
      case 'hurt': this._tone(140, 0.12, 'sawtooth', 0.22, 70); break;
      case 'eliminate': this._tone(660, 0.12, 'square', 0.2); setTimeout(() => this.ctx && this._tone(990, 0.2, 'square', 0.2), 110); break;
      case 'edit': this._tone(620, 0.05, 'square', 0.14 * v, 900); this._noise(0.05, 1800, 1.5, 0.15 * v); break;
      case 'edit_open': this._tone(400, 0.06, 'triangle', 0.16, 600); break;
      case 'tile': this._tone(1200, 0.025, 'square', 0.07); break;
      case 'break': this._noise(0.25, 600, 0.6, 0.45 * v); this._tone(120, 0.18, 'square', 0.12 * v, 60); break;
      case 'slide': this._noise(0.35, 500, 0.5, 0.18 * v, 'lowpass'); break;
      case 'mantle': this._noise(0.12, 900, 0.8, 0.15 * v); break;
      case 'crit': this._tone(880, 0.06, 'square', 0.16 * v, 1320); this._noise(0.06, 1400, 1.2, 0.3 * v); break;
      case 'shield_break': [1400, 900, 600].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.08, 'triangle', 0.18), i * 45)); break;
      case 'throw': this._noise(0.12, 1200, 0.7, 0.18 * v); break;
      case 'bounce': this._tone(500, 0.04, 'triangle', 0.12 * v, 300); break;
      case 'hum': this._tone(196, 0.5, 'sine', 0.05 * v, 220); this._tone(294, 0.5, 'sine', 0.035 * v, 330); break;
      case 'supply': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.18, 'square', 0.12), i * 110)); break;
      case 'horn': this._tone(330, 0.3, 'square', 0.18, 320); setTimeout(() => this.ctx && this._tone(262, 0.4, 'square', 0.18, 255), 320); break;
      case 'land': this._noise(0.15, 400, 0.6, 0.3 * v, 'lowpass'); break;
      case 'glider': this._noise(0.4, 300, 0.5, 0.15, 'lowpass'); break;
      case 'emote': [523, 659, 784, 659, 523, 784, 1046].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.12, 'square', 0.08 * v), i * 140)); break;
      default: break;
    }
  }
}
