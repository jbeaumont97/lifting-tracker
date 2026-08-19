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
    simple: settings.detailLevel !== 'detailed',
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

for (const level of ['simple', 'detailed']) {
  reset();
  store.updateSettings({ detailLevel: level });
  const c = ctx();
  const label = `[${level}]`;

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
  store.updateSettings({ detailLevel: 'detailed' });
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
