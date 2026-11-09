// The four seasons. Switching season swaps the ENTIRE map (terrain, buildings, props,
// colours, hazards) and the loot pool. Everything season-specific lives in this file.

import * as THREE from '../lib/three.module.min.js';
import { lerp, smoothstep } from './util.js';

const C = (hex) => new THREE.Color(hex);
const tmp = new THREE.Color();
const mix = (a, b, t) => tmp.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

// ---------- prop geometry helpers (all low-poly) ----------
const cyl = (rt, rb, h, seg = 5, y = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, y, 0);
const cone = (r, h, seg = 6, y = 0) => new THREE.ConeGeometry(r, h, seg).translate(0, y, 0);
const ico = (r, y = 0) => new THREE.IcosahedronGeometry(r, 0).translate(0, y, 0);
const oct = (r, sy, y = 0) => new THREE.OctahedronGeometry(r, 0).scale(1, sy, 1).translate(0, y, 0);
const box = (w, h, d, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);

const RARITY_GROUND = [40, 28, 18, 10, 4];

export const SEASONS = [
  // ------------------------------------------------------------------ SEASON 1
  {
    id: 1,
    name: 'Season 1',
    title: 'Greenfield',
    blurb: 'Rolling green hills, a big lake and sleepy hamlets. The classic island with the classic loot.',
    seed: 11,
    sky: '#8ec9f0', fog: '#a9d6f2', sun: '#fff1d0', sunI: 1.15, hemiSky: '#bfe3ff', hemiGround: '#5a7a4a', hemiI: 0.85,
    liquid: { type: 'water', y: -0.8, color: '#2f86d6', opacity: 0.82 },
    poiCount: 6,
    poiNames: ['Greenhill Hamlet', 'Fisher\'s Cove', 'Old Mill', 'Dusty Depot', 'Lonely Lodge', 'Tower Row'],
    building: { wall: '#dccaa2', roof: '#a8483a', floor: '#8a6d4a', trim: '#6e4a2c', roofStyle: 'gable' },
    terrain(x, z, n) {
      let h = (n.fbm(x * 0.010, z * 0.010, 4) - 0.5) * 16;
      h += (n.fbm(x * 0.04 + 50, z * 0.04, 2) - 0.5) * 2.2;
      const d = Math.hypot(x + 55, z - 45);
      h -= Math.exp(-((d / 32) ** 2)) * 9;
      return h + 2;
    },
    avoid: () => false,
    ground(h, slope, x, z, n, liquidY) {
      const v = n.noise(x * 0.09, z * 0.09);
      let c = mix(C('#58a845'), C('#3f8a38'), v);
      c = c.clone();
      if (h > 7) c.lerp(C('#8dc462'), Math.min(1, (h - 7) / 6));
      if (h < liquidY + 1.4) c.lerp(C('#d9c88e'), 0.85);
      if (slope > 0.30) c.lerp(C('#7d6a4f'), Math.min(1, (slope - 0.30) / 0.2));
      if (slope > 0.55) c.lerp(C('#8b8a84'), 0.8);
      return c;
    },
    props: [
      { res: 'wood', count: 140, hp: 100, yield: 12, r: 0.4, h: 5, scale: [0.8, 1.5], parts: [
        { geo: cyl(0.25, 0.35, 2.4, 5, 1.2), color: '#6b4a2b' }, { geo: ico(1.9, 3.7), color: '#3f9a3a' }] },
      { res: 'wood', count: 80, hp: 100, yield: 12, r: 0.35, h: 6, scale: [0.8, 1.4], parts: [
        { geo: cyl(0.2, 0.28, 1.6, 5, 0.8), color: '#5f4126' }, { geo: cone(1.6, 2.8, 7, 2.6), color: '#2f7a3a' }, { geo: cone(1.1, 2.2, 7, 4.2), color: '#3a8a42' }] },
      { res: 'brick', count: 55, hp: 120, yield: 10, r: 1.1, h: 1.6, scale: [0.8, 1.8], parts: [{ geo: ico(1.3, 0.55), color: '#8f8f8f' }] },
      { res: 'metal', count: 24, hp: 120, yield: 8, r: 0.9, h: 1.2, scale: [0.9, 1.3], parts: [
        { geo: box(1.7, 1.0, 1.2, 0.5), color: '#6d6d73' }, { geo: box(0.9, 0.5, 0.9, 1.25), color: '#8a5a3a' }] },
    ],
    decor: [
      { geo: cone(0.09, 0.32, 3, 0.15), colors: ['#6fbf4a', '#7fd05a', '#5fae3c', '#8cd46a'], count: 3200, scale: [0.7, 1.3] },
      { geo: oct(0.11, 1.2, 0.32), colors: ['#ff5a5a', '#ffd84a', '#ffffff', '#b07cff', '#ff8ad8'], count: 600, scale: [0.8, 1.3] },
      { geo: ico(0.6, 0.3), colors: ['#3f8a38', '#4a9a3f', '#357a30'], count: 160, scale: [0.6, 1.3] },
    ],
    weapons: [['pistol', 14], ['pump', 12], ['ar', 14], ['smg', 12], ['sniper', 6], ['rocket', 4]],
    items: {
      heal_s: { name: 'Bandage', color: '#f4f4f4', w: 30 }, heal_l: { name: 'Medkit', color: '#ff4d4d', w: 10 },
      shield_s: { name: 'Mini Shield', color: '#4da6ff', w: 22 }, shield_l: { name: 'Big Shield', color: '#2f6bff', w: 8 },
      nade: { name: 'Grenade', color: '#4f7a3a', w: 14 },
    },
  },

  // ------------------------------------------------------------------ SEASON 2
  {
    id: 2,
    name: 'Season 2',
    title: 'Frostbite',
    blurb: 'Snowy peaks, pine forests and a frozen lake in the middle. Cold weapons, cold hands.',
    seed: 22,
    sky: '#cfe6f5', fog: '#dcebf5', sun: '#e8f0ff', sunI: 0.95, hemiSky: '#e8f4ff', hemiGround: '#8aa0b4', hemiI: 0.95,
    liquid: { type: 'icy', y: -0.8, color: '#7fd0ee', opacity: 0.85 },
    poiCount: 6,
    poiNames: ['Pinecrest Camp', 'Frozen Pier', 'Snowdrift Mine', 'Cabin Ridge', 'Glacier Station', 'Icebox Depot'],
    building: { wall: '#7a5230', roof: '#eef3f7', floor: '#5b4129', trim: '#4a3220', roofStyle: 'gable' },
    terrain(x, z, n) {
      let h = (n.fbm(x * 0.012, z * 0.012, 4) - 0.5) * 20 + (n.fbm(x * 0.05, z * 0.05, 2) - 0.5) * 3 + 3;
      const d = Math.hypot(x - 40, z + 50);
      const w = Math.exp(-((d / 38) ** 4));
      h = lerp(h, 0.45, w);
      return h;
    },
    avoid: (x, z) => Math.hypot(x - 40, z + 50) < 50,
    ground(h, slope, x, z, n, liquidY) {
      const v = n.noise(x * 0.1, z * 0.1);
      let c = mix(C('#f3f7fb'), C('#dfe9f2'), v).clone();
      const inLake = Math.hypot(x - 40, z + 50) < 40 && h < 0.8;
      if (inLake) c.set('#a9ddf2').lerp(C('#c9ecf8'), v);
      else if (h < liquidY + 1.2) c.lerp(C('#9fb4c4'), 0.7);
      if (!inLake && slope > 0.32) c.lerp(C('#7b8590'), Math.min(1, (slope - 0.32) / 0.2));
      return c;
    },
    props: [
      { res: 'wood', count: 230, hp: 100, yield: 12, r: 0.4, h: 6, scale: [0.8, 1.5], parts: [
        { geo: cyl(0.2, 0.3, 1.6, 5, 0.8), color: '#5a3f26' }, { geo: cone(1.7, 3.0, 6, 2.9), color: '#2f6b4a' },
        { geo: cone(1.25, 2.4, 6, 4.5), color: '#3b7d58' }, { geo: cone(0.7, 1.2, 6, 5.6), color: '#f2f7fb' }] },
      { res: 'brick', count: 50, hp: 120, yield: 10, r: 1.1, h: 1.6, scale: [0.8, 1.8], parts: [{ geo: ico(1.3, 0.55), color: '#b8cfe0' }] },
      { res: 'metal', count: 22, hp: 120, yield: 8, r: 0.8, h: 2.2, scale: [0.8, 1.4], parts: [{ geo: oct(0.8, 1.8, 1.2), color: '#7fd6ff' }] },
    ],
    decor: [
      { geo: ico(0.55, 0.05).scale(1, 0.45, 1), colors: ['#ffffff', '#eef5fb', '#e2ecf5'], count: 500, scale: [0.7, 1.8] },
      { geo: oct(0.16, 2.6, 0.36), colors: ['#9fe3ff', '#c8f1ff', '#7fd0ee'], count: 320, scale: [0.6, 1.4] },
      { geo: cone(0.5, 1.1, 5, 0.55), colors: ['#2f6b4a', '#3b7d58', '#2a5a40'], count: 260, scale: [0.6, 1.2] },
    ],
    weapons: [['hand_cannon', 12], ['double_barrel', 12], ['burst_ar', 14], ['frost_smg', 14], ['hunting_rifle', 7], ['crossbow', 5]],
    items: {
      heal_s: { name: 'Hot Cocoa', color: '#9b5a34', w: 30 }, heal_l: { name: 'Campfire Kit', color: '#ff8a3d', w: 10 },
      shield_s: { name: 'Frost Flask', color: '#8fe3ff', w: 22 }, shield_l: { name: 'Ice Armor', color: '#4fc3ff', w: 8 },
      nade: { name: 'Snowball Bomb', color: '#e8f6ff', w: 14 },
    },
  },

  // ------------------------------------------------------------------ SEASON 3
  {
    id: 3,
    name: 'Season 3',
    title: 'Dustbowl',
    blurb: 'Layered desert mesas, cacti and adobe towns. Wild-west loot, quicksand around the island.',
    seed: 33,
    sky: '#f3cf8e', fog: '#f1d8a6', sun: '#ffd9a0', sunI: 1.25, hemiSky: '#ffe6b8', hemiGround: '#b8803c', hemiI: 0.8,
    liquid: { type: 'quicksand', y: -0.8, color: '#b98a3d', opacity: 0.95 },
    poiCount: 6,
    poiNames: ['Dry Gulch', 'Rattlesnake Wells', 'Adobe Flats', 'Sundown Saloon', 'Mesa Point', 'Ghost Town'],
    building: { wall: '#d8a15a', roof: '#b9773a', floor: '#a97a45', trim: '#8a5a2c' },
    terrain(x, z, n) {
      const t = (n.fbm(x * 0.008, z * 0.008, 3) * 5.2) / 3.2;
      const fl = Math.floor(t), fr = t - fl;
      const h = (fl + smoothstep(0.42, 0.58, fr)) * 3.2;
      return h + (n.fbm(x * 0.05, z * 0.05, 2) - 0.5) * 1.1 - 1.5;
    },
    avoid: () => false,
    ground(h, slope, x, z, n, liquidY) {
      const v = n.noise(x * 0.08, z * 0.08);
      let c = mix(C('#e2b86b'), C('#d9a95a'), v).clone();
      const band = Math.floor(h / 1.6) % 2 === 0;
      if (band) c.lerp(C('#c97b3e'), 0.25);
      if (h < liquidY + 1.2) c.lerp(C('#f0d89c'), 0.7);
      if (slope > 0.25) c.lerp(C('#b5602f'), Math.min(1, (slope - 0.25) / 0.2));
      return c;
    },
    props: [
      { res: 'wood', count: 180, hp: 90, yield: 12, r: 0.45, h: 3.4, scale: [0.8, 1.5], parts: [
        { geo: cyl(0.35, 0.42, 3.2, 6, 1.6), color: '#4c8f45' },
        { geo: new THREE.CylinderGeometry(0.18, 0.18, 1.2, 6).rotateZ(Math.PI / 2).translate(0.7, 1.9, 0), color: '#4c8f45' },
        { geo: cyl(0.18, 0.18, 0.9, 6, 2.55).translate(1.3, 0, 0), color: '#4c8f45' }] },
      { res: 'brick', count: 70, hp: 140, yield: 10, r: 1.2, h: 2.0, scale: [0.9, 2.0], parts: [{ geo: ico(1.4, 0.7), color: '#c0703a' }] },
      { res: 'metal', count: 26, hp: 110, yield: 8, r: 0.6, h: 1.1, scale: [0.9, 1.3], parts: [
        { geo: cyl(0.5, 0.5, 1.0, 8, 0.5), color: '#8b3a2e' }, { geo: cyl(0.52, 0.52, 0.12, 8, 0.7), color: '#555' }] },
    ],
    decor: [
      { geo: ico(0.45, 0.28), colors: ['#8a7a3a', '#9a8a4a', '#7a6a32', '#a08a50'], count: 450, scale: [0.5, 1.2] },
      { geo: ico(0.2, 0.06).scale(1, 0.6, 1), colors: ['#b5602f', '#c97b3e', '#9a5028'], count: 700, scale: [0.6, 1.8] },
      { geo: cone(0.07, 0.4, 3, 0.2), colors: ['#d8c070', '#c0b060'], count: 900, scale: [0.6, 1.3] },
    ],
    weapons: [['revolver', 13], ['lever', 11], ['pump', 12], ['tommy', 13], ['scoped_ar', 10], ['grenade', 5]],
    items: {
      heal_s: { name: 'Water Canteen', color: '#6ab8ff', w: 30 }, heal_l: { name: 'Doc\'s Kit', color: '#ff5a3d', w: 10 },
      shield_s: { name: 'Leather Vest', color: '#a0703a', w: 22 }, shield_l: { name: 'Iron Plate', color: '#9aa0a8', w: 8 },
      nade: { name: 'Dynamite', color: '#d0302a', w: 14 },
    },
  },

  // ------------------------------------------------------------------ SEASON 4
  {
    id: 4,
    name: 'Season 4',
    title: 'Neon Meltdown',
    blurb: 'A glowing volcano island. Lava seas, neon crystal forests and plasma weapons only.',
    seed: 44,
    sky: '#1a0b2e', fog: '#2a1040', sun: '#a58bff', sunI: 0.95, hemiSky: '#ff7fe4', hemiGround: '#2de2ff', hemiI: 1.05,
    liquid: { type: 'lava', y: -0.8, color: '#ff5a14', opacity: 0.95, dps: 28 },
    poiCount: 5,
    poiNames: ['Reactor Ring', 'Obsidian Pods', 'Magma Dock', 'Neon Spire', 'Shard Yard'],
    building: { wall: '#25223a', roof: '#3a3560', floor: '#15131f', trim: '#ff2bd6' },
    terrain(x, z, n) {
      let h = (n.fbm(x * 0.02, z * 0.02, 5) - 0.5) * 14 + 2.5;
      const d = Math.hypot(x, z);
      h += 26 * Math.exp(-((d / 52) ** 2));
      h -= 32 * Math.exp(-((d / 10) ** 2));
      return h;
    },
    avoid: (x, z) => Math.hypot(x, z) < 72,
    ground(h, slope, x, z, n, liquidY) {
      const v = n.noise(x * 0.07, z * 0.07);
      let c = mix(C('#2b2638'), C('#1f1b2b'), v).clone();
      const vein = Math.abs(n.fbm(x * 0.045, z * 0.045, 2) - 0.5);
      if (vein < 0.018) c.set(vein < 0.009 ? '#ff2bd6' : '#2de2ff');
      if (h < liquidY + 1.0) c.lerp(C('#ff6a1a'), 0.85);
      if (slope > 0.35) c.lerp(C('#3b2f55'), Math.min(1, (slope - 0.35) / 0.2));
      return c;
    },
    props: [
      { res: 'wood', count: 170, hp: 100, yield: 12, r: 0.5, h: 5, scale: [0.8, 1.5], parts: [
        { geo: cyl(0.4, 0.55, 4.5, 5, 2.25), color: '#6a2d9e' }, { geo: oct(0.7, 1.4, 5.1), color: '#2de2ff', basic: true }] },
      { res: 'brick', count: 55, hp: 130, yield: 10, r: 1.1, h: 1.8, scale: [0.8, 1.8], parts: [{ geo: ico(1.3, 0.6), color: '#55406e' }] },
      { res: 'metal', count: 26, hp: 120, yield: 8, r: 0.6, h: 2.6, scale: [0.9, 1.3], parts: [
        { geo: box(0.9, 0.5, 0.9, 0.25), color: '#2a2a3a' }, { geo: box(0.55, 2.2, 0.55, 1.5), color: '#2de2ff', basic: true }] },
    ],
    decor: [
      { geo: cone(0.32, 0.26, 6, 0.13), colors: ['#ff4fd8', '#2de2ff', '#b06bff'], count: 520, scale: [0.6, 1.5], basic: true },
      { geo: oct(0.18, 2.6, 0.45), colors: ['#2de2ff', '#7a5cff', '#ff2bd6'], count: 380, scale: [0.5, 1.3], basic: true },
      { geo: ico(0.3, 0.08), colors: ['#2b2638', '#3a3350', '#1f1b2b'], count: 500, scale: [0.6, 1.8] },
    ],
    weapons: [['blaster', 14], ['plasma_rifle', 13], ['arc_shotgun', 11], ['pulse_smg', 13], ['laser_sniper', 6], ['rail_cannon', 4]],
    items: {
      heal_s: { name: 'Nano Patch', color: '#7dffb0', w: 30 }, heal_l: { name: 'Repair Swarm', color: '#2dff8a', w: 10 },
      shield_s: { name: 'Cell Charge', color: '#38e8ff', w: 22 }, shield_l: { name: 'Overshield', color: '#ff2bd6', w: 8 },
      nade: { name: 'Plasma Orb', color: '#ff4fd8', w: 14 },
    },
  },
];

export { RARITY_GROUND };
