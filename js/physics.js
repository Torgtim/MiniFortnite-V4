// Character physics: circle-vs-box horizontal collision, step-up, slopes, ramps/roofs, gravity,
// crouch height, mantling (climbing ledges) and vaulting.

import { colliderTop } from './geom.js?v=66';

export const PLAYER_R = 0.45;
export const PLAYER_H = 1.8;
export const CROUCH_H = 1.2;
export const STEP = 0.65;
export const GRAVITY = 24;
export const FALL_SAFE = 19;   // landing speed (m/s) below which a fall does no damage (~7.5 m)
export const SWIM_DEPTH = 1.25; // how deep the feet hang below the water surface while swimming

export { colliderTop };

/** Can an entity of height h with feet at y stand at (x,z) without being inside a solid? */
export function isFree(world, x, z, y, h = PLAYER_H) {
  const R = PLAYER_R;
  const list = world.query(x, z, R + 0.01);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (x < c.minx - R || x > c.maxx + R || z < c.minz - R || z > c.maxz + R) continue;
    if (c.miny >= y + h) continue;
    if (c.kind === 'ramp' || c.kind === 'roof') {
      // sloped pieces only block where their surface is above our knees and below our head
      const top = colliderTop(c, x, z);
      if (top > y + STEP && top - 0.5 < y + h) return false;
      continue;
    }
    if (c.maxy > y + STEP) return false;
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
    const top = c.kind === 'box' ? c.maxy : Math.max(colliderTop(c, x, z), colliderTop(c, clampTo(x, c.minx, c.maxx), clampTo(z, c.minz, c.maxz)));
    if (top <= y + STEP && top > g) g = top;
  }
  return g;
}

function clampTo(v, a, b) { return v < a ? a : v > b ? b : v; }

/**
 * Advance an entity {x,y,z,vx,vy,vz,grounded,h} by dt. vx/vz are the desired horizontal velocity
 * this frame (set by the controller); vy is integrated here. Returns true if a wall stopped us.
 */
export function stepEntity(world, e, dt) {
  const maxR = world.mapRadius + 6;
  const h = e.h || PLAYER_H;
  let blocked = false;

  // ---- horizontal (axis-separated so we slide along walls)
  const tryMove = (nx, nz) => {
    if (!isFree(world, nx, nz, e.y, h)) return false;
    // stepping (or landing) up onto a step / ramp: there must be headroom at that height
    const gy = groundAt(world, nx, nz, e.y);
    if (gy > e.y + 0.01 && !isFree(world, nx, nz, gy, h)) return false;
    const dist = Math.hypot(nx - e.x, nz - e.z);
    const th = world.heightAt(nx, nz);
    if (th - e.y > dist * 1.25 + (e.grounded ? 0.02 : 0.05)) return false;
    return true;
  };
  const nx = e.x + e.vx * dt;
  if (tryMove(nx, e.z)) e.x = nx; else blocked = true;
  const nz = e.z + e.vz * dt;
  if (tryMove(e.x, nz)) e.z = nz; else blocked = true;
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
      if (c.kind !== 'box') {
        // underside of a ramp/roof plate
        if (e.x < c.minx || e.x > c.maxx || e.z < c.minz || e.z > c.maxz) continue;
        const under = colliderTop(c, e.x, e.z) - 0.25;
        if (under >= e.y + h * 0.5 && under <= ny + h) { ny = Math.min(e.y, under - h); e.vy = 0; }
        continue;
      }
      if (e.x < c.minx - PLAYER_R || e.x > c.maxx + PLAYER_R || e.z < c.minz - PLAYER_R || e.z > c.maxz + PLAYER_R) continue;
      // (counts ceilings the head already pokes into a little, so you can't jump through them)
      if (c.miny >= e.y + h * 0.5 && c.miny <= ny + h) {
        ny = Math.min(e.y, c.miny - h);
        e.vy = 0;
      }
    }
  }

  const g = groundAt(world, e.x, e.z, e.y);
  // deep water / quicksand: float with the head above the surface (swimming)
  const liq = world.season.liquid;
  const floatY = world.liquidY - SWIM_DEPTH;
  const deep = liq && liq.type !== 'lava' && g < floatY - 0.05;
  const floor = deep ? floatY : g;
  e.landSpeed = 0;
  if (e.vy <= 0 && ny <= floor) {
    if (!wasGrounded) { e.landSpeed = -e.vy; if (!deep && -e.vy > FALL_SAFE && e.onFall) e.onFall(-e.vy); }
    e.y = floor;
    e.vy = 0;
    e.grounded = true;
  } else if (wasGrounded && e.vy <= 0 && e.y - floor >= 0 && e.y - floor <= 0.5) {
    e.y = floor; // stick to the ground when walking downhill / down stairs
    e.vy = 0;
    e.grounded = true;
  } else {
    e.y = ny;
    e.grounded = false;
  }
  e.swimming = deep && e.grounded && Math.abs(e.y - floatY) < 0.05;
  return blocked;
}

/** Push an entity out of any solid it overlaps (used right after a build piece appears). */
export function depenetrate(world, e) {
  const R = PLAYER_R, h = e.h || PLAYER_H;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const list = world.query(e.x, e.z, R + 1);
    for (const c of list) {
      if (c.miny >= e.y + h) continue;
      if (c.kind !== 'box') {
        const top = colliderTop(c, e.x, e.z);
        if (top > e.y && top <= e.y + STEP + 1.2 && e.x > c.minx && e.x < c.maxx && e.z > c.minz && e.z < c.maxz) {
          e.y = top; moved = true;
          // lifted under a low ceiling (a ramp built inside a house): duck instead of poking through
          if (e.setCrouch && ceilingBetween(world, e.x, e.z, top + 0.1, top + h)) e.setCrouch(true);
        }
        continue;
      }
      if (c.maxy <= e.y + STEP) continue;
      const l = e.x - (c.minx - R), r = (c.maxx + R) - e.x, t = e.z - (c.minz - R), b = (c.maxz + R) - e.z;
      if (l <= 0 || r <= 0 || t <= 0 || b <= 0) continue; // not inside
      const m = Math.min(l, r, t, b);
      if (m === l) e.x -= l + 0.01; else if (m === r) e.x += r + 0.01; else if (m === t) e.z -= t + 0.01; else e.z += b + 0.01;
      moved = true;
    }
    if (!moved) break;
  }
}

/** Is there a solid underside (ceiling, roof plate) above (x,z) between heights y0 and y1? */
export function ceilingBetween(world, x, z, y0, y1, R = PLAYER_R) {
  const list = world.query(x, z, R + 0.01);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.kind === 'box') {
      if (x < c.minx - R || x > c.maxx + R || z < c.minz - R || z > c.maxz + R) continue;
      if (c.miny >= y0 && c.miny < y1) return true;
    } else {
      if (x < c.minx || x > c.maxx || z < c.minz || z > c.maxz) continue;
      const under = colliderTop(c, x, z) - 0.25;
      if (under >= y0 && under < y1) return true;
    }
  }
  return false;
}

/** Is there room above the entity to stand up at full height? */
export function canStand(world, e) {
  return isFree(world, e.x, e.z, e.y, PLAYER_H);
}

/**
 * Look for a ledge in front of the entity it could mantle onto (or a low obstacle it could vault).
 * Returns {x,y,z,vault} target or null.
 */
export function findLedge(world, e, dirx, dirz, maxRise = 2.75, allowVault = false) {
  const h = e.h || PLAYER_H;
  const reach = PLAYER_R + 0.5;
  const px = e.x + dirx * reach, pz = e.z + dirz * reach;
  // something must actually block us at waist height, otherwise there is nothing to climb
  if (isFree(world, px, pz, e.y + 0.05, Math.min(h, 1.2)) && world.heightAt(px, pz) < e.y + STEP) return null;
  const top = groundAt(world, px, pz, e.y + maxRise - STEP);
  const rise = top - e.y;
  if (rise < 0.6 || rise > maxRise) return null;

  // vault: thin, low obstacle with free ground right behind it
  if (allowVault && rise < 1.45 && !ceilingBetween(world, e.x, e.z, e.y + h * 0.5, top + 0.35 + h, 0.2)) {
    const fx = e.x + dirx * (reach + 1.3), fz = e.z + dirz * (reach + 1.3);
    const gBehind = groundAt(world, fx, fz, e.y + 0.4);
    if (Math.abs(gBehind - e.y) < 1.2 && isFree(world, fx, fz, gBehind, h) && isFree(world, px, pz, top, 0.9)
      && !ceilingBetween(world, px, pz, top + 0.05, top + 0.35 + h, 0.2)) {
      return { x: fx, y: gBehind, z: fz, vault: true, peak: top + 0.35 };
    }
  }
  // climb: need room to stand on top, and headroom above where we are now
  const sx = e.x + dirx * (reach + 0.25), sz = e.z + dirz * (reach + 0.25);
  const sTop = groundAt(world, sx, sz, top + 0.05);
  if (Math.abs(sTop - top) > 0.4) return null;
  if (!isFree(world, sx, sz, sTop, CROUCH_H)) return null;
  if (!isFree(world, e.x, e.z, sTop + 0.05, CROUCH_H * 0.6)) return null;
  // the body rises straight up before moving over the edge: never through a ceiling
  // (this used to let you climb from inside a house through its roof)
  if (ceilingBetween(world, e.x, e.z, e.y + h * 0.5, sTop + CROUCH_H, 0.2)) return null;
  if (ceilingBetween(world, px, pz, sTop + 0.05, sTop + CROUCH_H, 0.2)) return null;
  return { x: sx, y: sTop, z: sz, vault: false, peak: sTop + 0.15 };
}

/** Start a mantle/vault animation on the entity. */
export function startMantle(e, ledge) {
  const d = Math.hypot(ledge.x - e.x, ledge.z - e.z);
  e.mantle = {
    t: 0, dur: ledge.vault ? 0.42 : 0.26 + (ledge.y - e.y) * 0.08,
    x0: e.x, y0: e.y, z0: e.z, x1: ledge.x, y1: ledge.y, z1: ledge.z, peak: ledge.peak, vault: ledge.vault, d,
  };
  e.vx = e.vz = e.vy = 0;
}

/** Advance a mantle. Returns true while still mantling. */
export function stepMantle(world, e, dt) {
  const m = e.mantle;
  if (!m) return false;
  m.t += dt;
  const k = Math.min(1, m.t / m.dur);
  // rise first, then move over the edge
  const up = Math.min(1, k / 0.6), fwd = k < 0.35 ? 0 : (k - 0.35) / 0.65;
  const ease = (t) => t * t * (3 - 2 * t);
  e.x = m.x0 + (m.x1 - m.x0) * ease(fwd);
  e.z = m.z0 + (m.z1 - m.z0) * ease(fwd);
  if (m.vault) e.y = m.y0 + (m.peak - m.y0) * Math.sin(k * Math.PI) + (m.y1 - m.y0) * k;
  else e.y = m.y0 + (Math.max(m.peak, m.y1) - m.y0) * ease(up) - (k >= 1 ? Math.max(0, m.peak - m.y1) : 0);
  // never cut through the surface we are climbing over (sloped roofs, ramps)
  if (k < 1 && fwd > 0) {
    const under = groundAt(world, e.x, e.z, Math.max(m.y1, m.peak));
    if (under > e.y && under <= Math.max(m.y1, m.peak) + 0.05) e.y = under;
  }
  if (k >= 1) {
    e.x = m.x1; e.y = m.y1; e.z = m.z1;
    e.mantle = null;
    e.grounded = true;
    e.vy = 0;
    depenetrate(world, e);
    return false;
  }
  return true;
}
