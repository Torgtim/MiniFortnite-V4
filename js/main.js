// Game orchestration: renderer, match lifecycle (bus -> drop -> storm), input, cameras, main loop.

import * as THREE from '../lib/three.module.min.js';
import { SEASONS } from './seasons.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Bot, BOT_NAMES } from './bots.js';
import { Combat } from './combat.js';
import { Loot } from './loot.js';
import { BuildSystem } from './build.js';
import { EditSystem } from './edit.js';
import { Storm } from './storm.js';
import { Bus } from './bus.js';
import { Sky } from './sky.js';
import { FX } from './fx.js';
import { RetroPass } from './retro.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { ViewModel } from './viewmodel.js';
import { GameAudio } from './audio.js';
import { settings, saveSettings, onSettingsChange } from './settings.js';
import { ITEM_KINDS, RARITIES, weaponStats, WEAPONS } from './weapons.js';
import { mulberry32, clamp, dirFromAngles } from './util.js';

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
    this.storm = new Storm(this);
    this.bus = new Bus(this);
    this.sky = new Sky(this.scene);
    this.retro = new RetroPass();
    this.scene.add(this.fx.group, this.combat.group, this.loot.group, this.build.group, this.edit.group, this.storm.group, this.bus.mesh);
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
    if (!settings.thirdPerson) return false;
    // scoped snipers switch to the scope view like in the real game
    if (p && p.ads && p.held && p.held.type === 'weapon' && weaponStats(p.held).zoom >= 2.4) return false;
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
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.retro.setSize(innerWidth, innerHeight, settings.retroLines, settings.scanlines);
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
    this.storm.wall.material.color.set(s.id === 4 ? 0xff2bd6 : 0x8a3dff);
    this.build.clear();
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
  }

  // ------------------------------------------------------------------ match lifecycle
  startMatch() {
    this.audio.init();
    this.buildWorld();
    this.ui.showLobby(false);
    this.ui.hideResult();
    this.ui.showSettings(false);
    this.hud.show(true);
    this.bigMap = false;
    for (const b of this.bots) this.scene.remove(b.mesh);
    if (this.player) this.scene.remove(this.player.model.root);
    this.entities = []; this.bots = [];
    this.edit.cancel();
    const rnd = mulberry32((Date.now() >>> 3) & 0xfffff);
    this.storm.reset((Date.now() >>> 5) & 0xffff);
    this.lastStormPhase = this.storm.phase;
    this.time = 0;
    this.bus.start(rnd);

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

  backToLobby() {
    this.mode = 'lobby';
    for (const b of this.bots) this.scene.remove(b.mesh);
    if (this.player) this.scene.remove(this.player.model.root);
    this.bots = []; this.entities = []; this.player = null;
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

  // ------------------------------------------------------------------ eliminations
  eliminate(target, src, weapon) {
    if (!target.alive) return;
    target.alive = false;
    this.loot.dropInventory(target);
    if (target.model) {
      const c = target.model.colors;
      this.fx.eliminate(target.x, target.y, target.z, [c.shirt, c.pants, c.skin, c.accent, '#5fd0ff']);
      target.model.root.visible = false;
    }
    if (src && src !== target) src.kills++;
    const by = src && src !== target ? src.name : (target.lastWeapon || 'the storm');
    const hl = (e) => `<span class="${e.isPlayer ? 'me' : ''}">${e.name}</span>`;
    if (src && src !== target) this.hud.feed(`${hl(src)} <small>[${weapon}]</small> ${hl(target)}`);
    else this.hud.feed(`${hl(target)} <small>was eliminated (${weapon || 'storm'})</small>`);
    if (src && src.isPlayer && src !== target) { this.audio.play('eliminate', null); this.hud.elimBanner(target.name, weapon); src.lastKill = target.name; }

    const left = this.aliveCount();
    if (target.isPlayer) {
      this.mode = 'dead';
      this.build.setActive(false);
      this.edit.cancel();
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
    this.audio.play('supply', null);
    this.ui.showResult({ victory: true, place: 1, total: this.totalPlayers, kills: p.kills, season: this.season.name + ' · ' + this.season.title, by: p.lastKill || 'you' });
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const down = (e) => {
      if (this.ui.captureKey(e.code)) { e.preventDefault(); return; }
      if (this.mode === 'lobby') return;
      const p = this.player;
      const K = settings.keys, c = e.code;
      if (c === 'Tab' || c === K.crouch || c === 'Space') e.preventDefault();
      if (c === K.map && !e.repeat) { this.bigMap = !this.bigMap; return; }
      if (this.mode === 'spectating') {
        if (c === 'ArrowRight' || c === 'KeyD') this.cycleSpectate(1);
        if (c === 'ArrowLeft' || c === 'KeyA') this.cycleSpectate(-1);
        return;
      }
      if (!p || !p.alive || this.paused || !document.pointerLockElement) return;
      if (c === K.forward) p.input.f = 1;
      else if (c === K.back) p.input.b = 1;
      else if (c === K.left) p.input.l = 1;
      else if (c === K.right) p.input.r = 1;
      else if (c === K.sprint) p.input.sprint = true;
      else if (c === K.crouch) { p.input.crouch = true; if (!e.repeat) p.crouchToggle = !p.crouchToggle; }
      else if (c === K.jump) { p.input.jump = true; if (!e.repeat) p.pressJump(); }
      if (e.repeat) return;
      if (c === K.camera) { settings.thirdPerson = !settings.thirdPerson; saveSettings(); return; }
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
      else if (/^Digit[1-6]$/.test(c)) { this.build.setActive(false); this.edit.cancel(); p.selectSlot(+c[5] - 1); }
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
      else if (c === K.crouch) p.input.crouch = false;
      else if (c === K.jump) p.input.jump = false;
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
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
      if (this.mode === 'spectating') { this.cycleSpectate(e.button === 2 ? -1 : 1); return; }
      const p = this.player;
      if (this.mode !== 'playing' || !p) return;
      if (!document.pointerLockElement) { if (!this.paused && e.target === this.canvas) this.lockPointer(); return; }
      if (this.edit.active) {
        if (e.button === 0) this.edit.press(true);
        if (e.button === 2) this.edit.reset();
        return;
      }
      if (e.button === 0) p.mouseLeft = true;
      if (e.button === 2) { if (this.build.active) this.build.cycleMaterial(); else this.rightDown = true; }
    });
    addEventListener('mouseup', (e) => {
      const p = this.player;
      if (!p) return;
      if (e.button === 0) { p.mouseLeft = false; if (this.edit.active) this.edit.press(false); }
      if (e.button === 2) this.rightDown = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      const p = this.player;
      if (this.mode !== 'playing' || !p || !p.alive || !document.pointerLockElement || p.airborne) return;
      if (this.build.active) {
        if (e.deltaY !== 0) { const i = ['wall', 'floor', 'ramp', 'cone'].indexOf(this.build.type); this.build.setType(['wall', 'floor', 'ramp', 'cone'][(i + (e.deltaY > 0 ? 1 : 3)) % 4]); }
        return;
      }
      p.selectSlot((p.slot + (e.deltaY > 0 ? 1 : 5)) % 6);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'playing' && !this.paused) {
        this.paused = true;
        if (this.player) this.player.resetInput();
        this.rightDown = false;
        this.edit.cancel();
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
    if (e.air) return;
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
    if (settings.style === 'retro') this.retro.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step (no rendering) - also used by headless tests. */
  tick(dt) {
    const tnow = performance.now() / 1000;
    this.loot.update(dt, tnow);
    this.combat.update(dt);
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
      return;
    }
    if (this.camera.view) { this.camera.clearViewOffset(); }

    if (!this.paused) {
      this.time += dt;
      const p = this.player;
      this.bus.update(dt);
      if (!this.bus.active || this.bus.dist > 120) this.storm.update(dt);
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
        this.hazards(p, dt);
        this.prompt = '';
        if (p.air === 'bus') this.prompt = this.bus.canDrop ? `[${keyName(settings.keys.jump)}] Jump from the bus` : 'Get ready to jump...';
        else if (!p.airborne && !this.build.active && !this.edit.active) {
          const t = this.loot.nearestInteractable(p, 2.6);
          if (t) {
            const K = keyName(settings.keys.interact);
            if (t.type === 'chest') this.prompt = `[${K}] Open ${t.c.kind === 'ammo' ? 'ammo box' : t.c.kind === 'supply' ? 'supply drop' : 'chest'}`;
            else if (t.p.kind === 'weapon') this.prompt = `[${K}] ${WEAPONS[t.p.inst.id].name} (${RARITIES[t.p.inst.rarity].name})`;
            else this.prompt = `[${K}] ${this.season.items[t.p.itemId].name}`;
          }
        }
      }
      this.build.update(dt);
      for (const b of this.bots) if (b.alive) { b.update(dt); this.hazards(b, dt); }
    }

    this.updateCamera(dt);
    this.sky.update(dt, tnow, this.camera);
    if (this.player) this.hud.update(dt);
    const f = this.player && this.player.alive ? this.player : this.camera.position;
    this._sunFollow(f.x, f.z);
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
      const wantBack = p.airborne ? 6.5 : ads ? 1.6 : 3.3;
      const side = p.airborne ? 0 : ads ? 0.6 : 0.78;
      const up = p.airborne ? 1.0 : 0.35;
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

function keyName(code) { return code.replace('Key', '').replace('Space', 'SPACE'); }

window.game = new Game();
