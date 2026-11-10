// Tiny WebAudio synth: every sound effect is generated, no audio files needed.

import { clamp } from './util.js?v=67';
import { settings } from './settings.js?v=67';

// note name -> frequency ('C5', 'F#4', ...)
const NOTE_I = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
function note(n) { const m = n.match(/^([A-G]#?)(\d)$/); return 440 * Math.pow(2, (NOTE_I[m[1]] + (+m[2] - 4) * 12) / 12); }

// Original little loops, one per season (16th-note steps, '' = rest).
const SONGS = {
  1: { bpm: 128, lead: 'square', hat: true,
    mel: ['C5', '', 'E5', 'G5', '', 'E5', 'F5', '', 'A5', '', 'G5', 'E5', 'D5', '', 'C5', '', 'D5', '', 'F5', 'A5', '', 'F5', 'G5', '', 'B5', '', 'A5', 'G5', 'E5', '', 'D5', ''],
    bass: ['C3', '', '', '', 'C3', '', '', '', 'F2', '', '', '', 'G2', '', '', '', 'D3', '', '', '', 'D3', '', '', '', 'G2', '', '', '', 'G2', '', '', ''] },
  2: { bpm: 96, lead: 'triangle', hat: false,
    mel: ['A4', '', 'C5', '', 'E5', '', 'D5', 'C5', 'B4', '', '', '', 'G4', '', 'B4', '', 'A4', '', 'C5', '', 'E5', '', 'A5', 'G5', 'E5', '', '', '', 'D5', '', 'C5', ''],
    bass: ['A2', '', '', '', '', '', '', '', 'E2', '', '', '', '', '', '', '', 'F2', '', '', '', '', '', '', '', 'E2', '', '', '', '', '', '', ''] },
  3: { bpm: 116, lead: 'sawtooth', hat: true,
    mel: ['D5', '', '', 'A4', 'D5', '', 'F5', '', 'E5', '', 'D5', '', 'C5', '', 'A4', '', 'D5', '', '', 'A4', 'D5', '', 'G5', '', 'F5', '', 'E5', '', 'D5', '', '', ''],
    bass: ['D2', '', 'A2', '', 'D2', '', 'A2', '', 'C2', '', 'G2', '', 'C2', '', 'G2', '', 'D2', '', 'A2', '', 'D2', '', 'A2', '', 'A2', '', 'E2', '', 'A2', '', 'C3', ''] },
  4: { bpm: 108, lead: 'square', hat: true,
    mel: ['E4', 'G4', 'B4', 'E5', 'B4', 'G4', 'E4', 'G4', 'C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'E4', 'D4', 'F#4', 'A4', 'D5', 'A4', 'F#4', 'D4', 'F#4', 'B3', 'D#4', 'F#4', 'B4', 'F#4', 'D#4', 'B3', 'D#4'],
    bass: ['E2', '', '', '', '', '', '', '', 'C2', '', '', '', '', '', '', '', 'D2', '', '', '', '', '', '', '', 'B1', '', '', '', '', '', '', ''] },
};

// quiet sounds you only hear close by (footsteps, splashes, reload clicks)
const NEAR_SOUNDS = new Set(['step', 'splash', 'mag_out', 'mag_in', 'rack', 'shell_in', 'break_open', 'break_close', 'cyl_open', 'cyl_close', 'rocket_in']);

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

  applyVolume() {
    if (this.master) this.master.gain.value = settings.volume;
    if (this.musicGain) this.musicGain.gain.value = settings.music;
  }

  // ------------------------------------------------------------------ lobby music (tiny tracker)
  startMusic(seasonId) {
    if (!this.ctx) return;
    this.stopMusic();
    const song = SONGS[seasonId] || SONGS[1];
    if (!this.musicGain) { this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master); }
    this.musicGain.gain.value = settings.music;
    const stepDur = 60 / song.bpm / 4;
    let step = 0, next = this.ctx.currentTime + 0.1;
    const tick = () => {
      while (next < this.ctx.currentTime + 0.25) {
        const i = step % song.mel.length;
        const m = song.mel[i], bss = song.bass[i % song.bass.length];
        if (m) this._note(note(m), next, stepDur * 0.9, song.lead, 0.09);
        if (bss) this._note(note(bss), next, stepDur * 1.8, 'triangle', 0.16);
        if (song.hat && i % 2 === 1) this._hat(next);
        next += stepDur; step++;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 100);
  }

  // ------------------------------------------------------------------ ambience (wind while skydiving, storm rumble)
  _loop(freq, q, type) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { g, f };
  }

  ambience(wind, storm) {
    if (!this.ctx) return;
    if (!this.amb) this.amb = { wind: this._loop(500, 0.6, 'bandpass'), storm: this._loop(140, 0.8, 'lowpass') };
    const t = this.ctx.currentTime;
    this.amb.wind.g.gain.setTargetAtTime(wind * 0.35, t, 0.15);
    this.amb.wind.f.frequency.setTargetAtTime(300 + wind * 700, t, 0.2);
    this.amb.storm.g.gain.setTargetAtTime(storm * 0.5, t, 0.3);
  }

  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  _note(f, t, dur, type, gain) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + dur + 0.02);
  }

  _hat(t) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    src.connect(f); f.connect(g); g.connect(this.musicGain); src.start(t, Math.random() * 0.5, 0.05);
  }

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
      v = clamp(1 - d / (NEAR_SOUNDS.has(name) ? 32 : 110), 0, 1);
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
      // ---- reload foley
      case 'mag_out': this._noise(0.05, 2300, 3, 0.26 * v); this._tone(760, 0.03, 'square', 0.05 * v, 520); break;
      case 'mag_in': this._noise(0.05, 1500, 2, 0.38 * v); this._tone(300, 0.045, 'square', 0.11 * v, 190); break;
      case 'rack': this._noise(0.05, 2700, 2.5, 0.3 * v); setTimeout(() => this.ctx && (this._noise(0.06, 1500, 2, 0.36 * v), this._tone(240, 0.04, 'square', 0.1 * v, 150)), 95); break;
      case 'shell_in': this._noise(0.04, 2100, 3, 0.24 * v); this._tone(1150, 0.03, 'triangle', 0.05 * v, 820); break;
      case 'break_open': this._noise(0.08, 900, 1.5, 0.32 * v); this._tone(250, 0.06, 'square', 0.08 * v, 150); break;
      case 'break_close': this._noise(0.06, 1300, 2, 0.42 * v); this._tone(190, 0.07, 'square', 0.13 * v, 110); break;
      case 'cyl_open': this._noise(0.05, 2700, 3, 0.24 * v); this._tone(900, 0.03, 'triangle', 0.05 * v, 1100); break;
      case 'cyl_close': this._noise(0.05, 1800, 2.5, 0.36 * v); this._tone(520, 0.035, 'square', 0.09 * v, 320); break;
      case 'rocket_in': this._noise(0.2, 480, 0.8, 0.32 * v, 'lowpass'); setTimeout(() => this.ctx && this._tone(140, 0.08, 'square', 0.1 * v, 80), 140); break;
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
      case 'pad': this._tone(200, 0.35, 'square', 0.2 * v, 900); this._noise(0.2, 1200, 0.8, 0.2 * v); break;
      case 'rift': this._tone(300, 0.6, 'sine', 0.25 * v, 1600); this._tone(450, 0.6, 'triangle', 0.15 * v, 2200); break;
      case 'splash': this._noise(0.18, 900, 0.7, 0.18 * v + 0.02, 'lowpass'); break;
      case 'trap': this._noise(0.12, 2600, 1.5, 0.5 * v); this._tone(220, 0.15, 'square', 0.2 * v, 110); break;
      case 'alpaca': [660, 880, 1100, 1320, 1760].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.1, 'triangle', 0.18 * v), i * 60)); break;
      case 'sizzle': this._noise(0.35, 3000, 0.5, 0.3 * v, 'highpass'); this._tone(200, 0.2, 'sawtooth', 0.1 * v, 600); break;
      case 'step': if (v > 0.08) this._noise(0.05, 260 + Math.random() * 120, 1.2, 0.22 * v * v + 0.02, 'lowpass'); break;
      case 'step_me': this._noise(0.04, 300 + Math.random() * 100, 1.2, 0.06, 'lowpass'); break;
      case 'emote': [523, 659, 784, 659, 523, 784, 1046].forEach((f, i) => setTimeout(() => this.ctx && this._tone(f, 0.12, 'square', 0.08 * v), i * 140)); break;
      default: break;
    }
  }
}
