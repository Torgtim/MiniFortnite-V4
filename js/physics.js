// Simple character physics: circle-vs-box horizontal collision, step-up, slopes, gravity.

import { clamp } from './util.js';

export const PLAYER_R = 0.45;
export const PLAYER_H = 1.8;
export const STEP = 0.65;
export const GRAVITY = 24;

/** Height of a collider's walkable surface at (x,z). Ramps slope along their direction. */
export function colliderTop(c, x, z) {
  if (c.kind === 'ramp') {
    const t = clamp(((x - c.cx) * c.dx + (z - c.cz) * c.dz) / c.len + 0.5, 0, 1);
    return c.base + c.rise * t;
  }
  return c.maxy;
}

/** Can an entity with feet at y stand at (x,z) without being inside a solid? */
export function isFree(world, x, z, y) {
  const R = PLAYER_R;
  const list = world.query(x, z, R + 0.01);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (x < c.minx - R || x > c.maxx + R || z < c.minz - R || z > c.maxz + R) continue;
    if (c.miny >= y + PLAYER_H) continue;
    if (colliderTop(c, x, z) > y + STEP) return false;
  }
  return true;
}

/** Highest surface the entity could be standing on at (x,z), given its feet height y. */
export function groundAt(world, x, z, y) {
  let g = world.heightAt(x, z);
  const m = PLAYER_R * 0.6;
  const list = world.query(x, z, m);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (x < c.minx - m || x > c.maxx + m || z < c.minz - m || z > c.maxz + m) continue;
    const top = colliderTop(c, x, z);
    if (top <= y + STEP && top > g) g = top;
  }
  return g;
}

/**
 * Advance an entity {x,y,z,vx,vy,vz,grounded} by dt. vx/vz are the desired horizontal velocity
 * this frame (set by the controller); vy is integrated here.
 */
export function stepEntity(world, e, dt) {
  const maxR = world.mapRadius + 6;

  // ---- horizontal (axis-separated so we slide along walls)
  const tryMove = (nx, nz) => {
    if (!isFree(world, nx, nz, e.y)) return false;
    const dist = Math.hypot(nx - e.x, nz - e.z);
    const h = world.heightAt(nx, nz);
    if (h - e.y > dist * 1.25 + (e.grounded ? 0.02 : 0.05)) return false;
    return true;
  };
  const nx = e.x + e.vx * dt;
  if (tryMove(nx, e.z)) e.x = nx;
  const nz = e.z + e.vz * dt;
  if (tryMove(e.x, nz)) e.z = nz;
  const rr = Math.hypot(e.x, e.z);
  if (rr > maxR) { e.x *= maxR / rr; e.z *= maxR / rr; }

  // ---- vertical
  const wasGrounded = e.grounded;
  e.vy -= GRAVITY * dt;
  let ny = e.y + e.vy * dt;

  if (e.vy > 0) {
    const list = world.query(e.x, e.z, PLAYER_R);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === 'ramp') continue;
      if (e.x < c.minx - PLAYER_R || e.x > c.maxx + PLAYER_R || e.z < c.minz - PLAYER_R || e.z > c.maxz + PLAYER_R) continue;
      if (c.miny >= e.y + PLAYER_H - 0.05 && c.miny <= ny + PLAYER_H) {
        ny = c.miny - PLAYER_H;
        e.vy = 0;
      }
    }
  }

  const g = groundAt(world, e.x, e.z, e.y);
  if (e.vy <= 0 && ny <= g) {
    if (!wasGrounded && e.vy < -13 && e.onFall) e.onFall(-e.vy);
    e.y = g;
    e.vy = 0;
    e.grounded = true;
  } else if (wasGrounded && e.vy <= 0 && e.y - g >= 0 && e.y - g <= 0.5) {
    e.y = g; // stick to the ground when walking downhill / down stairs
    e.vy = 0;
    e.grounded = true;
  } else {
    e.y = ny;
    e.grounded = false;
  }
}

/** Push an entity out of any solid it overlaps (used right after a build piece appears). */
export function depenetrate(world, e) {
  const R = PLAYER_R;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const list = world.query(e.x, e.z, R + 1);
    for (const c of list) {
      if (c.miny >= e.y + PLAYER_H) continue;
      if (colliderTop(c, e.x, e.z) <= e.y + STEP) continue;
      const l = e.x - (c.minx - R), r = (c.maxx + R) - e.x, t = e.z - (c.minz - R), b = (c.maxz + R) - e.z;
      if (l <= 0 || r <= 0 || t <= 0 || b <= 0) continue; // not inside
      const m = Math.min(l, r, t, b);
      if (m === l) e.x -= l + 0.01; else if (m === r) e.x += r + 0.01; else if (m === t) e.z -= t + 0.01; else e.z += b + 0.01;
      moved = true;
    }
    if (!moved) break;
  }
}
