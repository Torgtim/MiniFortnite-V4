// Build-piece shapes: turns a placement + its edit state into boxes / sloped plates for both
// rendering and collision. Grid: cells are 4x4, levels are 3 high.
//
// Edit tiles (Fortnite-style):
//   wall  : 3 x 3 tiles (index = row*3 + col, row 0 at the bottom, col along the wall)
//   floor : 2 x 2 tiles (index = row*2 + col, col along +x, row along +z)
//   ramp  : 2 x 2 tiles, edited by dragging a path: the path's direction rotates the ramp,
//           a path that stays in one column makes a half-width ramp
//   cone  : 2 x 2 tiles, each selected tile raises its corner (pyramid -> slopes -> flat)

import * as THREE from '../lib/three.module.min.js';
import { roofHeight } from './geom.js';

export const CS = 4;
export const LV = 3;
export const CONE_H = 1.6;
export const TILES = { wall: 9, floor: 4, ramp: 4, cone: 4 };

/** Default (unedited) edit state for a piece type. */
export function defaultEdit(type, c) {
  if (type === 'ramp') return { dx: c.dx, dz: c.dz, side: 0 };
  return { removed: [] };
}

function mergeGrid(cols, rows, keep) {
  // greedy merge of kept tiles into rectangles [c0, r0, c1, r1] (inclusive)
  const used = new Array(cols * rows).fill(false);
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (!keep[i] || used[i]) continue;
    let c1 = c;
    while (c1 + 1 < cols && keep[r * cols + c1 + 1] && !used[r * cols + c1 + 1]) c1++;
    let r1 = r;
    outer: while (r1 + 1 < rows) {
      for (let k = c; k <= c1; k++) if (!keep[(r1 + 1) * cols + k] || used[(r1 + 1) * cols + k]) break outer;
      r1++;
    }
    for (let rr = r; rr <= r1; rr++) for (let k = c; k <= c1; k++) used[rr * cols + k] = true;
    rects.push([c, r, c1, r1]);
  }
  return rects;
}

/**
 * Shape of a piece: { boxes: [[x0,y0,z0,x1,y1,z1], ...], ramp: {...}|null, roof: {...}|null, bounds }
 * c = placement record, edit = edit state, skirt = extra wall depth below level 0 on slopes.
 */
export function pieceShape(c, edit, skirt = 0) {
  const out = { boxes: [], ramp: null, roof: null };
  if (c.type === 'wall') {
    const keep = new Array(9).fill(true);
    for (const i of edit.removed) keep[i] = false;
    const tw = CS / 3, T = 0.15;
    for (const [c0, r0, c1, r1] of mergeGrid(3, 3, keep)) {
      const a0 = -CS / 2 + c0 * tw, a1 = -CS / 2 + (c1 + 1) * tw;
      const y0 = c.y0 + r0 - (r0 === 0 ? skirt : 0), y1 = c.y0 + r1 + 1;
      if (c.axis === 'x') out.boxes.push([c.cx + a0, y0, c.cz - T, c.cx + a1, y1, c.cz + T]);
      else out.boxes.push([c.cx - T, y0, c.cz + a0, c.cx + T, y1, c.cz + a1]);
    }
  } else if (c.type === 'floor') {
    const keep = new Array(4).fill(true);
    for (const i of edit.removed) keep[i] = false;
    for (const [c0, r0, c1, r1] of mergeGrid(2, 2, keep)) {
      out.boxes.push([c.cx - 2 + c0 * 2, c.y0 - 0.4, c.cz - 2 + r0 * 2, c.cx - 2 + (c1 + 1) * 2, c.y0, c.cz - 2 + (r1 + 1) * 2]);
    }
  } else if (c.type === 'ramp') {
    const dx = edit.dx, dz = edit.dz, side = edit.side || 0;
    // perpendicular axis (in the floor plane)
    const px = -dz, pz = dx;
    const w = side === 0 ? CS : CS / 2;
    const off = side === 0 ? 0 : side * CS / 4;
    const cx = c.cx + px * off, cz = c.cz + pz * off;
    const hx = Math.abs(dx) * CS / 2 + Math.abs(px) * w / 2, hz = Math.abs(dz) * CS / 2 + Math.abs(pz) * w / 2;
    out.ramp = { cx, cz, dx, dz, len: CS, base: c.y0, rise: LV, w };
    out.rampBounds = [cx - hx, c.y0, cz - hz, cx + hx, c.y0 + LV, cz + hz];
  } else if (c.type === 'cone') {
    const sel = new Set(edit.removed);
    const corner = (i) => (sel.has(i) ? CONE_H : 0);
    const n = sel.size;
    out.roof = { cx: c.cx, cz: c.cz, half: CS / 2, base: c.y0, c: [corner(0), corner(1), corner(2), corner(3)], hc: n === 0 || n >= 3 ? CONE_H : CONE_H / 2 };
  }
  // overall bounds
  let b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const grow = (q) => { for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], q[i]); b[i + 3] = Math.max(b[i + 3], q[i + 3]); } };
  out.boxes.forEach(grow);
  if (out.rampBounds) grow(out.rampBounds);
  if (out.roof) grow([c.cx - 2, c.y0, c.cz - 2, c.cx + 2, c.y0 + CONE_H + 0.05, c.cz + 2]);
  out.bounds = b;
  return out;
}

/** Collider records for a shape (each one points back at the piece). */
export function shapeColliders(shape, piece) {
  const list = [];
  for (const [x0, y0, z0, x1, y1, z1] of shape.boxes) list.push({ kind: 'box', minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1, piece });
  if (shape.ramp) {
    const r = shape.ramp, [x0, y0, z0, x1, y1, z1] = shape.rampBounds;
    list.push({ kind: 'ramp', minx: x0, miny: y0 - 0.2, minz: z0, maxx: x1, maxy: y1 + 0.2, maxz: z1, cx: r.cx, cz: r.cz, dx: r.dx, dz: r.dz, len: r.len, base: r.base, rise: r.rise, piece });
  }
  if (shape.roof) {
    const r = shape.roof;
    const top = Math.max(r.hc, ...r.c);
    list.push({ kind: 'roof', minx: r.cx - r.half, miny: r.base - 0.2, minz: r.cz - r.half, maxx: r.cx + r.half, maxy: r.base + top + 0.2, maxz: r.cz + r.half, cx: r.cx, cz: r.cz, half: r.half, base: r.base, c: r.c, hc: r.hc, piece });
  }
  return list;
}

// ---------------------------------------------------------------- render geometry
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

/** Box with UVs scaled to its size (texture repeats every `uvScale` metres). */
function pushBox(arr, x0, y0, z0, x1, y1, z1, uvScale) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const uv = g.attributes.uv, nor = g.attributes.normal;
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const w = nx > 0.5 ? sz : sx, h = ny > 0.5 ? sz : sy;
    uv.setXY(i, uv.getX(i) * w / uvScale, uv.getY(i) * h / uvScale);
  }
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  arr.push(g);
}

function merge(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index ? g.index.count : 0; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(idx);
  m.computeBoundingSphere();
  return m;
}

/** World-space geometry for a shape. */
export function shapeGeometry(shape) {
  const parts = [];
  for (const b of shape.boxes) pushBox(parts, ...b, CS / 2);
  if (shape.ramp) {
    const r = shape.ramp;
    const L = Math.hypot(r.len, r.rise);
    const g = new THREE.BoxGeometry(L, 0.3, r.w);
    const uv = g.attributes.uv, nor = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      const w = ny > 0.5 ? L : nz > 0.5 ? L : r.w, h = ny > 0.5 ? r.w : 0.3;
      uv.setXY(i, uv.getX(i) * w / 2, uv.getY(i) * h / 2);
    }
    tmpQ.setFromEuler(new THREE.Euler(0, Math.atan2(-r.dz, r.dx), Math.atan2(r.rise, r.len), 'YXZ'));
    tmpM.compose(tmpP.set(r.cx, r.base + r.rise / 2 - 0.1, r.cz), tmpQ, tmpS.set(1, 1, 1));
    g.applyMatrix4(tmpM);
    parts.push(g);
  }
  if (shape.roof) {
    const r = shape.roof, h = r.half, B = r.base;
    const C = [r.cx, B + r.hc, r.cz];
    const P = [[r.cx - h, B + r.c[0], r.cz - h], [r.cx + h, B + r.c[1], r.cz - h], [r.cx + h, B + r.c[3], r.cz + h], [r.cx - h, B + r.c[2], r.cz + h]];
    const pos = [], uvs = [];
    for (let i = 0; i < 4; i++) {
      const p = P[i], q = P[(i + 1) % 4];
      // top face (counter-clockwise seen from above) + bottom face
      pos.push(...C, ...q, ...p, ...C, ...p, ...q);
      uvs.push(1, 2, 0, 0, 2, 0, 1, 2, 2, 0, 0, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    parts.push(g);
  }
  return merge(parts);
}

/** Positions/orientations of the edit tiles for the edit overlay: [{x,y,z,sx,sy,sz,rot:Euler}] */
export function editTiles(piece) {
  const c = piece.c, t = [];
  if (c.type === 'wall') {
    const tw = CS / 3;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
      const a = -CS / 2 + (k + 0.5) * tw, y = c.y0 + r + 0.5;
      if (c.axis === 'x') t.push({ x: c.cx + a, y, z: c.cz, sx: tw * 0.92, sy: 0.92, sz: 0.42 });
      else t.push({ x: c.cx, y, z: c.cz + a, sx: 0.42, sy: 0.92, sz: tw * 0.92 });
    }
  } else if (c.type === 'floor') {
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) t.push({ x: c.cx - 1 + k * 2, y: c.y0 - 0.2, z: c.cz - 1 + r * 2, sx: 1.86, sy: 0.55, sz: 1.86 });
  } else if (c.type === 'ramp') {
    const e = piece.edit, L = Math.hypot(CS / 2, LV / 2);
    const rot = new THREE.Euler(0, Math.atan2(-e.dz, e.dx), Math.atan2(LV, CS), 'YXZ');
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      const x = c.cx - 1 + k * 2, z = c.cz - 1 + r * 2;
      const s = ((x - c.cx) * e.dx + (z - c.cz) * e.dz) / CS + 0.5;
      t.push({ x, y: c.y0 + LV * s + 0.12, z, sx: L * 0.92, sy: 0.14, sz: 1.86, rot });
    }
  } else {
    const roof = piece.shape.roof;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      const x = c.cx - 1 + k * 2, z = c.cz - 1 + r * 2;
      t.push({ x, y: roofHeight(roof, x, z) + 0.1, z, sx: 1.86, sy: 0.14, sz: 1.86 });
    }
  }
  return t;
}
