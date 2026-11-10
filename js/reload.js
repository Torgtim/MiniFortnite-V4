// Realistic reloads. Every weapon has a reload STYLE that turns one reload into timed phases
// (used by the first-person and third-person animations) and events (sounds, ammo going in,
// empty magazines dropping, shells being ejected):
//
//   mag    : detachable magazine. Tactical reload (rounds left) keeps one in the chamber (+1) on
//            closed-bolt guns; an empty reload is slower because you also have to rack the gun.
//   shell  : tube / internal magazine, loaded one round at a time. Every round counts as soon as
//            it is in, and pulling the trigger stops the reload so you can shoot.
//   break  : break-action (double barrel): open, eject both, two new shells, close.
//   cyl    : revolver: swing the cylinder out, eject, speed-loader, close.
//   single : one big round at a time (rocket, bolt, rail slug); bolt guns cycle the bolt after.

export const RELOAD_STYLE = {
  pistol: 'mag', hand_cannon: 'mag', blaster: 'mag',
  smg: 'mag', frost_smg: 'mag', pulse_smg: 'mag', tommy: 'mag',
  ar: 'mag', burst_ar: 'mag', scoped_ar: 'mag', plasma_rifle: 'mag', laser_sniper: 'mag', arc_shotgun: 'mag',
  pump: 'shell', lever: 'shell', hunting_rifle: 'shell', grenade: 'shell',
  double_barrel: 'break',
  revolver: 'cyl',
  sniper: 'single', rocket: 'single', crossbow: 'single', rail_cannon: 'single',
};

/** Closed-bolt guns hold one extra round in the chamber after a tactical reload. */
const CHAMBER = new Set(['pistol', 'hand_cannon', 'smg', 'frost_smg', 'ar', 'burst_ar', 'scoped_ar']);
/** Guns that work a bolt / pump after loading from empty. */
const BOLT = new Set(['sniper', 'hunting_rifle', 'lever', 'pump']);

export const reloadStyle = (id) => RELOAD_STYLE[id] || 'mag';

/** Largest number of rounds the weapon can hold right now (mag + chambered round). */
export function capacity(it, st, chambered = it.mag > 0) {
  return st.mag + (CHAMBER.has(it.id) && chambered ? 1 : 0);
}

/**
 * Build the reload plan for weapon instance `it` (stats `st`) with `ammo` spare rounds.
 * Returns null when there is nothing to do. Times are in seconds.
 */
export function planReload(it, st, ammo) {
  const style = reloadStyle(it.id);
  const empty = it.mag <= 0;
  const cap = capacity(it, st, !empty);
  const missing = cap - it.mag;
  if (missing <= 0 || ammo <= 0) return null;
  const R = st.reload;
  const phases = [];   // [name, t0, t1]
  const events = [];   // {at, kind}
  const add = (name, dur) => { const t0 = phases.length ? phases[phases.length - 1][2] : 0; phases.push([name, t0, t0 + dur]); return t0 + dur; };
  const ev = (at, kind) => events.push({ at, kind });

  if (style === 'mag') {
    // empty reloads take ~25% longer: the bolt / slide has to go forward again
    const T = empty ? R * 1.25 : R;
    let t = add('out', T * (empty ? 0.22 : 0.28)); ev(t * 0.35, 'mag_out'); ev(t, 'mag_drop');
    t = add('fetch', T * (empty ? 0.18 : 0.22));
    t = add('in', T * (empty ? 0.24 : 0.3)); ev(t, 'mag_in'); ev(t, 'grant');
    if (empty) { t = add('rack', T * 0.22); ev(phases[phases.length - 1][1] + T * 0.1, 'rack'); }
    add('settle', T - t);
  } else if (style === 'shell') {
    const n = Math.min(missing, ammo);
    const per = Math.max(0.32, Math.min(0.75, R / (st.mag + 1)));
    let t = add('open', 0.3);
    for (let i = 0; i < n; i++) { t = add('shell', per); ev(t - per * 0.25, 'shell_in'); ev(t, 'grant1'); }
    if (empty && BOLT.has(it.id)) { t = add('rack', 0.42); ev(t - 0.2, 'rack'); }
    add('close', 0.22);
  } else if (style === 'break') {
    let t = add('open', R * 0.22); ev(t * 0.6, 'break_open');
    t = add('eject', R * 0.13); ev(t - R * 0.06, 'eject');
    t = add('in', R * 0.38); ev(t - R * 0.08, 'shell_in'); ev(t, 'grant');
    t = add('close', R * 0.27); ev(t - R * 0.1, 'break_close');
  } else if (style === 'cyl') {
    let t = add('open', R * 0.18); ev(t * 0.7, 'cyl_open');
    t = add('eject', R * 0.17); ev(t - R * 0.08, 'eject');
    t = add('in', R * 0.38); ev(t - R * 0.05, 'shell_in'); ev(t, 'grant');
    t = add('close', R * 0.27); ev(t - R * 0.14, 'cyl_close');
  } else { // single
    let t = add('lower', R * 0.25);
    t = add('in', R * 0.4); ev(t - R * 0.06, it.id === 'rocket' ? 'rocket_in' : 'shell_in'); ev(t, 'grant');
    if (BOLT.has(it.id) || it.id === 'rail_cannon') { t = add('rack', R * 0.22); ev(t - R * 0.1, 'rack'); }
    add('settle', R - t > 0.05 ? R - t : 0.12);
  }
  const T = phases[phases.length - 1][2];
  events.sort((a, b) => a.at - b.at);
  return { style, empty, cap, t: 0, T, phases, events, id: it.id };
}

/** Current phase of a running plan: {name, k (0..1 inside the phase), p (0..1 overall)}. */
export function reloadPhase(plan) {
  if (!plan) return null;
  const t = plan.t;
  for (const [name, t0, t1] of plan.phases) {
    if (t < t1) return { name, k: t1 > t0 ? (t - t0) / (t1 - t0) : 1, p: t / plan.T, style: plan.style };
  }
  const last = plan.phases[plan.phases.length - 1];
  return { name: last[0], k: 1, p: 1, style: plan.style };
}
