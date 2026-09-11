// metrics.js — a faithful port of the spreadsheet's maths, with one deliberate
// departure: a session's score is its best set, not whichever block happens to
// carry the most repeats. Pure functions only: no DOM, no storage, so every
// number here is testable in isolation.
//
//   e1RM (Epley)   = w x (1 + reps/30)
//   e1RM (Brzycki) = w x 36/(37 - reps)
//   Adj e1RM       = e1RM x (1 + k x ln(sets))       — one block, its own sets
//   Session adj    = best e1RM in the session x (1 + k x ln(total sets))
//   Volume         = w x reps x sets
//   Trend          = least-squares slope of session adj e1RM vs day, x7 for kg/week

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

/** "Tuesday" — the weekday on its own, for the session header. */
export function weekdayName(iso) {
  return new Date(iso + 'T00:00:00Z')
    .toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

/** Whole days from `iso` to today. Negative for future dates. */
export function daysSince(iso, todayIso = isoToday()) {
  if (!iso) return null;
  return dayNumber(todayIso) - dayNumber(iso);
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

/**
 * Some lifts have no weight to put on them. A press-up or a pull-up moves you,
 * and the only thing that changes between sessions is how many times.
 *
 * Rather than invent a load — the app does not know your bodyweight, and a
 * press-up is not all of it anyway — a reps lift is measured in reps. The shape
 * of the number is deliberately identical to the weighted one: a set is worth
 * something, and repeating it earns the same diminishing bonus. Everything
 * downstream — the trend, the projection, the bands, the readiness model —
 * therefore works on a reps lift without knowing it is one.
 */
export function isBodyweight(exercise) {
  if (!exercise) return false;
  // 'reps' is what this was called for one release; both mean the same lift.
  return exercise.kind === 'bodyweight' || exercise.kind === 'reps';
}

/** What one set is worth, on whichever scale its lift is measured in. */
export function setScore(weight, reps, settings, kind) {
  if (isBodyweight({ kind })) {
    const r = Math.round(Number(reps));
    return r > 0 ? r : NaN;
  }
  return e1rm(weight, reps, settings.formula);
}

export function adjE1rm(weight, reps, sets, settings, kind) {
  return setScore(weight, reps, settings, kind) * setBonus(sets, settings.setBonusK);
}

export function volume(weight, reps, sets) {
  return Number(weight) * Number(reps) * (Number(sets) > 0 ? Number(sets) : 1);
}

/**
 * The identity of a set: the weight and the reps, and deliberately nothing
 * else. Two sets that match here are the same set done twice and are stored as
 * one entry with a count — the shape the spreadsheet used, and what keeps 3x5
 * a single row however it was typed in.
 *
 * RIR and notes are NOT part of this. They vary set to set, and splitting an
 * entry on them would split the set count with it: five sets logged with
 * falling RIR would score as five separate single sets, which is a much worse
 * lie than one block carrying the hardest set's RIR.
 */
export function setKey(e) {
  return `${Number(e.weight)}|${Math.round(Number(e.reps))}`;
}

/**
 * What a session scores, optionally with one more set added to it.
 *
 * A session is worth its best set — the single highest raw e1RM logged, whatever
 * its own rep scheme — credited for every set done that session, not only exact
 * repeats of that one block. A warm-up ahead of it or a lighter back-off block
 * after it no longer changes which set anchors the score; they only add to the
 * set count the anchor is credited for.
 *
 * This mirrors what the store will do with the set exactly, so the preview and
 * the saved result can never disagree.
 */
export function sessionAdjWith(entries, extra, settings, kind) {
  const list = entries.map((e) => ({
    weight: Number(e.weight), reps: Number(e.reps),
    sets: Number(e.sets) > 0 ? Number(e.sets) : 1, key: setKey(e),
  }));
  if (extra) {
    const key = setKey(extra);
    const hit = list.find((e) => e.key === key);
    if (hit) hit.sets += 1;
    else list.push({ weight: Number(extra.weight), reps: Number(extra.reps), sets: 1, key });
  }
  let bestRaw = NaN;
  let totalSets = 0;
  for (const e of list) {
    const raw = setScore(e.weight, e.reps, settings, kind);
    totalSets += e.sets;
    if (Number.isFinite(raw) && !(raw <= bestRaw)) bestRaw = raw;
  }
  return Number.isFinite(bestRaw) ? bestRaw * setBonus(totalSets, settings.setBonusK) : NaN;
}

/** What one logged entry is worth on each scale. */
export function scoreEntry(entry, settings, kind) {
  const one = setScore(entry.weight, entry.reps, settings, kind);
  return {
    e1rm: one,
    adj: one * setBonus(entry.sets, settings.setBonusK),
    // A reps lift moves no external load, so it contributes no tonnage. Adding
    // reps to a kilo total would be adding two different things together.
    volume: isBodyweight({ kind }) ? 0 : volume(entry.weight, entry.reps, entry.sets),
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

/**
 * The fewest whole reps whose score meets `target` at this many sets.
 * The reps equivalent of weightForTarget: the ladder is the integers.
 */
export function repsForTarget(target, sets, settings) {
  const bonus = setBonus(sets, settings.setBonusK);
  if (!(bonus > 0) || !(target > 0)) return NaN;
  return Math.max(1, Math.ceil(target / bonus - 1e-9));
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
    .map((e) => ({ ...e, ...scoreEntry(e, settings, exercise.kind) }))
    .sort((a, b) => a.day - b.day || (a.seq || 0) - (b.seq || 0));

  const stats = {
    exercise,
    entries: mine,
    entryCount: mine.length,
    sessionCount: new Set(mine.map((e) => e.date)).size,
    lastDate: null, lastAdj: null, lastReps: null, lastSets: null,
    daysSince: null, prCount: 0,
    bestAdj: null, bestEntry: null,
    trendPerWeek: null, trendPerDay: null, trendReliable: false,
    trendWindowCount: 0, trendWindowDays: 0, proj4: null, proj12: null,
    baseTarget: null, nextTarget: null, readiness: null,
    volume7: 0, sets7: 0, sessions: [],
    setsPerWeekTarget: exercise.setsPerWeek || null, setStatus: null,
    gainPerWeek: exercise.gainPerWeek ?? settings.defaultGainPerWeek,
    step: exercise.step || settings.defaultStep,
    base: Number(exercise.base) > 0 ? Number(exercise.base) : 0,
  };
  if (!mine.length) return stats;

  // One point per session date, anchored on that day's best RAW set — the
  // single highest e1RM logged, before any set-count bonus. A warm-up or a
  // lighter back-off block never wins the anchor just for having more sets
  // behind it; it only adds to the count the anchor is credited for below.
  const byDate = new Map();
  for (const e of mine) {
    const cur = byDate.get(e.date);
    if (!cur || e.e1rm > cur.best.e1rm) byDate.set(e.date, { ...(cur || {}), date: e.date, day: e.day, best: e });
    const s = byDate.get(e.date);
    s.sets = (s.sets || 0) + (Number(e.sets) > 0 ? Number(e.sets) : 1);
    s.volume = (s.volume || 0) + e.volume;
    s.rows = (s.rows || 0) + 1;
  }
  stats.sessions = [...byDate.values()].sort((a, b) => a.day - b.day);

  // A session is worth its best set, credited for every set logged that
  // session — not just exact repeats of that one block. This overwrites the
  // anchor entry's own (block-only) adj with the full session figure, which
  // every other reader of entry.adj — PR marking below, bestAdj, the live
  // "beats your best" check while logging — then sees for free.
  for (const s of stats.sessions) {
    s.best.adj = s.best.e1rm * setBonus(s.sets, settings.setBonusK);
  }

  // Mark the sessions that were a personal best at the moment they happened.
  // The first session is not a PR — there was nothing to beat. This runs over
  // sessions rather than raw entries so that a first-ever session logged as
  // warm-up-then-work does not get its anchor flagged just for having a
  // weaker entry ahead of it in the log.
  let running = -Infinity;
  for (const [i, s] of stats.sessions.entries()) {
    s.best.isPR = i > 0 && Number.isFinite(s.best.adj) && s.best.adj > running + 1e-9;
    if (s.best.isPR) stats.prCount++;
    if (Number.isFinite(s.best.adj)) running = Math.max(running, s.best.adj);
  }

  const last = stats.sessions[stats.sessions.length - 1];
  stats.lastDate = last.date;
  stats.daysSince = todayDay - last.day;
  stats.lastAdj = last.best.adj;
  stats.lastReps = last.best.reps;
  stats.lastSets = last.best.sets;

  stats.bestEntry = mine.reduce((a, b) => (b.adj > a.adj ? b : a));
  stats.bestAdj = stats.bestEntry.adj;

  // Trend: one point per session inside the lookback window, that day's best
  // adj e1RM against day. Sub-maximal entries within a session (warm-ups,
  // back-off sets) are deliberately excluded — fitting on every logged set
  // would let a session logged with more distinct low entries outweigh one
  // logged as a single clean top set, which can pull the line down even while
  // every session's best is a new PR.
  const from = todayDay - settings.lookbackDays;
  const win = stats.sessions.filter((s) => s.day >= from && Number.isFinite(s.best.adj));
  const perDay = slope(win.map((s) => [s.day, s.best.adj]));
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

  // The spreadsheet's target: last session plus this lift's weekly gain, flat,
  // however long ago that session was.
  stats.baseTarget = stats.lastAdj * (1 + stats.gainPerWeek);

  // What that becomes once the gap is taken seriously — see readinessFor().
  // With the model switched off the two are identical by construction.
  stats.readiness = readinessFor(stats, settings);
  stats.nextTarget = Number.isFinite(stats.readiness.target) ? stats.readiness.target : stats.baseTarget;

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

/* ------------------------------------------- fatigue, recovery, detraining */

/**
 * How much of last session you are actually carrying today.
 *
 * The spreadsheet had one lever — add gainPerWeek to the last session, every
 * session, whatever the gap. That is wrong at both ends: it asks for a step up
 * the morning after a hard session, and it asks for a PR after six weeks off.
 *
 * Three separate things move between one session and the next, so they are
 * modelled separately and multiplied:
 *
 *   fatigue    a transient deficit from the last session, decaying to nothing
 *              over a few days. Costs you strength today; costs you nothing
 *              permanently.
 *   accrual    the adaptation itself. It is earned per WEEK of elapsed time,
 *              not per session — which is what "gain per week" always said —
 *              and it stops once rest passes the point of being productive.
 *   retention  detraining. Nothing is lost for the first couple of weeks; past
 *              that, the losable part of your strength decays with a half-life
 *              toward a floor you keep more or less indefinitely.
 *
 *   target = lastAdj x retention x (1 + accrual) x (1 - fatigue)
 *
 * The defaults are set to the usual findings rather than to anything precise:
 * heavy compound work is recovered in 48-72 h; detraining shows up after about
 * two weeks off and costs roughly 5% by four weeks and 10-15% by eight; and a
 * long layoff leaves you well above untrained, not back at zero. All six are
 * settings, because the honest position is that these vary by person and lift.
 */
export const READINESS_DEFAULTS = {
  fatiguePeak: 0.06,        // deficit on the day of a normal hard session
  fatigueTau: 1.5,          // days for that deficit to fall to ~37% of peak
  productiveDays: 10,       // rest past this adds no more fitness
  graceDays: 14,            // nothing is lost before this
  detrainHalfLife: 42,      // days for the losable part to halve
  retainedFloor: 0.75,      // the share of your best a long layoff leaves
};

export const READINESS_PHASES = {
  recovering: { key: 'recovering', label: 'Recovering', glyph: '◔' },
  ready:      { key: 'ready',      label: 'Ready',      glyph: '●' },
  holding:    { key: 'holding',    label: 'Holding',    glyph: '○' },
  detrained:  { key: 'detrained',  label: 'Detraining', glyph: '↓' },
};

const FATIGUE_FLOOR = 0.005;   // below half a percent, call it spent
const FATIGUE_CAP = 0.15;      // no session leaves you 15% weaker than yourself

/**
 * The deficit at which a lift is fit to be trained hard again. Above it the
 * lift is still recovering and gets sorted that way; below it the residue is
 * still subtracted from the target, it just no longer changes what you do.
 * At the default peak and tau this falls between the first and second day
 * after a normal session, which is where the 48-hour rule of thumb puts it.
 */
export const READY_AT = 0.03;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * The readiness dials, defaults filled in for any the settings do not carry,
 * plus whether the model is switched on at all. A negative or non-numeric value
 * falls back to the default rather than producing a curve that runs backwards.
 */
export function readinessSettings(settings = {}) {
  const out = { ...READINESS_DEFAULTS };
  for (const k of Object.keys(READINESS_DEFAULTS)) {
    const v = Number(settings[k]);
    if (Number.isFinite(v) && v >= 0) out[k] = v;
  }
  out.enabled = settings.readiness !== 'off';
  return out;
}

/**
 * How hard the last session was, as a multiple of a normal one. Sets say how
 * much work; RIR says how close to failure it was taken. Both are already
 * logged, so nothing new is asked of the user — and where RIR was left blank
 * the session is assumed to have been a normal hard one rather than an easy or
 * a brutal one.
 */
export function sessionSeverity(session, exercise) {
  const usual = Number(exercise?.setsPerSession) > 0 ? Number(exercise.setsPerSession) : 3;
  const sets = Number(session?.sets) > 0 ? Number(session.sets) : usual;
  const setPart = clamp(sets / usual, 0.5, 1.6);
  const rir = session?.best?.rir;
  const rirPart = rir === null || rir === undefined || !Number.isFinite(Number(rir))
    ? 1
    : clamp(1.25 - 0.12 * Number(rir), 0.7, 1.25);
  return clamp(setPart * rirPart, 0.4, 1.8);
}

/** The strength deficit still owed to the last session, as a fraction. */
export function fatigueAt(days, severity = 1, rs = READINESS_DEFAULTS) {
  if (!(days >= 0) || !(rs.fatigueTau > 0) || !(rs.fatiguePeak > 0)) return 0;
  const f = rs.fatiguePeak * severity * Math.exp(-days / rs.fatigueTau);
  return f < FATIGUE_FLOOR ? 0 : Math.min(f, FATIGUE_CAP);
}

/** Fitness earned since the last session — per week of it, and only while it counts. */
export function accrualAt(days, gainPerWeek, productiveWindow) {
  if (!(days > 0) || !(gainPerWeek > 0)) return 0;
  return gainPerWeek * (Math.min(days, productiveWindow) / 7);
}

/** What is left of your strength after a layoff, as a fraction of it. */
export function retentionAt(days, grace, rs = READINESS_DEFAULTS) {
  if (!(days > grace) || !(rs.detrainHalfLife > 0)) return 1;
  const floor = clamp(rs.retainedFloor, 0, 1);
  return floor + (1 - floor) * Math.pow(0.5, (days - grace) / rs.detrainHalfLife);
}

/** Median gap, in days, between this lift's sessions. Null until there are two. */
export function typicalInterval(sessions) {
  if (!sessions || sessions.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < sessions.length; i++) gaps.push(sessions[i].day - sessions[i - 1].day);
  const usable = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  if (usable.length < 2) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2;
}

/**
 * The whole picture for one lift: where it sits between fatigue and detraining,
 * what its last session is worth today, and what to aim for.
 *
 * The windows stretch to fit how the lift is actually trained. Somebody who
 * squats every ten days is not detraining on day twelve, so the grace period
 * never sits below twice their normal gap.
 */
export function readinessFor(stats, settings = {}) {
  const rs = readinessSettings(settings);
  const days = stats.daysSince;
  const typical = typicalInterval(stats.sessions);
  const productiveWindow = Math.max(rs.productiveDays, typical ? typical * 1.5 : 0);
  const grace = Math.max(rs.graceDays, typical ? typical * 2 : 0);
  const last = stats.sessions.length ? stats.sessions[stats.sessions.length - 1] : null;
  const severity = sessionSeverity(last, stats.exercise);

  const out = {
    enabled: rs.enabled, days, typicalInterval: typical, severity,
    productiveWindow, grace,
    fatigue: 0, accrual: 0, retention: 1, factor: 1,
    baseline: stats.lastAdj, currentBest: stats.bestAdj,
    target: stats.baseTarget, phase: READINESS_PHASES.ready,
    recovered: true, readyIn: 0,
  };
  if (days === null || !Number.isFinite(stats.lastAdj)) return out;

  if (!rs.enabled) {
    // Off: exactly the spreadsheet's flat step, whatever the gap.
    out.accrual = stats.gainPerWeek;
    out.factor = 1 + out.accrual;
    out.target = stats.baseTarget;
    return out;
  }

  out.fatigue = fatigueAt(days, severity, rs);
  out.recovered = out.fatigue <= READY_AT;
  out.retention = retentionAt(days, grace, rs);
  // What you gained in the gap is the first thing a layoff takes back: the
  // newest adaptations are the least durable, so accrual fades on the same
  // curve retention does rather than sitting there as a credit forever.
  const durable = rs.retainedFloor < 1
    ? clamp((out.retention - rs.retainedFloor) / (1 - rs.retainedFloor), 0, 1) : 1;
  out.accrual = accrualAt(days, stats.gainPerWeek, productiveWindow) * durable;
  out.factor = out.retention * (1 + out.accrual) * (1 - out.fatigue);

  // Detraining is a real loss of capacity, so it discounts your best too —
  // otherwise a comeback session is scored against a number you no longer own,
  // and every honest re-entry weight reads as "already beaten". Fatigue does
  // not: being tired today never took a kilo off what you can do.
  out.baseline = stats.lastAdj * out.retention;
  out.currentBest = Number.isFinite(stats.bestAdj) ? stats.bestAdj * out.retention : stats.bestAdj;
  out.target = stats.lastAdj * out.factor;

  // Whole days until the lift is fit to be trained hard again.
  if (!out.recovered) {
    const full = rs.fatiguePeak * severity;
    out.readyIn = Math.max(0, Math.ceil(rs.fatigueTau * Math.log(full / READY_AT) - days));
  }

  out.phase = !out.recovered ? READINESS_PHASES.recovering
    : out.retention < 1 - 1e-9 ? READINESS_PHASES.detrained
    : days >= productiveWindow ? READINESS_PHASES.holding
    : READINESS_PHASES.ready;
  return out;
}

/**
 * The verdict in plain words. This is what the card leads with, always — the
 * arithmetic behind it is readinessMaths(), one tap away rather than behind a
 * mode switch.
 */
export function readinessNote(r) {
  if (!r || !r.enabled || r.days === null) return '';
  const d = r.days;
  const gap = d === 0 ? 'Earlier today' : d === 1 ? '1 day ago' : `${d} days ago`;
  switch (r.phase.key) {
    case 'recovering':
      return `${gap} — you are still carrying that session, so today asks for less than it would rested.`
        + (r.readyIn > 0 ? ` Fit for a hard one again in about ${plural(r.readyIn, 'day')}.` : '');
    case 'holding':
      return `${plural(d, 'day')} of rest — recovered, and nothing lost yet. This is about as strong as this lift gets without training it.`;
    case 'detrained':
      return `${plural(d, 'day')} since you last did this. Expect to be roughly ${((1 - r.retention) * 100).toFixed(0)}% off your best — this is a way back in, not a PR attempt.`;
    default:
      return `${plural(d, 'day')} of rest — recovered and ready.`
        + (r.fatigue > 0 ? ' Not quite fresh, so the step up is a small one.' : '');
  }
}

/** The same verdict with the model's workings shown. */
export function readinessMaths(r) {
  if (!r || !r.enabled || r.days === null) return '';
  const d = r.days;
  const gap = d === 0 ? 'Earlier today' : d === 1 ? '1 day ago' : `${d} days ago`;
  const residue = r.fatigue > 0
    ? ` Still about ${(r.fatigue * 100).toFixed(1)}% short of fresh, which is taken off the target.`
    : '';
  switch (r.phase.key) {
    case 'recovering':
      return `${gap}: an estimated ${(r.fatigue * 100).toFixed(1)}% deficit still owed to fatigue, discounted off the target.`
        + (r.readyIn > 0 ? ` Below the ${(READY_AT * 100).toFixed(0)}% ready line in about ${plural(r.readyIn, 'day')}.` : '');
    case 'holding':
      return `${plural(d, 'day')} rest: past the ${Math.round(r.productiveWindow)}-day productive window, inside the ${Math.round(r.grace)}-day grace period. No more fitness gained, none lost yet.`;
    case 'detrained':
      return `${plural(d, 'day')} off, ${Math.round(d - r.grace)} past the ${Math.round(r.grace)}-day grace period. Retention ${(r.retention * 100).toFixed(1)}%, applied to the target and to your best alike.`;
    default:
      return `${plural(d, 'day')} rest, ${(r.accrual * 100).toFixed(2)}% of a week's gain earned in the gap.` + residue;
  }
}

function plural(n, word) {
  const v = Math.round(n);
  return `${v} ${word}${v === 1 ? '' : 's'}`;
}

/* ---------------------------------------------------------- the planner */

export const BANDS = {
  beaten:  { key: 'beaten',  label: 'Already beaten', glyph: '=', hint: 'At or below your current best — not progression' },
  return:  { key: 'return',  label: 'Way back in',     glyph: '↩', hint: 'Lighter than you were lifting, on purpose, after time off' },
  ideal:   { key: 'ideal',   label: 'Ideal step',     glyph: '✓', hint: 'The smallest honest step forward' },
  stretch: { key: 'stretch', label: 'Stretch',        glyph: '▲', hint: 'Ambitious but usually doable' },
  toobig:  { key: 'toobig',  label: 'Too big a jump', glyph: '!', hint: 'You will probably miss reps' },
};

/**
 * The same verdict a band carries, said in plain words. This is what the
 * simple view shows in place of "scores 102.3 against a target of 100.1".
 */
export function plainVerdict(band, delta, unit = 'kg') {
  if (!band) return '';
  const move = !Number.isFinite(delta) || Math.abs(delta) < 1e-9
    ? null
    : `${fmtSigned(delta, unit === 'reps' ? 0 : 1).replace(/\.0$/, '')} ${unit} on last time`;
  switch (band.key) {
    case 'ideal':
      return move ? `A small step up — ${move}.` : 'A small step up on last time.';
    case 'stretch':
      return move ? `A big step up — ${move}. Ambitious, but usually doable.`
        : 'A big step up — ambitious, but usually doable.';
    case 'toobig':
      return move ? `A large jump — ${move}. You will probably miss reps.`
        : 'A large jump — you will probably miss reps.';
    case 'return':
      return move ? `${unit === 'reps' ? 'Fewer' : 'Lighter'} than last time — ${move}. A way back in after time off, not a step backwards.`
        : `${unit === 'reps' ? 'Fewer reps' : 'Lighter'} than last time, on purpose — a way back in after time off.`;
    default:
      return unit === 'reps'
        ? 'Not past a session you have already done — not progression yet.'
        : 'Lighter than a session you have already done — not progression yet.';
  }
}

/** Which band a candidate score falls in, given the target and current best. */
export function bandFor(score, target, bestAdj, settings) {
  if (!Number.isFinite(score) || !(target > 0)) return null;
  if (Number.isFinite(bestAdj) && score <= bestAdj) return BANDS.beaten;
  if (score > target * (1 + settings.stretchBand)) return BANDS.toobig;
  if (score > target * (1 + settings.idealBand)) return BANDS.stretch;
  return BANDS.ideal;
}

/** The weight behind the best set of the most recent session. */
export function lastSessionWeight(stats) {
  const last = stats.sessions && stats.sessions.length ? stats.sessions[stats.sessions.length - 1] : null;
  return last && Number.isFinite(last.best.weight) ? last.best.weight : null;
}

/**
 * Whatever the lift is loaded by — kilos on the bar, or reps of yourself.
 * The comeback rule is about doing less than you were, and "less" has to mean
 * the thing that actually varies.
 */
export function lastSessionLoad(stats) {
  const last = stats.sessions && stats.sessions.length ? stats.sessions[stats.sessions.length - 1] : null;
  if (!last) return null;
  const v = isBodyweight(stats.exercise) ? last.best.reps : last.best.weight;
  return Number.isFinite(v) ? v : null;
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
  const readiness = stats.readiness || null;
  // What counts as "already beaten" is your best AS OF TODAY. A layoff really
  // does take strength off, so after one the comparison is against the
  // discounted figure — otherwise every sensible re-entry weight is scolded for
  // not being a PR. Fatigue never moves this: tired is not weaker for good.
  const bestNow = readiness && Number.isFinite(readiness.currentBest)
    ? readiness.currentBest : stats.bestAdj;

  /**
   * Coming back from a layoff, the bands stop describing anything true. The
   * target has been discounted, so the next loadable rung above it can sit 3-4%
   * over and score as "too big a jump" — on a weight well under one you have
   * already lifted for the same reps. Nothing about that is a jump, and the
   * retention estimate is far too rough to be read to a whole percent.
   *
   * So while a lift is detraining, anything lighter than the session it is
   * coming back from is called what it is: a way back in. The judgement rests
   * on what you have demonstrably done, not on the model's guess.
   */
  const comebackUnder = readiness && readiness.phase && readiness.phase.key === 'detrained'
    ? lastSessionLoad(stats) : null;
  const bandOf = (score, weight) => (
    comebackUnder !== null && weight < comebackUnder - 1e-9
      ? BANDS.return
      : bandFor(score, target, bestNow, settings)
  );

  const reps = Number(override.reps) > 0 ? Math.round(Number(override.reps))
    : Number(stats.lastReps) > 0 ? Math.round(Number(stats.lastReps)) : 5;
  const sets = Number(override.sets) > 0 ? Math.round(Number(override.sets))
    : Number(stats.exercise.setsPerSession) > 0 ? Math.round(Number(stats.exercise.setsPerSession))
    : Number(stats.lastSets) > 0 ? Math.round(Number(stats.lastSets)) : 3;

  const plan = {
    ready: Number.isFinite(target) && target > 0,
    autoTarget, target, reps, sets, step, base,
    usingManualTarget: Number(override.target) > 0,
    readiness, baseTarget: stats.baseTarget, bestNow,
    bestAdj: stats.bestAdj,
    idealCeiling: target * (1 + settings.idealBand),
    stretchCeiling: target * (1 + settings.stretchBand),
    grid: [], columns: SET_COLUMNS, rows: REP_SCHEMES,
    gentlest: null, weight: NaN, score: NaN, overshoot: NaN, band: null,
    kind: isBodyweight(stats.exercise) ? 'bodyweight' : 'weight', options: null,
  };
  if (!plan.ready) return plan;

  if (isBodyweight(stats.exercise)) {
    plan.kind = 'bodyweight';
    plan.weight = null;
    plan.atBase = false;
    plan.lastWeight = null;
    plan.reps = repsForTarget(target, sets, settings);
    plan.score = plan.reps * setBonus(sets, settings.setBonusK);
    plan.overshoot = plan.score - target;
    plan.band = bandOf(plan.score, plan.reps);
    // No rep-scheme axis to trade against: the only choice is how many sets,
    // and each answer is the reps that gets you there. One row, not a grid.
    plan.options = SET_COLUMNS.map((sn) => {
      const r = repsForTarget(target, sn, settings);
      const score = r * setBonus(sn, settings.setBonusK);
      return { reps: r, sets: sn, weight: null, score, band: bandOf(score, r), isPick: sn === sets, volume: 0 };
    });
    // On a reps lift the smallest possible step is a whole rep, which low down
    // is a big one: 13 to 14 is nearly 8%. Adding a set instead is usually the
    // gentler way up, so the option that overshoots least is worth pointing at.
    const softest = plan.options
      .filter((o) => Number.isFinite(o.score) && o.score >= target - 1e-9)
      .reduce((a, b) => (a === null || b.score < a.score ? b : a), null);
    plan.gentlest = softest && softest.score < plan.score - 1e-9 ? softest : null;
    return plan;
  }

  plan.weight = weightForTarget(target, reps, sets, settings, step, base);
  // True when the bar alone is already heavier than the target needs.
  plan.atBase = base > 0 && Math.abs(plan.weight - base) < 1e-9;
  plan.score = plan.weight * repFactor(reps, settings.formula) * setBonus(sets, settings.setBonusK);
  plan.overshoot = plan.score - target;
  plan.band = bandOf(plan.score, plan.weight);
  plan.lastWeight = stats.lastAdj != null ? stats.entries[stats.entries.length - 1].weight : null;

  /** One cell of the trade-off grid: the lightest loadable weight at reps x sets. */
  const cell = (r, s) => {
    const w = weightForTarget(target, r, s, settings, step, base);
    const score = w * repFactor(r, settings.formula) * setBonus(s, settings.setBonusK);
    return {
      reps: r, sets: s, weight: w, score,
      band: bandOf(score, w),
      atBase: base > 0 && Math.abs(w - base) < 1e-9,
      isPick: r === snapReps(reps) && s === sets,
      volume: volume(w, r, s),
    };
  };

  // The grid is 42 solves. A collapsed card never looks at it, and holding a
  // stepper rebuilds the plan up to twenty times a second, so it is materialised
  // on first read rather than on construction. Same values, same order; the only
  // thing that changes is when the work happens.
  let grid = null;
  let gentlest;
  Object.defineProperty(plan, 'grid', {
    enumerable: true,
    configurable: true,
    get() {
      if (!grid) grid = REP_SCHEMES.map((r) => SET_COLUMNS.map((s) => cell(r, s)));
      return grid;
    },
  });

  // Gentlest option at the chosen set count: smallest overshoot of the target.
  // One column, so it solves seven cells rather than forcing the whole grid.
  Object.defineProperty(plan, 'gentlest', {
    enumerable: true,
    configurable: true,
    get() {
      if (gentlest !== undefined) return gentlest;
      const col = REP_SCHEMES.map((r) => cell(r, sets)).filter((c) => Number.isFinite(c.score));
      gentlest = col.length ? col.reduce((a, b) => (b.score < a.score ? b : a)) : null;
      return gentlest;
    },
  });

  return plan;
}

/* ----------------------------------------------------------- formatting */

export function fmt(n, dp = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** The unit a lift's score and milestones are counted in. */
export function loadUnit(exercise) {
  return isBodyweight(exercise) ? 'reps' : 'kg';
}

/** How one set reads: "3 × 5 @ 100 kg", or "3 × 12 reps" where there is no load. */
export function describeSet(exercise, sets, reps, weight) {
  return isBodyweight(exercise)
    ? `${sets} × ${reps} reps`
    : `${sets} × ${reps} @ ${fmtWeight(weight)} kg`;
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
