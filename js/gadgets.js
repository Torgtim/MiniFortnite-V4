// Mobility gadgets: bounce pads (launch you up, then the glider opens) and sky portals
// (instantly rift you into the sky for a new skydive).

import * as THREE from '../lib/three.module.min.js?v=41';

const PAD_R = 1.3;

export class Gadgets {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.pads = [];
    this.padGeo = new THREE.CylinderGeometry(PAD_R, PAD_R + 0.15, 0.25, 12);
    this.springGeo = new THREE.TorusGeometry(0.7, 0.12, 6, 12).rotateX(Math.PI / 2);
  }

  clear() {
    for (const p of this.pads) this.group.remove(p.mesh);
    this.pads.length = 0;
  }

  /** Use the gadget in slot `slot`. Returns true when it was used. */
  use(e, slot) {
    const it = e.slots[slot];
    const g = this.game, w = g.world;
    if (it.id === 'pad') {
      if (!e.grounded || e.airborne) return false;
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      const x = e.x + fx * 2.2, z = e.z + fz * 2.2;
      const y = Math.max(w.heightAt(x, z), e.y);
      this.placePad(x, y, z, e);
      e.consume(slot);
      g.audio.play('build', e);
      return true;
    }
    if (it.id === 'rift') {
      if (e.airborne) return false;
      if (g.fx) { g.fx.flash(e.x, e.y + 1, e.z, 6, 0.4); g.fx.eliminate(e.x, e.y, e.z, ['#a070ff', '#ffffff', '#5fd0ff']); }
      e.y = w.heightAt(e.x, e.z) + 95;
      e.vx *= 0.3; e.vz *= 0.3; e.vy = 0;
      e.air = 'fall'; e.grounded = false; e.sliding = false; e.setCrouch(false); e.mantle = null;
      e.consume(slot);
      g.audio.play('rift', e);
      if (g.fx) g.fx.flash(e.x, e.y, e.z, 8, 0.5);
      return true;
    }
    return false;
  }

  placePad(x, y, z, owner) {
    const color = this.game.season.items.pad.color;
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(this.padGeo, new THREE.MeshLambertMaterial({ color: '#333' }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.2, PAD_R - 0.2, 0.08, 12), new THREE.MeshBasicMaterial({ color }));
    top.position.y = 0.16;
    const spring = new THREE.Mesh(this.springGeo, new THREE.MeshBasicMaterial({ color }));
    spring.position.y = 0.3;
    mesh.add(base, top, spring);
    mesh.position.set(x, y + 0.12, z);
    this.group.add(mesh);
    this.pads.push({ x, y, z, mesh, spring, t: 0, owner });
  }

  update(dt) {
    const g = this.game;
    for (const p of this.pads) {
      p.t += dt;
      p.spring.position.y = 0.3 + Math.max(0, Math.sin(p.t * 3)) * 0.05 + (p.bounce > 0 ? p.bounce : 0);
      if (p.bounce > 0) p.bounce -= dt;
      for (const e of g.entities) {
        if (!e.alive || e.airborne || e.mantle) continue;
        if (Math.abs(e.y - p.y) > 0.8 || Math.hypot(e.x - p.x, e.z - p.z) > PAD_R) continue;
        if (e.vy > 5) continue; // already launched
        e.vy = 27; e.grounded = false; e.padLaunch = true; e.sliding = false;
        p.bounce = 0.4;
        g.audio.play('pad', e);
      }
    }
  }
}
