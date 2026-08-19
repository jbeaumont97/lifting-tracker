// core/select.js — derived data, computed once per document version.
//
// exerciseStats() filters the whole entry log once per exercise, and almost
// every render is triggered by something that never touched the document: a
// stepper nudge, a card opening, a tab switch. This layer makes those renders
// free.
//
// metrics.js does not know this exists. It stays pure, stays DOM-free, and
// stays testable in Node exactly as it was — the memo wraps it from outside, so
// the spreadsheet fixture keeps measuring the real thing.

import * as store from '../store.js';
import { exerciseStats, planFor as rawPlanFor, isoToday } from '../metrics.js';

/**
 * Only the settings that actually reach the maths. Flipping the detail toggle,
 * the rest timer or the unit must not throw the stats cache away.
 */
const STATS_KEYS = [
  'formula', 'setBonusK', 'lookbackDays', 'defaultStep', 'defaultGainPerWeek',
  'readiness', 'fatiguePeak', 'fatigueTau', 'productiveDays', 'graceDays',
  'detrainHalfLife', 'retainedFloor',
];

// The bands live in bandFor(), which planFor() calls and exerciseStats() does
// not — so widening the ideal band invalidates plans and leaves stats alone.
const PLAN_KEYS = ['idealBand', 'stretchBand'];

function sig(settings, keys) {
  let out = '';
  for (const k of keys) out += `${settings[k]},`;
  return out;
}

let cache = null;

/**
 * Rotate the cache if anything it was built on has moved. Everything below
 * calls this first, so a caller can never read a stale figure.
 */
function ensure(settings, today) {
  const version = store.getVersion();
  const statsSig = sig(settings, STATS_KEYS);
  const planSig = statsSig + sig(settings, PLAN_KEYS);
  if (!cache || cache.version !== version || cache.statsSig !== statsSig || cache.today !== today) {
    cache = { version, statsSig, planSig, today, index: null, stats: new Map(), list: null, plans: new Map() };
  } else if (cache.planSig !== planSig) {
    // Stats survive a band change; plans do not.
    cache.planSig = planSig;
    cache.plans.clear();
  }
  return cache;
}

/**
 * Map<exerciseId, entry[]>, built once per version. Replaces one full-log scan
 * per exercise per render with a single pass.
 */
function index(c) {
  if (c.index) return c.index;
  const map = new Map();
  for (const ex of store.getExercises()) map.set(ex.id, []);
  for (const e of store.getEntries()) {
    const bucket = map.get(e.exerciseId);
    if (bucket) bucket.push(e);
  }
  c.index = map;
  return map;
}

function build(c, exercise, settings) {
  const hit = c.stats.get(exercise.id);
  if (hit) return hit;
  // exerciseStats filters by exerciseId itself, so handing it the pre-filtered
  // bucket produces exactly the same object it would have produced from the
  // whole log — the filter simply has nothing left to remove.
  const st = exerciseStats(exercise, index(c).get(exercise.id) || [], settings, c.today);
  c.stats.set(exercise.id, st);
  return st;
}

/** Stats for one lift. Null if the lift is gone. */
export function statsFor(exerciseId, settings = store.getSettings(), today = isoToday()) {
  const c = ensure(settings, today);
  const ex = store.getExercise(exerciseId);
  return ex ? build(c, ex, settings) : null;
}

/** Stats for every lift, in the user's chosen order. The render loop's input. */
export function allStats(settings = store.getSettings(), today = isoToday()) {
  const c = ensure(settings, today);
  if (!c.list) c.list = store.getExercises().map((ex) => build(c, ex, settings));
  return c.list;
}

/**
 * planFor(), memoised on the override the card is actually showing. A stepper
 * hold changes only `override`, so this is the one thing that recomputes.
 */
export function planFor(stats, settings, override = {}, today = isoToday()) {
  const c = ensure(settings, today);
  const id = stats && stats.exercise && stats.exercise.id;
  if (!id) return rawPlanFor(stats, settings, override);
  const key = `${id}|${override.target ?? ''}|${override.reps ?? ''}|${override.sets ?? ''}`;
  const hit = c.plans.get(key);
  if (hit) return hit;
  const plan = rawPlanFor(stats, settings, override);
  c.plans.set(key, plan);
  return plan;
}

/** Drop everything. Needed by tests, and by a hard document swap. */
export function invalidate() { cache = null; }
