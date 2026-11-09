// Edit mode: select tiles on one of your own build pieces, then confirm to cut doors, windows,
// half walls, holes in floors, half / rotated ramps and different roof shapes.

import * as THREE from '../lib/three.module.min.js?v=48';
import { editTiles, TILES } from './pieces.js?v=48';

const RANGE = 7.5;

export class EditSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.piece = null;
    this.sel = [];          // selected tile indices (ordered, for ramp paths)
    this.hover = -1;
    this.dragMode = null;   // 'add' | 'remove' while the mouse is held
    this.tiles = [];
    this.raycaster = new THREE.Raycaster();
    this.matOn = new THREE.MeshBasicMaterial({ color: 0x5fb0ff, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    this.matHover = new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.matOff = new THREE.MeshBasicMaterial({ color: 0x08143a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.edges = new THREE.EdgesGeometry(this.box);
  }

  get active() { return !!this.piece; }

  /** Piece under the crosshair that `e` may edit. */
  target(e) {
    const g = this.game, a = g.aimRay();
    const hit = g.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, RANGE + a.back, 1.0);
    const p = hit.collider && hit.collider.piece;
    if (!p || p.dead || p.owner !== e) return null;
    if (Math.hypot(p.x - e.x, p.z - e.z) > RANGE + 2) return null;
    return p;
  }

  begin(e) {
    const p = this.target(e);
    if (!p) { this.game.audio.play('deny', null); return false; }
    this.piece = p;
    this.sel = p.type === 'ramp' ? [] : [...p.edit.removed];
    this.dragMode = null;
    this._makeTiles();
    this.game.audio.play('edit_open', null);
    return true;
  }

  _makeTiles() {
    this.clearTiles();
    for (const t of editTiles(this.piece)) {
      const m = new THREE.Mesh(this.box, this.matOn);
      m.position.set(t.x, t.y, t.z);
      m.scale.set(t.sx, t.sy, t.sz);
      if (t.rot) m.rotation.copy(t.rot);
      m.renderOrder = 6;
      const l = new THREE.LineSegments(this.edges, this.edgeMat);
      m.add(l);
      this.group.add(m);
      this.tiles.push(m);
    }
  }

  clearTiles() {
    for (const t of this.tiles) this.group.remove(t);
    this.tiles = [];
  }

  cancel() { this.piece = null; this.clearTiles(); this.dragMode = null; }

  /** Mouse button pressed / released while editing. */
  press(down) {
    if (!this.piece) return;
    if (down) {
      if (this.hover < 0) return;
      const has = this.sel.includes(this.hover);
      this.dragMode = this.piece.type === 'ramp' ? 'add' : has ? 'remove' : 'add';
      this._apply(this.hover);
    } else {
      this.dragMode = null;
      if (this.game.settings.editOnRelease) this.confirm();
    }
  }

  _apply(i) {
    const has = this.sel.includes(i);
    if (this.dragMode === 'add' && !has) this.sel.push(i);
    else if (this.dragMode === 'remove' && has) this.sel.splice(this.sel.indexOf(i), 1);
    this.game.audio.play('tile', null);
  }

  /** Right mouse: reset the piece to its unedited shape. */
  reset() {
    const p = this.piece;
    if (!p) return;
    const def = p.type === 'ramp' ? { dx: p.c.dx, dz: p.c.dz, side: 0 } : { removed: [] };
    this.game.build.applyEdit(p, def);
    this.cancel();
  }

  confirm() {
    const p = this.piece;
    if (!p) return;
    const edit = this._result();
    if (edit) this.game.build.applyEdit(p, edit);
    this.cancel();
  }

  _result() {
    const p = this.piece, sel = this.sel;
    if (p.type === 'ramp') {
      if (sel.length < 2) return null;
      // direction: from the centre of the first half of the path to the centre of the second half
      const ctr = (list) => [list.reduce((a, i) => a + (i % 2), 0) / list.length, list.reduce((a, i) => a + Math.floor(i / 2), 0) / list.length];
      const h = Math.ceil(sel.length / 2);
      const [ax, az] = ctr(sel.slice(0, h)), [bx, bz] = ctr(sel.slice(sel.length - h));
      let dx = bx - ax, dz = bz - az;
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return null;
      if (Math.abs(dx) >= Math.abs(dz)) { dx = Math.sign(dx); dz = 0; } else { dz = Math.sign(dz); dx = 0; }
      // which columns (perpendicular to the ramp direction) does the path cover?
      const perp = new Set(sel.map((i) => (dx !== 0 ? Math.floor(i / 2) : i % 2)));
      let side = 0;
      if (perp.size === 1) {
        const v = [...perp][0]; // 0 or 1 along the perpendicular axis
        // perpendicular vector is (-dz, dx); work out which side index v maps to
        const pAxisPositive = dx !== 0 ? dx > 0 : dz < 0; // sign of the perp component on its axis
        side = (v === 1) === pAxisPositive ? 1 : -1;
      }
      return { dx, dz, side };
    }
    if (sel.length >= TILES[p.type]) return null; // can't remove everything
    return { removed: [...sel].sort((a, b) => a - b) };
  }

  update(e) {
    const p = this.piece;
    if (!p) return;
    if (p.dead || !e.alive || Math.hypot(p.x - e.x, p.z - e.z) > RANGE + 3) { this.cancel(); return; }
    const a = this.game.aimRay();
    this.raycaster.set(new THREE.Vector3(a.ox, a.oy, a.oz), new THREE.Vector3(a.dx, a.dy, a.dz));
    this.raycaster.far = RANGE + a.back + 2;
    const hits = this.raycaster.intersectObjects(this.tiles, false);
    this.hover = hits.length ? this.tiles.indexOf(hits[0].object) : -1;
    if (this.dragMode && this.hover >= 0) {
      const has = this.sel.includes(this.hover);
      if ((this.dragMode === 'add' && !has) || (this.dragMode === 'remove' && has)) this._apply(this.hover);
    }
    this.tiles.forEach((t, i) => { t.material = this.sel.includes(i) ? this.matOff : i === this.hover ? this.matHover : this.matOn; });
  }
}
