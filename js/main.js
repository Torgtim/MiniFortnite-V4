// Game orchestration: renderer, match lifecycle (bus -> drop -> storm), input, cameras, main loop.

import * as THREE from '../lib/three.module.min.js?v=47';
import { SEASONS } from './seasons.js?v=47';
import { World } from './world.js?v=47';
import { Player } from './player.js?v=47';
import { Bot, BOT_NAMES } from './bots.js?v=47';
import { Combat } from './combat.js?v=47';
import { Loot } from './loot.js?v=47';
import { BuildSystem } from './build.js?v=47';
import { EditSystem } from './edit.js?v=47';
import { Storm } from './storm.js?v=47';
import { Bus } from './bus.js?v=47';
import { Sky } from './sky.js?v=47';
import { FX } from './fx.js?v=47';
import { Gadgets } from './gadgets.js?v=47';
import { RetroPass } from './retro.js?v=47';
import { BloomPass } from './bloom.js?v=47';
import { HUD } from './hud.js?v=47';
import { UI } from './ui.js?v=47';
import { ViewModel } from './viewmodel.js?v=47';
import { GameAudio } from './audio.js?v=47';
import { settings, saveSettings, onSettingsChange, keyLabel } from './settings.js?v=47';
import { ITEM_KINDS, RARITIES, weaponStats, WEAPONS, makeWeapon } from './weapons.js?v=47';
import { mulberry32, clamp, dirFromAngles } from './util.js?v=47';
import { recordMatch } from './stats.js?v=47';

const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.3).normalize();

class Game {
  constructor() {
    this.settings = settings;
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.audio = new GameAudio(this);
    this.fx = new FX(this);
    this.combat = new Combat(this);
    this.loot = new Loot(this);
    this.build = new BuildSystem(this);
    this.edit = new EditSystem(this);
    this.gadgets = new Gadgets(this);
    this.storm = new Storm(this);
    this.bus = new Bus(this);
    this.sky = new Sky(this.scene);
    this.retro = new RetroPass();
    this.bloom = new BloomPass();
    this._sz = new THREE.Vector2();
    this.scene.add(this.gadgets.group, this.fx.group, this.combat.group, this.loot.group, this.build.group, this.edit.group, this.storm.group, this.bus.mesh);
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
    this.totalPlayers = 1;
    this.matchSeed = 1;
    this.rightDown = false;
    this.bigMap = false;
    this._aim = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1, back: 0 };
    this.camBack = 3.2;
    this.lastStormPhase = -1;

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

  get thirdPerson() {
    const p = this.player;
    if (p && p.emoteT > 0) return true;
    if (!settings.thirdPerson) return false;
    // every scoped weapon (zoom >= 1.5) switches to a clean first-person scope view while aiming
    if (p && p.ads && p.held && p.held.type === 'weapon' && weaponStats(p.held).zoom >= 1.5) return false;
    return true;
  }

  // ------------------------------------------------------------------ setup
  applySettings() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * settings.renderScale);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = !!settings.shadows;
    if (this.sun.castShadow) {
      const s = this.sun.shadow; s.mapSize.set(2048, 2048); s.bias = -0.0006; s.normalBias = 0.04;
      const c = s.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 10; c.far = 320; c.updateProjectionMatrix();
    }
    if (this.scene.fog) { this.scene.fog.far = settings.drawDist; this.scene.fog.near = settings.drawDist * 0.3; }
    this.camera.far = Math.max(450, settings.drawDist * 1.6);
    this.camera.updateProjectionMatrix();
    this.retro.setSize(innerWidth, innerHeight, settings.retroLines, settings.scanlines);
    this.renderer.getDrawingBufferSize(this._sz); this.bloom.setSize(this._sz.x, this._sz.y);
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.retro.setSize(innerWidth, innerHeight, settings.retroLines, settings.scanlines);
    this.renderer.getDrawingBufferSize(this._sz); this.bloom.setSize(this._sz.x, this._sz.y);
  }

  /** (Re)build the entire world for the selected season. */
  buildWorld() {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    const s = this.season;
    this.world = new World(s, this.matchSeed, { decor: settings.decor });
    this.scene.add(this.world.group);
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(s.fog, settings.drawDist * 0.3, settings.drawDist);
    this.hemi.color.set(s.hemiSky); this.hemi.groundColor.set(s.hemiGround); this.hemi.intensity = s.hemiI * 1.05;
    this.sun.color.set(s.sun); this.sun.intensity = s.sunI * 1.25;
    this.sky.setSeason(s, SUN_DIR, { clouds: settings.clouds, weather: settings.weather });
    this.baseFog = new THREE.Color(s.fog);
    this.baseTop = this.sky.uniforms.uTop.value.clone();
    this.stormBlend = 0;
    this._purple = null;
    this.storm.wall.material.color.set(s.id === 4 ? 0xff2bd6 : 0x8a3dff);
    this.build.clear();
    this.gadgets.clear();
    this.combat.clear();
    this.fx.clear();
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

  /** Camera ray through the crosshair (third person) or from the eyes (first person). */
  aimRay() { return this._aim; }

  /** Something loud happened: bots in earshot may come and check it out. */
  noise(src, radius) {
    for (const b of this.bots) {
      if (!b.alive || b === src || b.air) continue;
      const d = Math.hypot(b.x - src.x, b.z - src.z);
      if (d < radius && d > 4) b.hear(src.x, src.z, src);
    }
  }

  onLanded(e) {
    this.fx.landing(e.x, e.y, e.z);
    if (e.isPlayer) this.audio.play('land', e);
    // bots skip the boring first minute of farming: builders land with a little wood
    else if (e.builder) e.mats.wood += Math.round(30 + e.skill * 70);
  }

  // ------------------------------------------------------------------ match lifecycle
  startMatch() {
    this.audio.init();
    this.audio.stopMusic();
    this.buildWorld();
    this.ui.showLobby(false);
    this.ui.hideResult();
    this.ui.showSettings(false);
    this.hud.show(true);
    this.bigMap = false;
    this.victory = false;
    this._clearActors();
    this.edit.cancel();
    const rnd = mulberry32((Date.now() >>> 3) & 0xfffff);
    this.storm.reset((Date.now() >>> 5) & 0xffff);
    this.lastStormPhase = this.storm.phase;
    this.time = 0;
    this.playground = settings.gameMode === 'playground';
    if (this.playground) return this.startPlayground(rnd);
    this.bus.start(rnd);
    // some seasons have bounce pads built into the map
    for (let i = 0; i < (this.season.worldPads || 0); i++) {
      const q = this.world.randomLandPoint(rnd, 20);
      this.gadgets.placePad(q.x, q.y, q.z, null);
    }

    const n = clamp(settings.botCount | 0, 1, 39);
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const b = new Bot(this, names[i % names.length] + (i >= names.length ? i : ''), i, settings.botDifficulty);
      b.air = 'bus'; b.untargetable = true;
      b.planDrop(this.bus, rnd);
      this.scene.add(b.mesh);
      this.bots.push(b); this.entities.push(b);
    }
    const pl = new Player(this);
    this.player = pl;
    pl.air = 'bus'; pl.untargetable = true;
    pl.yaw = this.bus.yaw; pl.pitch = -0.25;
    this.scene.add(pl.model.root);
    this.entities.push(pl);
    this.totalPlayers = this.entities.length;
    this.mode = 'playing';
    this.paused = false;
    this.applySettings();
    this.lockPointer();
    this.audio.play('horn', null);
  }

  /** Playground: no storm, no enemies, unlimited mats + ammo, a full loadout and target dummies. */
  startPlayground(rnd) {
    this.bus.active = false; this.bus.mesh.visible = false;
    this.storm.r = 9999; this.storm.toR = 9999; this.storm.state = 'idle'; this.storm._apply();
    for (let i = 0; i < (this.season.worldPads || 0); i++) { const q = this.world.randomLandPoint(rnd, 20); this.gadgets.placePad(q.x, q.y, q.z, null); }
    const pl = new Player(this);
    this.player = pl;
    const site = this.world.sites.find((s) => s.tower) || this.world.sites[0] || { x: 0, z: 0 };
    const spot = this.world.randomLandPoint(rnd, 0, 999);
    pl.x = site.x + 18; pl.z = site.z + 18;
    if (!this.world.isFreeSpot(pl.x, pl.z, this.world.heightAt(pl.x, pl.z))) { pl.x = spot.x; pl.z = spot.z; }
    pl.y = this.world.heightAt(pl.x, pl.z) + 60; pl.air = 'fall'; pl.vy = -10;
    pl.yaw = Math.atan2(-(site.x - pl.x), -(site.z - pl.z));
    const W = this.season.weapons.map(([id]) => id);
    const pickCls = (cls) => W.find((id) => WEAPONS[id].cls === cls) || W[0];
    pl.slots = [{ type: 'pickaxe' }, { type: 'weapon', id: pickCls('rifle'), rarity: 4, mag: 99 }, { type: 'weapon', id: pickCls('shotgun'), rarity: 4, mag: 99 },
      { type: 'weapon', id: pickCls('sniper'), rarity: 4, mag: 99 }, { type: 'item', id: 'nade', count: 6 }, { type: 'item', id: 'pad', count: 2 }];
    for (const s of pl.slots) if (s.type === 'weapon') s.mag = WEAPONS[s.id].mag;
    this.scene.add(pl.model.root);
    this.entities.push(pl);
    // practice dummies: stand around, strafe a bit, respawn when eliminated
    for (let i = 0; i < 5; i++) {
      const b = new Bot(this, 'Dummy ' + (i + 1), 30 + i, 0);
      b.dummy = true; b.builder = false;
      const a = (i / 5) * Math.PI * 2, r = 14;
      b.home = { x: pl.x + Math.cos(a) * r, z: pl.z + Math.sin(a) * r };
      this._placeDummy(b);
      this.scene.add(b.mesh);
      this.bots.push(b); this.entities.push(b);
    }
    this.totalPlayers = this.entities.length;
    this.mode = 'playing';
    this.paused = false;
    this.applySettings();
    this.lockPointer();
    this.hud.feed('<span class="me">PLAYGROUND: build, edit and shoot as much as you like. Dummies respawn.</span>');
  }

  _placeDummy(b) {
    const w = this.world;
    let x = b.home.x + (Math.random() - 0.5) * 6, z = b.home.z + (Math.random() - 0.5) * 6;
    if (!w.isFreeSpot(x, z, w.heightAt(x, z)) || w.heightAt(x, z) < w.liquidY + 0.5) { const q = w.randomLandPoint(Math.random, 0, 999); x = q.x; z = q.z; }
    b.x = x; b.z = z; b.y = w.heightAt(x, z); b.grounded = true; b.air = null; b.untargetable = false;
    b.alive = true; b.hp = 100; b.shield = 50; b.model.root.visible = true;
    b.yaw = Math.random() * Math.PI * 2;
  }

  backToLobby() {
    this.mode = 'lobby';
    this.playground = false;
    this._clearActors();
    this.player = null;
    this.bus.active = false; this.bus.mesh.visible = false;
    this.edit.cancel();
    this.hud.show(false);
    this.ui.showPause(false); this.ui.hideResult(); this.ui.showSettings(false);
    this.viewmodel.root.visible = false;
    this.buildWorld();
    this.ui.showLobby(true);
    this.applySettings();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _clearActors() {
    for (const b of this.bots) { this.scene.remove(b.mesh); b.model.dispose(); }
    if (this.player) { this.scene.remove(this.player.model.root); this.player.model.dispose(); }
    this.entities = []; this.bots = [];
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
    this.ui.showSpawn(false);
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

  // ------------------------------------------------------------------ eliminations
  eliminate(target, src, weapon) {
    if (!target.alive) return;
    target.alive = false;
    if (!this.playground) this.loot.dropInventory(target);
    if (target.model) {
      const c = target.model.colors;
      this.fx.eliminate(target.x, target.y, target.z, [c.shirt, c.pants, c.skin, c.accent, '#5fd0ff']);
      target.model.root.visible = false;
    }
    if (src && src !== target) {
      src.kills++;
      if (!src.isPlayer && src.alive && Math.random() < 0.35) src.emoteT = 2.5 + Math.random() * 1.5; // bots love a victory dance
    }
    const by = src && src !== target ? src.name : (target.lastWeapon || 'the storm');
    const hl = (e) => `<span class="${e.isPlayer ? 'me' : ''}">${e.name}</span>`;
    if (src && src !== target) this.hud.feed(`${hl(src)} <small>[${weapon}]</small> ${hl(target)}`);
    else this.hud.feed(`${hl(target)} <small>was eliminated (${weapon || 'storm'})</small>`);
    if (src && src.isPlayer && src !== target) { this.audio.play('eliminate', null); this.hud.elimBanner(target.name, weapon); src.lastKill = target.name; }

    if (this.playground) {
      if (target.dummy) setTimeout(() => { if (this.playground && this.bots.includes(target)) { this._placeDummy(target); this.fx.flash(target.x, target.y + 1, target.z, 4, 0.3); } }, 3000);
      if (target.isPlayer) setTimeout(() => { if (this.playground && this.player === target) { target.alive = true; target.hp = 100; target.shield = 100; target.y += 40; target.air = 'fall'; target.model.root.visible = true; } }, 1500);
      return;
    }
    const left = this.aliveCount();
    if (target.isPlayer) {
      this.mode = 'dead';
      this.build.setActive(false);
      this.edit.cancel();
      this.player.mouseLeft = false;
      if (document.pointerLockElement) document.exitPointerLock();
      recordMatch(left + 1, target.kills, false);
      this.ui.showResult({ victory: false, place: left + 1, total: this.totalPlayers, kills: target.kills, season: this.season.name + ' · ' + this.season.title, by });
      this.spectateTarget = src && src !== target && src.alive ? src : null;
    } else if (this.player && this.player.alive && left === 1) {
      this.mode = 'dead';
      this.win();
    }
  }

  win() {
    const p = this.player;
    p.emoteT = 999; p.untargetable = true; p.resetInput(); this.build.setActive(false); this.edit.cancel();
    this.victory = true;
    recordMatch(1, p.kills, true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.play('supply', null);
    this.ui.showResult({ victory: true, place: 1, total: this.totalPlayers, kills: p.kills, season: this.season.name + ' · ' + this.season.title, by: p.lastKill || 'you' });
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    // Every input becomes a "code": keyboard e.code, 'Mouse0'..'Mouse4' for mouse buttons and
    // 'WheelUp' / 'WheelDown' for the scroll wheel, so any action can be bound to any of them.
    const down = (c, repeat = false, e = null) => {
      if (this.ui.captureKey(c)) { if (e) e.preventDefault(); return; }
      if (this.mode === 'lobby') return;
      const p = this.player;
      const K = settings.keys;
      if (e && (c === 'Tab' || c === K.crouch || c === 'Space')) e.preventDefault();
      if (c === K.map && !repeat) { this.bigMap = !this.bigMap; return; }
      if ((c === 'Escape' || c === 'KeyP') && this.mode === 'playing' && !this.paused) {
        if (document.pointerLockElement) document.exitPointerLock(); // pointerlockchange opens the pause menu
        else { this.paused = true; this.ui.showPause(true); }
        return;
      }
      if (this.mode === 'spectating') {
        if (c === 'ArrowRight' || c === 'KeyD' || c === K.fire || c === 'WheelDown') this.cycleSpectate(1);
        if (c === 'ArrowLeft' || c === 'KeyA' || c === K.aim || c === 'WheelUp') this.cycleSpectate(-1);
        return;
      }
      if (!p || !p.alive || this.paused || !document.pointerLockElement) return;
      if (c === K.forward) p.input.f = 1;
      else if (c === K.back) p.input.b = 1;
      else if (c === K.left) p.input.l = 1;
      else if (c === K.right) p.input.r = 1;
      else if (c === K.sprint) p.input.sprint = true;
      else if (c === K.crouch) { p.input.crouch = true; if (!repeat) p.crouchToggle = !p.crouchToggle; }
      else if (c === K.jump) { p.input.jump = true; if (!repeat) p.pressJump(); }
      if (repeat) return;
      // context actions: the same button can mean shoot, place a piece or select an edit tile
      const ctx = this.edit.active ? 'edit' : this.build.active ? 'build' : 'combat';
      if (ctx === 'edit') {
        if (c === K.editSelect) { this.edit.press(true); return; }
        if (c === K.editReset) { this.edit.reset(); return; }
      } else if (ctx === 'build') {
        if (c === K.place) { p.mouseLeft = true; return; }
        if (c === K.material2) { this.build.cycleMaterial(); return; }
        if (c === K.nextPiece || c === K.prevPiece) { if (!p.airborne) this.cyclePiece(c === K.nextPiece ? 1 : -1); return; }
      } else {
        if (c === K.fire) { p.mouseLeft = true; return; }
        if (c === K.aim) { this.rightDown = true; return; }
        if ((c === K.nextSlot || c === K.prevSlot) && !p.airborne) { this.cycleSlot(c === K.nextSlot ? 1 : -1); return; }
      }
      if (c === K.camera) { settings.thirdPerson = !settings.thirdPerson; saveSettings(); return; }
      if (c === K.emote && !p.airborne) { this.build.setActive(false); this.edit.cancel(); p.emote(); return; }
      if (p.airborne) return;
      if (c === K.interact) this.interact();
      else if (c === K.reload) p.startReload();
      else if (c === K.edit) {
        if (this.edit.active) this.edit.confirm();
        else { this.build.setActive(false); this.edit.begin(p); }
      } else if (c === K.buildMode) { this.edit.cancel(); this.build.setActive(!this.build.active); }
      else if (c === K.wall) { this.edit.cancel(); this.build.setType('wall'); }
      else if (c === K.floor) { this.edit.cancel(); this.build.setType('floor'); }
      else if (c === K.ramp) { this.edit.cancel(); this.build.setType('ramp'); }
      else if (c === K.cone) { this.edit.cancel(); this.build.setType('cone'); }
      else if (c === K.material) this.build.cycleMaterial();
      else if (c === K.drop) this.dropHeld();
      else if (c === K.spawn && this.playground) { this.ui.spawnPending = true; if (document.pointerLockElement) document.exitPointerLock(); }
      else if (c === K.pickaxe) { this.build.setActive(false); this.edit.cancel(); p.selectSlot(p.slot === 0 ? (p.lastSlot || 1) : 0); }
      else { const si = [K.slot1, K.slot2, K.slot3, K.slot4, K.slot5].indexOf(c); if (si >= 0) { this.build.setActive(false); this.edit.cancel(); p.selectSlot(si + 1); } }
    };
    const up = (c) => {
      const p = this.player;
      if (!p) return;
      const K = settings.keys;
      if (c === K.forward) p.input.f = 0;
      else if (c === K.back) p.input.b = 0;
      else if (c === K.left) p.input.l = 0;
      else if (c === K.right) p.input.r = 0;
      else if (c === K.sprint) p.input.sprint = false;
      else if (c === K.crouch) p.input.crouch = false;
      else if (c === K.jump) p.input.jump = false;
      if (c === K.fire || c === K.place) p.mouseLeft = false;
      if (c === K.editSelect && this.edit.active) this.edit.press(false);
      if (c === K.aim) this.rightDown = false;
    };
    addEventListener('keydown', (e) => down(e.code, e.repeat, e));
    addEventListener('keyup', (e) => up(e.code));
    addEventListener('blur', () => { const p = this.player; if (p) p.resetInput(); this.rightDown = false; });

    addEventListener('mousemove', (e) => {
      const p = this.player;
      if (!p || !p.alive || this.mode !== 'playing' || !document.pointerLockElement) return;
      const k = 0.0022 * settings.sens * (p.ads ? settings.adsSens * (1 / Math.max(1, this.zoom || 1)) ** 0.5 : 1);
      p.yaw -= e.movementX * k;
      p.pitch -= e.movementY * k * (settings.invertY ? -1 : 1);
      p.pitch = clamp(p.pitch, -1.5, 1.5);
    });
    addEventListener('mousedown', (e) => {
      const c = 'Mouse' + e.button;
      // middle click autoscroll and side-button "back/forward" must not leave the game
      if (e.button === 1 || e.button > 2) e.preventDefault();
      if (this.ui.rebinding) { if (this.ui.captureKey(c)) e.preventDefault(); return; }
      if (this.mode === 'playing' && this.player && !document.pointerLockElement) {
        if (!this.paused && e.target === this.canvas) this.lockPointer();
        return;
      }
      if (this.mode === 'spectating') { this.cycleSpectate(e.button === 2 ? -1 : 1); return; }
      down(c, false, null);
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 1 || e.button > 2) e.preventDefault();
      up('Mouse' + e.button);
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      const c = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this.ui.rebinding) { e.preventDefault(); this.ui.captureKey(c); return; }
      if (this.mode === 'lobby' || (this.mode === 'playing' && !document.pointerLockElement)) return;
      // a wheel "click" is a press and an instant release
      down(c, false, null);
      up(c);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'playing' && !this.paused) {
        this.paused = true;
        if (this.player) this.player.resetInput();
        this.rightDown = false;
        this.edit.cancel();
        if (this.ui.spawnPending) { this.ui.spawnPending = false; this.ui.showSpawn(true); } else this.ui.showPause(true);
      }
    });
  }

  /** Scroll through weapon slots 1-5 (the pickaxe lives on its own key). */
  cycleSlot(dir) {
    const p = this.player;
    const from = p.slot === 0 ? (p.lastSlot || 1) - dir : p.slot;
    p.selectSlot(((from - 1 + (dir > 0 ? 1 : 4)) % 5 + 5) % 5 + 1);
  }

  /** Throw the held weapon / item stack out in front of you (it stays on the ground until you press pick up). */
  dropHeld() {
    const p = this.player, s = p.held;
    if (!s || s.type === 'pickaxe') return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * 1.4, z = p.z + fz * 1.4, y = this.world.heightAt(x, z);
    if (s.type === 'weapon') this.loot.spawnWeapon(x, Math.max(y, p.y - 0.5), z, s).dropped = true;
    else for (let k = 0; k < Math.min(s.count, 6); k++) this.loot.spawnItem(x + k * 0.3, Math.max(y, p.y - 0.5), z, s.id);
    p.slots[p.slot] = null;
    p.reloadT = 0; p.useT = 0; p.burstLeft = 0;
    p.selectSlot(0);
    this.audio.play('pickup', p);
  }

  /** Playground: put a weapon (with a rarity) or a healing item at your feet. */
  spawnForPlayer(kind, id, rarity = 0) {
    const p = this.player, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * 1.6, z = p.z + fz * 1.6, y = Math.max(this.world.heightAt(x, z), p.y - 0.5);
    if (kind === 'weapon') this.loot.spawnWeapon(x, y, z, makeWeapon(id, rarity)).dropped = true;
    else this.loot.spawnItem(x, y, z, id);
  }

  /** Scroll through the build pieces. */
  cyclePiece(dir) {
    const T = ['wall', 'floor', 'ramp', 'cone'], i = T.indexOf(this.build.type);
    this.build.setType(T[(i + (dir > 0 ? 1 : 3)) % 4]);
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
    if (e.air) return;
    let dps = 0, name = 'the storm';
    if (this.storm.outside(e.x, e.z)) dps += this.storm.dmg;
    const liq = this.world.liquidAt(e.x, e.z, e.y + 0.1);
    if (liq) {
      if (liq.type === 'lava') {
        dps += liq.dps || 28; name = 'lava';
        if (e.vy <= 0 && !e.mantle) {
          // lava throws you back up (and hurts)
          e.vy = 13; e.grounded = false; e.sliding = false;
          this.combat.damage(e, 10, null, 'lava');
          this.fx.chips(e.x, e.y + 0.3, e.z, 0xff7a20, 10);
          this.audio.play('sizzle', e);
        }
      }
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
    this.render();
  }

  render() {
    if (settings.style === 'retro') this.retro.render(this.renderer, this.scene, this.camera);
    else if (settings.bloom) {
      const neon = this.season.id === 4;
      this.bloom.render(this.renderer, this.scene, this.camera, neon ? 0.9 : 0.45, neon ? 0.55 : 1.05);
    } else this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step (no rendering) - also used by headless tests. */
  tick(dt) {
    const tnow = performance.now() / 1000;
    this.loot.update(dt, tnow);
    if (!this.paused) this.combat.update(dt); // projectiles freeze while paused
    this.fx.update(dt);
    this.world.update(dt, tnow);

    if (this.mode === 'lobby') {
      this.orbit += dt * 0.06;
      const r = 190, h = 105;
      this.camera.position.set(Math.cos(this.orbit) * r, h, Math.sin(this.orbit) * r);
      this.camera.lookAt(0, 0, 0);
      this.camera.fov = 55;
      this.camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
      this.camera.updateProjectionMatrix();
      this.viewmodel.root.visible = false;
      this.sky.update(dt, tnow, this.camera);
      this._sunFollow(0, 0);
      this.audio.ambience(0, 0);
      return;
    }
    if (this.camera.view) { this.camera.clearViewOffset(); }

    if (!this.paused) {
      this.time += dt;
      const p = this.player;
      this.bus.update(dt);
      if (!this.playground && (!this.bus.active || this.bus.dist > 120)) this.storm.update(dt);
      if (this.storm.phase !== this.lastStormPhase) {
        // a supply drop for each of the first storm circles
        if (this.storm.phase >= 1 && this.storm.phase <= 3) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * this.storm.toR * 0.7;
          const x = this.storm.toX + Math.cos(a) * r, z = this.storm.toZ + Math.sin(a) * r;
          if (this.world.heightAt(x, z) > this.world.liquidY + 0.5) this.loot.spawnSupplyDrop(x, z);
        }
        this.lastStormPhase = this.storm.phase;
      }
      if (p && p.alive) {
        p.ads = this.rightDown && !p.airborne && !this.build.active && !this.edit.active && p.held && p.held.type === 'weapon' && !p.sliding;
        p.update(dt);
        p.animateModel(dt);
        if (!p.airborne) { this.build.updateGhost(p); this.edit.update(p); } else { this.build.setActive(false); this.edit.cancel(); }
        if (!this.victory) this.hazards(p, dt);
        this.prompt = ''; this.promptColor = '';
        if (p.air === 'bus') this.prompt = this.bus.canDrop ? `[${keyName(settings.keys.jump)}] Jump from the bus` : 'Get ready to jump...';
        else if (!p.airborne && !this.build.active && !this.edit.active) {
          const t = this.loot.nearestInteractable(p, 2.6);
          if (t) {
            const K = keyName(settings.keys.interact);
            if (t.type === 'chest') this.prompt = `[${K}] Open ${t.c.kind === 'ammo' ? 'ammo box' : t.c.kind === 'supply' ? 'supply drop' : t.c.kind === 'alpaca' ? 'LOOT ALPACA!' : 'chest'}`;
            else if (t.p.kind === 'weapon') { this.prompt = `[${K}] ${WEAPONS[t.p.inst.id].name} (${RARITIES[t.p.inst.rarity].name})`; this.promptColor = RARITIES[t.p.inst.rarity].color; }
            else this.prompt = `[${K}] ${this.season.items[t.p.itemId].name}`;
          }
        }
      }
      this.build.update(dt);
      this.gadgets.update(dt);
      if (this.playground && p) { p.mats.wood = p.mats.brick = p.mats.metal = 999; for (const k in p.ammo) p.ammo[k] = 999; }
      for (const b of this.bots) if (b.alive) { b.update(dt); this.hazards(b, dt); }
    }

    this.updateCamera(dt);
    this.stormHaze(dt);
    this.ambience();
    this.sky.update(dt, tnow, this.camera);
    if (this.player) this.hud.update(dt);
    const f = this.player && this.player.alive ? this.player : this.camera.position;
    this._sunFollow(f.x, f.z);
  }

  /** Wind while skydiving, a rumble when the storm wall is close. */
  ambience() {
    const p = this.player;
    let wind = 0, storm = 0;
    if (p && p.alive && this.mode !== 'lobby' && !this.paused) {
      if (p.air === 'fall') wind = Math.min(1, Math.abs(p.vy) / 40);
      else if (p.air === 'glide') wind = 0.35;
      const edge = Math.abs(Math.hypot(p.x - this.storm.cx, p.z - this.storm.cz) - this.storm.r);
      storm = Math.max(0, 1 - edge / 25) * (this.storm.r < 260 ? 1 : 0);
    }
    this.audio.ambience(wind, storm);
  }

  /** Inside the storm the world turns into purple haze (fog closes in, the sky goes violet). */
  stormHaze(dt) {
    const p = this.player;
    const inStorm = !!(p && p.alive && !p.airborne && this.mode !== 'lobby' && this.storm.outside(p.x, p.z));
    this.stormBlend += ((inStorm ? 1 : 0) - this.stormBlend) * Math.min(1, dt * 2.5);
    const k = this.stormBlend;
    if (!this.scene.fog || !this.baseFog) return;
    const purple = this._purple || (this._purple = new THREE.Color(this.season.id === 4 ? '#ff2bd6' : '#6a2bb8'));
    this.scene.fog.color.copy(this.baseFog).lerp(purple, k * 0.85);
    this.scene.fog.far = settings.drawDist + (70 - settings.drawDist) * k;
    this.scene.fog.near = settings.drawDist * 0.3 * (1 - k);
    this.sky.uniforms.uHorizon.value.copy(this.scene.fog.color);
    this.sky.uniforms.uTop.value.copy(this.baseTop).lerp(purple, k * 0.7);
  }

  _sunFollow(x, z) {
    // snap to a coarse grid so the shadow map doesn't shimmer while moving
    const sx = Math.round(x / 4) * 4, sz = Math.round(z / 4) * 4;
    this.sun.position.set(sx + SUN_DIR.x * 150, SUN_DIR.y * 150, sz + SUN_DIR.z * 150);
    this.sun.target.position.set(sx, 0, sz);
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    let fov = settings.fov;
    const setAim = (ox, oy, oz, d, back) => { const a = this._aim; a.ox = ox; a.oy = oy; a.oz = oz; a.dx = d.x; a.dy = d.y; a.dz = d.z; a.back = back; };
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
    if (!p.alive) {
      cam.position.set(p.x, p.y + 6, p.z + 0.01);
      cam.rotation.set(-1.45, p.yaw, 0);
      this.viewmodel.root.visible = false;
      return;
    }
    if (this.victory) {
      // victory royale: slow orbit around the dancing winner
      this.orbit += dt * 0.5;
      cam.position.set(p.x + Math.sin(this.orbit) * 5, p.y + 2.2, p.z + Math.cos(this.orbit) * 5);
      cam.lookAt(p.x, p.y + 1.2, p.z);
      p.model.root.visible = true;
      this.viewmodel.root.visible = false;
      cam.fov = settings.fov; cam.updateProjectionMatrix();
      return;
    }
    const d = dirFromAngles(p.yaw, p.pitch);
    const tp = this.thirdPerson || p.airborne;
    p.model.root.visible = tp;
    if (p.air === 'bus') {
      // orbit camera around the bus
      const b = this.bus, back = 22;
      cam.position.set(b.x - d.x * back, b.y + 3 - d.y * back, b.z - d.z * back);
      cam.rotation.set(p.pitch, p.yaw, 0);
      setAim(cam.position.x, cam.position.y, cam.position.z, d, back);
      this.viewmodel.root.visible = false;
    } else if (tp) {
      const ads = p.ads;
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const pivotY = p.y + (p.sliding ? 0.9 : p.crouch ? 1.25 : 1.68);
      const wantBack = p.airborne ? 6.5 : ads ? 2.2 : 3.3;
      const side = p.airborne ? 0 : ads ? 1.0 : 0.82;
      const up = p.airborne ? 1.0 : ads ? 0.42 : 0.35;
      this.camBack += (wantBack - this.camBack) * Math.min(1, dt * 10);
      const px = p.x + rx * side, py = pivotY + up, pz = p.z + rz * side;
      // pull the camera in when something is between it and the player
      const hit = this.world.raycast(px, py, pz, -d.x, -d.y, -d.z, this.camBack + 0.3, 0.8);
      const back = Math.max(0.4, Math.min(this.camBack, hit.t - 0.3));
      let cx = px - d.x * back, cy = py - d.y * back, cz = pz - d.z * back;
      cy = Math.max(cy, this.world.heightAt(cx, cz) + 0.3);
      cam.position.set(cx, cy, cz);
      cam.rotation.set(p.pitch, p.yaw, 0);
      setAim(cx, cy, cz, d, back);
      this.viewmodel.root.visible = false;
      if (ads && p.held && p.held.type === 'weapon') { this.zoom = Math.min(1.5, weaponStats(p.held).zoom); fov = settings.fov / this.zoom; } else this.zoom = 1;
      // fade the player model when the camera is very close (e.g. in a 1x1)
      p.model.root.visible = back > 0.9;
    } else {
      cam.position.set(p.x, p.eyeY, p.z);
      cam.rotation.set(p.pitch, p.yaw, 0);
      setAim(p.x, p.eyeY, p.z, d, 0);
      if (p.ads && p.held && p.held.type === 'weapon') this.zoom = weaponStats(p.held).zoom; else this.zoom = 1;
      fov = settings.fov / this.zoom;
      this.viewmodel.update(dt, p, this);
    }
    if (!p.airborne && !p.ads && p.sprinting) fov += 5;
    if (p.sliding) fov += 8;
    this.fovCur += (fov - this.fovCur) * Math.min(1, dt * 12);
    cam.fov = this.fovCur;
    cam.updateProjectionMatrix();
  }
}

function keyName(code) { return keyLabel(code); }

// let the boot screen paint before the (synchronous) first island build
requestAnimationFrame(() => setTimeout(() => {
  window.game = new Game();
  setTimeout(() => document.getElementById('boot').classList.add('gone'), 350);
}, 30));
