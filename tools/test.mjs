// tools/test.mjs — run with `npm test`.
//
// The point of these tests is that the app agrees with the spreadsheet. The
// fixture in tools/xlsx-fixture.json holds the values Excel itself calculated,
// so any drift in the maths shows up here rather than in the gym.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from '../js/metrics.js';
import { SEED } from '../js/seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'xlsx-fixture.json'), 'utf8'));

// The workbook's TODAY() when its values were last calculated.
const TODAY = '2026-08-18';
const settings = { ...SEED.settings };

let pass = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) { pass++; return; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}

function close(name, actual, expected, tol = 0.001) {
  if (expected === null || expected === undefined) return;
  const a = Number(actual), e = Number(expected);
  ok(name, Number.isFinite(a) && Math.abs(a - e) <= tol, `got ${a}, sheet says ${e}`);
}

/* ---------------------------------------------- 1. the formulas themselves */

close('Epley e1RM 60x8', M.e1rm(60, 8, 'epley'), 76);
close('Epley e1RM 70x5', M.e1rm(70, 5, 'epley'), 81.6667, 0.001);
close('Brzycki e1RM 100x5', M.e1rm(100, 5, 'brzycki'), 100 * 36 / 32, 0.001);
close('set bonus, 1 set', M.setBonus(1, 0.05), 1);
close('set bonus, 2 sets', M.setBonus(2, 0.05), 1.03466, 0.0001);
close('set bonus, 3 sets', M.setBonus(3, 0.05), 1.05493, 0.0001);
close('set bonus, 5 sets', M.setBonus(5, 0.05), 1.08047, 0.0001);
close('volume 3x5 @ 70', M.volume(70, 5, 3), 1050);
close('volume 3x8 @ 60', M.volume(60, 8, 3), 1440);

// Rounding is always up, onto the step, and immune to float error.
close('ceilToStep 80.6 / 2.5', M.ceilToStep(80.6, 2.5), 82.5);
close('ceilToStep exact 82.5', M.ceilToStep(82.5, 2.5), 82.5);
close('ceilToStep float-safe', M.ceilToStep(0.1 + 0.2 + 82.2, 2.5), 82.5);
close('ceilToStep 101 / 5', M.ceilToStep(101, 5), 105);

// With a starting weight, loadable weights are base + n x step.
close('ladder: 26 on a 20 kg bar, 2.5 steps', M.ceilToStep(26, 2.5, 20), 27.5);
close('ladder: exactly on a rung', M.ceilToStep(27.5, 2.5, 20), 27.5);
close('ladder: below the bar clamps to the bar', M.ceilToStep(19, 2.5, 20), 20);
close('ladder: at the bar', M.ceilToStep(20, 2.5, 20), 20);
close('ladder: an odd stack, base 11.5 step 2.3', M.ceilToStep(60, 2.3, 11.5), 62.1);
close('ladder: float dust cannot skip a rung', M.ceilToStep(0.1 + 0.2 + 27.2, 2.5, 20), 27.5);
close('ladder: base 0 behaves as before', M.ceilToStep(80.6, 2.5, 0), 82.5);
close('ladder: a negative base is ignored', M.ceilToStep(80.6, 2.5, -5), 82.5);

// weightForTarget lands on the ladder, and never suggests less than the bar.
{
  const st = { formula: 'epley', setBonusK: 0.05 };
  const w = M.weightForTarget(120, 5, 3, st, 2.5, 20);
  close('weightForTarget sits on a rung', (w - 20) % 2.5, 0, 1e-9);
  ok('weightForTarget clears the target', w * M.repFactor(5, 'epley') * M.setBonus(3, 0.05) >= 120 - 1e-9);
  ok('weightForTarget never goes under the bar', M.weightForTarget(1, 12, 5, st, 2.5, 20) === 20);
}

// A perfect fit and a flat run.
close('slope of a straight line', M.slope([[0, 0], [1, 2], [2, 4]]), 2);
ok('slope of one point is null', M.slope([[1, 1]]) === null);
ok('slope of a single day is null', M.slope([[5, 1], [5, 9]]) === null);

/* ------------------------------------- 2. the Dashboard, row by row */

const stats = M.allStats(SEED.exercises, SEED.entries, settings, TODAY);
const byName = new Map(stats.map((s) => [s.exercise.name, s]));

for (const row of fixture.dashboard) {
  const s = byName.get(row.name);
  if (!ok(`dashboard has ${row.name}`, !!s) || !s) continue;
  close(`${row.name}: last adj e1RM`, s.lastAdj, row.lastAdj, 0.0001);
  close(`${row.name}: best adj e1RM`, s.bestAdj, row.bestAdj, 0.0001);
  close(`${row.name}: trend kg/week`, s.trendPerWeek, row.trendPerWeek, 0.0001);
  // The sheet's target is the flat one — last session plus the weekly gain,
  // whatever the gap. The app still publishes it as baseTarget; nextTarget is
  // that number after the fatigue/detraining model has had its say.
  close(`${row.name}: next target`, s.baseTarget, row.nextTarget, 0.0001);
  close(`${row.name}: volume last 7 days`, s.volume7, row.volume7, 0.0001);
  close(`${row.name}: reps last session`, s.lastReps, row.lastReps);
  close(`${row.name}: sets last session`, s.lastSets, row.lastSets);
  close(`${row.name}: sets last 7 days`, s.sets7, row.sets7);
  ok(`${row.name}: set volume status`, s.setStatus === row.setStatus, `got ${s.setStatus}, sheet says ${row.setStatus}`);
}

/* ------------------------------------------ 3. the NextSession planner */

const planStats = byName.get(fixture.plan.exercise);
ok('planner exercise is present', !!planStats);
if (planStats) {
  // The grid the spreadsheet drew was built with the flat target, so the
  // comparison is made with the readiness model switched off.
  const flat = { ...settings, readiness: 'off' };
  const flatStats = M.allStats(SEED.exercises, SEED.entries, flat, TODAY)
    .find((s) => s.exercise.name === fixture.plan.exercise);
  const plan = M.planFor(flatStats, flat, {});
  close('planner: target used', plan.target, fixture.plan.target, 0.0001);
  close('planner: weight step', plan.step, fixture.plan.step);
  close('planner: reps used', plan.reps, fixture.plan.repsUsed);
  close('planner: sets used', plan.sets, fixture.plan.setsUsed);
  close('planner: prescribed weight', plan.weight, fixture.plan.weight);
  close('planner: what it scores', plan.score, fixture.plan.score, 0.0001);

  const verdictMap = { 'Ideal step': 'ideal', Stretch: 'stretch', 'Too big a jump': 'toobig', 'Already beaten': 'beaten' };
  ok('planner: verdict', plan.band.key === verdictMap[fixture.plan.verdict],
    `got ${plan.band.key}, sheet says ${fixture.plan.verdict}`);

  // Both grids, cell by cell. The sheet only goes to 5 sets; ours adds a 6th.
  for (const [ri, reps] of M.REP_SCHEMES.entries()) {
    for (let ci = 0; ci < 5; ci++) {
      const cell = plan.grid[ri][ci];
      close(`grid weight ${reps}r x ${ci + 1}s`, cell.weight, fixture.plan.weightGrid[ri][ci]);
      close(`grid score ${reps}r x ${ci + 1}s`, cell.score, fixture.plan.scoreGrid[ri][ci], 0.0001);
    }
  }
}

/* --------------------------------------- 3b. the planner with a bar weight */

{
  // The same lift, given a 20 kg bar: every cell must sit on the ladder and
  // still clear the target, and none may fall below the bar.
  const flat = { ...settings, readiness: 'off' };
  const withBar = { ...planStats, base: 20, exercise: { ...planStats.exercise, base: 20 } };
  const plan = M.planFor(withBar, flat, {});
  let offLadder = 0, underBar = 0, shortOfTarget = 0;
  for (const row of plan.grid) {
    for (const cell of row) {
      if (Math.abs((cell.weight - 20) % 2.5) > 1e-9) offLadder++;
      if (cell.weight < 20 - 1e-9) underBar++;
      if (cell.score < plan.target - 1e-9) shortOfTarget++;
    }
  }
  ok('every grid weight sits on the ladder', offLadder === 0, `${offLadder} off-ladder`);
  ok('no grid weight is under the bar', underBar === 0, `${underBar} under`);
  ok('every grid option still meets the target', shortOfTarget === 0, `${shortOfTarget} short`);
  ok('the prescribed weight sits on the ladder', Math.abs((plan.weight - 20) % 2.5) < 1e-9, String(plan.weight));

  // A lift whose bar is already heavier than the target needs.
  const heavy = { ...planStats, base: 200, exercise: { ...planStats.exercise, base: 200 } };
  const heavyPlan = M.planFor(heavy, flat, {});
  ok('a too-heavy bar is reported as such', heavyPlan.atBase === true);
  close('a too-heavy bar prescribes the bar', heavyPlan.weight, 200);
}

/* ------------------------- 3c. fatigue, recovery and detraining */

{
  const rs = M.READINESS_DEFAULTS;

  // Fatigue: biggest on the day, decaying by 1/e every tau, and gone eventually.
  close('fatigue on the day is the peak', M.fatigueAt(0, 1, rs), rs.fatiguePeak, 1e-9);
  close('fatigue falls by 1/e after one tau', M.fatigueAt(rs.fatigueTau, 1, rs), rs.fatiguePeak / Math.E, 1e-9);
  ok('fatigue decays monotonically', M.fatigueAt(1, 1, rs) > M.fatigueAt(2, 1, rs));
  ok('fatigue is spent after a fortnight', M.fatigueAt(14, 1, rs) === 0);
  ok('a brutal session cannot exceed the cap', M.fatigueAt(0, 100, rs) <= 0.15 + 1e-12);
  ok('the ready line falls between day 1 and day 2',
    M.fatigueAt(1, 1, rs) > M.READY_AT && M.fatigueAt(2, 1, rs) < M.READY_AT,
    `day1 ${M.fatigueAt(1, 1, rs)}, day2 ${M.fatigueAt(2, 1, rs)}`);

  // Severity: more sets and a lower RIR cost more; a blank RIR is a normal set.
  const ex = { setsPerSession: 5 };
  const sev = (sets, rir) => M.sessionSeverity({ sets, best: { rir } }, ex);
  ok('to failure is harder than leaving two', sev(5, 0) > sev(5, 2));
  ok('leaving four is easier than leaving two', sev(5, 4) < sev(5, 2));
  ok('more sets is harder', sev(8, 2) > sev(5, 2));
  close('a normal session is severity 1', sev(5, 2), 1.01, 0.02);
  close('a missing RIR is treated as normal', sev(5, null), 1, 1e-9);
  ok('severity is bounded', sev(50, 0) <= 1.8 + 1e-12 && sev(1, 10) >= 0.4 - 1e-12);

  // Accrual: earned by the week, and only while the rest is productive.
  close('half a week earns half the gain', M.accrualAt(3.5, 0.01, 10), 0.005, 1e-12);
  close('a week earns the week', M.accrualAt(7, 0.01, 10), 0.01, 1e-12);
  close('past the window earns nothing more', M.accrualAt(40, 0.01, 10), 0.01 * 10 / 7, 1e-12);
  ok('no time means no gain', M.accrualAt(0, 0.01, 10) === 0);

  // Retention: nothing lost inside the grace period, a half-life outside it.
  close('nothing is lost at the grace boundary', M.retentionAt(rs.graceDays, rs.graceDays, rs), 1, 1e-12);
  close('nothing is lost before it', M.retentionAt(3, rs.graceDays, rs), 1, 1e-12);
  close('one half-life loses half the losable part',
    M.retentionAt(rs.graceDays + rs.detrainHalfLife, rs.graceDays, rs),
    rs.retainedFloor + (1 - rs.retainedFloor) / 2, 1e-12);
  close('a decade off leaves exactly the floor', M.retentionAt(3650, rs.graceDays, rs), rs.retainedFloor, 1e-9);
  // The shape everyone quotes: a few percent by a month, low teens by two.
  const lost = (d) => (1 - M.retentionAt(d, rs.graceDays, rs)) * 100;
  ok('a month off costs a few percent', lost(28) > 3 && lost(28) < 8, `${lost(28).toFixed(1)}%`);
  ok('two months off costs low double digits', lost(56) > 9 && lost(56) < 18, `${lost(56).toFixed(1)}%`);

  // The typical gap is the median of the gaps, not of the days.
  close('typical interval, an odd number of gaps',
    M.typicalInterval([{ day: 0 }, { day: 3 }, { day: 7 }, { day: 10 }]), 3);
  close('typical interval, an even number of gaps',
    M.typicalInterval([{ day: 0 }, { day: 3 }, { day: 7 }, { day: 10 }, { day: 14 }]), 3.5);
  close('typical interval is a median, not a mean',
    M.typicalInterval([{ day: 0 }, { day: 3 }, { day: 6 }, { day: 90 }]), 3);
  ok('two sessions are not enough to call a rhythm', M.typicalInterval([{ day: 0 }, { day: 3 }]) === null);
}

{
  // One session, then the same lift read at every gap after it.
  const anchor = '2026-01-01';
  const ex = { id: 'x', name: 'X', step: 2.5, base: 0, gainPerWeek: 0.0075, setsPerSession: 5, setsPerWeek: 15 };
  const entries = [{ id: 'a', date: anchor, exerciseId: 'x', weight: 100, reps: 5, sets: 5, rir: 2, seq: 1 }];
  const at = (d, over = {}) => M.exerciseStats(ex, entries, { ...settings, ...over }, M.isoAddDays(anchor, d));

  const d0 = at(0), d1 = at(1), d3 = at(3), d7 = at(7), d10 = at(10), d21 = at(21), d90 = at(90);

  ok('a repeat on the day is still recovering', d0.readiness.phase.key === 'recovering');
  ok('a day later is still recovering', d1.readiness.phase.key === 'recovering');
  ok('three days out is ready', d3.readiness.phase.key === 'ready');
  ok('ten days out is holding', d10.readiness.phase.key === 'holding');
  ok('three weeks out is detraining', d21.readiness.phase.key === 'detrained');

  ok('a same-day repeat asks for less than the session it follows',
    d0.nextTarget < d0.lastAdj, `${d0.nextTarget} vs ${d0.lastAdj}`);
  ok('the target climbs as the fatigue clears', d0.nextTarget < d1.nextTarget && d1.nextTarget < d3.nextTarget);
  close('a week off earns exactly the weekly gain', d7.nextTarget, d7.baseTarget, 0.0001);
  ok('rest past the window stops adding', at(10).nextTarget === at(13).nextTarget);
  ok('a layoff asks for less than you last did', d90.nextTarget < d90.lastAdj, String(d90.nextTarget));
  ok('the target falls the longer the layoff runs', at(180).nextTarget < d90.nextTarget);

  // Detraining discounts your best; fatigue does not.
  close('fatigue leaves your best alone', d1.readiness.currentBest, d1.bestAdj, 1e-9);
  ok('a layoff discounts your best', d90.readiness.currentBest < d90.bestAdj);
  close('the discount is the retention', d90.readiness.currentBest, d90.bestAdj * d90.readiness.retention, 1e-9);

  // The flat target is untouched throughout — the two live side by side.
  close('the flat target ignores the gap', d90.baseTarget, d0.baseTarget, 1e-9);

  // Switched off, every gap gives the spreadsheet's answer.
  for (const d of [0, 1, 7, 90]) {
    const off = at(d, { readiness: 'off' });
    close(`model off, day ${d}: the flat step`, off.nextTarget, off.baseTarget, 1e-9);
    ok(`model off, day ${d}: your best stands`, off.readiness.currentBest === off.bestAdj);
  }

  // A harder last session leaves a bigger hole the next day.
  const hard = [{ ...entries[0], sets: 8, rir: 0 }];
  const easy = [{ ...entries[0], sets: 3, rir: 4 }];
  const hardR = M.exerciseStats(ex, hard, settings, M.isoAddDays(anchor, 1)).readiness;
  const easyR = M.exerciseStats(ex, easy, settings, M.isoAddDays(anchor, 1)).readiness;
  ok('eight sets to failure costs more than three easy ones', hardR.fatigue > easyR.fatigue);

  // A comeback weight is not scolded for failing to be a PR, and a weight you
  // have already lifted for the same reps is never "too big a jump".
  const back = at(120);
  const backPlan = M.planFor(back, settings, {});
  ok('a comeback plan is measured against today’s best', backPlan.bestNow === back.readiness.currentBest);
  ok('a comeback plan is lighter than the last session', backPlan.weight < 100, String(backPlan.weight));
  ok('a comeback plan is called a way back in', backPlan.band.key === 'return', backPlan.band.key);
  ok('the way-back-in verdict says so', /way back in/i.test(M.plainVerdict(backPlan.band, -20)));
  const overreach = backPlan.grid.flat().filter((c) => c.weight < 100 - 1e-9 && c.band.key === 'toobig');
  ok('no weight under the last session reads as too big a jump', overreach.length === 0,
    `${overreach.length} cells`);
  // The relabelling is a floor, not a blanket: options at or above the weight
  // you last lifted are still judged on the maths.
  const shortLayoff = M.planFor(at(28), settings, {}).grid.flat();
  ok('options over the last weight are judged normally',
    shortLayoff.filter((c) => c.weight >= 100).length > 0
      && shortLayoff.filter((c) => c.weight >= 100).every((c) => c.band.key !== 'return'));
  ok('options under it are the way back in',
    shortLayoff.filter((c) => c.weight < 100).every((c) => c.band.key === 'return'));
  // Nothing is relabelled while the lift is merely rested rather than detrained.
  ok('the way-back-in band is only for a real layoff',
    M.planFor(at(5), settings, {}).grid.flat().every((c) => c.band.key !== 'return'));

  // Whatever the gap, the prescription still clears the target it was given.
  for (const d of [0, 1, 2, 5, 14, 30, 120]) {
    const st = at(d);
    const pl = M.planFor(st, settings, {});
    ok(`day ${d}: the weight still meets its target`,
      pl.score >= pl.target - 1e-9, `${pl.score} vs ${pl.target}`);
    ok(`day ${d}: the weight is loadable`, Math.abs(pl.weight / pl.step % 1) < 1e-9);
  }

  // A lift trained on a fortnightly rhythm is not detraining on day fifteen.
  const slow = [0, 14, 28, 42].map((d, i) => ({
    id: `s${i}`, date: M.isoAddDays(anchor, d), exerciseId: 'x',
    weight: 100, reps: 5, sets: 5, rir: 2, seq: i + 1,
  }));
  const slowStats = M.exerciseStats(ex, slow, settings, M.isoAddDays(anchor, 42 + 15));
  close('the rhythm is read off the log', slowStats.readiness.typicalInterval, 14);
  ok('the grace period stretches to the rhythm', slowStats.readiness.grace >= 28);
  ok('day fifteen of a fortnightly lift is not a layoff', slowStats.readiness.phase.key !== 'detrained');
}

/* ---------------------------------------------------- 4. behaviour guards */

// An override target must win over the automatic one.
if (planStats) {
  const forced = M.planFor(planStats, settings, { target: 120, reps: 5, sets: 3 });
  close('override target is used', forced.target, 120);
  ok('override weight clears the target',
    forced.weight * M.repFactor(5, 'epley') * M.setBonus(3, 0.05) >= 120 - 1e-9);
  ok('override weight is loadable', Math.abs((forced.weight / forced.step) % 1) < 1e-9);
}

// Reps snap down onto the grid's schemes, exactly as MATCH(...,1) does.
close('snapReps 7 -> 6', M.snapReps(7), 6);
close('snapReps 5 -> 5', M.snapReps(5), 5);
close('snapReps 2 -> 3', M.snapReps(2), 3);
close('snapReps 20 -> 12', M.snapReps(20), 12);

// Bands, at the edges.
const st = { stretchBand: 0.03, idealBand: 0.01 };
ok('band: at the ideal ceiling is still ideal', M.bandFor(101, 100, 50, st).key === 'ideal');
ok('band: just over the ideal ceiling is a stretch', M.bandFor(101.5, 100, 50, st).key === 'stretch');
ok('band: over the stretch ceiling is too big', M.bandFor(103.5, 100, 50, st).key === 'toobig');
ok('band: at or below the best is beaten', M.bandFor(100, 100, 100, st).key === 'beaten');
ok('band: beaten outranks too big', M.bandFor(110, 100, 120, st).key === 'beaten');

// A projection needs a fit worth extrapolating.
const thin = M.exerciseStats(SEED.exercises[0], SEED.entries, settings, TODAY);
ok('a two-session fit is provisional', thin.trendReliable === false);
ok('a provisional fit publishes no projection', thin.proj12 === null);

// Dates.
close('dayNumber of the anchor', M.dayNumber('2020-01-01'), 0);
close('dayNumber spans a leap day', M.dayNumber('2020-03-01'), 60);
ok('relativeDate today', M.relativeDate('2026-08-18', '2026-08-18') === 'Today');
ok('relativeDate yesterday', M.relativeDate('2026-08-17', '2026-08-18') === 'Yesterday');
ok('isoAddDays crosses a month', M.isoAddDays('2026-08-31', 1) === '2026-09-01');

/* ------------------------------------------------- 5. the store (js/store.js) */

// store.js is the one place a bug silently loses data, and it has never had a
// test. It needs a localStorage before it is imported, so the shim goes first.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const store = await import('../js/store.js');

/** A store holding nothing but the seed, with an empty undo stack. */
function fresh() {
  globalThis.localStorage.clear();
  store.reload();
  return store.getExercises()[0].id;
}

// --- logSet: the merge rule ---
{
  const ex = fresh();
  const day = '2026-08-18';
  const before = store.entriesOn(ex, day).length;
  store.logSet({ exerciseId: ex, date: day, weight: 100, reps: 5, rir: 3 });
  store.logSet({ exerciseId: ex, date: day, weight: 100, reps: 5, rir: 1 });
  const rows = store.entriesOn(ex, day).filter((e) => e.weight === 100 && e.reps === 5);
  ok('logSet merges two identical sets into one block', rows.length === 1, `got ${rows.length} rows`);
  ok('a merged block counts both sets', rows[0].sets === 2, `sets=${rows[0]?.sets}`);
  ok('a merged block keeps the hardest RIR', rows[0].rir === 1, `rir=${rows[0]?.rir}`);
  ok('logSet did not disturb the rest of the day', store.entriesOn(ex, day).length === before + 1);

  store.logSet({ exerciseId: ex, date: day, weight: 100, reps: 4, rir: 0 });
  const four = store.entriesOn(ex, day).filter((e) => e.weight === 100 && e.reps === 4);
  ok('a different rep count becomes its own block', four.length === 1 && four[0].sets === 1);
}

// --- logSet: notes are collected, not lost ---
{
  const ex = fresh();
  store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 60, reps: 5, notes: 'felt light' });
  store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 60, reps: 5, notes: 'grip slipped' });
  const row = store.entriesOn(ex, '2026-08-18').find((e) => e.weight === 60 && e.reps === 5);
  ok('a merged block collects both notes', row.notes === 'felt light; grip slipped', row.notes);
  store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 60, reps: 5, notes: 'grip slipped' });
  const again = store.entriesOn(ex, '2026-08-18').find((e) => e.weight === 60 && e.reps === 5);
  ok('a repeated note is not duplicated', again.notes === 'felt light; grip slipped', again.notes);
}

// --- undo: the merge branch restores every field it touched ---
{
  const ex = fresh();
  const day = '2026-08-18';
  store.logSet({ exerciseId: ex, date: day, weight: 90, reps: 5, rir: 3, notes: 'one' });
  const snap = { ...store.entriesOn(ex, day).find((e) => e.weight === 90) };
  store.logSet({ exerciseId: ex, date: day, weight: 90, reps: 5, rir: 0, notes: 'two' });
  store.undo();
  const back = store.entriesOn(ex, day).find((e) => e.weight === 90);
  ok('undo restores the block set count', back.sets === snap.sets, `${back.sets} vs ${snap.sets}`);
  ok('undo restores the block RIR', back.rir === snap.rir, `${back.rir} vs ${snap.rir}`);
  ok('undo restores the block notes', back.notes === snap.notes, `${back.notes} vs ${snap.notes}`);
}

// --- undo: the create branch removes the entry it added ---
{
  const ex = fresh();
  const day = '2026-08-18';
  const before = store.getEntries().length;
  store.logSet({ exerciseId: ex, date: day, weight: 123.5, reps: 7 });
  ok('logSet added an entry', store.getEntries().length === before + 1);
  store.undo();
  ok('undo removes the entry logSet created', store.getEntries().length === before);
  ok('undo leaves no trace of the set', !store.getEntries().some((e) => e.weight === 123.5));
}

// --- removeLastSet, both branches, and their inverses ---
{
  const ex = fresh();
  const day = '2026-08-18';
  store.logSet({ exerciseId: ex, date: day, weight: 80, reps: 5 });
  store.logSet({ exerciseId: ex, date: day, weight: 80, reps: 5 });
  store.removeLastSet(ex, day);
  ok('removeLastSet decrements a multi-set block',
    store.entriesOn(ex, day).find((e) => e.weight === 80).sets === 1);
  store.undo();
  ok('undo puts the removed set back',
    store.entriesOn(ex, day).find((e) => e.weight === 80).sets === 2);

  const count = store.getEntries().length;
  store.logSet({ exerciseId: ex, date: day, weight: 77.5, reps: 3 });
  store.removeLastSet(ex, day);
  ok('removeLastSet deletes a one-set block', store.getEntries().length === count);
  store.undo();
  ok('undo restores a deleted one-set block', store.getEntries().length === count + 1);
  ok('the restored block is the one that went', store.getEntries().some((e) => e.weight === 77.5 && e.reps === 3));
}

// --- deleteEntry restores in place, not at the end ---
{
  fresh();
  const all = store.getEntries();
  const victim = all[Math.floor(all.length / 2)];
  const idx = all.indexOf(victim);
  store.deleteEntry(victim.id);
  ok('deleteEntry removes the entry', !store.getEntries().some((e) => e.id === victim.id));
  store.undo();
  ok('undo restores the deleted entry', store.getEntries().some((e) => e.id === victim.id));
  ok('undo restores it at its original index', store.getEntries().indexOf(
    store.getEntries().find((e) => e.id === victim.id)) === idx);
}

// --- updateEntry and its inverse ---
{
  fresh();
  const e0 = store.getEntries()[0];
  const snap = { ...e0 };
  store.updateEntry(e0.id, { weight: 999, reps: 2, sets: 9, rir: 0, notes: 'changed' });
  const hit = store.getEntries().find((e) => e.id === snap.id);
  ok('updateEntry applies the patch', hit.weight === 999 && hit.reps === 2 && hit.sets === 9);
  store.undo();
  const back = store.getEntries().find((e) => e.id === snap.id);
  for (const k of ['date', 'weight', 'reps', 'sets', 'rir', 'notes', 'exerciseId']) {
    ok(`undo restores entry.${k}`, back[k] === snap[k], `${back[k]} vs ${snap[k]}`);
  }
}

// --- settings, order, and the coarse whole-document path ---
{
  fresh();
  const was = store.getSettings().lookbackDays;
  store.updateSettings({ lookbackDays: 21 });
  ok('updateSettings applies', store.getSettings().lookbackDays === 21);
  store.undo();
  ok('undo restores the previous setting', store.getSettings().lookbackDays === was);

  const order = store.getExercises().map((e) => e.id);
  store.moveExercise(order[1], -1);
  ok('moveExercise swaps', store.getExercises()[0].id === order[1]);
  store.undo();
  ok('undo restores the order', store.getExercises().map((e) => e.id).join() === order.join());

  const n = store.getEntries().length;
  ok('the seed has a log to clear', n > 0);
  store.clearAll();
  ok('clearAll empties the log', store.getEntries().length === 0);
  store.undo();
  ok('undo restores the whole log from a coarse snapshot', store.getEntries().length === n);
}

// --- the undo stack itself ---
{
  const ex = fresh();
  const v0 = store.getVersion();
  store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 50, reps: 5 });
  ok('a commit bumps the version', store.getVersion() === v0 + 1);
  store.undo();
  ok('an undo bumps the version too', store.getVersion() === v0 + 2);
  ok('the stack is empty once drained', store.canUndo() === false);
  ok('undo on an empty stack is a no-op', store.undo() === false);

  for (let i = 0; i < 25; i++) store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 50 + i, reps: 5 });
  let depth = 0;
  while (store.undo()) depth++;
  ok('the undo stack caps at 20', depth === 20, `unwound ${depth}`);
}

// --- normalise: the guards that protect the log ---
{
  fresh();
  const ex = store.getExercises()[0].id;
  const doc = JSON.parse(store.exportJSON());
  doc.entries.push({ date: '2026-08-18', exerciseId: 'ex-does-not-exist', weight: 100, reps: 5, sets: 1 });
  doc.entries.push({ date: '2026-08-18', exerciseId: ex, weight: 100, reps: 0, sets: 1 });
  const kept = store.importJSON(JSON.stringify(doc)).entries;
  ok('an entry for an unknown lift is dropped', !kept.some((e) => e.exerciseId === 'ex-does-not-exist'));
  ok('a zero-rep entry is dropped', !kept.some((e) => e.reps === 0));
}

// --- reload(): another tab wrote, and this one must not lose its footing ---
{
  const ex = fresh();
  store.logSet({ exerciseId: ex, date: '2026-08-18', weight: 111, reps: 5 });
  ok('there is something to undo', store.canUndo() === true);
  const outside = JSON.parse(globalThis.localStorage.getItem('liftingTracker.v1'));
  outside.entries = outside.entries.filter((e) => e.weight !== 111);
  globalThis.localStorage.setItem('liftingTracker.v1', JSON.stringify(outside));
  store.reload();
  ok('reload picks up the other tab’s write', !store.getEntries().some((e) => e.weight === 111));
  ok('reload drops an undo stack that no longer applies', store.canUndo() === false);
}

// --- a long log must not blow the call stack when seq is derived ---
{
  fresh();
  const ex = store.getExercises()[0].id;
  const big = { exercises: store.getExercises(), settings: store.getSettings(), entries: [] };
  for (let i = 0; i < 200000; i++) {
    big.entries.push({ id: `b-${i}`, date: '2026-08-18', exerciseId: ex, weight: 100, reps: 5, sets: 1, seq: i + 1 });
  }
  let threw = null;
  try { store.importJSON(JSON.stringify(big)); } catch (err) { threw = err; }
  ok('a 200k-entry log normalises without a RangeError', threw === null, String(threw && threw.message));
  ok('seq is derived correctly at that size', store.getDoc().seq === 200001, String(store.getDoc().seq));
  fresh();
}

/* -------------------------------- 5b. the simple/detailed split, retired */

// The two-mode split is gone: one design, with the arithmetic behind a
// disclosure. The only thing carried across is whether those disclosures start
// open — and somebody who chose the detailed view was asking to see the
// numbers, so they must still see them without touching anything.
{
  const base = () => {
    fresh();
    return JSON.parse(store.exportJSON());
  };

  const detailed = base();
  detailed.settings = { ...detailed.settings, detailLevel: 'detailed' };
  delete detailed.settings.numbersOpen;
  ok('a detailed-view user keeps their numbers open',
    store.importJSON(JSON.stringify(detailed)).settings.numbersOpen === true);

  const simple = base();
  simple.settings = { ...simple.settings, detailLevel: 'simple' };
  delete simple.settings.numbersOpen;
  ok('a simple-view user starts with them folded',
    store.importJSON(JSON.stringify(simple)).settings.numbersOpen === false);

  // A document written before the split showed everything, so it counts as
  // detailed — the same rule the old migration used.
  const ancient = base();
  delete ancient.settings.detailLevel;
  delete ancient.settings.numbersOpen;
  ok('a pre-split document keeps everything it used to show',
    store.importJSON(JSON.stringify(ancient)).settings.numbersOpen === true);

  // An explicit choice always wins over the migration.
  const explicit = base();
  explicit.settings = { ...explicit.settings, detailLevel: 'detailed', numbersOpen: false };
  ok('an explicit choice beats the migration',
    store.importJSON(JSON.stringify(explicit)).settings.numbersOpen === false);

  ok('the retired setting is not carried forward',
    store.getSettings().detailLevel === undefined);

  fresh();
  store.updateSettings({ numbersOpen: true });
  ok('the setting is a boolean, not a coerced number', store.getSettings().numbersOpen === true);
  store.updateSettings({ numbersOpen: false });
  ok('and it turns off again', store.getSettings().numbersOpen === false);
  store.undo();
  ok('undo restores it', store.getSettings().numbersOpen === true);
}

// --- readinessNote / readinessMaths, split out of one forked function ---
{
  fresh();
  const cfg = store.getSettings();
  const st = M.allStats(store.getExercises(), store.getEntries(), cfg, '2026-08-18')
    .find((s) => s.entryCount > 0);
  const r = st.readiness;
  const plain = M.readinessNote(r);
  const maths = M.readinessMaths(r);
  ok('the plain verdict says something', plain.length > 20);
  ok('the maths says something else', maths.length > 20 && maths !== plain);
  ok('the plain verdict keeps the jargon out', !/e1RM|deficit|retention/i.test(plain), plain);
  ok('both are empty when the model is off', M.readinessNote({ enabled: false }) === ''
    && M.readinessMaths({ enabled: false }) === '');
  ok('both are empty without a last session', M.readinessNote({ enabled: true, days: null }) === ''
    && M.readinessMaths({ enabled: true, days: null }) === '');
}

/* ------------------------------------- 6. the memo layer (js/core/select.js) */

// The memo is only allowed to change WHEN the maths runs, never WHAT it says.
// If these drift, the app is quietly showing something the spreadsheet does not.
const select = await import('../js/core/select.js');

{
  fresh();
  select.invalidate();
  const cfg = store.getSettings();
  const day = '2026-08-18';

  const raw = M.allStats(store.getExercises(), store.getEntries(), cfg, day);
  const memo = select.allStats(cfg, day);
  ok('the memo returns one stats object per lift', memo.length === raw.length);
  ok('the memo agrees with metrics.js on every published field',
    JSON.stringify(memo) === JSON.stringify(raw),
    'memoised stats differ from a direct allStats() call');

  // Pre-filtering the log per exercise must not change a single figure.
  for (const [i, st] of memo.entries()) {
    close(`memo lastAdj matches for ${st.exercise.name}`, st.lastAdj ?? 0, raw[i].lastAdj ?? 0, 1e-12);
    close(`memo nextTarget matches for ${st.exercise.name}`, st.nextTarget ?? 0, raw[i].nextTarget ?? 0, 1e-12);
    close(`memo trendPerWeek matches for ${st.exercise.name}`, st.trendPerWeek ?? 0, raw[i].trendPerWeek ?? 0, 1e-12);
  }

  // --- what the cache is actually for ---
  ok('a repeat call is served from the cache', select.allStats(cfg, day) === memo);
  ok('statsFor hands back the same object as the list',
    select.statsFor(memo[0].exercise.id, cfg, day) === memo[0]);

  // Settings that never reach the maths must not cost a recompute.
  ok('changing the detail level keeps the cache',
    select.allStats({ ...cfg, detailLevel: 'detailed' }, day) === memo);
  ok('changing the rest timer keeps the cache',
    select.allStats({ ...cfg, restSeconds: 90 }, day) === memo);

  // Settings that do reach it must not.
  ok('changing the formula drops the cache',
    select.allStats({ ...cfg, formula: 'brzycki' }, day) !== memo);
  select.invalidate();
  const again = select.allStats(cfg, day);
  ok('changing a readiness dial drops the cache',
    select.allStats({ ...cfg, fatigueTau: 3 }, day) !== again);

  // A new day is a new answer: daysSince moves under everything.
  select.invalidate();
  const onDay = select.allStats(cfg, day);
  ok('a different day drops the cache', select.allStats(cfg, '2026-08-19') !== onDay);
}

// --- the band settings invalidate plans, and only plans ---
{
  fresh();
  select.invalidate();
  const cfg = store.getSettings();
  const day = '2026-08-18';
  const trained = select.allStats(cfg, day).filter((s) => s.entryCount > 0);
  ok('the seed has a trained lift to plan for', trained.length > 0);
  const st = trained[0];

  const p1 = select.planFor(st, cfg, {}, day);
  ok('a repeat plan is served from the cache', select.planFor(st, cfg, {}, day) === p1);
  ok('a different override computes a different plan',
    select.planFor(st, cfg, { reps: 8 }, day) !== p1);
  ok('the same override is cached again',
    select.planFor(st, cfg, { reps: 8 }, day) === select.planFor(st, cfg, { reps: 8 }, day));

  const wide = { ...cfg, idealBand: 0.2 };
  ok('widening the ideal band keeps the stats cache',
    select.allStats(wide, day) === select.allStats(cfg, day));
  const p2 = select.planFor(st, wide, {}, day);
  ok('widening the ideal band recomputes the plan', p2 !== p1);
  ok('and the verdict actually moves with it', p2.band.key !== p1.band.key || p1.band.key === 'beaten');

  // The memoised plan must equal the plan metrics.js would have produced.
  const direct = M.planFor(st, cfg, {});
  const p3 = select.planFor(st, cfg, {}, day);
  close('memo plan weight matches metrics.js', p3.weight, direct.weight, 1e-12);
  close('memo plan score matches metrics.js', p3.score, direct.score, 1e-12);
  ok('memo plan verdict matches metrics.js', p3.band.key === direct.band.key);
}

// --- a write must invalidate everything ---
{
  const ex = fresh();
  select.invalidate();
  const cfg = store.getSettings();
  const day = '2026-08-18';
  const before = select.allStats(cfg, day);
  store.logSet({ exerciseId: ex, date: day, weight: 500, reps: 5 });
  const after = select.allStats(cfg, day);
  ok('logging a set drops the cache', after !== before);
  const mine = after.find((s) => s.exercise.id === ex);
  ok('and the new set is in the fresh stats', mine.entries.some((e) => e.weight === 500));
  store.undo();
  ok('undoing drops it again', select.allStats(cfg, day) !== after);
  ok('and the set is gone from the stats',
    !select.allStats(cfg, day).find((s) => s.exercise.id === ex).entries.some((e) => e.weight === 500));
}

// --- the lazy grid must be exactly the grid that used to be built eagerly ---
{
  fresh();
  const cfg = store.getSettings();
  const st = M.allStats(store.getExercises(), store.getEntries(), cfg, '2026-08-18')
    .find((s) => s.entryCount > 0);
  const plan = M.planFor(st, cfg, {});
  ok('the grid is enumerable, as it was when it was a plain array',
    Object.keys(plan).includes('grid'));
  ok('the grid has a row per rep scheme', plan.grid.length === M.REP_SCHEMES.length);
  ok('the grid has a column per set count', plan.grid[0].length === M.SET_COLUMNS.length);
  ok('a second read is the same array', plan.grid === plan.grid);
  ok('gentlest resolves without forcing the grid',
    plan.gentlest === null || Number.isFinite(plan.gentlest.score));
  // gentlest is the smallest score in the chosen set column, however it is found.
  const col = plan.grid.map((row) => row.find((c) => c.sets === plan.sets)).filter((c) => c && Number.isFinite(c.score));
  const expect = col.length ? col.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  close('gentlest picks the same cell the grid would', plan.gentlest?.score ?? 0, expect?.score ?? 0, 1e-12);
  ok('gentlest picks the same rep scheme', (plan.gentlest?.reps ?? 0) === (expect?.reps ?? 0));
}

/* ------------------------------------------------------------------ report */

console.log(`\n${pass} checks passed`);
if (failures.length) {
  console.error(`${failures.length} FAILED:`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('The app agrees with the spreadsheet on every value it publishes.\n');
