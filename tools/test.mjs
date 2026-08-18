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
  close(`${row.name}: next target`, s.nextTarget, row.nextTarget, 0.0001);
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
  const plan = M.planFor(planStats, settings, {});
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
  const withBar = { ...planStats, base: 20, exercise: { ...planStats.exercise, base: 20 } };
  const plan = M.planFor(withBar, settings, {});
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
  const heavyPlan = M.planFor(heavy, settings, {});
  ok('a too-heavy bar is reported as such', heavyPlan.atBase === true);
  close('a too-heavy bar prescribes the bar', heavyPlan.weight, 200);
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

/* ------------------------------------------------------------------ report */

console.log(`\n${pass} checks passed`);
if (failures.length) {
  console.error(`${failures.length} FAILED:`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('The app agrees with the spreadsheet on every value it publishes.\n');
