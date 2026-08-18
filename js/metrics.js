// metrics.js — a faithful port of the spreadsheet's maths. Pure functions only:
// no DOM, no storage, so every number here is testable in isolation.
//
//   e1RM (Epley)   = w x (1 + reps/30)
//   e1RM (Brzycki) = w x 36/(37 - reps)
//   Adj e1RM       = e1RM x (1 + k x ln(sets))
//   Volume         = w x reps x sets
//   Trend          = least-squares slope of adj e1RM vs day, x7 for kg/week

export const ANCHOR = '2020-01-01';          // Settings!B3 — zero point for day numbers
export const REP_SCHEMES = [3, 4, 5, 6, 8, 10, 12];
export const SET_COLUMNS = [1, 2, 3, 4, 5, 6];

/* ------------------------------------------------------------------ dates */

/** Days between the anchor and an ISO date string — the sheet's "Day #". */
export function dayNumber(iso, anchor = ANCHOR) {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(anchor + 'T00:00:00Z')) / 86400000);
}

export function isoToday(now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

export function isoAddDays(iso, days) {
  const t = Date.parse(iso + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Sat 15 Aug" — short, unambiguous, no year unless it differs from now. */
export function formatDate(iso, now = new Date()) {
  const d = new Date(iso + 'T00:00:00Z');
  const opts = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "15 Aug" — day and month only, for axis ticks where space is tight. */
export function formatDateShort(iso, now = new Date()) {
  const d = new Date(iso + 'T00:00:00Z');
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== now.getFullYear()) opts.year = '2-digit';
  return d.toLocaleDateString(undefined, opts);
}

/** "Today", "Yesterday", "3 days ago", else the short date. */
export function relativeDate(iso, todayIso = isoToday()) {
  const diff = dayNumber(todayIso) - dayNumber(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff === -1) return 'Tomorrow';
  return formatDate(iso);
}

/* ------------------------------------------------------------- core maths */

/** The rep multiplier: e1RM = weight x repFactor(reps). */
export function repFactor(reps, formula = 'epley') {
  const r = Number(reps);
  if (!(r > 0)) return NaN;
  if (formula === 'brzycki') return r >= 36 ? NaN : 36 / (37 - r);
  return 1 + r / 30;
}

export function e1rm(weight, reps, formula = 'epley') {
  const f = repFactor(reps, formula);
  return Number.isFinite(f) ? Number(weight) * f : NaN;
}

/** Diminishing-returns credit for repeating the load. sets=1 adds nothing. */
export function setBonus(sets, k = 0.05) {
  const s = Number(sets) > 0 ? Number(sets) : 1;
  return 1 + k * Math.log(s);
}

export function adjE1rm(weight, reps, sets, settings) {
  return e1rm(weight, reps, settings.formula) * setBonus(sets, settings.setBonusK);
}

export function volume(weight, reps, sets) {
  return Number(weight) * Number(reps) * (Number(sets) > 0 ? Number(sets) : 1);
}

/** What one logged entry is worth on each scale. */
export function scoreEntry(entry, settings) {
  const one = e1rm(entry.weight, entry.reps, settings.formula);
  return {
    e1rm: one,
    adj: one * setBonus(entry.sets, settings.setBonusK),
    volume: volume(entry.weight, entry.reps, entry.sets),
    day: dayNumber(entry.date),
  };
}

/**
 * Round UP onto the ladder of weights this lift can actually be loaded to:
 * base, base + step, base + 2*step, ... where base is the empty bar or the
 * lightest pin on the stack. Never suggests a load you cannot make, and never
 * suggests less than the bar.
 */
export function ceilToStep(value, step, base = 0) {
  const s = Number(step) > 0 ? Number(step) : 2.5;
  const b = Number.isFinite(Number(base)) && Number(base) > 0 ? Number(base) : 0;
  if (!Number.isFinite(value)) return NaN;
  if (value <= b) return b;
  // Guard against binary float error: 82.49999999 must not become 85.
  const rungs = Math.ceil((value - b) / s - 1e-9);
  return Number((b + rungs * s).toFixed(6));
}

/** The lightest loadable weight whose adj e1RM meets `target` at reps x sets. */
export function weightForTarget(target, reps, sets, settings, step, base = 0) {
  const denom = repFactor(reps, settings.formula) * setBonus(sets, settings.setBonusK);
  if (!Number.isFinite(denom) || denom <= 0 || !(target > 0)) return NaN;
  return ceilToStep(target / denom, step, base);
}

/** Least-squares slope of y on x. Returns null when it is not defined. */
export function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;      // every point on the same day
  return (n * sxy - sx * sy) / denom;
}

/* --------------------------------------------------------- per-exercise */

/**
 * Everything the Dashboard row computes, for one exercise.
 * `entries` may be the whole log; it is filtered here.
 */
export function exerciseStats(exercise, entries, settings, todayIso = isoToday()) {
  const todayDay = dayNumber(todayIso);
  const mine = entries
    .filter((e) => e.exerciseId === exercise.id)
    .map((e) => ({ ...e, ...scoreEntry(e, settings) }))
    .sort((a, b) => a.day - b.day || (a.seq || 0) - (b.seq || 0));

  const stats = {
    exercise,
    entries: mine,
    entryCount: mine.length,
    sessionCount: new Set(mine.map((e) => e.date)).size,
    lastDate: null, lastAdj: null, lastReps: null, lastSets: null,
    bestAdj: null, bestEntry: null,
    trendPerWeek: null, trendPerDay: null, trendReliable: false,
    trendWindowCount: 0, trendWindowDays: 0, proj4: null, proj12: null, nextTarget: null,
    volume7: 0, sets7: 0, sessions: [],
    setsPerWeekTarget: exercise.setsPerWeek || null, setStatus: null,
    gainPerWeek: exercise.gainPerWeek ?? settings.defaultGainPerWeek,
    step: exercise.step || settings.defaultStep,
    base: Number(exercise.base) > 0 ? Number(exercise.base) : 0,
  };
  if (!mine.length) return stats;

  // One point per session date, carrying that day's best set — this is what
  // gets charted, and what "last session" means.
  const byDate = new Map();
  for (const e of mine) {
    const cur = byDate.get(e.date);
    if (!cur || e.adj > cur.best.adj) byDate.set(e.date, { ...(cur || {}), date: e.date, day: e.day, best: e });
    const s = byDate.get(e.date);
    s.sets = (s.sets || 0) + (Number(e.sets) > 0 ? Number(e.sets) : 1);
    s.volume = (s.volume || 0) + e.volume;
    s.rows = (s.rows || 0) + 1;
  }
  stats.sessions = [...byDate.values()].sort((a, b) => a.day - b.day);

  const last = stats.sessions[stats.sessions.length - 1];
  stats.lastDate = last.date;
  stats.lastAdj = last.best.adj;
  stats.lastReps = last.best.reps;
  stats.lastSets = last.best.sets;

  stats.bestEntry = mine.reduce((a, b) => (b.adj > a.adj ? b : a));
  stats.bestAdj = stats.bestEntry.adj;

  // Trend: every logged set inside the lookback window, adj e1RM against day.
  const from = todayDay - settings.lookbackDays;
  const win = mine.filter((e) => e.day >= from && Number.isFinite(e.adj));
  const perDay = slope(win.map((e) => [e.day, e.adj]));
  stats.trendWindowCount = win.length;
  stats.trendWindowDays = win.length ? win[win.length - 1].day - win[0].day : 0;
  // Two sessions three days apart give a slope, but not one worth extrapolating
  // twelve weeks. Projections are held back until the fit has something to say.
  stats.trendReliable = win.length >= 3 && stats.trendWindowDays >= 14;
  if (perDay !== null) {
    // A dead-flat run leaves a slope like 3e-16; treat that as the zero it is.
    stats.trendPerDay = Math.abs(perDay) < 1e-6 ? 0 : perDay;
    stats.trendPerWeek = stats.trendPerDay * 7;
    if (stats.trendReliable) {
      stats.proj4 = stats.lastAdj + stats.trendPerWeek * 4;
      stats.proj12 = stats.lastAdj + stats.trendPerWeek * 12;
    }
  }

  stats.nextTarget = stats.lastAdj * (1 + stats.gainPerWeek);

  // Last 7 days — the sheet's window is day >= today-7.
  for (const e of mine) {
    if (e.day >= todayDay - 7) {
      stats.volume7 += e.volume;
      stats.sets7 += Number(e.sets) > 0 ? Number(e.sets) : 1;
    }
  }
  const tgt = stats.setsPerWeekTarget;
  if (tgt) {
    stats.setStatus = stats.sets7 < tgt * 0.8 ? 'under' : stats.sets7 > tgt * 1.2 ? 'over' : 'on target';
  }
  return stats;
}

export function allStats(exercises, entries, settings, todayIso = isoToday()) {
  return exercises.map((ex) => exerciseStats(ex, entries, settings, todayIso));
}

/* ---------------------------------------------------------- the planner */

export const BANDS = {
  beaten:  { key: 'beaten',  label: 'Already beaten', glyph: '=', hint: 'At or below your current best — not progression' },
  ideal:   { key: 'ideal',   label: 'Ideal step',     glyph: '✓', hint: 'The smallest honest step forward' },
  stretch: { key: 'stretch', label: 'Stretch',        glyph: '▲', hint: 'Ambitious but usually doable' },
  toobig:  { key: 'toobig',  label: 'Too big a jump', glyph: '!', hint: 'You will probably miss reps' },
};

/** Which band a candidate score falls in, given the target and current best. */
export function bandFor(score, target, bestAdj, settings) {
  if (!Number.isFinite(score) || !(target > 0)) return null;
  if (Number.isFinite(bestAdj) && score <= bestAdj) return BANDS.beaten;
  if (score > target * (1 + settings.stretchBand)) return BANDS.toobig;
  if (score > target * (1 + settings.idealBand)) return BANDS.stretch;
  return BANDS.ideal;
}

/** Snap a rep count down to the nearest scheme in the grid (the sheet's MATCH,1). */
export function snapReps(reps) {
  const r = Number(reps);
  if (!(r > 0)) return 5;
  let out = REP_SCHEMES[0];
  for (const s of REP_SCHEMES) if (s <= r) out = s;
  return out;
}

/**
 * The whole NextSession sheet for one exercise.
 * `override` = { target, reps, sets } — any field may be null/'' for "auto".
 */
export function planFor(stats, settings, override = {}) {
  const step = stats.step;
  const base = stats.base || 0;
  const autoTarget = stats.nextTarget;
  const target = Number(override.target) > 0 ? Number(override.target) : autoTarget;

  const reps = Number(override.reps) > 0 ? Math.round(Number(override.reps))
    : Number(stats.lastReps) > 0 ? Math.round(Number(stats.lastReps)) : 5;
  const sets = Number(override.sets) > 0 ? Math.round(Number(override.sets))
    : Number(stats.exercise.setsPerSession) > 0 ? Math.round(Number(stats.exercise.setsPerSession))
    : Number(stats.lastSets) > 0 ? Math.round(Number(stats.lastSets)) : 3;

  const plan = {
    ready: Number.isFinite(target) && target > 0,
    autoTarget, target, reps, sets, step, base,
    usingManualTarget: Number(override.target) > 0,
    bestAdj: stats.bestAdj,
    idealCeiling: target * (1 + settings.idealBand),
    stretchCeiling: target * (1 + settings.stretchBand),
    grid: [], columns: SET_COLUMNS, rows: REP_SCHEMES,
    gentlest: null, weight: NaN, score: NaN, overshoot: NaN, band: null,
  };
  if (!plan.ready) return plan;

  plan.weight = weightForTarget(target, reps, sets, settings, step, base);
  // True when the bar alone is already heavier than the target needs.
  plan.atBase = base > 0 && Math.abs(plan.weight - base) < 1e-9;
  plan.score = plan.weight * repFactor(reps, settings.formula) * setBonus(sets, settings.setBonusK);
  plan.overshoot = plan.score - target;
  plan.band = bandFor(plan.score, target, stats.bestAdj, settings);
  plan.lastWeight = stats.lastAdj != null ? stats.entries[stats.entries.length - 1].weight : null;

  // The full trade-off grid: every rep scheme x set count.
  plan.grid = REP_SCHEMES.map((r) => SET_COLUMNS.map((s) => {
    const w = weightForTarget(target, r, s, settings, step, base);
    const score = w * repFactor(r, settings.formula) * setBonus(s, settings.setBonusK);
    return {
      reps: r, sets: s, weight: w, score,
      band: bandFor(score, target, stats.bestAdj, settings),
      atBase: base > 0 && Math.abs(w - base) < 1e-9,
      isPick: r === snapReps(reps) && s === sets,
      volume: volume(w, r, s),
    };
  }));

  // Gentlest option at the chosen set count: smallest overshoot of the target.
  const col = plan.grid.map((row) => row.find((c) => c.sets === sets)).filter((c) => c && Number.isFinite(c.score));
  if (col.length) plan.gentlest = col.reduce((a, b) => (b.score < a.score ? b : a));

  return plan;
}

/* ----------------------------------------------------------- formatting */

export function fmt(n, dp = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Weights print without a pointless .0 — "82.5 kg", "80 kg". */
export function fmtWeight(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1));
}

export function fmtSigned(n, dp = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp);
}

export function fmtCompact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(v).toLocaleString();
}
