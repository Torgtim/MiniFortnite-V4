// World generation for one season: terrain, liquid, points of interest (buildings),
// resource props, decoration, loot spots, colliders, raycasting and a pre-rendered minimap.

import * as THREE from '../lib/three.module.min.js?v=42';
import { mulberry32, createNoise, clamp, lerp, smoothstep } from './util.js?v=42';
import { rayCollider } from './geom.js?v=42';
import { TEX, TERRAIN_TEX, HOUSE_TEX } from './textures.js?v=42';
import { buildLiquid } from './liquid.js?v=42';

export const MAP_R = 190;
const SIZE = 420;
const WALL_H = 3.2;
const WALL_T = 0.4;

/** Accumulates many axis-aligned boxes into ONE geometry with a draw group per material layer. */
class BoxBatch {
  constructor(layers) { this.layers = Array.from({ length: layers }, () => ({ pos: [], nor: [], col: [], uv: [] })); }
  add(minx, miny, minz, maxx, maxy, maxz, color, layer = 0, uvScale = 2) {
    const L = this.layers[layer];
    const u = BoxBatch.unit;
    const p = u.attributes.position, n = u.attributes.normal, uv = u.attributes.uv, ix = u.index;
    const sx = maxx - minx, sy = maxy - miny, sz = maxz - minz;
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    for (let k = 0; k < ix.count; k++) {
      const i = ix.getX(k);
      const nx = n.getX(i), ny = n.getY(i);
      L.pos.push(p.getX(i) * sx + cx, p.getY(i) * sy + cy, p.getZ(i) * sz + cz);
      L.nor.push(nx, ny, n.getZ(i));
      L.col.push(color.r, color.g, color.b);
      const w = Math.abs(nx) > 0.5 ? sz : sx, h = Math.abs(ny) > 0.5 ? sz : sy;
      L.uv.push(uv.getX(i) * w / uvScale, uv.getY(i) * h / uvScale);
    }
  }
  /** Flat convex polygon (points in order, counter-clockwise seen from the front). */
  addPoly(pts, color, layer = 0, out = null, uvScale = 2) {
    const L = this.layers[layer];
    if (out) {
      const [p0, p1, p2] = pts;
      const ux0 = p1[0] - p0[0], uy0 = p1[1] - p0[1], uz0 = p1[2] - p0[2], vx0 = p2[0] - p0[0], vy0 = p2[1] - p0[1], vz0 = p2[2] - p0[2];
      const n = [uy0 * vz0 - uz0 * vy0, uz0 * vx0 - ux0 * vz0, ux0 * vy0 - uy0 * vx0];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) pts = pts.slice().reverse();
    }
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // planar UVs: u along the first edge, v perpendicular to it in the polygon plane
    const ul = Math.hypot(ux, uy, uz) || 1, eu = [ux / ul, uy / ul, uz / ul];
    const ev = [ny * eu[2] - nz * eu[1], nz * eu[0] - nx * eu[2], nx * eu[1] - ny * eu[0]];
    const uv = (p) => { const dx = p[0] - a[0], dy = p[1] - a[1], dz = p[2] - a[2]; return [(dx * eu[0] + dy * eu[1] + dz * eu[2]) / uvScale, (dx * ev[0] + dy * ev[1] + dz * ev[2]) / uvScale]; };
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        L.pos.push(p[0], p[1], p[2]); L.nor.push(nx, ny, nz); L.col.push(color.r, color.g, color.b);
        const t = uv(p); L.uv.push(t[0], t[1]);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    const pos = [], nor = [], col = [], uv = [];
    let start = 0;
    this.layers.forEach((L, i) => {
      pos.push(...L.pos); nor.push(...L.nor); col.push(...L.col); uv.push(...L.uv);
      const n = L.pos.length / 3;
      if (n) g.addGroup(start, n, i);
      start += n;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
BoxBatch.unit = new THREE.BoxGeometry(1, 1, 1);

export class World {
  constructor(season, seed = 1, opts = {}) {
    this.season = season;
    this.opts = opts;
    this.seed = seed;
    this.mapRadius = MAP_R;
    this.noise = createNoise(season.seed * 977 + seed);
    this.rnd = mulberry32(season.seed * 31 + seed * 7919);
    this.group = new THREE.Group();
    this.colliders = [];
    this.grid = new Map();
    this.cell = 8;
    this._stamp = 0;
    this.sites = [];
    this.buildings = [];
    this.lootSpots = [];
    this.chests = [];
    this.nodes = [];
    this.liquidY = season.liquid.y;

    this._pickSites();
    this._planRoads();
    this._buildTerrain();
    this._buildLiquid();
    this._buildBuildings();
    this._scatterProps();
    this._scatterDecor(opts.decor === undefined ? 1 : opts.decor);
    this.shaking = [];
    this._tumbleweeds(this.season.tumbleweeds || 0);
    this.minimap = this._renderMinimap(192);
  }

  // ---------------------------------------------------------------- terrain
  rawHeight(x, z) {
    const h = this.season.terrain(x, z, this.noise);
    const m = 1 - smoothstep(0.80, 1.0, Math.hypot(x, z) / MAP_R);
    return lerp(-7, h, m);
  }

  heightAt(x, z) {
    let h = this.rawHeight(x, z);
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r + 10) h = lerp(h, s.h, 1 - smoothstep(s.r, s.r + 10, d));
    }
    return h;
  }

  liquidAt(x, z, y) {
    return y < this.liquidY ? this.season.liquid : null;
  }

  _pickSites() {
    const rnd = this.rnd, s = this.season;
    for (let pass = 0; pass < 2 && this.sites.length < s.poiCount; pass++) {
      for (let tries = 0; tries < 800 && this.sites.length < s.poiCount; tries++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (MAP_R - 55);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (s.avoid(x, z)) continue;
        const h = this.rawHeight(x, z);
        if (h < this.liquidY + 1.8) continue;
        const lim = pass === 0 ? 5 : 9;
        let ok = true;
        for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
          if (Math.abs(this.rawHeight(x + dx, z + dz) - h) > lim) ok = false;
        }
        if (!ok) continue;
        if (this.sites.some((o) => Math.hypot(o.x - x, o.z - z) < 62)) continue;
        this.sites.push({ x, z, h: Math.round(h * 2) / 2, r: 26, name: s.poiNames[this.sites.length % s.poiNames.length] });
      }
    }
  }

  /** Connect the towns with roads (minimum spanning tree over the sites). */
  _planRoads() {
    this.roads = [];
    const S = this.sites;
    if (S.length < 2) return;
    const inTree = [0], rest = S.map((_, i) => i).slice(1);
    while (rest.length) {
      let best = null;
      for (const a of inTree) for (const b of rest) {
        const d = Math.hypot(S[a].x - S[b].x, S[a].z - S[b].z);
        if (!best || d < best.d) best = { a, b, d };
      }
      // slight wiggle: route through a midpoint offset sideways
      const A = S[best.a], B = S[best.b];
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, px = -(B.z - A.z) / best.d, pz = (B.x - A.x) / best.d;
      const off = (this.rnd() - 0.5) * best.d * 0.25;
      const M = { x: mx + px * off, z: mz + pz * off };
      this.roads.push([A.x, A.z, M.x, M.z], [M.x, M.z, B.x, B.z]);
      inTree.push(best.b); rest.splice(rest.indexOf(best.b), 1);
    }
  }

  /** 0..1: how much (x,z) is on a road. */
  roadAt(x, z) {
    let best = 99;
    for (const [x0, z0, x1, z1] of this.roads) {
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
      let t = ((x - x0) * dx + (z - z0) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
      if (d < best) best = d;
    }
    return 1 - smoothstep(1.6, 3.0, best);
  }

  _buildTerrain() {
    const seg = 170;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
      uv.setXY(i, pos.getX(i) / 3.2, pos.getZ(i) / 3.2);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const c = this.season.ground(h, slope, x, z, this.noise, this.liquidY);
      const road = h > this.liquidY + 0.3 && this.season.road ? this.roadAt(x, z) : 0;
      if (road > 0) c.lerp(this._roadCol || (this._roadCol = new THREE.Color(this.season.road)), road * 0.9);
      cols[i * 3] = Math.min(1, c.r * 1.12); cols[i * 3 + 1] = Math.min(1, c.g * 1.12); cols[i * 3 + 2] = Math.min(1, c.b * 1.12);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const tex = TEX[TERRAIN_TEX[this.season.id] || 'grass']();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: tex });
    if (this.season.id === 4) { mat.emissive = new THREE.Color('#3a1250'); mat.emissiveIntensity = 0.9; }
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
  }

  _buildLiquid() {
    this.liquidMesh = buildLiquid(this.season.liquid, (x, z) => this.heightAt(x, z), MAP_R);
    this.group.add(this.liquidMesh);
  }

  // ---------------------------------------------------------------- buildings
  _buildBuildings() {
    // layers: 0 walls (season texture), 1 roofs (shingles), 2 floors (boards), 3 plain trim
    const batch = new BoxBatch(4);
    const st = this.season.building;
    const colWall = new THREE.Color(st.wall), colRoof = new THREE.Color(st.roof);
    const colFloor = new THREE.Color(st.floor), colTrim = new THREE.Color(st.trim);
    const rnd = this.rnd;
    const jit = (c, a = 0.07) => c.clone().multiplyScalar(1 - a + rnd() * a * 2);

    const addBox = (x0, y0, z0, x1, y1, z1, color, collide = true, layer = 0) => {
      batch.add(x0, y0, z0, x1, y1, z1, color, layer);
      if (collide) this.addCollider({ kind: 'box', minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1 });
    };
    addBox.poly = (pts, color, layer, out) => batch.addPoly(pts, color, layer, out);

    // the site closest to the middle of the island gets a lookout tower (high ground!)
    let towerSite = null, td = Infinity;
    for (const st2 of this.sites) { const d = Math.hypot(st2.x, st2.z); if (d < td) { td = d; towerSite = st2; } }
    for (const site of this.sites) {
      const placed = [];
      if (site === towerSite) placed.push([site.x - 7, site.z - 7, site.x + 7, site.z + 7]);
      const target = 5 + Math.floor(rnd() * 3);
      for (let k = 0, tries = 0; k < target && tries < 90; tries++) {
        const w = 6 + Math.floor(rnd() * 4), d = 6 + Math.floor(rnd() * 4);
        const a = rnd() * Math.PI * 2, r = 5 + rnd() * 15;
        const cx = Math.round(site.x + Math.cos(a) * r), cz = Math.round(site.z + Math.sin(a) * r);
        if (Math.hypot(cx - site.x, cz - site.z) > 19) continue;
        const box = [cx - w / 2 - 3, cz - d / 2 - 3, cx + w / 2 + 3, cz + d / 2 + 3];
        if (placed.some((p) => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) continue;
        placed.push([cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2]);
        k++;
        const dx = site.x - cx, dz = site.z - cz;
        const door = Math.hypot(dx, dz) < 4 ? Math.floor(rnd() * 4) : Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3);
        this._house(addBox, cx, cz, w, d, door, site.h, { colWall: jit(colWall), colRoof: jit(colRoof), colFloor, colTrim }, rnd);
        const dv = [[1, 0], [-1, 0], [0, 1], [0, -1]][door];
        const dxp = cx + dv[0] * w / 2, dzp = cz + dv[1] * d / 2;
        this.buildings.push({
          x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2,
          door: { x: dxp - dv[0] * 1.4, z: dzp - dv[1] * 1.4, ox: dxp + dv[0] * 2.2, oz: dzp + dv[1] * 2.2 },
        });
      }
    }
    if (towerSite) {
      this._tower(addBox, Math.round(towerSite.x), Math.round(towerSite.z), towerSite.h, { colWall: colWall.clone().multiplyScalar(0.9), colFloor, colTrim, colRoof });
      this.buildings.push({ x0: towerSite.x - 3.5, z0: towerSite.z - 3.5, x1: towerSite.x + 3.5, z1: towerSite.z + 3.5, door: { x: towerSite.x, z: towerSite.z + 2.2, ox: towerSite.x, oz: towerSite.z + 5.8 } });
      towerSite.tower = true;
    }
    const wallTex = TEX[HOUSE_TEX[this.season.id] || 'siding']();
    const mats = [
      new THREE.MeshLambertMaterial({ vertexColors: true, map: wallTex }),
      new THREE.MeshLambertMaterial({ vertexColors: true, map: TEX.shingles() }),
      new THREE.MeshLambertMaterial({ vertexColors: true, map: TEX.floorboards() }),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    ];
    if (this.season.id === 4) { mats[3].emissive = new THREE.Color(st.trim); mats[3].emissiveIntensity = 0.8; }
    this.staticMesh = new THREE.Mesh(batch.build(), mats);
    this.staticMesh.castShadow = true;
    this.staticMesh.receiveShadow = true;
    this.group.add(this.staticMesh);
  }

  _house(addBox, cx, cz, w, d, door, yb, c, rnd) {
    const H = WALL_H, T = WALL_T;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    addBox(x0, yb - 0.4, z0, x1, yb + 0.03, z1, c.colFloor, false, 2);

    const seg = (axis, fixed, a0, a1, v0, v1) => {
      if (a1 - a0 < 0.01) return;
      if (axis === 'x') addBox(fixed - T / 2, yb + v0, a0, fixed + T / 2, yb + v1, a1, c.colWall);
      else addBox(a0, yb + v0, fixed - T / 2, a1, yb + v1, fixed + T / 2, c.colWall);
    };
    const sides = [
      { axis: 'x', fixed: x1, lo: z0, hi: z1 }, // 0: +x
      { axis: 'x', fixed: x0, lo: z0, hi: z1 }, // 1: -x
      { axis: 'z', fixed: z1, lo: x0, hi: x1 }, // 2: +z
      { axis: 'z', fixed: z0, lo: x0, hi: x1 }, // 3: -z
    ];
    sides.forEach((s, i) => {
      const mid = (s.lo + s.hi) / 2;
      if (i === door) {
        seg(s.axis, s.fixed, s.lo, mid - 1.1, 0, H);
        seg(s.axis, s.fixed, mid + 1.1, s.hi, 0, H);
        seg(s.axis, s.fixed, mid - 1.1, mid + 1.1, 2.4, H);
      } else if (rnd() < 0.55) {
        seg(s.axis, s.fixed, s.lo, mid - 0.8, 0, H);
        seg(s.axis, s.fixed, mid + 0.8, s.hi, 0, H);
        seg(s.axis, s.fixed, mid - 0.8, mid + 0.8, 0, 1.0);
        seg(s.axis, s.fixed, mid - 0.8, mid + 0.8, 2.1, H);
      } else seg(s.axis, s.fixed, s.lo, s.hi, 0, H);
    });
    addBox(x0 - 0.4, yb + H, z0 - 0.4, x1 + 0.4, yb + H + 0.35, z1 + 0.4, c.colRoof, true, 1);
    if (this.season.building.roofStyle === 'gable') this._gable(addBox, x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, yb + H + 0.35, c, rnd);
    else addBox(x0 + 0.6, yb + H + 0.35, z0 + 0.6, x1 - 0.6, yb + H + 0.75, z1 - 0.6, c.colRoof, true, 1); // low flat cap
    // trim strips along the roof edge (visual only)
    const ty = yb + H + 0.35;
    addBox(x0 - 0.4, ty, z0 - 0.4, x1 + 0.4, ty + 0.14, z0 - 0.25, c.colTrim, false, 3);
    addBox(x0 - 0.4, ty, z1 + 0.25, x1 + 0.4, ty + 0.14, z1 + 0.4, c.colTrim, false, 3);
    addBox(x0 - 0.4, ty, z0 - 0.25, x0 - 0.25, ty + 0.14, z1 + 0.25, c.colTrim, false, 3);
    addBox(x1 + 0.25, ty, z0 - 0.25, x1 + 0.4, ty + 0.14, z1 + 0.25, c.colTrim, false, 3);

    // a table to hide behind, a chest in a back corner and loot on the floor
    const back = [[-1, 0], [1, 0], [0, -1], [0, 1]][door];
    const bx = cx - back[0] * (w / 2 - 1.3), bz = cz - back[1] * (d / 2 - 1.3);
    const sx = back[1] !== 0 ? (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.3) : 0;
    const sz = back[0] !== 0 ? (rnd() < 0.5 ? -1 : 1) * (d / 2 - 1.3) : 0;
    if (rnd() < 0.65) this.chests.push({ x: bx + sx, y: yb, z: bz + sz });
    if (rnd() < 0.6) addBox(cx - 0.6, yb, cz - 0.6, cx + 0.6, yb + 0.85, cz + 0.6, c.colTrim, true, 3);
    const nLoot = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nLoot; i++) {
      this.lootSpots.push({ x: cx + (rnd() - 0.5) * (w - 3), y: yb, z: cz + (rnd() - 0.5) * (d - 3) });
    }
    if (rnd() < 0.5) {
      const o = [[1, 0], [-1, 0], [0, 1], [0, -1]][door];
      this.lootSpots.push({ x: cx + o[0] * (w / 2 + 2), y: yb, z: cz + o[1] * (d / 2 + 2) });
    }
  }

  /** Three-storey lookout tower with ramps inside, windows on every side and a chest on the roof. */
  _tower(addBox, cx, cz, yb, c) {
    const S = 3.5, LH = 3.2, T = 0.3, levels = 3;
    const x0 = cx - S, x1 = cx + S, z0 = cz - S, z1 = cz + S;
    // ramp footprints per level (alternating sides so you zig-zag up)
    const ramps = [];
    for (let k = 0; k < levels; k++) {
      const even = k % 2 === 0;
      const za = even ? z0 + T + 0.1 : z1 - T - 1.9, zb = za + 1.8;
      const xa = x0 + T + 0.6, xb = xa + 4.2;
      ramps.push({ xa, xb, za, zb, dir: even ? 1 : -1, y: yb + k * LH });
    }
    // walls with a window on each side (door on +z at the bottom)
    const seg = (alongX, fixed, a0, a1, y0, y1) => {
      if (a1 - a0 < 0.01) return;
      if (alongX) addBox(a0, y0, fixed - T / 2, a1, y1, fixed + T / 2, c.colWall);
      else addBox(fixed - T / 2, y0, a0, fixed + T / 2, y1, a1, c.colWall);
    };
    for (let k = 0; k < levels; k++) {
      const y = yb + k * LH;
      for (const [alongX, fixed, lo, hi, side] of [[true, z0, x0, x1, 'n'], [true, z1, x0, x1, 's'], [false, x0, z0, z1, 'w'], [false, x1, z0, z1, 'e']]) {
        const mid = (lo + hi) / 2;
        if (k === 0 && side === 's') { // door
          seg(alongX, fixed, lo, mid - 1.0, y, y + LH); seg(alongX, fixed, mid + 1.0, hi, y, y + LH); seg(alongX, fixed, mid - 1.0, mid + 1.0, y + 2.4, y + LH);
        } else {
          seg(alongX, fixed, lo, mid - 0.9, y, y + LH); seg(alongX, fixed, mid + 0.9, hi, y, y + LH);
          seg(alongX, fixed, mid - 0.9, mid + 0.9, y, y + 1.0); seg(alongX, fixed, mid - 0.9, mid + 0.9, y + 2.1, y + LH);
        }
      }
    }
    addBox(x0, yb - 0.4, z0, x1, yb + 0.03, z1, c.colFloor, false, 2);
    // floors (with a hole above the ramp that leads up to them)
    for (let k = 1; k <= levels; k++) {
      const y = yb + k * LH, r = ramps[k - 1];
      const fy0 = y - T;
      addBox(x0, fy0, z0, r.xa, y, z1, c.colFloor, true, 2);
      addBox(r.xb, fy0, z0, x1, y, z1, c.colFloor, true, 2);
      addBox(r.xa, fy0, z0, r.xb, y, r.za, c.colFloor, true, 2);
      addBox(r.xa, fy0, r.zb, r.xb, y, z1, c.colFloor, true, 2);
    }
    // ramps (sloped plates you can walk up)
    for (const r of ramps) {
      const lowX = r.dir > 0 ? r.xa : r.xb, highX = r.dir > 0 ? r.xb : r.xa;
      const yl = r.y, yh = r.y + LH;
      addBox.poly([[lowX, yl, r.za], [lowX, yl, r.zb], [highX, yh, r.zb], [highX, yh, r.za]], c.colTrim, 3, [0, 1, 0]);
      addBox.poly([[lowX, yl - 0.15, r.za], [highX, yh - 0.15, r.za], [highX, yh - 0.15, r.zb], [lowX, yl - 0.15, r.zb]], c.colTrim, 3, [0, -1, 0]);
      this.addCollider({ kind: 'ramp', minx: r.xa, maxx: r.xb, minz: r.za, maxz: r.zb, miny: yl - 0.2, maxy: yh + 0.2, cx: (r.xa + r.xb) / 2, cz: (r.za + r.zb) / 2, dx: r.dir, dz: 0, len: r.xb - r.xa, base: yl, rise: LH });
    }
    // roof parapet + a flag
    const top = yb + levels * LH;
    for (const [alongX, fixed, lo, hi] of [[true, z0, x0, x1], [true, z1, x0, x1], [false, x0, z0, z1], [false, x1, z0, z1]]) seg(alongX, fixed, lo, hi, top, top + 1.1);
    addBox(cx + 2.6, top, cz + 2.6, cx + 2.8, top + 4.5, cz + 2.8, c.colTrim, false, 3);
    addBox(cx + 2.8, top + 3.4, cz + 2.65, cx + 4.2, top + 4.4, cz + 2.75, c.colRoof, false, 1);
    // loot: a chest on the roof and something on every floor
    this.chests.push({ x: cx - 1.5, y: top, z: cz + 1.5 });
    for (let k = 0; k < levels; k++) this.lootSpots.push({ x: cx + 1.8, y: yb + k * LH, z: cz + (k % 2 ? -1.6 : 1.6) });
  }

  /** Pitched roof: two sloped shingle planes (walkable ramp colliders) + gable ends + a chimney. */
  _gable(addBox, x0, z0, x1, z1, y, c, rnd) {
    const alongX = x1 - x0 >= z1 - z0;
    const span = alongX ? z1 - z0 : x1 - x0;
    const RH = Math.min(2.4, span * 0.32);
    const roof = c.colRoof, wall = c.colWall;
    if (alongX) {
      const zm = (z0 + z1) / 2, L = span / 2;
      addBox.poly([[x0, y, z0], [x0, y + RH, zm], [x1, y + RH, zm], [x1, y, z0]], roof, 1, [0, 1, -1]);
      addBox.poly([[x0, y, z1], [x1, y, z1], [x1, y + RH, zm], [x0, y + RH, zm]], roof, 1, [0, 1, 1]);
      addBox.poly([[x0 + 0.2, y, z0], [x0 + 0.2, y, z1], [x0 + 0.2, y + RH, zm]], wall, 0, [-1, 0, 0]);
      addBox.poly([[x1 - 0.2, y, z0], [x1 - 0.2, y + RH, zm], [x1 - 0.2, y, z1]], wall, 0, [1, 0, 0]);
      this.addCollider({ kind: 'ramp', minx: x0, maxx: x1, minz: z0, maxz: zm, miny: y - 0.2, maxy: y + RH + 0.2, cx: (x0 + x1) / 2, cz: (z0 + zm) / 2, dx: 0, dz: 1, len: L, base: y, rise: RH });
      this.addCollider({ kind: 'ramp', minx: x0, maxx: x1, minz: zm, maxz: z1, miny: y - 0.2, maxy: y + RH + 0.2, cx: (x0 + x1) / 2, cz: (zm + z1) / 2, dx: 0, dz: -1, len: L, base: y, rise: RH });
    } else {
      const xm = (x0 + x1) / 2, L = span / 2;
      addBox.poly([[x0, y, z0], [x0, y, z1], [xm, y + RH, z1], [xm, y + RH, z0]], roof, 1, [-1, 1, 0]);
      addBox.poly([[x1, y, z0], [xm, y + RH, z0], [xm, y + RH, z1], [x1, y, z1]], roof, 1, [1, 1, 0]);
      addBox.poly([[x0, y, z0 + 0.2], [xm, y + RH, z0 + 0.2], [x1, y, z0 + 0.2]], wall, 0, [0, 0, -1]);
      addBox.poly([[x0, y, z1 - 0.2], [x1, y, z1 - 0.2], [xm, y + RH, z1 - 0.2]], wall, 0, [0, 0, 1]);
      this.addCollider({ kind: 'ramp', minx: x0, maxx: xm, minz: z0, maxz: z1, miny: y - 0.2, maxy: y + RH + 0.2, cx: (x0 + xm) / 2, cz: (z0 + z1) / 2, dx: 1, dz: 0, len: L, base: y, rise: RH });
      this.addCollider({ kind: 'ramp', minx: xm, maxx: x1, minz: z0, maxz: z1, miny: y - 0.2, maxy: y + RH + 0.2, cx: (xm + x1) / 2, cz: (z0 + z1) / 2, dx: -1, dz: 0, len: L, base: y, rise: RH });
    }
    if (rnd() < 0.6) {
      const cx = x0 + (x1 - x0) * (0.25 + rnd() * 0.5), cz = z0 + (z1 - z0) * (0.25 + rnd() * 0.5);
      addBox(cx - 0.35, y + RH * 0.4, cz - 0.35, cx + 0.35, y + RH + 0.9, cz + 0.35, c.colTrim, false, 3);
    }
  }

  // ---------------------------------------------------------------- props (trees, rocks, ...)
  _scatterProps() {
    const rnd = this.rnd;
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const def of this.season.props) {
      const spots = [];
      for (let i = 0, tries = 0; i < def.count && tries < def.count * 12; tries++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (MAP_R - 10);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < this.liquidY + 0.9) continue;
        if (this.sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
        if (Math.abs(this.heightAt(x + 1.5, z) - h) > 1.2 || Math.abs(this.heightAt(x, z + 1.5) - h) > 1.2) continue;
        spots.push({ x, z, h, s: def.scale[0] + rnd() * (def.scale[1] - def.scale[0]), rot: rnd() * Math.PI * 2, v: rnd() });
        i++;
      }
      if (!spots.length) continue;
      const meshes = def.parts.map((p) => {
        const mat = p.basic ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
        const m = new THREE.InstancedMesh(p.geo, mat, spots.length);
        m.castShadow = !p.basic;
        m.receiveShadow = !p.basic;
        this.group.add(m);
        return m;
      });
      spots.forEach((sp, idx) => {
        dummy.position.set(sp.x, sp.h, sp.z);
        dummy.rotation.set(0, sp.rot, 0);
        dummy.scale.setScalar(sp.s);
        dummy.updateMatrix();
        meshes.forEach((m, pi) => {
          m.setMatrixAt(idx, dummy.matrix);
          tint.set(def.parts[pi].color).multiplyScalar(0.85 + sp.v * 0.3);
          m.setColorAt(idx, tint);
        });
        const rr = def.r * sp.s;
        const collider = { kind: 'box', minx: sp.x - rr, maxx: sp.x + rr, minz: sp.z - rr, maxz: sp.z + rr, miny: sp.h - 0.5, maxy: sp.h + def.h * sp.s };
        const node = { res: def.res, hp: def.hp, maxHp: def.hp, yield: def.yield, collider, meshes, idx, x: sp.x, y: sp.h, z: sp.z, s: sp.s, rot: sp.rot, color: def.parts[def.parts.length - 1].color };
        collider.node = node;
        this.addCollider(collider);
        this.nodes.push(node);
      });
      meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    }
    // loose loot lying around outside the towns
    for (let i = 0, tries = 0; i < 45 && tries < 400; tries++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (MAP_R - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < this.liquidY + 1.0) continue;
      this.lootSpots.push({ x, y: h, z });
      i++;
    }
  }

  /** Grass tufts, flowers, snow mounds, glowing mushrooms... purely visual, no colliders. */
  _scatterDecor(density) {
    const defs = this.season.decor || [];
    if (density <= 0) return;
    const rnd = mulberry32(this.season.seed * 13 + 5);
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    for (const def of defs) {
      const n = Math.floor(def.count * density);
      const m = new THREE.InstancedMesh(def.geo, def.basic ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
      let k = 0;
      for (let tries = 0; k < n && tries < n * 6; tries++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (MAP_R - 8);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < this.liquidY + 0.5) continue;
        if (def.minH !== undefined && h < def.minH) continue;
        if (Math.abs(this.heightAt(x + 1, z) - h) > 0.8) continue;
        if (this.buildings.some((b) => x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5)) continue;
        dummy.position.set(x, h - 0.05, z);
        dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
        dummy.scale.setScalar(def.scale[0] + rnd() * (def.scale[1] - def.scale[0]));
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
        const cs = def.colors;
        m.setColorAt(k, tint.set(cs[Math.floor(rnd() * cs.length)]).multiplyScalar(0.85 + rnd() * 0.3));
        k++;
      }
      m.count = k;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Is (x,z) slippery ice at ground height h? */
  iceAt(x, z, h) { return !!(this.season.ice && this.season.ice(x, z, h)); }

  /** Dustbowl: tumbleweeds rolling with the wind (visual only). */
  _tumbleweeds(n) {
    this.tumble = [];
    if (!n) return;
    const rnd = mulberry32(777);
    const tw = TEX.twigs(); tw.repeat.set(2, 2);
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 2), new THREE.MeshLambertMaterial({ map: tw, alphaTest: 0.4, side: THREE.DoubleSide, transparent: false }), n);
    for (let i = 0; i < n; i++) {
      const p = this.randomLandPoint(rnd);
      this.tumble.push({ x: p.x, z: p.z, s: 0.6 + rnd() * 0.6, sp: 2.5 + rnd() * 3, rot: rnd() * 6, ph: rnd() * 6, dz: (rnd() - 0.5) * 0.4 });
    }
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    this.tumbleMesh = m;
    this.group.add(m);
  }

  _updateTumble(dt, time) {
    if (!this.tumbleMesh) return;
    const d = this._td || (this._td = new THREE.Object3D());
    this.tumble.forEach((t, i) => {
      t.x += t.sp * dt; t.z += t.sp * t.dz * dt; t.rot += t.sp * dt / (0.55 * t.s);
      if (Math.hypot(t.x, t.z) > MAP_R - 5 || this.heightAt(t.x, t.z) < this.liquidY + 0.3) { t.x = -Math.abs(t.x) * 0.9 + (Math.random() - 0.5) * 20; t.z *= 0.9; }
      const g = this.heightAt(t.x, t.z);
      const hop = Math.abs(Math.sin(time * t.sp * 0.8 + t.ph)) * 0.6;
      d.position.set(t.x, g + 0.55 * t.s + hop, t.z);
      d.rotation.set(0, 0, -t.rot);
      d.scale.setScalar(t.s);
      d.updateMatrix();
      this.tumbleMesh.setMatrixAt(i, d.matrix);
    });
    this.tumbleMesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove a harvested resource node (hides its instances and drops its collider). */
  destroyNode(node) {
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    node.meshes.forEach((m) => { m.setMatrixAt(node.idx, m4); m.instanceMatrix.needsUpdate = true; });
    this.removeCollider(node.collider);
    node.dead = true;
    node.shake = 0;
  }

  /** Make a node wobble when it gets hit. */
  shakeNode(node) {
    if (!node.shake) this.shaking.push(node);
    node.shake = 0.35;
  }

  update(dt, time) {
    if (this.liquidMesh) this.liquidMesh.userData.mat.uniforms.uTime.value = time;
    this._updateTumble(dt, time);
    if (!this.shaking.length) return;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = this.shaking.length - 1; i >= 0; i--) {
      const n = this.shaking[i];
      if (n.dead) { this.shaking.splice(i, 1); continue; }
      n.shake = Math.max(0, n.shake - dt);
      const k = n.shake / 0.35;
      e.set(Math.sin(time * 40) * 0.06 * k, n.rot, Math.cos(time * 37) * 0.06 * k);
      q.setFromEuler(e);
      m4.compose(p.set(n.x, n.y, n.z), q, sc.setScalar(n.s * (1 - 0.04 * k)));
      n.meshes.forEach((m) => { m.setMatrixAt(n.idx, m4); m.instanceMatrix.needsUpdate = true; });
      if (n.shake <= 0) this.shaking.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- colliders / spatial grid
  _key(cx, cz) { return (cx + 1000) * 4096 + (cz + 1000); }

  addCollider(c) {
    c._i = this.colliders.length;
    this.colliders.push(c);
    const cs = this.cell;
    const x0 = Math.floor(c.minx / cs), x1 = Math.floor(c.maxx / cs), z0 = Math.floor(c.minz / cs), z1 = Math.floor(c.maxz / cs);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(c);
    }
    return c;
  }

  removeCollider(c) {
    if (c._i === undefined || c._i < 0) return;
    const last = this.colliders[this.colliders.length - 1];
    this.colliders[c._i] = last;
    last._i = c._i;
    this.colliders.pop();
    c._i = -1;
    const cs = this.cell;
    const x0 = Math.floor(c.minx / cs), x1 = Math.floor(c.maxx / cs), z0 = Math.floor(c.minz / cs), z1 = Math.floor(c.maxz / cs);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const a = this.grid.get(this._key(x, z));
      if (!a) continue;
      const i = a.indexOf(c);
      if (i >= 0) a.splice(i, 1);
    }
  }

  /** Colliders near (x,z) within radius r (deduplicated). */
  query(x, z, r) {
    const cs = this.cell;
    const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs), z0 = Math.floor((z - r) / cs), z1 = Math.floor((z + r) / cs);
    const out = [];
    const stamp = ++this._stamp;
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.grid.get(this._key(cx, cz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c._q === stamp) continue;
        c._q = stamp;
        out.push(c);
      }
    }
    return out;
  }

  /** Ray vs colliders + terrain. Returns {t, collider|null, terrain}. t === maxT means no hit.
   *  Walks the collider grid cell by cell (2D DDA) so long rays stay cheap. */
  raycast(ox, oy, oz, dx, dy, dz, maxT, terrainStep = 1.2, ignore = null) {
    let best = maxT, hitC = null, hitTerrain = false;
    const cs = this.cell;
    let cx = Math.floor(ox / cs), cz = Math.floor(oz / cs);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) < 1e-9 ? Infinity : cs / Math.abs(dx);
    const tdz = Math.abs(dz) < 1e-9 ? Infinity : cs / Math.abs(dz);
    let tmx = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? (cx + 1) * cs - ox : ox - cx * cs) / Math.abs(dx));
    let tmz = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? (cz + 1) * cs - oz : oz - cz * cs) / Math.abs(dz));
    const stamp = ++this._stamp;
    let tEnter = 0;
    for (let guard = 0; guard < 400 && tEnter <= best; guard++) {
      const a = this.grid.get(this._key(cx, cz));
      if (a) {
        for (let i = 0; i < a.length; i++) {
          const c = a[i];
          if (c._q === stamp) continue;
          c._q = stamp;
          if (ignore && c.piece && ignore(c)) continue;
          const t = rayCollider(c, ox, oy, oz, dx, dy, dz, best);
          if (t > 0.0001 && t < best) { best = t; hitC = c; }
        }
      }
      if (tmx < tmz) { tEnter = tmx; tmx += tdx; cx += sx; } else { tEnter = tmz; tmz += tdz; cz += sz; }
    }
    // terrain march
    let t = 0.4;
    const step = terrainStep;
    while (t < best) {
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      if (py < this.heightAt(px, pz)) {
        let lo = Math.max(0, t - step), hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          if (oy + dy * mid < this.heightAt(ox + dx * mid, oz + dz * mid)) hi = mid; else lo = mid;
        }
        if (hi < best) { best = hi; hitC = null; hitTerrain = true; }
        break;
      }
      t += step;
    }
    return { t: best, collider: hitC, terrain: hitTerrain };
  }

  /** Random walkable land point (not water/lava). */
  randomLandPoint(rnd, minRadius = 0, maxRadius = MAP_R - 25) {
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2, r = minRadius + Math.sqrt(rnd()) * (maxRadius - minRadius);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h > this.liquidY + 1.2 && this.isFreeSpot(x, z, h)) return { x, y: h, z };
    }
    return { x: 0, y: this.heightAt(0, 0), z: 0 };
  }

  isFreeSpot(x, z, y) {
    const list = this.query(x, z, 1.0);
    for (const c of list) {
      if (x > c.minx - 0.8 && x < c.maxx + 0.8 && z > c.minz - 0.8 && z < c.maxz + 0.8 && c.miny < y + 1.8 && c.maxy > y) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- minimap image
  _renderMinimap(px) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const g = cv.getContext('2d');
    const img = g.createImageData(px, px);
    const liq = new THREE.Color(this.season.liquid.color);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = (i / px - 0.5) * SIZE, z = (j / px - 0.5) * SIZE;
      const h = this.heightAt(x, z);
      let r, gg, b;
      if (h < this.liquidY) { r = liq.r; gg = liq.g; b = liq.b; }
      else {
        const sl = Math.abs(this.heightAt(x + 4, z) - h) * 0.35;
        const c = this.season.ground(h, sl, x, z, this.noise, this.liquidY);
        const shade = clamp(1 - (this.heightAt(x + 3, z + 3) - h) * 0.07, 0.6, 1.25);
        r = c.r * shade; gg = c.g * shade; b = c.b * shade;
      }
      const o = (j * px + i) * 4;
      img.data[o] = clamp(r, 0, 1) * 255; img.data[o + 1] = clamp(gg, 0, 1) * 255; img.data[o + 2] = clamp(b, 0, 1) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const k = px / SIZE;
    if (this.season.road) {
      g.strokeStyle = this.season.road; g.lineWidth = 2; g.lineCap = 'round';
      for (const [x0, z0, x1, z1] of this.roads) { g.beginPath(); g.moveTo((x0 + SIZE / 2) * k, (z0 + SIZE / 2) * k); g.lineTo((x1 + SIZE / 2) * k, (z1 + SIZE / 2) * k); g.stroke(); }
    }
    g.fillStyle = 'rgba(20,20,20,0.85)';
    for (const b of this.buildings) g.fillRect((b.x0 + SIZE / 2) * k, (b.z0 + SIZE / 2) * k, Math.max(2, (b.x1 - b.x0) * k), Math.max(2, (b.z1 - b.z0) * k));
    cv.worldSize = SIZE;
    return cv;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}
