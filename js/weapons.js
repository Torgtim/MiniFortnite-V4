// Weapon, ammo, rarity and healing-item data. Seasons pick from these tables.

export const RARITIES = [
  { id: 'common', name: 'Common', color: '#bfbfbf', mult: 1.0 },
  { id: 'uncommon', name: 'Uncommon', color: '#3fb950', mult: 1.05 },
  { id: 'rare', name: 'Rare', color: '#3b8bff', mult: 1.1 },
  { id: 'epic', name: 'Epic', color: '#b25cff', mult: 1.15 },
  { id: 'legendary', name: 'Legendary', color: '#ffb020', mult: 1.2 },
];

export const AMMO = {
  light: { name: 'Light', color: '#ffd24a', amount: 30 },
  medium: { name: 'Medium', color: '#7bd36b', amount: 30 },
  heavy: { name: 'Heavy', color: '#ff7a5c', amount: 8 },
  shells: { name: 'Shells', color: '#ff9f3b', amount: 8 },
  rockets: { name: 'Rockets', color: '#e05555', amount: 3 },
  cells: { name: 'Cells', color: '#38e8ff', amount: 40 },
};

// dmg is per pellet. rate = shots (or bursts) per second. spread = cone half-angle in radians.
// fall: [startDist, endDist] damage falls to 35% between them. blast: {r, dmg} explosion at impact.
export const WEAPONS = {
  pistol: { name: 'Pistol', short: 'PST', cls: 'pistol', ammo: 'light', dmg: 24, rate: 6.5, mag: 16, reload: 1.6, spread: 0.010, range: 150 },
  pump: { name: 'Pump Shotgun', short: 'PMP', cls: 'shotgun', ammo: 'shells', dmg: 11, pellets: 10, rate: 0.75, mag: 5, reload: 3.2, spread: 0.055, range: 70, fall: [8, 32], head: 1.5 },
  ar: { name: 'Assault Rifle', short: 'AR', cls: 'rifle', ammo: 'medium', dmg: 30, rate: 5.5, mag: 30, reload: 2.3, spread: 0.014, range: 220, auto: true },
  smg: { name: 'SMG', short: 'SMG', cls: 'smg', ammo: 'light', dmg: 18, rate: 11, mag: 30, reload: 1.9, spread: 0.022, range: 140, auto: true },
  sniper: { name: 'Bolt Sniper', short: 'SNP', cls: 'sniper', ammo: 'heavy', dmg: 105, rate: 0.55, mag: 1, reload: 2.5, spread: 0.0008, range: 500, zoom: 4, head: 2, proj: { speed: 260, grav: 7, kind: 'bullet' } },
  rocket: { name: 'Rocket Launcher', short: 'RPG', cls: 'launcher', ammo: 'rockets', dmg: 0, rate: 0.75, mag: 1, reload: 3.2, spread: 0.004, range: 300, blast: { r: 6, dmg: 115 }, proj: { speed: 55, grav: 0, kind: 'rocket' } },

  burst_ar: { name: 'Burst Rifle', short: 'BRS', cls: 'rifle', ammo: 'medium', dmg: 27, rate: 3.0, burst: 3, burstGap: 0.07, mag: 30, reload: 2.2, spread: 0.012, range: 220 },
  double_barrel: { name: 'Double Barrel', short: 'DBL', cls: 'shotgun', ammo: 'shells', dmg: 10, pellets: 12, rate: 1.5, mag: 2, reload: 2.6, spread: 0.06, range: 60, fall: [6, 26], head: 1.5 },
  frost_smg: { name: 'Frost SMG', short: 'FSM', cls: 'smg', ammo: 'light', dmg: 15, rate: 13, mag: 32, reload: 1.8, spread: 0.028, range: 130, auto: true },
  hunting_rifle: { name: 'Hunting Rifle', short: 'HNT', cls: 'sniper', ammo: 'heavy', dmg: 68, rate: 1.5, mag: 6, reload: 3.0, spread: 0.003, range: 350, zoom: 2.6, head: 2, proj: { speed: 220, grav: 8, kind: 'bullet' } },
  crossbow: { name: 'Crossbow', short: 'XBW', cls: 'sniper', ammo: 'heavy', dmg: 105, rate: 0.8, mag: 1, reload: 2.6, spread: 0.002, range: 220, zoom: 2.0, head: 2, quiet: true, proj: { speed: 90, grav: 12, kind: 'bullet' } },
  hand_cannon: { name: 'Hand Cannon', short: 'HCN', cls: 'pistol', ammo: 'medium', dmg: 54, rate: 2.2, mag: 7, reload: 2.0, spread: 0.006, range: 170, head: 2 },

  revolver: { name: 'Revolver', short: 'RVL', cls: 'pistol', ammo: 'medium', dmg: 58, rate: 2.4, mag: 6, reload: 2.8, spread: 0.005, range: 170, head: 2 },
  lever: { name: 'Lever Action', short: 'LVR', cls: 'rifle', ammo: 'heavy', dmg: 62, rate: 1.8, mag: 8, reload: 3.0, spread: 0.004, range: 260, zoom: 2.0, head: 2 },
  tommy: { name: 'Tommy Gun', short: 'TMY', cls: 'smg', ammo: 'light', dmg: 20, rate: 10, mag: 40, reload: 2.4, spread: 0.024, range: 140, auto: true },
  scoped_ar: { name: 'Scoped AR', short: 'SAR', cls: 'rifle', ammo: 'medium', dmg: 36, rate: 4.0, mag: 20, reload: 2.4, spread: 0.007, range: 300, zoom: 2.2, auto: true },
  grenade: { name: 'Grenade Launcher', short: 'GRN', cls: 'launcher', ammo: 'rockets', dmg: 0, rate: 0.9, mag: 6, reload: 3.6, spread: 0.01, range: 120, blast: { r: 5, dmg: 95 }, proj: { speed: 40, grav: 16, kind: 'grenade', fuse: 1.6, bounce: true } },

  blaster: { name: 'Blaster Pistol', short: 'BLS', cls: 'pistol', ammo: 'cells', dmg: 22, rate: 5.0, mag: 18, reload: 1.4, spread: 0.010, range: 160 },
  plasma_rifle: { name: 'Plasma Rifle', short: 'PLS', cls: 'rifle', ammo: 'cells', dmg: 25, rate: 9, mag: 36, reload: 2.2, spread: 0.014, range: 220, auto: true },
  arc_shotgun: { name: 'Arc Shotgun', short: 'ARC', cls: 'shotgun', ammo: 'cells', dmg: 11, pellets: 8, rate: 1.1, mag: 4, reload: 2.6, spread: 0.05, range: 70, fall: [7, 30], head: 1.5 },
  laser_sniper: { name: 'Laser Sniper', short: 'LSR', cls: 'sniper', ammo: 'cells', dmg: 95, rate: 0.9, mag: 3, reload: 2.8, spread: 0, range: 500, zoom: 4, head: 2 },
  rail_cannon: { name: 'Rail Cannon', short: 'RLC', cls: 'launcher', ammo: 'cells', dmg: 115, rate: 0.6, mag: 1, reload: 3.0, spread: 0, range: 400, zoom: 2.5, blast: { r: 3, dmg: 50 } },
  pulse_smg: { name: 'Pulse SMG', short: 'PUL', cls: 'smg', ammo: 'cells', dmg: 14, rate: 15, mag: 40, reload: 1.7, spread: 0.03, range: 130, auto: true },
};

// Viewmodel / pickup body colours per class
export const CLASS_COLORS = {
  pistol: 0x555a66, smg: 0x4d5560, rifle: 0x3f4650, shotgun: 0x5a4632, sniper: 0x2f3a33, launcher: 0x4a5a3a,
};

// Healing items. Season files supply the display name/colour for each kind.
export const ITEM_KINDS = {
  heal_s: { hp: 15, max: 75, time: 3.2, short: 'HP+' },
  heal_l: { hp: 100, max: 100, time: 6.0, short: 'MED' },
  shield_s: { sh: 25, max: 50, time: 2.2, short: 'SH+' },
  shield_l: { sh: 50, max: 100, time: 4.5, short: 'SH++' },
  // throwables: stack up to 6, thrown with the fire button
  nade: { throw: true, stack: 6, time: 0, short: 'NADE', blast: { r: 5, dmg: 75 }, fuse: 2.2 },
  // area heal you throw at your feet (or at friends): +20, health first then shield
  splash: { throw: true, stack: 6, time: 0, short: 'FIZZ', heal: { r: 4.2, amt: 20 }, fuse: 1.4 },
  // mobility gadgets (fire to use)
  pad: { gadget: 'pad', stack: 2, time: 0, short: 'PAD' },
  trap: { gadget: 'trap', stack: 3, time: 0, short: 'TRAP', dmg: 75 },
  rift: { gadget: 'rift', stack: 2, time: 0, short: 'RIFT' },
};

// how much each shot adds to the weapon's bloom (spread grows while spraying)
export const BLOOM = { pistol: 0.25, smg: 0.12, rifle: 0.16, shotgun: 0, sniper: 0, launcher: 0 };

/** Computed stats for a weapon instance {id, rarity, mag}. */
export function weaponStats(inst) {
  const base = WEAPONS[inst.id];
  const r = RARITIES[inst.rarity] || RARITIES[0];
  return {
    ...base,
    id: inst.id,
    dmg: base.dmg * r.mult,
    blast: base.blast ? { r: base.blast.r, dmg: base.blast.dmg * r.mult } : null,
    pellets: base.pellets || 1,
    burst: base.burst || 0,
    burstGap: base.burstGap || 0.07,
    auto: !!base.auto,
    head: base.head || 1.5,
    zoom: base.zoom || 1.25,
    rarity: r,
    dps: base.dmg * r.mult * (base.pellets || 1) * base.rate * (base.burst || 1) * (base.blast ? 0.5 : 1),
  };
}

export function makeWeapon(id, rarity = 0) {
  return { type: 'weapon', id, rarity, mag: WEAPONS[id].mag };
}
