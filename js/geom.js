// Pure geometry helpers shared by physics, raycasting and building.
// Collider kinds:
//   box  : {minx,miny,minz,maxx,maxy,maxz}
//   ramp : box bounds + {cx,cz,dx,dz,len,base,rise}  (sloped walkable plate)
//   roof : box bounds + {cx,cz,half,base,c:[h00,h10,h01,h11],hc}  (4 triangles meeting at the centre)

const EPS = 1e-9;

/** Ray vs axis-aligned box. Returns entry distance (>=0) or -1. */
export function rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < EPS) { if (ox < minx || ox > maxx) return -1; }
  else { let a = (minx - ox) / dx, b = (maxx - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < EPS) { if (oy < miny || oy > maxy) return -1; }
  else { let a = (miny - oy) / dy, b = (maxy - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < EPS) { if (oz < minz || oz > maxz) return -1; }
  else { let a = (minz - oz) / dz, b = (maxz - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  return tmin;
}

/** Height of a ramp's surface at (x,z) (clamped to the plate). */
export function rampHeight(c, x, z) {
  let t = ((x - c.cx) * c.dx + (z - c.cz) * c.dz) / c.len + 0.5;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return c.base + c.rise * t;
}

/** Height of a roof surface at (x,z). */
export function roofHeight(c, x, z) {
  let u = (x - c.cx) / c.half, v = (z - c.cz) / c.half;
  u = u < -1 ? -1 : u > 1 ? 1 : u; v = v < -1 ? -1 : v > 1 ? 1 : v;
  const [h00, h10, h01, h11] = c.c, hc = c.hc;
  // pick the triangle (centre + one edge) the point falls in
  let ax, az, ah, bx, bz, bh;
  if (Math.abs(u) >= Math.abs(v)) {
    if (u >= 0) { ax = 1; az = -1; ah = h10; bx = 1; bz = 1; bh = h11; }
    else { ax = -1; az = -1; ah = h00; bx = -1; bz = 1; bh = h01; }
  } else if (v >= 0) { ax = -1; az = 1; ah = h01; bx = 1; bz = 1; bh = h11; }
  else { ax = -1; az = -1; ah = h00; bx = 1; bz = -1; bh = h10; }
  // barycentric with C=(0,0)
  const det = ax * bz - bx * az;
  if (Math.abs(det) < EPS) return c.base + hc;
  const wa = (u * bz - bx * v) / det, wb = (ax * v - u * az) / det, wc = 1 - wa - wb;
  return c.base + wa * ah + wb * bh + wc * hc;
}

/** Walkable top of any collider at (x,z). */
export function colliderTop(c, x, z) {
  if (c.kind === 'ramp') return rampHeight(c, x, z);
  if (c.kind === 'roof') return roofHeight(c, x, z);
  return c.maxy;
}

/** Ray vs triangle (Moller-Trumbore), returns t or -1. */
function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz, maxT) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPS) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 && t < maxT ? t : -1;
}

/**
 * Precise ray test against a collider (boxes are exact, ramps/roofs test their sloped surfaces
 * so bullets fly through the open air above or below them). Returns t or -1.
 */
export function rayCollider(c, ox, oy, oz, dx, dy, dz, maxT) {
  const tb = rayBox(ox, oy, oz, dx, dy, dz, c.minx, c.miny, c.minz, c.maxx, c.maxy, c.maxz, maxT);
  if (tb < 0) return -1;
  if (c.kind === 'ramp') {
    // plane: y = base + rise/2 + k*s,  s = (x-cx)*dx + (z-cz)*dz,  k = rise/len (thickness ~0.35)
    const k = c.rise / c.len, y0 = c.base + c.rise / 2;
    const f0 = oy - y0 - k * ((ox - c.cx) * c.dx + (oz - c.cz) * c.dz);
    const fd = dy - k * (dx * c.dx + dz * c.dz);
    const tryT = (off) => {
      if (Math.abs(fd) < EPS) return -1;
      const t = -(f0 - off) / fd;
      if (t < 0 || t > maxT) return -1;
      const x = ox + dx * t, z = oz + dz * t;
      if (x < c.minx - 0.01 || x > c.maxx + 0.01 || z < c.minz - 0.01 || z > c.maxz + 0.01) return -1;
      return t;
    };
    const a = tryT(0.17), b = tryT(-0.17);
    if (a < 0) return b; if (b < 0) return a;
    return Math.min(a, b);
  }
  if (c.kind === 'roof') {
    const h = c.half, cx = c.cx, cz = c.cz, B = c.base;
    const [h00, h10, h01, h11] = c.c;
    const C = [cx, B + c.hc, cz];
    const P = [[cx - h, B + h00, cz - h], [cx + h, B + h10, cz - h], [cx + h, B + h11, cz + h], [cx - h, B + h01, cz + h]];
    let best = -1;
    for (let i = 0; i < 4; i++) {
      const p = P[i], q = P[(i + 1) % 4];
      const t = rayTri(ox, oy, oz, dx, dy, dz, C[0], C[1], C[2], p[0], p[1], p[2], q[0], q[1], q[2], maxT);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }
  return tb;
}
