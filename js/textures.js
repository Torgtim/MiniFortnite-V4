// Procedural pixel-art textures (drawn on small canvases, filtered "nearest" for that crunchy
// late-90s 3D look). No image files needed.

import * as THREE from '../lib/three.module.min.js?v=44';
import { mulberry32 } from './util.js?v=44';

const cache = {};

function make(name, size, draw, { repeat = true, srgb = true } = {}) {
  if (cache[name]) return cache[name];
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size, mulberry32(name.length * 7919 + size));
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache[name] = t;
  return t;
}

const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return '#' + c.getHexString();
};

function speckle(g, S, rnd, base, lo, hi, n) {
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) {
    const k = lo + rnd() * (hi - lo);
    g.fillStyle = `rgba(${k},${k},${k},${0.25 + rnd() * 0.35})`;
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1 + Math.floor(rnd() * 2), 1);
  }
}

export const TEX = {
  // ---------------------------------------------------------------- building materials
  wood: () => make('wood', 64, (g, S, r) => {
    const rows = 4, h = S / rows;
    for (let i = 0; i < rows; i++) {
      const base = ['#c08a4e', '#b47d44', '#c9955a', '#a97340'][i % 4];
      g.fillStyle = base; g.fillRect(0, i * h, S, h);
      for (let k = 0; k < 14; k++) { g.fillStyle = shade(base, 0.82 + r() * 0.12); g.fillRect(Math.floor(r() * S), i * h + 2 + Math.floor(r() * (h - 4)), 6 + Math.floor(r() * 18), 1); }
      g.fillStyle = '#5a3a1c'; g.fillRect(0, i * h, S, 2);
      const seam = Math.floor(r() * S);
      g.fillRect(seam, i * h, 2, h);
      g.fillStyle = '#3a3a3a'; g.fillRect(seam - 3, i * h + 4, 2, 2); g.fillRect(seam + 3, i * h + 4, 2, 2);
      g.fillRect(seam - 3, i * h + h - 5, 2, 2); g.fillRect(seam + 3, i * h + h - 5, 2, 2);
    }
    g.fillStyle = '#4a2e14'; g.fillRect(0, 0, 3, S); g.fillRect(S - 3, 0, 3, S);
  }),
  brick: () => make('brick', 64, (g, S, r) => {
    g.fillStyle = '#9a9184'; g.fillRect(0, 0, S, S);
    const bh = 8, bw = 16;
    for (let y = 0; y < S / bh; y++) for (let x = -1; x < S / bw + 1; x++) {
      const ox = (y % 2) * (bw / 2);
      const c = ['#a84a35', '#b5543c', '#9c4230', '#bd5d44', '#a34b39'][Math.floor(r() * 5)];
      g.fillStyle = c; g.fillRect(x * bw + ox + 1, y * bh + 1, bw - 2, bh - 2);
      g.fillStyle = shade(c, 1.15); g.fillRect(x * bw + ox + 1, y * bh + 1, bw - 2, 1);
      g.fillStyle = shade(c, 0.75); g.fillRect(x * bw + ox + 1, y * bh + bh - 2, bw - 2, 1);
    }
  }),
  metal: () => make('metal', 64, (g, S, r) => {
    for (let x = 0; x < S; x++) {
      const k = 0.78 + 0.22 * Math.abs(Math.sin(x / S * Math.PI * 8));
      g.fillStyle = shade('#a7b0b8', k); g.fillRect(x, 0, 1, S);
    }
    g.fillStyle = '#5e666e'; g.fillRect(0, 0, S, 3); g.fillRect(0, S - 3, S, 3); g.fillRect(0, S / 2 - 1, S, 2);
    g.fillStyle = '#d8dde2';
    for (const y of [6, S / 2 + 4, S - 7]) for (let x = 4; x < S; x += 15) g.fillRect(x, y, 2, 2);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(120,70,40,0.25)'; g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 2); }
  }),

  // ---------------------------------------------------------------- terrain detail (multiplied with vertex colours)
  grass: () => make('grass', 64, (g, S, r) => {
    speckle(g, S, r, '#e9e9e9', 150, 255, 900);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.4})`; const x = Math.floor(r() * S), y = Math.floor(r() * S); g.fillRect(x, y, 1, 2 + Math.floor(r() * 2)); }
  }),
  snow: () => make('snow', 64, (g, S, r) => {
    speckle(g, S, r, '#f2f2f2', 190, 255, 500);
    for (let i = 0; i < 30; i++) { g.fillStyle = '#ffffff'; g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 1); }
  }),
  sand: () => make('sand', 64, (g, S, r) => {
    speckle(g, S, r, '#ededed', 170, 255, 700);
    for (let y = 0; y < S; y += 6) {
      g.fillStyle = 'rgba(150,150,150,0.25)';
      for (let x = 0; x < S; x++) g.fillRect(x, (y + Math.round(Math.sin(x / S * Math.PI * 4) * 2) + S) % S, 1, 1);
    }
  }),
  basalt: () => make('basalt', 64, (g, S, r) => {
    speckle(g, S, r, '#e0e0e0', 120, 230, 800);
    g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 18; y += (r() - 0.5) * 18; g.lineTo(x, y); }
      g.stroke();
    }
  }),

  // ---------------------------------------------------------------- houses (tinted by the season colour)
  siding: () => make('siding', 64, (g, S) => {
    for (let y = 0; y < S; y += 8) {
      g.fillStyle = '#f2f2f2'; g.fillRect(0, y, S, 8);
      g.fillStyle = '#d0d0d0'; g.fillRect(0, y + 6, S, 2);
      g.fillStyle = '#ffffff'; g.fillRect(0, y, S, 1);
    }
  }),
  plaster: () => make('plaster', 64, (g, S, r) => speckle(g, S, r, '#efefef', 190, 255, 600)),
  logs: () => make('logs', 64, (g, S, r) => {
    for (let y = 0; y < S; y += 16) {
      for (let k = 0; k < 16; k++) { const v = 0.75 + 0.25 * Math.sin((k / 15) * Math.PI); g.fillStyle = shade('#e6e6e6', v); g.fillRect(0, y + k, S, 1); }
      for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(90,90,90,0.4)'; g.fillRect(Math.floor(r() * S), y + 3 + Math.floor(r() * 10), 8 + Math.floor(r() * 12), 1); }
    }
  }),
  adobe: () => make('adobe', 64, (g, S, r) => {
    speckle(g, S, r, '#eeeeee', 170, 250, 700);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(160,160,160,0.35)'; g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 10 + Math.floor(r() * 16), 5 + Math.floor(r() * 6)); }
  }),
  panel: () => make('panel', 64, (g, S) => {
    g.fillStyle = '#d8d8e8'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#9a9ab0'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S); g.fillRect(S / 2, 0, 2, S); g.fillRect(0, S / 2, S, 2);
    g.fillStyle = '#ffffff'; for (const [x, y] of [[6, 6], [S / 2 + 6, 6], [6, S / 2 + 6], [S / 2 + 6, S / 2 + 6]]) g.fillRect(x, y, 3, 3);
  }),
  shingles: () => make('shingles', 64, (g, S, r) => {
    g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 8) for (let x = -8; x < S; x += 10) {
      const ox = (y / 8) % 2 ? 5 : 0, k = 0.8 + r() * 0.25;
      g.fillStyle = shade('#e8e8e8', k); g.fillRect(x + ox + 1, y + 1, 8, 7);
      g.fillStyle = '#9a9a9a'; g.fillRect(x + ox + 1, y + 7, 8, 1);
    }
  }),
  floorboards: () => make('floorboards', 64, (g, S, r) => {
    for (let x = 0; x < S; x += 8) {
      g.fillStyle = shade('#e4e4e4', 0.85 + r() * 0.15); g.fillRect(x, 0, 8, S);
      g.fillStyle = '#8a8a8a'; g.fillRect(x, 0, 1, S); g.fillRect(x, Math.floor(r() * S), 8, 1);
    }
  }),
  twigs: () => make('twigs', 64, (g, S, r) => {
    g.clearRect(0, 0, S, S);
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = ['#8a6a34', '#a8844a', '#6e5228', '#c0a060'][Math.floor(r() * 4)];
      g.beginPath(); const x = r() * S, y = r() * S, a = r() * Math.PI * 2, l = 6 + r() * 16;
      g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }),
  crate: () => make('crate', 32, (g, S) => {
    g.fillStyle = '#e8b020'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#9a6a10'; g.fillRect(0, 0, S, 3); g.fillRect(0, S - 3, S, 3); g.fillRect(0, 0, 3, S); g.fillRect(S - 3, 0, 3, S);
    g.fillStyle = '#fff4b0'; g.fillRect(S / 2 - 3, S / 2 - 3, 6, 6);
  }),
};

/** Terrain detail texture name per season id. */
export const TERRAIN_TEX = { 1: 'grass', 2: 'snow', 3: 'sand', 4: 'basalt' };
/** House wall texture per season id. */
export const HOUSE_TEX = { 1: 'siding', 2: 'logs', 3: 'adobe', 4: 'panel' };
