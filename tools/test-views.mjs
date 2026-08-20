// tools/test-views.mjs — do the screens actually render?
//
// tools/test.mjs proves the maths. This proves the views survive contact with
// it. draw() wraps every view in a try/catch that falls back to "Something went
// wrong", so a view that throws does not crash — it quietly replaces itself
// with an apology. That is exactly the kind of failure that reaches the gym.
//
// Runs on tools/dom-shim.mjs: no jsdom, no dependencies, no build step.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { installDom } from './dom-shim.mjs';

installDom();

const store = await import('../js/store.js');
const select = await import('../js/core/select.js');
const bindings = await import('../js/core/bind.js');
const uistate = await import('../js/core/uistate.js');
const ui = uistate;
const { renderPlan, openCard } = await import('../js/views/plan.js');
const { renderLog, setPrefill, clearForm } = await import('../js/views/log.js');
const { renderProgress, openExercise, clearSelection } = await import('../js/views/progress.js');
const { renderSetup } = await import('../js/views/setup.js');
const { showWelcome } = await import('../js/views/welcome.js');

let pass = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) { pass++; return; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}

/** Render and report the throw rather than letting it kill the run. */
function render(name, fn) {
  try {
    const node = fn();
    ok(`${name} renders`, !!node && node.nodeType === 1, 'returned nothing');
    return node;
  } catch (err) {
    ok(`${name} renders`, false, `threw ${err && err.message}`);
    return null;
  }
}

const TODAY = '2026-08-18';
let refreshes = 0;
let ticks = 0;

/** Let any queued animation frame run, the way the browser would. */
const settle = () => new Promise((r) => setTimeout(r, 10));

function ctx(over = {}) {
  const settings = store.getSettings();
  return {
    settings,
    numbersOpen: settings.numbersOpen === true,
    stats: select.allStats(settings, TODAY),
    today: TODAY,
    route: 'plan',
    refresh: () => { refreshes++; },
    tick: () => { ticks++; bindings.tick(); },
    goTo: () => {},
    onResize: () => {},
    ...over,
  };
}

/** A fresh page load: empty storage, and no module holding on to view state. */
function reset() {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  uistate.clearAll();
  clearForm();
  clearSelection();
  store.reload();
  select.invalidate();
  bindings.resetBindings();
}

/* ------------------------------------------------- 1. every view, both modes */

for (const open of [false, true]) {
  reset();
  store.updateSettings({ numbersOpen: open });
  const c = ctx();
  const label = open ? '[numbers open]' : '[numbers folded]';

  const plan = render(`${label} Next`, () => renderPlan(c));
  ok(`${label} Next is a view section`, plan && plan.classList.contains('view'));
  ok(`${label} Next shows a prescription`, plan && plan.querySelectorAll('.presc').length > 0);
  ok(`${label} Next names every lift`,
    plan && store.getExercises().every((ex) => plan.textContent.includes(ex.name)));

  setPrefill({});
  const bare = render(`${label} Log with nothing chosen`, () => renderLog(ctx({ route: 'log' })));
  ok(`${label} Log offers the lift picker`, bare && bare.querySelectorAll('.chip-lift').length > 0);
  ok(`${label} Log asks you to pick a lift first`,
    bare && bare.textContent.includes('Pick a lift to log'));

  setPrefill({ exerciseId: store.getExercises()[0].id, date: TODAY });
  const log = render(`${label} Log with a lift chosen`, () => renderLog(ctx({ route: 'log' })));
  ok(`${label} Log shows the form once a lift is chosen`, log && log.querySelectorAll('.stepper').length >= 3);
  ok(`${label} Log has a save button`, log && log.querySelectorAll('.btn-save').length === 1);

  clearSelection();
  const prog = render(`${label} Progress list`, () => renderProgress(ctx({ route: 'progress' })));
  ok(`${label} Progress lists the lifts`, prog && prog.querySelectorAll('.card-row').length > 0);

  const trained = c.stats.find((s) => s.entryCount > 0);
  openExercise(trained.exercise.id);
  const detail = render(`${label} Progress detail`, () => renderProgress(ctx({ route: 'progress' })));
  ok(`${label} Progress detail leads with the hero number`, detail && detail.querySelectorAll('.hero-value').length > 0);
  // The charts are painted in a requestAnimationFrame, exactly as they are in
  // the browser, so the assertion has to wait for the frame the same way.
  await settle();
  ok(`${label} Progress detail draws the progression chart`,
    detail && detail.querySelectorAll('.chart-svg').length > 0);
  ok(`${label} Progress detail draws the weekly sets chart`,
    detail && detail.querySelectorAll('.meter').length > 0);
  clearSelection();

  const setup = render(`${label} Setup`, () => renderSetup(ctx({ route: 'setup' })));
  ok(`${label} Setup offers the steppers`, setup && setup.querySelectorAll('.stepper').length > 5);

  // One design for everyone: the arithmetic is present on every screen, and
  // the setting only decides whether it starts open.
  const discs = plan.querySelectorAll('.disclose');
  ok(`${label} Next offers the numbers`, discs.length > 0);

  // "Show the numbers" and friends follow the setting. The target override is
  // not a reading aid — it is an input, and it opens when an override is
  // actually in force, which is a different question.
  const labelOf = (d) => (d.querySelector('.disclose-label') || {}).textContent || '';
  const numbers = discs.filter((d) => /^(Show|Where)/.test(labelOf(d)));
  ok(`${label} at least one numbers disclosure is on the screen`, numbers.length > 0);
  ok(`${label} the numbers disclosures follow the setting`,
    numbers.every((d) => d.hasAttribute('open') === open),
    numbers.map((d) => `${labelOf(d)}=${d.hasAttribute('open')}`).join(', '));
  const override = discs.filter((d) => labelOf(d) === 'Set the target myself');
  ok(`${label} the target override stays shut until it is used`,
    override.every((d) => !d.hasAttribute('open')));
  ok(`${label} the verdict is on the surface either way`,
    plan.querySelectorAll('.presc-explain').length > 0);
  ok(`${label} the numbers are reachable either way`,
    plan.textContent.includes('against a target of'));
}

/* ------------------------- 1b. nothing is gated behind a setting any more */

{
  // The grid and the dashboard table used to appear only in the detailed view.
  // Everyone gets them now, whichever way the disclosure setting is set.
  for (const open of [false, true]) {
    reset();
    store.updateSettings({ numbersOpen: open });
    select.invalidate();
    const label = open ? '[numbers open]' : '[numbers folded]';
    const c = ctx();
    const trained = c.stats.find((s) => s.entryCount > 0);

    openCard(trained.exercise.id);
    const plan = renderPlan(ctx());
    ok(`${label} the trade-off grid is always there`,
      plan.querySelectorAll('.cell-btn').length === 42);
    ok(`${label} so is the target override`,
      plan.textContent.includes('Set the target myself'));
    ok(`${label} and the upsell to a hidden mode is gone`,
      !plan.textContent.includes('Show the trade-off grid'));

    // And it opens itself once an override is actually in force.
    ui.setForExercise('plan.overrides', trained.exercise.id, { target: 999 });
    const withOverride = renderPlan(ctx());
    const od = withOverride.querySelectorAll('.disclose')
      .find((d) => ((d.querySelector('.disclose-label') || {}).textContent || '') === 'Set the target myself');
    ok(`${label} the target override opens when one is set`, !!od && od.hasAttribute('open'));
    ui.clearForExercise('plan.overrides', trained.exercise.id);

    ui.set('progress.listMode', 'table');
    clearSelection();
    const prog = renderProgress(ctx({ route: 'progress' }));
    ok(`${label} the dashboard table is always reachable`,
      prog.querySelectorAll('.data-table-wide').length === 1);
    ui.set('progress.listMode', 'cards');

    openExercise(trained.exercise.id);
    const detail = renderProgress(ctx({ route: 'progress' }));
    ok(`${label} the projections are always there`,
      detail.textContent.includes('Projected +12 wks'));
    clearSelection();
  }
}

/* ------------------------------------------------------- 2. the empty states */

{
  reset();
  store.clearAll();
  select.invalidate();
  const c = ctx();
  const plan = render('Next with an empty log', () => renderPlan(c));
  ok('an empty log invites a first set', plan && plan.textContent.includes('Nothing logged yet'));
  const prog = render('Progress with an empty log', () => renderProgress(ctx({ route: 'progress' })));
  ok('an empty Progress says so', prog && prog.textContent.includes('Nothing to show yet'));
  const log = render('Log with an empty log', () => renderLog(ctx({ route: 'log' })));
  ok('Log still works with no history', !!log);
}

/* ------------------------------------------ 3. the interactions that mutate */

{
  reset();
  const ex = store.getExercises()[0];
  const before = store.getEntries().length;

  setPrefill({ exerciseId: ex.id, date: TODAY, weight: 100, reps: 5, sets: 3 });
  const log = renderLog(ctx({ route: 'log' }));
  const save = log.querySelectorAll('.btn-primary').find((b) => /Log set|Save/.test(b.textContent));
  ok('the save button says what it will do', !!save, save ? save.textContent : 'not found');
  save.click();
  ok('tapping save logs a set', store.getEntries().length > before);

  const logged = store.entriesOn(ex.id, TODAY);
  ok('the set landed on the right lift and day', logged.length > 0);
  store.undo();
  ok('undo takes it back off', store.getEntries().length === before);
}

{
  reset();
  select.invalidate();
  const c = ctx();
  const trained = c.stats.find((s) => s.entryCount > 0);
  openCard(trained.exercise.id);
  const plan = renderPlan(ctx());
  const cells = plan.querySelectorAll('.cell-btn');
  ok('the open card draws the trade-off grid', cells.length === 42, `${cells.length} cells`);
  const was = refreshes;
  cells[10].click();
  ok('tapping a grid cell asks for a repaint', refreshes > was);
}

/* --------------------------------------------- 4. bindings update in place */

{
  reset();
  bindings.resetBindings();
  const node = globalThis.document.createElement('span');
  let value = 1;
  bindings.bindText(node, () => `${value} kg`);
  ok('a binding paints its initial value', node.textContent === '1 kg', node.textContent);
  value = 2;
  ok('a binding does not repaint until it is ticked', node.textContent === '1 kg');
  bindings.tick();
  await new Promise((r) => setTimeout(r, 10));
  ok('ticking repaints the bound node', node.textContent === '2 kg', node.textContent);

  // The point of all this: the node is the same node, so focus and animation
  // state survive a value change.
  const same = node;
  value = 3;
  bindings.tick();
  await new Promise((r) => setTimeout(r, 10));
  ok('the bound node keeps its identity', node === same && node.textContent === '3 kg');

  bindings.resetBindings();
  value = 4;
  bindings.tick();
  await new Promise((r) => setTimeout(r, 10));
  ok('a reset binding stops updating', node.textContent === '3 kg', node.textContent);
}

/* ------------------------------------------- 5. keyed patch keeps identity */

{
  const doc = globalThis.document;
  const parent = doc.createElement('div');
  const make = (item) => { const n = doc.createElement('i'); n.textContent = item.id; return n; };
  bindings.patch(parent, [{ id: 'a' }, { id: 'b' }], (i) => i.id, make);
  const [a, b] = parent.children;
  ok('patch renders the list', parent.children.length === 2);

  bindings.patch(parent, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], (i) => i.id, make);
  ok('patch appends without touching what was there',
    parent.children.length === 3 && parent.children[0] === a && parent.children[1] === b);

  bindings.patch(parent, [{ id: 'c' }, { id: 'a' }], (i) => i.id, make);
  ok('patch removes what is gone', parent.children.length === 2);
  ok('patch reorders what remains', parent.children[1] === a);
  ok('patch keeps identity across a reorder', parent.children[0].textContent === 'c');
}

/* ------------------------------------------------------- 6. the welcome tour */

{
  reset();
  let done = false;
  try {
    showWelcome({ onDone: () => { done = true; } });
    const overlay = globalThis.document.body.querySelector('.welcome');
    ok('the welcome tour mounts', !!overlay);
    ok('the tour offers a way out', !!overlay && overlay.querySelectorAll('button').length > 0);
  } catch (err) {
    ok('the welcome tour mounts', false, `threw ${err && err.message}`);
  }
  void done;
}

/* ------------------- 6b. the log form updates in place, not by re-rendering */

{
  reset();
  const ex = store.getExercises()[0];
  setPrefill({ exerciseId: ex.id, date: TODAY, weight: 100, reps: 5, sets: 3 });
  const c = ctx({ route: 'log' });
  const view = renderLog(c);

  const preview = view.querySelector('.preview');
  const save = view.querySelector('.btn-save');
  const plus = view.querySelectorAll('.stepper-btn')
    .find((b) => /Increase Weight/.test(b.getAttribute('aria-label') || ''));

  ok('the weight stepper has an increase button', !!plus);
  ok('the preview starts painted', !!preview && preview.textContent.length > 0);
  const label0 = save.textContent;
  const preview0 = preview.textContent;
  ok('the save button starts labelled with the set', /100/.test(label0), label0);

  const refreshesBefore = refreshes;
  plus.click();                                   // nudge the weight up one rung
  await settle();

  ok('nudging a stepper does NOT trigger a full re-render',
    refreshes === refreshesBefore, `${refreshes - refreshesBefore} refreshes`);
  ok('the preview is the same node', view.querySelector('.preview') === preview);
  ok('the save button is the same node', view.querySelector('.btn-save') === save);
  ok('the save button relabelled itself', save.textContent !== label0, save.textContent);
  ok('the new weight is in the label', /102\.5/.test(save.textContent), save.textContent);
  ok('the preview repainted', preview.textContent !== preview0);

  // The form is what actually moved, and it persisted on the way.
  ok('the form followed the stepper', Number(uistate.get('log.form', {}).weight) === 102.5,
    String(uistate.get('log.form', {}).weight));

  // Something the preview does not depend on must not repaint it.
  const steady = preview.textContent;
  c.tick();
  await settle();
  ok('ticking with nothing changed repaints nothing', preview.textContent === steady);
}

/* ------------------------------------------ 6c. the motion primitives */

// Nothing consumes these yet — the kinetic pass is later — but they are the
// substrate the live session score is going to be built on, so they get
// verified before anything depends on them.
{
  const motion = await import('../js/core/motion.js');
  const doc = globalThis.document;

  // Timings come off the CSS tokens. The shim's getComputedStyle returns
  // nothing, so this is really checking the fallbacks hold.
  ok('durations resolve to numbers',
    [motion.durations.fast, motion.durations.base, motion.durations.slow].every(Number.isFinite),
    `${motion.durations.fast}/${motion.durations.base}/${motion.durations.slow}`);
  ok('durations are in a sane order',
    motion.durations.fast < motion.durations.base && motion.durations.base < motion.durations.slow);
  ok('easings resolve to curves', /cubic-bezier/.test(motion.easings.out) && /cubic-bezier/.test(motion.easings.spring));

  // countUp lands on the target whatever route it takes.
  const n = doc.createElement('span');
  n.textContent = '100.0';
  motion.countUp(n, 118.3, { duration: 40, format: (v) => v.toFixed(1) });
  ok('countUp starts from where the node already was', n.textContent !== '118.3', n.textContent);
  await new Promise((r) => setTimeout(r, 120));
  ok('countUp lands exactly on the target', n.textContent === '118.3', n.textContent);

  // Interrupting mid-run must not snap backwards.
  motion.countUp(n, 90, { duration: 200, format: (v) => v.toFixed(1) });
  await new Promise((r) => setTimeout(r, 30));
  const mid = Number(n.textContent);
  motion.countUp(n, 130, { duration: 40, format: (v) => v.toFixed(1) });
  ok('a second countUp picks up mid-flight', Number.isFinite(mid) && mid < 118.3 && mid > 90, String(mid));
  await new Promise((r) => setTimeout(r, 120));
  ok('and still lands on the newest target', n.textContent === '130.0', n.textContent);

  // No animation to run: same value, or a value that was never a number.
  const same = doc.createElement('span');
  same.textContent = '42.0';
  motion.countUp(same, 42, { format: (v) => v.toFixed(1) });
  ok('countUp to the same value writes it straight out', same.textContent === '42.0');

  const blank = doc.createElement('span');
  motion.countUp(blank, 7, { format: (v) => v.toFixed(1) });
  ok('countUp from an empty node writes the target', blank.textContent === '7.0', blank.textContent);

  const bad = doc.createElement('span');
  motion.countUp(bad, NaN, { format: (v) => (Number.isFinite(v) ? v.toFixed(1) : '—') });
  ok('countUp handles a value that is not a number', bad.textContent === '—', bad.textContent);
  ok('countUp on nothing does not throw', (() => { try { motion.countUp(null, 5); return true; } catch { return false; } })());

  // spring/pulse need Web Animations, which the shim does not have — they must
  // decline rather than throw, exactly as they would on an old browser.
  ok('spring declines without Web Animations', motion.spring(doc.createElement('i')) === null);
  ok('pulse declines without Web Animations', motion.pulse(doc.createElement('i')) === null);
  ok('reduced-motion is reported', motion.prefersReducedMotion() === false);
}

/* ------------------------------------------- 6d. in-workout momentum */

// The session rail: the first view in the app of a session as a whole rather
// than one lift at a time.
{
  reset();
  const [a, b] = store.getExercises();
  store.logSet({ exerciseId: a.id, date: TODAY, weight: 100, reps: 5, rir: 3 });
  store.logSet({ exerciseId: a.id, date: TODAY, weight: 100, reps: 5, rir: 2 });
  store.logSet({ exerciseId: b.id, date: TODAY, weight: 60, reps: 8, rir: 2 });
  select.invalidate();
  setPrefill({ exerciseId: b.id, date: TODAY });

  const view = renderLog(ctx({ route: 'log' }));
  const rail = view.querySelector('.rail');
  ok('the rail appears once a session is under way', !!rail);

  const segs = rail.querySelectorAll('.rail-seg');
  ok('one segment per lift in the session', segs.length === 2, String(segs.length));
  ok('the lift you are on is the current one',
    segs.filter((n) => n.classList.contains('is-current')).length === 1);
  ok('and it is the right one',
    segs.find((n) => n.classList.contains('is-current')).textContent.includes(b.name));

  // The identity hues are not pairwise separable under deuteranopia, so a dot
  // may never be the only thing saying which lift a segment is.
  ok('every segment names its lift in words',
    segs.every((n) => n.querySelectorAll('.rail-seg-name').length === 1
      && n.querySelector('.rail-seg-name').textContent.trim().length > 1),
    'a segment identified by colour alone is unreadable to some users');

  ok('each segment counts its sets', segs.every((n) => /\d+/.test(n.querySelector('.rail-seg-count').textContent)));
  ok('the session total is a meter', rail.querySelectorAll('.rail-total-track').length === 1);
  ok('and it counts every set logged today', rail.textContent.includes('3 of'), rail.textContent.slice(0, 120));

  // Ordering is by when the first set actually happened, which is only knowable
  // because of the per-set log.
  ok('the lift trained first comes first', segs[0].textContent.includes(a.name),
    segs.map((n) => n.querySelector('.rail-seg-name').textContent).join(' | '));

  const was = refreshes;
  segs[0].click();
  ok('tapping a segment switches lift', refreshes > was);
  ok('and the form follows it', uistate.get('log.form', {}).exerciseId === a.id);
}

{
  reset();
  setPrefill({});
  const bare = renderLog(ctx({ route: 'log' }));
  ok('no session and no lift chosen means no rail', bare.querySelectorAll('.rail').length === 0);
}

// The set trace: the pill row with an axis on it.
{
  reset();
  const ex = store.getExercises()[0];
  store.logSet({ exerciseId: ex.id, date: TODAY, weight: 100, reps: 5, rir: 3 });
  store.logSet({ exerciseId: ex.id, date: TODAY, weight: 100, reps: 4, rir: 1 });
  select.invalidate();
  // The fixture date is in the past, and the live tracker is only for a session
  // happening now, so the mode is stated rather than inferred from the date.
  setPrefill({ exerciseId: ex.id, date: TODAY, weight: 100, reps: 5, sets: 4, mode: 'sets' });

  const c = ctx({ route: 'log' });
  const view = renderLog(c);
  const trace = view.querySelector('.chart-trace');
  ok('the trace replaces the pill row', !!trace && view.querySelectorAll('.set-pills').length === 0);

  const done = trace.querySelectorAll('.trace-bar').filter((n) => !n.classList.contains('is-next'));
  ok('one bar per set already done', done.length === 2, String(done.length));
  ok('a set that came up short of the plan is marked',
    done.filter((n) => n.classList.contains('is-short')).length === 1,
    'the 4-rep set against a 5-rep plan should read as short');
  ok('the set you are about to do is an outline',
    trace.querySelectorAll('.trace-bar.is-next').length === 1);
  ok('the sets still planned after it are placeholders',
    trace.querySelectorAll('.trace-slot').length === 1, String(trace.querySelectorAll('.trace-slot').length));

  ok('each set shows its RIR', trace.textContent.includes('RIR 3') && trace.textContent.includes('RIR 1'));
  ok('the rest between sets is shown', /\ds|\d:\d\d/.test(trace.textContent), trace.textContent);
  ok('the chart describes itself for a screen reader',
    /\d sets? of \d planned/.test(trace.querySelector('.trace-svg').getAttribute('aria-label') || ''),
    trace.querySelector('.trace-svg').getAttribute('aria-label'));

  // The pending bar follows the stepper without a re-render, same as the
  // preview and the button label.
  const nextBar = trace.querySelector('.trace-bar.is-next');
  const before = nextBar.getAttribute('d');
  const plus = view.querySelectorAll('.stepper-btn').find((n) => /Increase Reps/.test(n.getAttribute('aria-label') || ''));
  const refreshesBefore = refreshes;
  plus.click();
  await settle();
  ok('nudging the reps moves the pending bar', nextBar.getAttribute('d') !== before);
  ok('without re-rendering the view', refreshes === refreshesBefore);
  ok('and it is still the same node', view.querySelector('.trace-bar.is-next') === nextBar);
}

// Notes have been stored since the first version and never shown.
{
  reset();
  const ex = store.getExercises()[0];
  store.logSet({ exerciseId: ex.id, date: TODAY, weight: 80, reps: 5, notes: 'belt on, felt fast' });
  select.invalidate();
  setPrefill({ exerciseId: ex.id, date: TODAY });
  const view = renderLog(ctx({ route: 'log' }));
  ok('a note written at the rack is readable afterwards',
    view.querySelectorAll('.row-note').length === 1
    && view.querySelector('.row-note').textContent === 'belt on, felt fast');
}

/* -------------------------------------------- 6e. paths to progression */

const metrics = await import('../js/metrics.js');

/** Replace one lift's history with a steady climb, so the fit is worth using. */
function giveHistory(exerciseId, { weeks = 14, from = 72.5, perWeek = 1.15 } = {}) {
  const entries = store.getEntries().filter((e) => e.exerciseId !== exerciseId);
  let seq = 9000;
  for (let w = weeks - 1; w >= 0; w--) {
    for (const offset of [0, 3]) {
      entries.push({
        id: `h-${seq}`, date: metrics.isoAddDays(TODAY, -(w * 7 + offset)),
        exerciseId, weight: Math.round((from + (weeks - 1 - w) * perWeek) / 2.5) * 2.5,
        reps: 5, sets: 3, rir: offset ? 2 : 1, notes: '', seq: seq++,
      });
    }
  }
  store.importJSON(JSON.stringify({
    exercises: store.getExercises(), entries, settings: store.getSettings(),
  }));
  select.invalidate();
}

// --- a thin fit publishes a destination but refuses to date it ---
{
  reset();
  const c = ctx();
  const st = c.stats.find((s) => s.entryCount > 0);
  openExercise(st.exercise.id);
  const view = renderProgress(ctx({ route: 'progress' }));

  const track = view.querySelector('.milestone');
  ok('the next milestone is always named', !!track);
  ok('it is a round number on the bar', /\d+\s*kg/.test(track.querySelector('.milestone-value').textContent));
  ok('a thin fit says why it cannot be dated',
    /Needs a few more sessions/.test(track.querySelector('.milestone-eta').textContent),
    track.querySelector('.milestone-eta').textContent);
  ok('and the seed really is a thin fit', st.trendReliable === false);
  clearSelection();

  // The planner stays quiet rather than repeating "cannot say yet" per card.
  const plan = renderPlan(ctx());
  ok('no runway on the cards while nothing can be dated',
    plan.querySelectorAll('.milestone').length === 0);
}

// --- a real fit turns the projection into a destination and a date ---
{
  reset();
  const ex = store.getExercises()[0];
  giveHistory(ex.id);
  const c = ctx();
  const st = c.stats.find((s) => s.exercise.id === ex.id);
  ok('fourteen weeks of training is a fit worth extrapolating', st.trendReliable === true);

  openExercise(ex.id);
  const detail = renderProgress(ctx({ route: 'progress' }));
  const eta = detail.querySelector('.milestone-eta').textContent;
  ok('the milestone is now dated', /at this rate/.test(eta), eta);
  ok('and counted in sessions, not just days', /session/.test(eta), eta);
  const bar = detail.querySelector('.milestone-fill');
  ok('the track shows how far along the climb you are', /width:\d/.test(bar.getAttribute('style') || ''));
  clearSelection();

  openCard(ex.id);
  const plan = renderPlan(ctx());
  const compact = plan.querySelectorAll('.milestone.is-compact');
  ok('the planner card now carries a runway', compact.length === 1, String(compact.length));
  ok('and it names the same target',
    compact[0].querySelector('.milestone-value').textContent
      === detail.querySelector('.milestone-value').textContent);

  // Both screens must date it from the app's `today`, not the wall clock.
  ok('the planner and the lift detail agree on the date',
    compact[0].querySelector('.milestone-eta').textContent === eta,
    `plan: ${compact[0].querySelector('.milestone-eta').textContent}\n     detail: ${eta}`);
}

// --- what a lift is worth today, once a layoff has taken something off it ---
{
  reset();
  const ex = store.getExercises()[0];
  // Train hard for months, then stop for three of them.
  giveHistory(ex.id, { weeks: 14 });
  const shifted = store.getEntries().map((e) => (e.exerciseId === ex.id
    ? { ...e, date: metrics.isoAddDays(e.date, -90) } : e));
  store.importJSON(JSON.stringify({
    exercises: store.getExercises(), entries: shifted, settings: store.getSettings(),
  }));
  select.invalidate();

  const st = ctx().stats.find((s) => s.exercise.id === ex.id);
  ok('the lift reads as detraining', st.readiness.phase.key === 'detrained', st.readiness.phase.key);

  openExercise(ex.id);
  const view = renderProgress(ctx({ route: 'progress' }));
  const note = view.querySelector('.baseline-note');
  ok('a detrained lift says what it is worth today', !!note, 'readiness.baseline is still invisible');
  ok('and that is less than what was last lifted',
    st.readiness.baseline < st.lastAdj - 1e-9);
  ok('the note gives the number', /\d+\.\d\s*kg/.test(note.textContent), note.textContent);
  ok('and says how much time off cost', /% off it/.test(note.textContent), note.textContent);
  clearSelection();
}

{
  // A lift trained this week must not be told it has lost anything.
  reset();
  const ex = store.getExercises()[0];
  giveHistory(ex.id);
  openExercise(ex.id);
  const view = renderProgress(ctx({ route: 'progress' }));
  ok('a lift in regular training gets no layoff note',
    view.querySelectorAll('.baseline-note').length === 0);
  clearSelection();
}

/* ------------------------------------- 7. view state survives a reload */

{
  reset();
  const ex = store.getExercises()[1];

  // Half-fill the form, the way someone standing at the rack would.
  setPrefill({ exerciseId: ex.id, date: TODAY, weight: 82.5, reps: 6, sets: 4 });
  renderLog(ctx({ route: 'log' }));

  const saved = uistate.get('log.form', null);
  ok('the log form is written to view state as it is filled in', !!saved);
  ok('the saved form keeps the lift', saved && saved.exerciseId === ex.id);
  ok('the saved form keeps the weight', saved && saved.weight === 82.5, String(saved && saved.weight));
  ok('the saved form keeps the reps', saved && saved.reps === 6);

  // uistate debounces its writes; a reload reads the bytes, so check the bytes.
  await new Promise((r) => setTimeout(r, 200));
  const raw = globalThis.sessionStorage.getItem('liftingTracker.ui');
  ok('view state reaches sessionStorage', !!raw && raw.includes('log.form'));
  ok('and it is the form that was typed', !!raw && raw.includes('82.5'));

}

{
  // Rehydration: prove renderLog reads the form back out of view state rather
  // than out of its own module scope. The store is reloaded and the module's
  // cached form is dropped, but sessionStorage is deliberately left alone.
  const ex = store.getExercises()[2];
  setPrefill({ exerciseId: ex.id, date: TODAY, weight: 47.5, reps: 9, sets: 2 });
  // Writes are debounced; flush before reading the bytes a reload would see.
  uistate.flush();
  const stashed = globalThis.sessionStorage.getItem('liftingTracker.ui');
  ok('flush writes straight through the debounce', stashed.includes('47.5'));

  // A page load: the modules forget everything, sessionStorage does not.
  store.reload();
  select.invalidate();
  clearForm();
  globalThis.sessionStorage.setItem('liftingTracker.ui', stashed);
  uistate.rehydrate();

  const back = renderLog(ctx({ route: 'log' }));
  const fields = back.querySelectorAll('.stepper-input').map((n) => n.value);
  ok('a reload puts the half-typed weight back', fields.includes('47.5'), fields.join(', '));
  ok('a reload puts the half-typed reps back', fields.includes('9'), fields.join(', '));
  ok('and it remembers which lift it was for',
    back.querySelectorAll('.chip-lift.is-selected').length === 1);
}

{
  // The other half: a lift deleted underneath a form must not crash the screen.
  reset();
  const ex = store.getExercises()[0];
  setPrefill({ exerciseId: ex.id, date: TODAY });
  renderLog(ctx({ route: 'log' }));
  store.deleteExercise(ex.id);
  select.invalidate();
  const after = render('Log after its lift was deleted', () => renderLog(ctx({ route: 'log' })));
  ok('a deleted lift drops back to the picker',
    after && after.textContent.includes('Pick a lift to log'));
}

{
  // Plan and Progress keep their place too.
  reset();
  const c = ctx();
  const trained = c.stats.find((s) => s.entryCount > 0);
  openCard(trained.exercise.id);
  ok('the open card is remembered', uistate.get('plan.openId', undefined) === trained.exercise.id);

  openExercise(trained.exercise.id);
  ok('the drilled-in lift is remembered', uistate.get('progress.selectedId', null) === trained.exercise.id);
  clearSelection();
  ok('and clearing it is remembered', uistate.get('progress.selectedId', null) === null);
}

/* --------------------------------------------- 8. the app actually boots */

// app.js is the only module with side effects at import time, so it is imported
// last and only once. This is the whole loop: ctx() -> draw() -> a view -> the
// tab bar -> the action button.
{
  reset();
  const doc = globalThis.document;
  const main = doc.createElement('main');
  main.setAttribute('id', 'main');
  const tabbar = doc.createElement('nav');
  tabbar.setAttribute('id', 'tabbar');
  doc.body.append(main, tabbar);

  let booted = true;
  try {
    await import('../js/app.js');
  } catch (err) {
    booted = false;
    ok('the app boots', false, `threw ${err && err.message}`);
  }

  if (booted) {
    ok('the app boots', true);
    await settle();
    ok('it lands on the Next screen', main.querySelectorAll('.view-plan').length === 1);
    ok('it paints the tab bar', tabbar.querySelectorAll('.tab').length === 4);
    ok('one tab is current',
      tabbar.querySelectorAll('.tab').filter((t) => t.getAttribute('aria-current') === 'page').length === 1);
    ok('the action button is offered', doc.body.querySelectorAll('.fab').length === 1);

    // Switching tabs must actually swap the view.
    const progressTab = tabbar.querySelectorAll('.tab').find((t) => t.textContent.includes('Progress'));
    progressTab.click();
    await settle();
    ok('tapping a tab switches the view', main.querySelectorAll('.view-progress').length === 1);
    ok('and the action button follows you there', doc.body.querySelectorAll('.fab').length === 1);

    const logTab = tabbar.querySelectorAll('.tab').find((t) => t.textContent.trim().startsWith('Log'));
    logTab.click();
    await settle();
    ok('the Log tab renders through the loop', main.querySelectorAll('.view-log').length === 1);
    ok('the action button hides on the screen it points at',
      doc.body.querySelectorAll('.fab').length === 0);
  }
}

/* ---------------------------- 8b. the band colours: one contract, two files */

// The verdict tints moved from a class per band to a data attribute, so the
// stylesheet and the planner now agree through data-band. If they drift, every
// cell in the trade-off grid silently reads grey — which looks deliberate.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(root, 'css', 'app.css'), 'utf8');
  const M = await import('../js/metrics.js');

  const styled = new Set([...css.matchAll(/\[data-band="([a-z]+)"\]/g)].map((m) => m[1]));
  for (const key of Object.keys(M.BANDS)) {
    ok(`the stylesheet colours the "${key}" verdict`, styled.has(key));
  }
  for (const key of styled) {
    ok(`the stylesheet does not colour a verdict that no longer exists: ${key}`,
      Object.keys(M.BANDS).includes(key));
  }
  ok('the tint is defined once, not per consumer',
    !/\.is-(ideal|stretch|toobig|beaten|return)/.test(css),
    'a per-band class rule survived the refactor');

  reset();
  select.invalidate();
  const c = ctx();
  const trained = c.stats.find((s) => s.entryCount > 0);
  openCard(trained.exercise.id);
  const plan = renderPlan(ctx());

  const cells = plan.querySelectorAll('.cell');
  ok('every grid cell declares its verdict',
    cells.length === 42 && cells.every((n) => !!n.dataset.band), `${cells.length} cells`);
  ok('and every verdict it declares is a real one',
    cells.every((n) => Object.keys(M.BANDS).includes(n.dataset.band)));
  ok('the legend declares its verdicts too',
    plan.querySelectorAll('.legend-item').every((n) => styled.has(n.dataset.band)));
  const chips = plan.querySelectorAll('.band-chip');
  ok('the verdict chips declare theirs', chips.length > 0 && chips.every((n) => !!n.dataset.band));
  ok('the pick marker still rides alongside the verdict',
    cells.filter((n) => n.classList.contains('is-pick')).length === 1);
}

/* ------------------------------------------- 9. the offline shell is complete */

// sw.js keeps a hand-written list of every file to precache. A module missing
// from it is not a build error and not a runtime error — the app simply stops
// working offline, quietly, for the people who installed it. So the list is
// checked against the disk rather than against anyone's memory.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);

  ok('sw.js declares a shell', shell.length > 5);
  for (const rel of shell) {
    if (rel === './') continue;
    ok(`shell file exists: ${rel}`, existsSync(join(root, rel.slice(2))));
  }

  const listed = new Set(shell);
  const jsFiles = [];
  const sweep = (dir) => {
    for (const name of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${name.name}`;
      if (name.isDirectory()) sweep(rel);
      else if (name.name.endsWith('.js')) jsFiles.push(`./${relative('.', rel)}`);
    }
  };
  sweep('js');
  for (const f of jsFiles) {
    ok(`precached: ${f}`, listed.has(f), 'add it to SHELL in sw.js and bump CACHE');
  }
  ok('the stylesheet is precached', listed.has('./css/app.css'));
  ok('the shell is versioned', /const CACHE = 'lifting-tracker-v\d+'/.test(sw));
}

/* ------------------------------------------------------------------ report */

console.log(`\n${pass} view checks passed`);
if (failures.length) {
  console.error(`${failures.length} FAILED:`);
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log('Every screen renders, and the bindings update without rebuilding.\n');
