// Game orchestration: renderer, match lifecycle, input, main loop.

import * as THREE from '../lib/three.module.min.js';
import { SEASONS } from './seasons.js';
import { World, MAP_R } from './world.js';
import { Player } from './player.js';
import { Bot, BOT_NAMES } from './bots.js';
import { Combat } from './combat.js';
import { Loot } from './loot.js';
import { BuildSystem } from './build.js';
import { Storm } from './storm.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { ViewModel } from './viewmodel.js';
import { GameAudio } from './audio.js';
import { settings, saveSettings, onSettingsChange } from './settings.js';
import { ITEM_KINDS, RARITIES, weaponStats, WEAPONS } from './weapons.js';
import { mulberry32, clamp } from './util.js';

const BOT_COUNT = 15;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(60, 120, 40);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.audio = new GameAudio(this);
    this.combat = new Combat(this);
    this.loot = new Loot(this);
    this.build = new BuildSystem(this);
    this.storm = new Storm(this);
    this.scene.add(this.combat.group, this.loot.group, this.build.group, this.storm.group);
    this.viewmodel = new ViewModel(this.camera);

    this.world = null;
    this.season = SEASONS[(settings.season || 1) - 1] || SEASONS[0];
    this.entities = [];
    this.bots = [];
    this.player = null;
    this.mode = 'lobby'; // lobby | playing | dead | spectating
    this.time = 0;
    this.prompt = '';
    this.paused = false;
    this.fovCur = settings.fov;
    this.orbit = 0;
    this.spectateTarget = null;
    this.totalPlayers = BOT_COUNT + 1;
    this.matchSeed = 1;
    this.keys = new Set();
    this.rightDown = false;

    this.hud = new HUD(this);
    this.ui = new UI(this);

    this.applySettings();
    onSettingsChange(() => { this.applySettings(); this.audio.applyVolume(); this.hud.applyCrosshair(); });
    this.bindInput();
    addEventListener('resize', () => this.onResize());

    this.buildWorld();
    this.ui.showLobby(true);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup
  applySettings() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * settings.renderScale);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = !!settings.shadows && this.mode !== 'lobby';
    if (this.sun.castShadow) {
      const s = this.sun.shadow; s.mapSize.set(1024, 1024);
      const c = s.camera; c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 10; c.far = 300; c.updateProjectionMatrix();
    }
    if (this.scene.fog) { this.scene.fog.far = settings.drawDist; this.scene.fog.near = settings.drawDist * 0.35; }
    this.camera.far = Math.max(400, settings.drawDist * 1.5);
    this.camera.updateProjectionMatrix();
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  /** (Re)build the entire world for the selected season. */
  buildWorld() {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    const s = this.season;
    this.world = new World(s, this.matchSeed);
    this.scene.add(this.world.group);
    this.scene.background = new THREE.Color(s.sky);
    this.scene.fog = new THREE.Fog(s.fog, settings.drawDist * 0.35, settings.drawDist);
    this.hemi.color.set(s.hemiSky); this.hemi.groundColor.set(s.hemiGround); this.hemi.intensity = s.hemiI;
    this.sun.color.set(s.sun); this.sun.intensity = s.sunI;
    this.storm.wall.material.color.set(s.id === 4 ? 0xff2bd6 : 0x8a3dff);
    this.build.clear();
    this.loot.clear();
    this.loot.populate(this.world, mulberry32(Date.now() & 0xffff));
    this.ui.refreshSeason(s);
  }

  selectSeason(id) {
    if (this.mode !== 'lobby') return;
    if (this.season.id === id) return;
    this.season = SEASONS[id - 1];
    settings.season = id; saveSettings();
    this.buildWorld();
  }

  itemTime(it) { return ITEM_KINDS[it.id].time; }

  aliveCount() { let n = 0; for (const e of this.entities) if (e.alive) n++; return n; }

  // ------------------------------------------------------------------ match lifecycle
  startMatch() {
    this.audio.init();
    this.buildWorld();
    this.ui.showLobby(false);
    this.ui.hideResult();
    this.ui.showSettings(false);
    this.hud.show(true);
    // clear previous entities
    for (const b of this.bots) this.scene.remove(b.mesh);
    this.entities = []; this.bots = [];
    const rnd = mulberry32((Date.now() >>> 3) & 0xfffff);
    this.storm.reset((Date.now() >>> 5) & 0xffff);
    this.time = 0;

    // bots start spread around the towns so there is early action
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < BOT_COUNT; i++) {
      const b = new Bot(this, names[i], i);
      const site = this.world.sites.length && rnd() < 0.7 ? this.world.sites[Math.floor(rnd() * this.world.sites.length)] : null;
      let p;
      if (site) {
        const a = rnd() * Math.PI * 2, r = 6 + rnd() * 14;
        p = { x: site.x + Math.cos(a) * r, z: site.z + Math.sin(a) * r };
        p.y = this.world.heightAt(p.x, p.z);
      } else p = this.world.randomLandPoint(rnd);
      b.x = p.x; b.z = p.z; b.y = p.y; b.grounded = true;
      b.yaw = rnd() * Math.PI * 2;
      this.scene.add(b.mesh);
      this.bots.push(b); this.entities.push(b);
    }
    const pl = new Player(this);
    this.player = pl;
    this.entities.push(pl);
    const spot = this.world.sites.length ? this.world.sites[Math.floor(rnd() * this.world.sites.length)] : { x: 0, z: 0 };
    pl.drop(spot.x + (rnd() - 0.5) * 60, spot.z + (rnd() - 0.5) * 60);
    this.mode = 'playing';
    this.paused = false;
    this.applySettings();
    this.lockPointer();
  }

  backToLobby() {
    this.mode = 'lobby';
    for (const b of this.bots) this.scene.remove(b.mesh);
    this.bots = []; this.entities = []; this.player = null;
    this.hud.show(false);
    this.ui.showPause(false); this.ui.hideResult(); this.ui.showSettings(false);
    this.viewmodel.root.visible = false;
    this.build.clear();
    this.buildWorld();
    this.ui.showLobby(true);
    this.applySettings();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  lockPointer() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* needs user gesture */ }
  }

  resume() {
    this.paused = false;
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this.lockPointer();
  }

  startSpectating() {
    this.ui.hideResult();
    this.mode = 'spectating';
    this.cycleSpectate(0);
  }

  cycleSpectate(dir) {
    const alive = this.bots.filter((b) => b.alive);
    if (!alive.length) { this.spectateTarget = null; return; }
    let i = alive.indexOf(this.spectateTarget);
    i = i < 0 ? 0 : (i + dir + alive.length) % alive.length;
    this.spectateTarget = alive[i];
  }

  // ------------------------------------------------------------------ events from other systems
  onPlayerLanded() {
    this.audio.play('pickup', null);
  }

  eliminate(target, src, weapon) {
    if (!target.alive) return;
    target.alive = false;
    this.loot.dropInventory(target);
    if (target.mesh) target.mesh.visible = false;
    if (src && src !== target) src.kills++;
    const by = src && src !== target ? src.name : (target.lastWeapon || 'the storm');
    const hl = (e) => `<span class="${e.isPlayer ? 'me' : ''}">${e.name}</span>`;
    if (src && src !== target) this.hud.feed(`${hl(src)} <small>[${weapon}]</small> ${hl(target)}`);
    else this.hud.feed(`${hl(target)} <small>was eliminated (${weapon || 'storm'})</small>`);
    if (src && src.isPlayer) this.audio.play('eliminate', null);

    const left = this.aliveCount();
    if (target.isPlayer) {
      this.mode = 'dead';
      this.build.setActive(false);
      this.player.mouseLeft = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showResult({ victory: false, place: left + 1, total: this.totalPlayers, kills: target.kills, season: this.season.name + ' · ' + this.season.title, by });
      this.spectateTarget = src && src !== target && src.alive ? src : null;
    } else if (this.player && this.player.alive && left === 1) {
      this.mode = 'dead';
      this.win();
    }
  }

  win() {
    const p = this.player;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showResult({ victory: true, place: 1, total: this.totalPlayers, kills: p.kills, season: this.season.name + ' · ' + this.season.title, by: p.lastKill || 'you' });
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const down = (e) => {
      if (this.ui.captureKey(e.code)) { e.preventDefault(); return; }
      if (this.mode === 'lobby') return;
      const p = this.player;
      if (e.code === 'Tab') e.preventDefault();
      if (this.mode === 'spectating') {
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.cycleSpectate(1);
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.cycleSpectate(-1);
        return;
      }
      if (!p || !p.alive || this.paused || !document.pointerLockElement) return;
      const K = settings.keys, c = e.code;
      if (c === K.forward) p.input.f = 1;
      else if (c === K.back) p.input.b = 1;
      else if (c === K.left) p.input.l = 1;
      else if (c === K.right) p.input.r = 1;
      else if (c === K.sprint) p.input.sprint = true;
      else if (c === K.jump) { p.input.jump = true; if (!e.repeat && p.state !== 'ground') p.toggleGlider(); }
      if (e.repeat) return;
      if (p.state !== 'ground') return;
      if (c === K.interact) this.interact();
      else if (c === K.reload) p.startReload();
      else if (c === K.buildMode) this.build.setActive(!this.build.active);
      else if (c === K.wall) this.build.setType('wall');
      else if (c === K.floor) this.build.setType('floor');
      else if (c === K.ramp) this.build.setType('ramp');
      else if (c === K.material) this.build.cycleMaterial();
      else if (/^Digit[1-6]$/.test(c)) { this.build.setActive(false); p.selectSlot(+c[5] - 1); }
    };
    const up = (e) => {
      const p = this.player;
      if (!p) return;
      const K = settings.keys, c = e.code;
      if (c === K.forward) p.input.f = 0;
      else if (c === K.back) p.input.b = 0;
      else if (c === K.left) p.input.l = 0;
      else if (c === K.right) p.input.r = 0;
      else if (c === K.sprint) p.input.sprint = false;
      else if (c === K.jump) p.input.jump = false;
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', () => { const p = this.player; if (p) { p.input = { f: 0, b: 0, l: 0, r: 0, jump: false, sprint: false }; p.mouseLeft = false; } this.rightDown = false; });

    addEventListener('mousemove', (e) => {
      const p = this.player;
      if (!p || !p.alive || this.mode !== 'playing' || !document.pointerLockElement) return;
      const k = 0.0022 * settings.sens * (p.ads ? settings.adsSens * (1 / Math.max(1, this.zoom || 1)) ** 0.5 : 1);
      p.yaw -= e.movementX * k;
      p.pitch -= e.movementY * k * (settings.invertY ? -1 : 1);
      p.pitch = clamp(p.pitch, -1.5, 1.5);
    });
    addEventListener('mousedown', (e) => {
      if (this.mode === 'spectating') { this.cycleSpectate(e.button === 2 ? -1 : 1); return; }
      const p = this.player;
      if (this.mode !== 'playing' || !p) return;
      if (!document.pointerLockElement) { if (!this.paused && e.target === this.canvas) this.lockPointer(); return; }
      if (e.button === 0) p.mouseLeft = true;
      if (e.button === 2) this.rightDown = true;
    });
    addEventListener('mouseup', (e) => {
      const p = this.player;
      if (!p) return;
      if (e.button === 0) p.mouseLeft = false;
      if (e.button === 2) this.rightDown = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      const p = this.player;
      if (this.mode !== 'playing' || !p || !p.alive || !document.pointerLockElement || p.state !== 'ground') return;
      if (this.build.active) { if (e.deltaY !== 0) this.build.cycleMaterial(); return; }
      p.selectSlot((p.slot + (e.deltaY > 0 ? 1 : 5)) % 6);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'playing' && !this.paused) {
        this.paused = true;
        const p = this.player;
        if (p) { p.input = { f: 0, b: 0, l: 0, r: 0, jump: false, sprint: false }; p.mouseLeft = false; }
        this.rightDown = false;
        this.ui.showPause(true);
      }
    });
  }

  interact() {
    const p = this.player;
    const t = this.loot.nearestInteractable(p, 2.6);
    if (!t) return;
    const wasPick = p.slot === 0;
    if (this.loot.interact(p, t) && t.type === 'pickup' && t.p.kind === 'weapon' && wasPick) {
      for (let i = 1; i <= 5; i++) if (p.slots[i] === t.p.inst) { p.selectSlot(i); break; }
    }
  }

  // ------------------------------------------------------------------ hazards (storm, lava, ...)
  hazards(e, dt) {
    let dps = 0, name = 'the storm';
    if (this.storm.outside(e.x, e.z)) dps += this.storm.dmg;
    const liq = this.world.liquidAt(e.x, e.z, e.y + 0.1);
    if (liq) {
      if (liq.type === 'lava') { dps += liq.dps || 28; name = 'lava'; }
      else if (liq.type === 'icy') { dps += 3; name = 'icy water'; }
    }
    if (dps <= 0) { e._acc = 0; return; }
    e._acc = (e._acc || 0) + dps * dt;
    if (e._acc >= 1) {
      const n = Math.floor(e._acc); e._acc -= n;
      this.combat.damage(e, n, null, name);
    }
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step (no rendering) - also used by headless tests. */
  tick(dt) {
    this.loot.update(dt, performance.now() / 1000);
    this.combat.update(dt);

    if (this.mode === 'lobby') {
      this.orbit += dt * 0.06;
      const r = 190, h = 105;
      this.camera.position.set(Math.cos(this.orbit) * r, h, Math.sin(this.orbit) * r);
      this.camera.lookAt(0, 0, 0);
      this.camera.fov = 55;
      this.camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
      this.camera.updateProjectionMatrix();
      this.viewmodel.root.visible = false;
      return;
    }
    if (this.camera.view) { this.camera.clearViewOffset(); }

    if (!this.paused) {
      this.time += dt;
      this.storm.update(dt);
      const p = this.player;
      if (p && p.alive) {
        p.ads = this.rightDown && p.state === 'ground' && !this.build.active && p.held && p.held.type === 'weapon';
        p.update(dt);
        if (p.state === 'ground') this.build.update(dt, p); else this.build.setActive(false);
        this.hazards(p, dt);
        this.prompt = '';
        if (p.state === 'ground' && !this.build.active) {
          const t = this.loot.nearestInteractable(p, 2.6);
          if (t) {
            const K = settings.keys.interact.replace('Key', '');
            if (t.type === 'chest') this.prompt = `[${K}] Open chest`;
            else if (t.p.kind === 'weapon') this.prompt = `[${K}] ${WEAPONS[t.p.inst.id].name} (${RARITIES[t.p.inst.rarity].name})`;
            else this.prompt = `[${K}] ${this.season.items[t.p.itemId].name}`;
          }
        }
      }
      for (const b of this.bots) if (b.alive) { b.update(dt); this.hazards(b, dt); }
    }

    this.updateCamera(dt);
    if (this.player) this.hud.update(dt);
    this.sun.position.set(this.camera.position.x + 60, 120, this.camera.position.z + 40);
    this.sun.target.position.set(this.camera.position.x, 0, this.camera.position.z);
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    let fov = settings.fov;
    if (this.mode === 'spectating') {
      const t = this.spectateTarget && this.spectateTarget.alive ? this.spectateTarget : (this.cycleSpectate(0), this.spectateTarget);
      this.viewmodel.root.visible = false;
      if (t) {
        const back = 5.5;
        cam.position.set(t.x + Math.sin(t.yaw) * back, t.y + 3.2, t.z + Math.cos(t.yaw) * back);
        cam.lookAt(t.x, t.y + 1.3, t.z);
      }
      cam.fov = fov; cam.updateProjectionMatrix();
      return;
    }
    if (!p) return;
    if (p.alive) {
      cam.position.set(p.x, p.eyeY, p.z);
      cam.rotation.set(p.pitch, p.yaw, 0);
      if (p.ads && p.held && p.held.type === 'weapon') { this.zoom = weaponStats(p.held).zoom; }
      else this.zoom = 1;
      fov = settings.fov / this.zoom;
      if (p.state === 'ground' && !p.ads && p.input.sprint && p.moving) fov += 4;
      this.viewmodel.update(dt, p, this);
    } else {
      // dead: pull the camera up and keep watching
      cam.position.set(p.x, p.y + 6, p.z + 0.01);
      cam.rotation.set(-1.45, p.yaw, 0);
      this.viewmodel.root.visible = false;
    }
    this.fovCur += (fov - this.fovCur) * Math.min(1, dt * 12);
    cam.fov = this.fovCur;
    cam.updateProjectionMatrix();
  }
}

window.game = new Game();
