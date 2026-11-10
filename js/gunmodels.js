// Detailed low-poly weapon models, one design per weapon id (original designs, not copies).
// Every gun is built from boxes and cylinders, then merged into at most two meshes
// (a lit body with vertex colours + an unlit "glow" part for lenses, energy cells and the
// rarity stripe), so a gun costs 1-2 draw calls no matter how detailed it is.
//
// Convention: the grip (hand) is at the origin, the barrel points down -Z, +Y is up.

import * as THREE from '../lib/three.module.min.js?v=66';
import { RARITIES } from './weapons.js?v=66';

// ---- palette
const C = {
  steel: 0x3a4048, gun: 0x4a5260, grey: 0x707884, light: 0xa4adb8, black: 0x24272d,
  wood: 0x7a4e2a, woodD: 0x5a3820, brass: 0xc9a040, olive: 0x4d5a3a, tan: 0xb59a6a,
  white: 0xdfe6ee, ice: 0x9fd8ff, purple: 0x5a3a8a, red: 0xb03030, orange: 0xd06a20,
};
const GLOW = { red: 0xff3030, cyan: 0x40f0ff, lens: 0x60c0ff, magenta: 0xff40e0, green: 0x60ff80, ice: 0xbff4ff, orange: 0xffa030 };

// ---- part list helpers ---------------------------------------------------------------
class Parts {
  constructor() { this.list = []; this.muzzle = [0, 0, -0.6]; this.sightY = 0.1; }
  box(w, h, d, x, y, z, c, o = {}) { this.list.push({ t: 'box', w, h, d, x, y, z, c, ...o }); return this; }
  /** cylinder along Z (o.axis 'x' or 'y' to turn it) */
  cyl(r, len, x, y, z, c, o = {}) { this.list.push({ t: 'cyl', r, len, x, y, z, c, ...o }); return this; }
  glow(w, h, d, x, y, z, c, o = {}) { return this.box(w, h, d, x, y, z, c, { ...o, glow: true }); }
  rar(w, h, d, x, y, z, o = {}) { return this.box(w, h, d, x, y, z, 'rar', { ...o, glow: true }); }
  // common sub-assemblies
  grip(z = 0.02, c = C.black, h = 0.16) { return this.box(0.055, h, 0.075, 0, -h / 2 + 0.01, z + 0.02, c, { rx: 0.28 }); }
  /** pistol magazine that sits inside the grip (only its base plate shows until it slides out) */
  gripMag(z = 0.02, c = C.black, h = 0.16) { return this.box(0.046, h, 0.06, 0, -h / 2 - 0.004, z + 0.024, c, { rx: 0.28, mag: true }); }
  guard(z = -0.06, y = -0.055) { return this.box(0.02, 0.018, 0.1, 0, y - 0.03, z, C.black).box(0.02, 0.04, 0.015, 0, y - 0.01, z - 0.05, C.black); }
  iron(zFront, zRear, top) {
    this.sightY = top + 0.02;
    return this.box(0.012, 0.035, 0.012, 0, top + 0.017, zFront, C.black).box(0.04, 0.03, 0.015, 0, top + 0.015, zRear, C.black);
  }
  redDot(z, top, dot = GLOW.red) {
    this.sightY = top + 0.045;
    return this.box(0.045, 0.02, 0.09, 0, top + 0.01, z, C.black)
      // open frame (two thin side posts + a top bar) so you can look through it
      .box(0.008, 0.06, 0.05, -0.03, top + 0.045, z - 0.02, C.steel).box(0.008, 0.06, 0.05, 0.03, top + 0.045, z - 0.02, C.steel)
      .box(0.068, 0.008, 0.05, 0, top + 0.078, z - 0.02, C.steel)
      .box(0.03, 0.03, 0.04, 0, top + 0.03, z + 0.03, C.black)
      .glow(0.004, 0.004, 0.003, 0, top + 0.045, z - 0.04, dot);
  }
  scope(z, len, top, r = 0.034, lens = GLOW.lens, body = C.black) {
    this.sightY = top + 0.06;
    const y = top + 0.06;
    return this.cyl(r, len, 0, y, z, body)
      .cyl(r * 1.45, 0.07, 0, y, z - len / 2 + 0.035, body, { r2: r }).cyl(r * 1.3, 0.06, 0, y, z + len / 2 - 0.03, body, { r1: r })
      .cyl(r * 0.55, 0.035, r * 1.25, y, z - 0.02, body, { axis: 'x' }).cyl(r * 0.5, 0.03, 0, y + r * 1.2, z - 0.02, body, { axis: 'y' })
      .box(0.025, 0.05, 0.03, 0, top + 0.02, z - len * 0.28, C.steel).box(0.025, 0.05, 0.03, 0, top + 0.02, z + len * 0.28, C.steel)
      .cyl(r * 1.3, 0.004, 0, y, z - len / 2 - 0.001, lens, { glow: true }).cyl(r * 1.1, 0.004, 0, y, z + len / 2 + 0.001, lens, { glow: true });
  }
  rail(z, len, top) {
    this.box(0.04, 0.012, len, 0, top + 0.006, z, C.black);
    for (let i = 0; i < Math.floor(len / 0.03); i++) this.box(0.046, 0.008, 0.012, 0, top + 0.014, z - len / 2 + 0.015 + i * 0.03, C.black);
    return this;
  }
  barrel(r, len, zStart, y, c = C.black) { this.muzzle = [0, y, zStart - len]; return this.cyl(r, len, 0, y, zStart - len / 2, c); }
}

// ---- the designs ------------------------------------------------------------------------
const DESIGNS = {
  // ---------------- pistols
  pistol(p) {
    p.box(0.062, 0.065, 0.29, 0, 0.035, -0.1, C.gun)                  // slide
      .box(0.058, 0.045, 0.25, 0, -0.012, -0.09, C.black)              // frame
      .grip(0.02).gripMag(0.02, C.steel).guard(-0.06, -0.035)
      .box(0.064, 0.012, 0.05, 0, 0.04, 0.0, C.black)                  // slide serrations
      .box(0.064, 0.012, 0.05, 0, 0.02, 0.0, C.black)
      .rar(0.066, 0.01, 0.12, 0, 0.052, -0.14)
      .iron(-0.235, 0.03, 0.068)
      .barrel(0.012, 0.03, -0.245, 0.035);
  },
  hand_cannon(p) {
    p.box(0.078, 0.085, 0.36, 0, 0.045, -0.13, C.light)
      .box(0.07, 0.05, 0.32, 0, -0.015, -0.12, C.steel)
      .grip(0.03, C.woodD, 0.17).gripMag(0.03, C.steel, 0.17).guard(-0.07, -0.04)
      .box(0.05, 0.03, 0.08, 0, 0.1, -0.24, C.light)                   // compensator on top
      .box(0.052, 0.012, 0.012, 0, 0.115, -0.22, C.black).box(0.052, 0.012, 0.012, 0, 0.115, -0.26, C.black)
      .rar(0.08, 0.012, 0.16, 0, 0.06, -0.08)
      .iron(-0.27, 0.035, 0.09)
      .barrel(0.018, 0.04, -0.31, 0.045, C.steel);
  },
  revolver(p) {
    p.box(0.055, 0.075, 0.13, 0, 0.03, -0.02, C.steel)                 // frame
      .cyl(0.048, 0.1, 0, 0.035, -0.1, C.grey, { seg: 6, mag: true })              // cylinder (swings out to reload)
      .cyl(0.02, 0.26, 0, 0.055, -0.27, C.steel)                         // barrel
      .box(0.02, 0.02, 0.26, 0, 0.075, -0.27, C.steel)                   // top rib
      .cyl(0.012, 0.2, 0, 0.022, -0.24, C.black)                         // ejector rod
      .box(0.025, 0.04, 0.03, 0, 0.08, 0.05, C.black, { rx: -0.4 })      // hammer
      .grip(0.04, C.wood, 0.17).guard(-0.03, -0.01)
      .rar(0.058, 0.012, 0.06, 0, 0.0, -0.02)
      .iron(-0.39, 0.03, 0.085);
    p.muzzle = [0, 0.055, -0.41];
  },
  blaster(p) {
    p.box(0.07, 0.09, 0.26, 0, 0.03, -0.1, C.white)
      .box(0.08, 0.05, 0.12, 0, 0.06, -0.02, C.grey)
      .cyl(0.03, 0.12, 0, 0.035, -0.28, C.white)
      .cyl(0.034, 0.012, 0, 0.035, -0.25, GLOW.cyan, { glow: true }).cyl(0.034, 0.012, 0, 0.035, -0.3, GLOW.cyan, { glow: true })
      .box(0.09, 0.012, 0.08, 0, 0.0, -0.12, C.grey)                     // fins
      .glow(0.072, 0.02, 0.1, 0, 0.065, -0.14, GLOW.cyan)
      .grip(0.02, C.grey).gripMag(0.02, C.black).guard(-0.06, -0.025)
      .rar(0.074, 0.01, 0.1, 0, -0.012, -0.02)
      .iron(-0.2, 0.0, 0.085);
    p.muzzle = [0, 0.035, -0.35];
  },

  // ---------------- SMGs
  smg(p) {
    p.box(0.07, 0.09, 0.34, 0, 0.02, -0.12, C.gun)
      .box(0.06, 0.05, 0.12, 0, -0.03, -0.3, C.black)                    // lower front
      .box(0.035, 0.12, 0.05, 0, -0.1, -0.26, C.black)                   // foregrip
      .box(0.035, 0.17, 0.05, 0, -0.1, -0.11, C.black, { rx: 0.05, mag: true })     // mag
      .grip(0.04).guard(-0.02, -0.025)
      .cyl(0.022, 0.12, 0, 0.03, -0.35, C.black)                          // suppressor-ish barrel
      .box(0.015, 0.015, 0.2, -0.025, 0.02, 0.15, C.black).box(0.015, 0.015, 0.2, 0.025, 0.02, 0.15, C.black)  // wire stock
      .box(0.065, 0.06, 0.015, 0, 0.0, 0.25, C.black)
      .rar(0.072, 0.012, 0.14, 0, 0.06, -0.18)
      .redDot(-0.09, 0.065);
    p.muzzle = [0, 0.03, -0.42];
  },
  frost_smg(p) {
    p.box(0.075, 0.1, 0.36, 0, 0.02, -0.12, C.white)
      .box(0.08, 0.04, 0.16, 0, 0.08, -0.12, C.ice)
      .glow(0.082, 0.012, 0.012, 0, 0.065, -0.06, GLOW.ice).glow(0.082, 0.012, 0.012, 0, 0.065, -0.1, GLOW.ice).glow(0.082, 0.012, 0.012, 0, 0.065, -0.14, GLOW.ice)
      .box(0.035, 0.16, 0.05, 0, -0.1, -0.13, C.ice, { rx: 0.35, mag: true })        // angled mag
      .box(0.03, 0.1, 0.045, 0, -0.08, -0.27, C.grey)
      .grip(0.04, C.grey).guard(-0.02, -0.03)
      .cyl(0.02, 0.1, 0, 0.03, -0.35, C.grey)
      .box(0.06, 0.07, 0.18, 0, 0.0, 0.14, C.white)                       // stock
      .rar(0.077, 0.012, 0.1, 0, 0.0, -0.22)
      .iron(-0.29, 0.03, 0.1);
    p.muzzle = [0, 0.03, -0.41];
  },
  tommy(p) {
    p.box(0.065, 0.085, 0.3, 0, 0.025, -0.1, C.steel)
      .cyl(0.024, 0.2, 0, 0.03, -0.35, C.steel)
      .cyl(0.032, 0.012, 0, 0.03, -0.28, C.black).cyl(0.032, 0.012, 0, 0.03, -0.32, C.black).cyl(0.032, 0.012, 0, 0.03, -0.36, C.black) // cooling fins
      .cyl(0.085, 0.055, 0, -0.07, -0.1, C.black, { axis: 'x', seg: 12, mag: true })   // drum mag
      .box(0.035, 0.1, 0.045, 0, -0.07, -0.24, C.wood)                      // vertical foregrip
      .grip(0.04, C.wood).guard(0.0, -0.02)
      .box(0.055, 0.075, 0.24, 0, -0.02, 0.17, C.wood, { rx: -0.08 })     // stock
      .rar(0.068, 0.012, 0.1, 0, 0.07, -0.02)
      .iron(-0.42, 0.04, 0.07);
    p.muzzle = [0, 0.03, -0.45];
  },
  pulse_smg(p) {
    p.box(0.07, 0.1, 0.34, 0, 0.025, -0.12, C.purple)
      .box(0.05, 0.05, 0.3, 0, 0.09, -0.12, C.steel)
      .cyl(0.02, 0.16, 0, 0.035, -0.36, C.steel)
      .cyl(0.03, 0.01, 0, 0.035, -0.31, GLOW.magenta, { glow: true }).cyl(0.03, 0.01, 0, 0.035, -0.36, GLOW.magenta, { glow: true }).cyl(0.03, 0.01, 0, 0.035, -0.41, GLOW.magenta, { glow: true })
      .glow(0.03, 0.08, 0.06, 0, -0.06, -0.12, GLOW.magenta, { mag: true })              // energy cell
      .box(0.036, 0.04, 0.07, 0, -0.11, -0.12, C.steel)
      .grip(0.04, C.steel).guard(-0.02, -0.03)
      .box(0.05, 0.08, 0.16, 0, 0.0, 0.13, C.purple)
      .rar(0.072, 0.012, 0.12, 0, -0.03, -0.24)
      .redDot(-0.1, 0.115, GLOW.magenta);
    p.muzzle = [0, 0.035, -0.45];
  },

  // ---------------- rifles
  ar(p) {
    p.box(0.07, 0.1, 0.36, 0, 0.03, -0.1, C.gun)                         // receiver
      .box(0.075, 0.085, 0.24, 0, 0.03, -0.38, C.black)                   // handguard
      .box(0.077, 0.012, 0.012, 0, 0.03, -0.3, C.gun).box(0.077, 0.012, 0.012, 0, 0.03, -0.36, C.gun).box(0.077, 0.012, 0.012, 0, 0.03, -0.42, C.gun)
      .cyl(0.016, 0.16, 0, 0.035, -0.58, C.black)
      .cyl(0.022, 0.05, 0, 0.035, -0.66, C.black, { seg: 6 })              // flash hider
      .box(0.04, 0.1, 0.06, 0, -0.07, -0.13, C.black, { rx: 0.18, mag: true })        // curved mag
      .box(0.04, 0.08, 0.06, 0, -0.15, -0.105, C.black, { rx: 0.4, mag: true })
      .grip(0.04).guard(-0.03, -0.02)
      .box(0.06, 0.08, 0.22, 0, 0.0, 0.17, C.gun)                          // stock
      .box(0.065, 0.11, 0.03, 0, -0.01, 0.28, C.black)                     // butt pad
      .box(0.012, 0.025, 0.012, 0.036, 0.04, -0.03, C.black)               // charging handle
      .rar(0.072, 0.014, 0.12, 0, 0.0, 0.17)
      .rail(-0.12, 0.26, 0.08)
      .redDot(-0.06, 0.092);
    p.muzzle = [0, 0.035, -0.69];
  },
  burst_ar(p) {
    // bullpup: magazine sits behind the grip
    p.box(0.075, 0.12, 0.62, 0, 0.03, -0.12, C.light)
      .box(0.08, 0.06, 0.3, 0, -0.01, -0.3, C.steel)
      .box(0.04, 0.13, 0.06, 0, -0.08, 0.12, C.black, { rx: 0.15, mag: true })
      .grip(-0.06, C.steel).guard(-0.13, -0.03)
      .cyl(0.017, 0.12, 0, 0.04, -0.49, C.black)
      .box(0.07, 0.11, 0.035, 0, 0.02, 0.2, C.black)
      .box(0.012, 0.03, 0.18, 0.04, 0.05, -0.2, C.black)                 // side vents
      .rar(0.077, 0.014, 0.14, 0, 0.075, 0.05)
      .redDot(-0.12, 0.09, GLOW.cyan);
    p.muzzle = [0, 0.04, -0.55];
  },
  scoped_ar(p) {
    DESIGNS.ar(p);
    p.list = p.list.filter((q) => !(q.y > 0.095)); // drop the red dot, keep the rail
    p.scope(-0.1, 0.24, 0.09, 0.03);
  },
  plasma_rifle(p) {
    p.box(0.075, 0.11, 0.44, 0, 0.03, -0.12, C.steel)
      .box(0.085, 0.07, 0.2, 0, 0.04, -0.42, C.white)
      .cyl(0.02, 0.18, 0, 0.04, -0.6, C.white)
      .cyl(0.036, 0.012, 0, 0.04, -0.54, GLOW.magenta, { glow: true }).cyl(0.036, 0.012, 0, 0.04, -0.6, GLOW.magenta, { glow: true }).cyl(0.036, 0.012, 0, 0.04, -0.66, GLOW.magenta, { glow: true })
      .glow(0.08, 0.025, 0.24, 0, 0.0, -0.12, GLOW.magenta)              // side energy strip
      .glow(0.035, 0.09, 0.07, 0, -0.08, -0.14, GLOW.magenta, { mag: true })            // cell
      .grip(0.04, C.white).guard(-0.03, -0.025)
      .box(0.06, 0.09, 0.2, 0, 0.0, 0.18, C.white)
      .rar(0.077, 0.014, 0.1, 0, 0.09, -0.18)
      .redDot(-0.04, 0.085, GLOW.magenta);
    p.muzzle = [0, 0.04, -0.7];
  },
  lever(p) {
    p.box(0.06, 0.09, 0.2, 0, 0.03, -0.05, C.brass)                      // receiver
      .cyl(0.018, 0.5, 0, 0.055, -0.4, C.steel, { seg: 6 })               // octagon barrel
      .cyl(0.014, 0.42, 0, 0.018, -0.36, C.steel)                         // tube magazine
      .box(0.06, 0.06, 0.26, 0, 0.025, -0.28, C.wood)                     // forend
      .box(0.02, 0.02, 0.14, 0, -0.06, 0.0, C.steel).box(0.02, 0.07, 0.02, 0, -0.09, 0.07, C.steel).box(0.02, 0.02, 0.1, 0, -0.12, 0.03, C.steel) // lever loop
      .box(0.055, 0.08, 0.3, 0, -0.02, 0.2, C.wood, { rx: -0.12 })
      .box(0.06, 0.11, 0.03, 0, -0.04, 0.35, C.woodD)
      .rar(0.062, 0.014, 0.08, 0, -0.005, -0.05)
      .scope(-0.08, 0.2, 0.08, 0.026);
    p.muzzle = [0, 0.055, -0.65];
  },

  // ---------------- shotguns
  pump(p) {
    p.box(0.07, 0.1, 0.24, 0, 0.025, -0.05, C.gun)
      .cyl(0.024, 0.5, 0, 0.05, -0.42, C.black)                           // barrel
      .cyl(0.02, 0.38, 0, 0.0, -0.36, C.black)                            // tube mag
      .box(0.07, 0.065, 0.18, 0, 0.005, -0.33, C.wood)                    // pump
      .box(0.072, 0.008, 0.008, 0, 0.04, -0.29, C.woodD).box(0.072, 0.008, 0.008, 0, 0.04, -0.33, C.woodD).box(0.072, 0.008, 0.008, 0, 0.04, -0.37, C.woodD)
      .grip(0.06, C.wood).guard(-0.0, -0.025)
      .box(0.06, 0.09, 0.26, 0, -0.01, 0.2, C.wood, { rx: -0.1 })
      .box(0.065, 0.12, 0.03, 0, -0.03, 0.33, C.black)
      .rar(0.072, 0.014, 0.1, 0, 0.02, -0.05)
      .iron(-0.64, 0.02, 0.075);
    p.muzzle = [0, 0.05, -0.67];
  },
  double_barrel(p) {
    p.box(0.08, 0.08, 0.14, 0, 0.03, -0.03, C.steel)
      .cyl(0.024, 0.48, -0.024, 0.045, -0.34, C.black).cyl(0.024, 0.48, 0.024, 0.045, -0.34, C.black)
      .box(0.02, 0.012, 0.48, 0, 0.07, -0.34, C.steel)                    // rib
      .box(0.08, 0.05, 0.22, 0, 0.0, -0.22, C.wood)
      .grip(0.06, C.wood).guard(0.0, -0.01)
      .box(0.06, 0.09, 0.3, 0, -0.01, 0.2, C.wood, { rx: -0.15 })
      .box(0.03, 0.03, 0.04, 0, 0.08, 0.04, C.steel, { rx: -0.5 })        // hammer/top lever
      .rar(0.082, 0.014, 0.06, 0, 0.0, -0.03)
      .iron(-0.56, 0.0, 0.07);
    p.muzzle = [0, 0.045, -0.59];
  },
  arc_shotgun(p) {
    p.box(0.09, 0.12, 0.34, 0, 0.03, -0.1, C.steel)
      .box(0.1, 0.08, 0.2, 0, 0.04, -0.36, C.white)
      .box(0.015, 0.015, 0.12, -0.04, 0.07, -0.5, C.steel).box(0.015, 0.015, 0.12, 0.04, 0.07, -0.5, C.steel) // prongs
      .box(0.015, 0.015, 0.12, -0.04, 0.01, -0.5, C.steel).box(0.015, 0.015, 0.12, 0.04, 0.01, -0.5, C.steel)
      .glow(0.06, 0.04, 0.08, 0, 0.04, -0.52, GLOW.cyan)
      .glow(0.092, 0.03, 0.12, 0, 0.06, -0.1, GLOW.cyan)
      .grip(0.04, C.white).guard(-0.02, -0.03)
      .box(0.05, 0.09, 0.08, 0, -0.07, -0.19, C.steel, { mag: true }).glow(0.052, 0.015, 0.06, 0, -0.05, -0.19, GLOW.cyan, { mag: true }) // power cell
      .box(0.07, 0.1, 0.18, 0, 0.0, 0.15, C.white)
      .rar(0.092, 0.014, 0.1, 0, -0.02, -0.2)
      .iron(-0.44, 0.0, 0.09);
    p.muzzle = [0, 0.04, -0.57];
  },

  // ---------------- snipers
  sniper(p) {
    p.box(0.065, 0.09, 0.3, 0, 0.03, -0.05, C.olive)
      .cyl(0.019, 0.6, 0, 0.045, -0.5, C.black)
      .cyl(0.028, 0.08, 0, 0.045, -0.82, C.black, { seg: 6 })              // muzzle brake
      .box(0.07, 0.07, 0.3, 0, 0.0, -0.3, C.olive)                          // forend
      .cyl(0.012, 0.06, 0.06, 0.05, 0.02, C.steel, { axis: 'x' }).cyl(0.02, 0.025, 0.095, 0.05, 0.02, C.black, { axis: 'x' }) // bolt
      .box(0.035, 0.1, 0.06, 0, -0.07, -0.08, C.black)
      .grip(0.06, C.olive).guard(0.0, -0.02)
      .box(0.06, 0.1, 0.3, 0, 0.0, 0.22, C.olive)
      .box(0.05, 0.04, 0.16, 0, 0.06, 0.2, C.olive)                        // cheek riser
      .box(0.065, 0.13, 0.03, 0, -0.01, 0.38, C.black)
      .box(0.012, 0.012, 0.22, -0.02, -0.04, -0.52, C.black).box(0.012, 0.012, 0.22, 0.02, -0.04, -0.52, C.black) // folded bipod
      .rar(0.072, 0.014, 0.12, 0, -0.02, -0.3)
      .scope(-0.04, 0.34, 0.08, 0.038);
    p.muzzle = [0, 0.045, -0.86];
  },
  hunting_rifle(p) {
    p.box(0.06, 0.08, 0.24, 0, 0.03, -0.05, C.steel)
      .cyl(0.017, 0.56, 0, 0.045, -0.44, C.steel)
      .box(0.065, 0.065, 0.42, 0, 0.0, -0.3, C.wood)
      .cyl(0.01, 0.05, 0.05, 0.05, 0.03, C.steel, { axis: 'x' }).cyl(0.016, 0.02, 0.08, 0.05, 0.03, C.steel, { axis: 'x' })
      .grip(0.06, C.wood).guard(0.0, -0.02)
      .box(0.055, 0.1, 0.32, 0, -0.02, 0.22, C.wood, { rx: -0.12 })
      .box(0.06, 0.12, 0.03, 0, -0.04, 0.38, C.woodD)
      .rar(0.067, 0.014, 0.1, 0, 0.0, -0.36)
      .scope(-0.06, 0.26, 0.07, 0.03);
    p.muzzle = [0, 0.045, -0.72];
  },
  crossbow(p) {
    p.box(0.06, 0.07, 0.6, 0, 0.02, -0.15, C.wood)                         // stock / rail
      .box(0.4, 0.03, 0.04, -0.0, 0.03, -0.42, C.black)                     // limbs base
      .box(0.22, 0.025, 0.03, -0.24, 0.03, -0.37, C.black, { ry: -0.35 })
      .box(0.22, 0.025, 0.03, 0.24, 0.03, -0.37, C.black, { ry: 0.35 })
      .box(0.008, 0.008, 0.36, -0.17, 0.05, -0.2, C.light, { ry: -0.75 })   // string
      .box(0.008, 0.008, 0.36, 0.17, 0.05, -0.2, C.light, { ry: 0.75 })
      .cyl(0.008, 0.42, 0, 0.065, -0.27, C.tan, { mag: true })                              // bolt
      .glow(0.02, 0.02, 0.04, 0, 0.065, -0.49, GLOW.orange, { mag: true })
      .grip(0.06, C.wood).guard(0.0, -0.02)
      .box(0.055, 0.09, 0.2, 0, -0.01, 0.22, C.wood)
      .rar(0.062, 0.014, 0.12, 0, -0.01, -0.1)
      .redDot(0.02, 0.055, GLOW.green);
    p.muzzle = [0, 0.065, -0.5];
  },
  laser_sniper(p) {
    p.box(0.07, 0.1, 0.4, 0, 0.03, -0.08, C.white)
      .box(0.05, 0.06, 0.56, 0, 0.035, -0.55, C.white)
      .glow(0.052, 0.015, 0.5, 0, 0.069, -0.55, GLOW.cyan)
      .glow(0.072, 0.03, 0.2, 0, 0.0, -0.08, GLOW.cyan)
      .box(0.035, 0.09, 0.06, 0, -0.07, -0.12, C.steel, { mag: true })
      .grip(0.06, C.steel).guard(0.0, -0.025)
      .box(0.06, 0.1, 0.28, 0, 0.0, 0.22, C.white)
      .box(0.065, 0.13, 0.03, 0, -0.01, 0.37, C.steel)
      .rar(0.072, 0.014, 0.1, 0, -0.03, -0.3)
      .scope(-0.06, 0.32, 0.08, 0.036, GLOW.cyan, C.steel);
    p.muzzle = [0, 0.035, -0.84];
  },

  // ---------------- launchers
  rocket(p) {
    p.cyl(0.085, 0.95, 0, 0.07, -0.2, C.olive, { seg: 10 })
      .cyl(0.1, 0.12, 0, 0.07, 0.3, C.black, { seg: 10, r1: 0.085, r2: 0.11 })  // rear flare
      .cyl(0.095, 0.05, 0, 0.07, -0.66, C.black, { seg: 10 })                    // front ring
      .cyl(0.06, 0.1, 0, 0.07, -0.71, C.red, { seg: 8, r1: 0.0, mag: true })               // warhead tip
      .cyl(0.092, 0.03, 0, 0.07, -0.1, C.black, { seg: 10 })
      .box(0.05, 0.08, 0.12, -0.11, 0.12, -0.25, C.black)                         // side sight
      .glow(0.04, 0.03, 0.005, -0.11, 0.13, -0.31, GLOW.red)
      .box(0.035, 0.13, 0.05, 0, -0.07, -0.3, C.black)                            // front grip
      .grip(0.0).guard(-0.06, -0.01)
      .rar(0.172, 0.02, 0.06, 0, 0.07, 0.05);
    p.sightY = 0.17;
    p.muzzle = [0, 0.07, -0.72];
  },
  grenade(p) {
    p.cyl(0.085, 0.16, 0, 0.0, -0.12, C.steel, { seg: 6 })                       // revolving drum
      .cyl(0.04, 0.34, 0, 0.04, -0.36, C.black)
      .box(0.06, 0.06, 0.16, 0, 0.09, -0.12, C.olive)
      .box(0.05, 0.05, 0.26, 0, -0.08, -0.32, C.olive)
      .box(0.035, 0.1, 0.05, 0, -0.14, -0.32, C.black)
      .grip(0.04).guard(-0.02, -0.03)
      .box(0.05, 0.08, 0.22, 0, 0.0, 0.17, C.black)
      .rar(0.062, 0.014, 0.1, 0, 0.12, -0.12)
      .redDot(-0.12, 0.12);
    p.muzzle = [0, 0.04, -0.53];
  },
  rail_cannon(p) {
    p.box(0.12, 0.14, 0.5, 0, 0.04, -0.15, C.steel)
      .box(0.03, 0.04, 0.5, -0.045, 0.1, -0.52, C.white).box(0.03, 0.04, 0.5, 0.045, 0.1, -0.52, C.white)   // rails
      .box(0.03, 0.04, 0.5, -0.045, 0.0, -0.52, C.white).box(0.03, 0.04, 0.5, 0.045, 0.0, -0.52, C.white)
      .glow(0.05, 0.06, 0.46, 0, 0.05, -0.52, GLOW.cyan)
      .glow(0.13, 0.03, 0.2, 0, 0.04, -0.1, GLOW.cyan)
      .box(0.04, 0.12, 0.06, 0, -0.1, -0.36, C.black)
      .grip(0.04, C.steel).guard(-0.02, -0.03)
      .box(0.08, 0.12, 0.18, 0, 0.02, 0.18, C.steel)
      .rar(0.122, 0.016, 0.12, 0, -0.02, -0.15)
      .scope(-0.12, 0.2, 0.11, 0.032, GLOW.cyan, C.steel);
    p.muzzle = [0, 0.05, -0.78];
  },
};

// ---- merging --------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

function partGeometry(q) {
  let g;
  if (q.t === 'box') g = new THREE.BoxGeometry(q.w, q.h, q.d);
  else {
    g = new THREE.CylinderGeometry(q.r2 !== undefined ? q.r2 : q.r, q.r1 !== undefined ? q.r1 : q.r, q.len, q.seg || 8);
    // CylinderGeometry runs along Y; turn it to the requested axis
    if (!q.axis || q.axis === 'z') g.rotateX(Math.PI / 2);
    else if (q.axis === 'x') g.rotateZ(Math.PI / 2);
  }
  _e.set(q.rx || 0, q.ry || 0, q.rz || 0);
  _m.compose(_p.set(q.x, q.y, q.z), _q.setFromEuler(_e), _s);
  g.applyMatrix4(_m);
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  return ng;
}

function merge(parts, rarityHex) {
  const pos = [], nor = [], col = [];
  for (const q of parts) {
    const g = partGeometry(q);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    _c.set(q.c === 'rar' ? rarityHex : q.c);
    for (let i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]); col.push(_c.r, _c.g, _c.b); }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map();

/** Merged geometry + metadata for a weapon id and rarity (cached, shared by every copy). */
export function gunGeometry(id, rarity = 0) {
  const key = id + '|' + rarity;
  let e = geoCache.get(key);
  if (e) return e;
  const p = new Parts();
  (DESIGNS[id] || DESIGNS.ar)(p);
  const hex = parseInt((RARITIES[rarity] || RARITIES[0]).color.slice(1), 16);
  // magazine parts become their own meshes so reloads can pull them out
  const pick = (glow, mag) => p.list.filter((q) => !!q.glow === glow && !!q.mag === mag);
  const geoOf = (list) => (list.length ? merge(list, hex) : null);
  const magParts = p.list.filter((q) => q.mag);
  let magC = [0, 0, 0];
  if (magParts.length) magC = [0, Math.min(...magParts.map((q) => q.y)), magParts.reduce((a, q) => a + q.z, 0) / magParts.length];
  e = { lit: geoOf(pick(false, false)), glow: geoOf(pick(true, false)), magLit: geoOf(pick(false, true)), magGlow: geoOf(pick(true, true)), magC, muzzle: p.muzzle, sightY: p.sightY };
  geoCache.set(key, e);
  return e;
}

const defaultMats = {
  lit: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
};

/**
 * A ready-to-use gun Group. opts.mats = {lit, glow} lets the first-person viewmodel use its
 * own materials. userData.muzzle is an Object3D at the barrel tip, userData.sightY the
 * height of the sight line above the grip.
 */
export function buildGunModel(id, rarity = 0, opts = {}) {
  const e = gunGeometry(id, rarity);
  const mats = opts.mats || defaultMats;
  const g = new THREE.Group();
  const U = g.userData;
  U.body = new THREE.Mesh(e.lit, mats.lit); g.add(U.body);
  if (e.glow) { U.glow = new THREE.Mesh(e.glow, mats.glow); g.add(U.glow); }
  // the magazine group: moved / hidden by the reload animations
  U.mag = new THREE.Group(); g.add(U.mag);
  if (e.magLit) { U.magLit = new THREE.Mesh(e.magLit, mats.lit); U.mag.add(U.magLit); }
  if (e.magGlow) { U.magGlow = new THREE.Mesh(e.magGlow, mats.glow); U.mag.add(U.magGlow); }
  U.magC = e.magC;
  const mz = new THREE.Object3D(); mz.position.set(e.muzzle[0], e.muzzle[1], e.muzzle[2]);
  g.add(mz);
  g.userData.muzzle = mz;
  g.userData.sightY = e.sightY;
  g.userData.id = id; g.userData.rarity = rarity;
  return g;
}

/** Swap an existing gun group's meshes to another rarity without rebuilding the group. */
export function setGunRarity(g, rarity) {
  if (g.userData.rarity === rarity) return;
  const e = gunGeometry(g.userData.id, rarity), U = g.userData;
  U.body.geometry = e.lit;
  if (U.glow && e.glow) U.glow.geometry = e.glow;
  if (U.magLit && e.magLit) U.magLit.geometry = e.magLit;
  if (U.magGlow && e.magGlow) U.magGlow.geometry = e.magGlow;
  U.rarity = rarity;
}

export const GUN_IDS = Object.keys(DESIGNS);
