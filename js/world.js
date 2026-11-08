// World generation for one season: terrain, liquid, points of interest (buildings),
// resource props, loot spots, colliders, raycasting and a pre-rendered minimap.

import * as THREE from '../lib/three.module.min.js';
import { mulberry32, createNoise, clamp, lerp, smoothstep } from './util.js';

export const MAP_R = 190;
const SIZE = 420;
const WALL_H = 3.2;
const WALL_T = 0.4;

/** Accumulates many axis-aligned coloured boxes into ONE geometry (one draw call). */
class BoxBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  add(minx, miny, minz, maxx, maxy, maxz, color) {
    const u = BoxBatch.unit;
    const p = u.attributes.position, n = u.attributes.normal, ix = u.index;
    const base = this.pos.length / 3;
    const sx = maxx - minx, sy = maxy - miny, sz = maxz - minz;
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i) * sx + cx, p.getY(i) * sy + cy, p.getZ(i) * sz + cz);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < ix.count; i++) this.idx.push(ix.getX(i) + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
BoxBatch.unit = new THREE.BoxGeometry(1, 1, 1);

export class World {
  constructor(season, seed = 1) {
    this.season = season;
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
    this._buildTerrain();
    this._buildLiquid();
    this._buildBuildings();
    this._scatterProps();
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

  _buildTerrain() {
    const seg = 170;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const c = this.season.ground(h, slope, x, z, this.noise, this.liquidY);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
  }

  _buildLiquid() {
    const l = this.season.liquid;
    const geo = new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: l.color, transparent: true, opacity: l.opacity,
      emissive: l.type === 'lava' ? new THREE.Color('#ff3a00') : new THREE.Color('#000000'), emissiveIntensity: l.type === 'lava' ? 0.9 : 0,
    });
    this.liquidMesh = new THREE.Mesh(geo, mat);
    this.liquidMesh.position.y = l.y;
    this.group.add(this.liquidMesh);
  }

  // ---------------------------------------------------------------- buildings
  _buildBuildings() {
    const batch = new BoxBatch();
    const st = this.season.building;
    const colWall = new THREE.Color(st.wall), colRoof = new THREE.Color(st.roof);
    const colFloor = new THREE.Color(st.floor), colTrim = new THREE.Color(st.trim);
    const rnd = this.rnd;
    const jit = (c, a = 0.07) => c.clone().multiplyScalar(1 - a + rnd() * a * 2);

    const addBox = (x0, y0, z0, x1, y1, z1, color, collide = true) => {
      batch.add(x0, y0, z0, x1, y1, z1, color);
      if (collide) this.addCollider({ kind: 'box', minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1 });
    };

    for (const site of this.sites) {
      const placed = [];
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
        this.buildings.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });
      }
    }
    this.staticMesh = new THREE.Mesh(
      batch.build(),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.staticMesh.castShadow = true;
    this.staticMesh.receiveShadow = true;
    this.group.add(this.staticMesh);
  }

  _house(addBox, cx, cz, w, d, door, yb, c, rnd) {
    const H = WALL_H, T = WALL_T;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    addBox(x0, yb - 0.4, z0, x1, yb + 0.03, z1, c.colFloor, false);

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
    addBox(x0 - 0.4, yb + H, z0 - 0.4, x1 + 0.4, yb + H + 0.35, z1 + 0.4, c.colRoof);
    // trim strips along the roof edge (visual only)
    const ty = yb + H + 0.35;
    addBox(x0 - 0.4, ty, z0 - 0.4, x1 + 0.4, ty + 0.14, z0 - 0.25, c.colTrim, false);
    addBox(x0 - 0.4, ty, z1 + 0.25, x1 + 0.4, ty + 0.14, z1 + 0.4, c.colTrim, false);
    addBox(x0 - 0.4, ty, z0 - 0.25, x0 - 0.25, ty + 0.14, z1 + 0.25, c.colTrim, false);
    addBox(x1 + 0.25, ty, z0 - 0.25, x1 + 0.4, ty + 0.14, z1 + 0.25, c.colTrim, false);

    // a table to hide behind, a chest in a back corner and loot on the floor
    const back = [[-1, 0], [1, 0], [0, -1], [0, 1]][door];
    const bx = cx - back[0] * (w / 2 - 1.3), bz = cz - back[1] * (d / 2 - 1.3);
    const sx = back[1] !== 0 ? (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.3) : 0;
    const sz = back[0] !== 0 ? (rnd() < 0.5 ? -1 : 1) * (d / 2 - 1.3) : 0;
    if (rnd() < 0.65) this.chests.push({ x: bx + sx, y: yb, z: bz + sz });
    if (rnd() < 0.6) addBox(cx - 0.6, yb, cz - 0.6, cx + 0.6, yb + 0.85, cz + 0.6, c.colTrim);
    const nLoot = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nLoot; i++) {
      this.lootSpots.push({ x: cx + (rnd() - 0.5) * (w - 3), y: yb, z: cz + (rnd() - 0.5) * (d - 3) });
    }
    if (rnd() < 0.5) {
      const o = [[1, 0], [-1, 0], [0, 1], [0, -1]][door];
      this.lootSpots.push({ x: cx + o[0] * (w / 2 + 2), y: yb, z: cz + o[1] * (d / 2 + 2) });
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
        const node = { res: def.res, hp: def.hp, maxHp: def.hp, yield: def.yield, collider, meshes, idx, x: sp.x, y: sp.h, z: sp.z };
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

  /** Remove a harvested resource node (hides its instances and drops its collider). */
  destroyNode(node) {
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    node.meshes.forEach((m) => { m.setMatrixAt(node.idx, m4); m.instanceMatrix.needsUpdate = true; });
    this.removeCollider(node.collider);
    node.dead = true;
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

  /** Ray vs colliders + terrain. Returns {t, collider|null, terrain}. t === maxT means no hit. */
  raycast(ox, oy, oz, dx, dy, dz, maxT, terrainStep = 1.2) {
    let best = maxT, hitC = null, hitTerrain = false;
    const cols = this.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      let tmin = 0, tmax = best;
      if (Math.abs(dx) < 1e-9) { if (ox < c.minx || ox > c.maxx) continue; }
      else { let a = (c.minx - ox) / dx, b = (c.maxx - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) continue; }
      if (Math.abs(dy) < 1e-9) { if (oy < c.miny || oy > c.maxy) continue; }
      else { let a = (c.miny - oy) / dy, b = (c.maxy - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) continue; }
      if (Math.abs(dz) < 1e-9) { if (oz < c.minz || oz > c.maxz) continue; }
      else { let a = (c.minz - oz) / dz, b = (c.maxz - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) continue; }
      if (tmin > 0.0001 && tmin < best) { best = tmin; hitC = c; }
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
