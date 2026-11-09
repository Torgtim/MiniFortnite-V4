// Career stats (localStorage), shown in the lobby like an old-school hit counter.

const KEY = 'mfv4_stats_v1';

export const stats = (() => {
  try { return Object.assign({ matches: 0, wins: 0, kills: 0, best: 0 }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { return { matches: 0, wins: 0, kills: 0, best: 0 }; }
})();

export function recordMatch(place, kills, won) {
  stats.matches++;
  stats.kills += kills;
  if (won) stats.wins++;
  if (!stats.best || place < stats.best) stats.best = place;
  try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) { /* private mode */ }
}
