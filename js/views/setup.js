// views/setup.js — the Exercises and Settings sheets, plus backup/restore.
// Everything here is stored on this device only; nothing is ever sent anywhere.

import { el, stepper, chipGroup, segmented, toast, sheet, confirmSheet, details, chevron, accentDot } from '../ui.js';
import * as store from '../store.js';
import { showWelcome } from './welcome.js';
import { fmt, setBonus, READY_AT, fatigueAt, retentionAt, readinessSettings } from '../metrics.js';

export function renderSetup(ctx) {
  const { settings } = ctx;
  const root = el('section', { class: 'view view-setup' });
  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: 'Setup' }),
    el('p', { class: 'view-sub', text: 'Your lifts, the maths behind the numbers, and your backups. All of it stays on this iPhone.' }),
  ]));

  /* ------------------------------------------------------- how much detail */
  root.append(el('h2', { class: 'section-title', text: 'How much to show' }));
  root.append(el('div', { class: 'card card-pad' }, [
    el('div', { class: 'field-block' }, [
      el('span', { class: 'field-label', text: 'Detail level' }),
      segmented({
        label: 'Detail level', value: settings.detailLevel === 'detailed' ? 'detailed' : 'simple',
        options: [{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }],
        onChange: (v) => { store.updateSettings({ detailLevel: v }); ctx.refresh({ transition: true }); },
      }),
      el('p', { class: 'field-hint', text: 'Simple gives you the prescription and how big a step it is, in plain words. Detailed adds the e1RM maths, the target every suggestion is measured against, the sets-against-weight grid and the projections. Nothing is calculated differently — it is only what gets shown.' }),
    ]),
    el('div', { class: 'lever-row lever-row-half' }, [
      stepper({ label: 'Rest timer (seconds)', value: settings.restSeconds, step: 15, min: 0, max: 900, dp: 0, id: 'set-rest',
        onChange: (v) => { store.updateSettings({ restSeconds: v }); ctx.refresh(); } }),
    ]),
    el('p', { class: 'field-hint', text: 'Saving a set dated today starts a rest clock above the tab bar; it keeps counting past the target rather than stopping. Set it to 0 to turn the timer off.' }),
  ]));

  /* ---------------------------------------------------------- exercises */
  root.append(el('h2', { class: 'section-title', text: 'Your lifts' }));
  const list = el('div', { class: 'card-list' });
  const exercises = store.getExercises();
  for (const [i, ex] of exercises.entries()) list.append(exerciseCard(ex, i, exercises.length, ctx));
  root.append(list);
  root.append(el('p', { class: 'field-hint', text: 'Tap a lift to change its step, weekly gain and set targets.' }));
  root.append(el('button', {
    type: 'button', class: 'btn btn-primary btn-block',
    onclick: () => addSheet(ctx),
  }, ['Add a lift']));
  root.append(details('How to set these up', [
    el('p', { text: 'Starting weight is the lightest this lift can be: the empty bar, or the lowest pin on a stack. Weight step is the smallest increment on top of that. Together they define the loads that exist — a 20 kg bar with 2.5 kg steps means 20, 22.5, 25 and so on, and nothing in between. Leave the starting weight at 0 for dumbbells or anything where the step alone describes it.' }),
    el('p', { text: 'Weight step is the smallest increment you can actually load — every suggestion is rounded up to the next rung. Target gain per week is roughly 1.0% if you are new, 0.5% at intermediate, 0.2% once advanced.' }),
    el('p', { text: 'Sets per session is the set count the planner assumes when it recommends a weight. Sets per week is your working-set budget for that lift; Progress flags you under, on, or over it. Roughly 10–20 hard sets per muscle per week is the common recommendation, spread across every lift that trains it — so these per-lift numbers should add up to that, not each hit it.' }),
  ]));

  /* ----------------------------------------------------------- settings */
  root.append(el('h2', { class: 'section-title', text: 'The maths' }));
  const s = settings;
  const mathsCard = el('div', { class: 'card card-pad' }, [
    el('div', { class: 'field-block' }, [
      el('span', { class: 'field-label', text: 'e1RM formula' }),
      chipGroup({
        label: 'Formula', value: s.formula,
        options: [{ value: 'epley', label: 'Epley' }, { value: 'brzycki', label: 'Brzycki' }],
        onChange: (v) => { store.updateSettings({ formula: v }); ctx.refresh(); },
      }),
      el('p', { class: 'field-hint', text: 'Epley: w × (1 + reps/30). Brzycki: w × 36/(37 − reps), which reads lower at high reps. Epley is the common default.' }),
    ]),
    el('div', { class: 'lever-row' }, [
      stepper({ label: 'Set bonus k', value: s.setBonusK, step: 0.01, min: 0, max: 0.3, dp: 2, id: 'set-k',
        onChange: (v) => { store.updateSettings({ setBonusK: v }); ctx.refresh(); } }),
      stepper({ label: 'Trend lookback (days)', value: s.lookbackDays, step: 7, min: 14, max: 365, dp: 0, id: 'set-look',
        onChange: (v) => { store.updateSettings({ lookbackDays: v }); ctx.refresh(); } }),
    ]),
    el('p', { class: 'field-hint', text: `Adj e1RM = e1RM × (1 + k × ln(sets)). At k = ${s.setBonusK}: 2 sets ${pct(setBonus(2, s.setBonusK))}, 3 sets ${pct(setBonus(3, s.setBonusK))}, 5 sets ${pct(setBonus(5, s.setBonusK))}. Set k to 0 to ignore sets entirely.` }),
    el('div', { class: 'lever-row' }, [
      stepper({ label: 'Ideal band (%)', value: s.idealBand * 100, step: 0.5, min: 0, max: 20, dp: 1, id: 'set-ideal',
        onChange: (v) => { store.updateSettings({ idealBand: v / 100 }); ctx.refresh(); } }),
      stepper({ label: 'Stretch band (%)', value: s.stretchBand * 100, step: 0.5, min: 0, max: 30, dp: 1, id: 'set-stretch',
        onChange: (v) => { store.updateSettings({ stretchBand: v / 100 }); ctx.refresh(); } }),
    ]),
    el('p', { class: 'field-hint', text: 'Where the planner’s colour bands fall, as a percentage over your target. Widen the ideal band if the green options feel too timid; narrow it if you keep missing reps.' }),
    el('div', { class: 'lever-row' }, [
      stepper({ label: 'Default weight step', value: s.defaultStep, step: 0.5, min: 0.5, max: 25, dp: 1, id: 'set-step',
        onChange: (v) => { store.updateSettings({ defaultStep: v }); ctx.refresh(); } }),
      stepper({ label: 'Default gain (%/week)', value: s.defaultGainPerWeek * 100, step: 0.05, min: 0, max: 5, dp: 2, id: 'set-gain',
        onChange: (v) => { store.updateSettings({ defaultGainPerWeek: v / 100 }); ctx.refresh(); } }),
    ]),
  ]);

  /* --------------------------------- fatigue, recovery and detraining */
  const on = s.readiness !== 'off';
  const readinessCard = el('div', { class: 'card card-pad' }, [
    el('div', { class: 'field-block' }, [
      el('span', { class: 'field-label', text: 'Account for the gap between sessions' }),
      segmented({
        label: 'Readiness model', value: on ? 'on' : 'off',
        options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
        onChange: (v) => { store.updateSettings({ readiness: v }); ctx.refresh({ transition: true }); },
      }),
      el('p', { class: 'field-hint', text: 'On, your weekly gain is earned by the week: train a lift twice in a week and each session asks for half of it, not all of it. On top of that the planner subtracts fatigue still owed to your last session, and — after a real layoff — the strength you will have lost. Off puts back the flat step of the original spreadsheet: last session plus the full weekly gain, whether that was yesterday or in March.' }),
    ]),
    !on ? null : el('div', {}, [
      el('div', { class: 'lever-row' }, [
        stepper({ label: 'Fatigue after a session (%)', value: s.fatiguePeak * 100, step: 0.5, min: 0, max: 25, dp: 1, id: 'set-fpeak',
          onChange: (v) => { store.updateSettings({ fatiguePeak: v / 100 }); ctx.refresh(); } }),
        stepper({ label: 'Recovery time constant (days)', value: s.fatigueTau, step: 0.5, min: 0.5, max: 10, dp: 1, id: 'set-ftau',
          onChange: (v) => { store.updateSettings({ fatigueTau: v }); ctx.refresh(); } }),
      ]),
      el('p', { class: 'field-hint', text: `A normal hard session costs you ${pct1(s.fatiguePeak)} on the day, decaying by 1/e every ${fmt(s.fatigueTau, 1)} days: ${fatigueLadder(s)}. More sets or a lower RIR scale the peak up, fewer or a higher RIR scale it down. A lift counts as ready once the deficit falls under ${pct1(READY_AT)}.` }),
      el('div', { class: 'lever-row' }, [
        stepper({ label: 'Productive rest (days)', value: s.productiveDays, step: 1, min: 1, max: 60, dp: 0, id: 'set-prod',
          onChange: (v) => { store.updateSettings({ productiveDays: v }); ctx.refresh(); } }),
        stepper({ label: 'Grace before detraining (days)', value: s.graceDays, step: 1, min: 1, max: 90, dp: 0, id: 'set-grace',
          onChange: (v) => { store.updateSettings({ graceDays: v }); ctx.refresh(); } }),
      ]),
      el('p', { class: 'field-hint', text: 'Rest past the productive window stops adding fitness; time past the grace period starts taking it away. Both stretch to fit how you actually train a lift — if your normal gap is a fortnight, nothing counts as a layoff at fifteen days.' }),
      el('div', { class: 'lever-row' }, [
        stepper({ label: 'Detraining half-life (days)', value: s.detrainHalfLife, step: 7, min: 7, max: 180, dp: 0, id: 'set-half',
          onChange: (v) => { store.updateSettings({ detrainHalfLife: v }); ctx.refresh(); } }),
        stepper({ label: 'Strength you keep (%)', value: s.retainedFloor * 100, step: 1, min: 0, max: 100, dp: 0, id: 'set-floor',
          onChange: (v) => { store.updateSettings({ retainedFloor: v / 100 }); ctx.refresh(); } }),
      ]),
      el('p', { class: 'field-hint', text: `Past the grace period the losable part of your strength halves every ${fmt(s.detrainHalfLife, 0)} days, toward a floor of ${pct1(s.retainedFloor)} that a layoff never takes: ${detrainLadder(s)}.` }),
    ]),
  ]);
  root.append(ctx.simple ? details('Fatigue, recovery and detraining', [readinessCard]) : readinessCard);
  // In the simple view these dials are still all here — just folded away, so
  // the page is not a wall of coefficients on first read.
  root.append(ctx.simple ? details('Tune the formulas', [mathsCard]) : mathsCard);

  root.append(el('div', { class: 'field-block' }, [
    el('span', { class: 'field-label', text: 'Appearance' }),
    segmented({
      label: 'Theme', value: store.getTheme(),
      options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: (v) => store.setTheme(v),
    }),
  ]));

  /* --------------------------------------------------------- your data */
  root.append(el('h2', { class: 'section-title', text: 'Your data' }));
  const counts = { ex: store.getExercises().length, en: store.getEntries().length };
  root.append(el('div', { class: 'card card-pad' }, [
    el('p', { class: 'card-note', text: `${counts.en} logged entries across ${counts.ex} lifts, saved in this device’s local storage. Take a backup now and then — clearing Safari’s website data would wipe it.` }),
    el('div', { class: 'btn-grid' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => shareFile(`lifting-tracker-${today()}.json`, store.exportJSON(), 'application/json') }, ['Back up (JSON)']),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => shareFile(`lifting-log-${today()}.csv`, store.exportCSV(), 'text/csv') }, ['Export log (CSV)']),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => importPicker(ctx) }, ['Restore a backup']),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => resetSheet(ctx) }, ['Reset options']),
    ]),
  ]));

  /* ------------------------------------------------------------ how to */
  root.append(el('h2', { class: 'section-title', text: 'How this works' }));
  root.append(details('Logging', [
    el('p', { text: 'Two ways in, and they store the same thing. Set by set logs the set you have just finished and starts the rest clock; all at once writes up a session that is already over. Sets that match on weight and reps are counted onto one row either way, so 3×5 at 100 kg is a single entry however you typed it.' }),
    el('p', { text: 'Drop the reps before your last set and it is recorded as it happened: four sets of five plus one of four is stored as two rows, and the session is scored on the four honest sets rather than being dragged down to the short one or rounded up past it.' }),
    el('p', { text: 'RIR and notes are recorded per set. Where sets are counted onto one row, that row keeps the lowest RIR — the set that came closest to failure — and collects the notes.' }),
    el('p', { text: 'For a ramping or pyramid session, just log each set: the different loads become their own rows on their own.' }),
  ]));
  root.append(details('Reading the plan', [
    el('p', { text: 'Grey means you have already beaten that session, so it is not progression. Green is the smallest honest step forward. Amber is a stretch — ambitious but usually doable. Red means the jump is big enough that you will probably miss reps. Aim for green on most sessions and take amber when you are feeling strong.' }),
    el('p', { text: 'Sets are a progression lever in their own right, and the cheapest one. Going 3×5 to 4×5 at the same weight raises adjusted e1RM by about 1.4% at k = 0.05 — less than adding 2.5 kg to a 100 kg squat, and it adds real work. The usual order is reps first, then weight, then sets.' }),
  ]));
  root.append(details('What to watch out for', [
    el('p', { text: 'e1RM formulas drift above roughly 10–12 reps and will overestimate. Keep comparisons inside 1–10 reps where you can.' }),
    el('p', { text: 'A set taken to failure and a set with 3 reps left produce the same e1RM but are not the same session. That is what RIR is for — log it, and read the trend with it in mind.' }),
    el('p', { text: 'The set bonus is a heuristic. There is no agreed formula for folding sets into one strength number, so treat k as a dial you tune to your own training rather than a constant to trust.' }),
    el('p', { text: 'Projections are straight lines. Real progress is roughly linear for a few months and then flattens, so the +12 week figure is a ceiling, not a forecast. The trend is only honest if your set count is reasonably stable.' }),
  ]));

  // Only worth saying while the app is still running in a browser tab.
  const standalone = window.navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches;
  if (!standalone) {
    root.append(details('Add it to your Home Screen', [
      el('p', { text: 'Tap the Share button in Safari, scroll down, and choose “Add to Home Screen”. It then launches full-screen, keeps working with no signal, and iOS stops treating its data as a disposable browser cache.' }),
      el('p', { text: 'Open it from the Home Screen icon after that, rather than from a Safari tab.' }),
    ]));
  }

  root.append(el('button', {
    type: 'button', class: 'btn btn-ghost btn-block',
    onclick: () => showWelcome({ onDone: () => ctx.refresh({ transition: true }) }),
  }, ['Show the welcome tour again']));

  root.append(el('p', { class: 'foot-note', text: 'Lifting Tracker · built from your spreadsheet · works offline · no accounts, no network, no tracking.' }));
  return root;
}

/** "20, 22.5, 25 …" — the first few loads this lift can actually be set to. */
function ladderExample(ex) {
  const rungs = [0, 1, 2].map((n) => fmt(ex.base + n * ex.step, 1).replace(/\.0$/, ''));
  return rungs.join(', ') + ' …';
}

function pct(mult) {
  return `+${((mult - 1) * 100).toFixed(1)}%`;
}

function pct1(fraction) {
  return `${(Number(fraction) * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/** "day 1 −3.1%, day 2 −1.6%, day 3 recovered" — the dials, made concrete. */
function fatigueLadder(settings) {
  const rs = readinessSettings(settings);
  return [1, 2, 3, 4]
    .map((d) => {
      const f = fatigueAt(d, 1, rs);
      return `day ${d} ${f > 0 ? '−' + (f * 100).toFixed(1) + '%' : 'spent'}`;
    })
    .join(', ');
}

/** "4 weeks −5.2%, 8 weeks −12.5%, 6 months −23.4%". */
function detrainLadder(settings) {
  const rs = readinessSettings(settings);
  return [['4 weeks', 28], ['8 weeks', 56], ['6 months', 182]]
    .map(([label, d]) => `${label} ${'−' + ((1 - retentionAt(d, rs.graceDays, rs)) * 100).toFixed(1)}%`)
    .join(', ');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

let openExerciseId = null;

function exerciseCard(ex, index, total, ctx) {
  const isOpen = openExerciseId === ex.id;
  const body = el('div', { class: 'card-body' }, [
    el('div', { class: 'lever-row' }, [
      stepper({ label: 'Starting weight', value: ex.base, step: 0.5, min: 0, max: 200, dp: 1, id: `bs-${ex.id}`,
        onChange: (v) => { store.updateExercise(ex.id, { base: v }); ctx.refresh(); } }),
      stepper({ label: 'Weight step', value: ex.step, step: 0.1, min: 0.1, max: 25, dp: 1, id: `st-${ex.id}`,
        onChange: (v) => { store.updateExercise(ex.id, { step: v }); ctx.refresh(); } }),
    ]),
    el('p', { class: 'field-hint', text: ex.base > 0
      ? `Loads are ${fmt(ex.base, 1).replace('.0', '')} kg and up, in ${fmt(ex.step, 1).replace('.0', '')} kg steps — ${ladderExample(ex)}.`
      : 'Starting weight is the empty bar, or the lightest pin on the stack. Leave it at 0 if anything is loadable.' }),
    el('div', { class: 'lever-row' }, [
      stepper({ label: 'Gain %/week', value: ex.gainPerWeek * 100, step: 0.05, min: 0, max: 5, dp: 2, id: `gn-${ex.id}`,
        onChange: (v) => { store.updateExercise(ex.id, { gainPerWeek: v / 100 }); ctx.refresh(); } }),
      stepper({ label: 'Sets / session', value: ex.setsPerSession, step: 1, min: 1, max: 12, dp: 0, id: `ss-${ex.id}`,
        onChange: (v) => { store.updateExercise(ex.id, { setsPerSession: v }); ctx.refresh(); } }),
    ]),
    el('div', { class: 'lever-row lever-row-half' }, [
      stepper({ label: 'Sets / week', value: ex.setsPerWeek, step: 1, min: 0, max: 60, dp: 0, id: `sw-${ex.id}`,
        onChange: (v) => { store.updateExercise(ex.id, { setsPerWeek: v }); ctx.refresh(); } }),
    ]),
    el('div', { class: 'card-actions card-actions-end' }, [
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: index === 0, onclick: () => { store.moveExercise(ex.id, -1); ctx.refresh(); } }, ['↑ Up']),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: index === total - 1, onclick: () => { store.moveExercise(ex.id, 1); ctx.refresh(); } }, ['↓ Down']),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => renameSheet(ex, ctx) }, ['Rename']),
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => {
        const n = store.getEntries().filter((e) => e.exerciseId === ex.id).length;
        confirmSheet({
          title: `Delete ${ex.name}?`,
          message: n ? `Its ${n} logged entries go with it. You can undo straight afterwards.` : 'It has no logged entries.',
          onConfirm: () => { store.deleteExercise(ex.id); ctx.refresh(); toast(`${ex.name} deleted`, { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' }); },
        });
      } }, ['Delete']),
    ]),
  ]);

  return el('article', { class: `card${isOpen ? ' is-open' : ''}` }, [
    el('button', {
      type: 'button', class: 'card-head', 'aria-expanded': isOpen ? 'true' : 'false',
      onclick: () => { openExerciseId = isOpen ? null : ex.id; ctx.refresh({ transition: true }); },
    }, [
      accentDot(ex.id),
      el('div', { class: 'card-head-main' }, [
        el('h3', { class: 'card-title', text: ex.name }),
        el('p', { class: 'card-meta', text: (ex.base > 0 ? `from ${fmt(ex.base, 1).replace('.0', '')} kg · ` : '')
          + `${fmt(ex.step, 1).replace('.0', '')} kg steps · ${(ex.gainPerWeek * 100).toFixed(2)}%/wk · ${ex.setsPerSession} sets/session · ${ex.setsPerWeek}/week` }),
      ]),
      chevron(),
    ]),
    isOpen ? body : null,
  ]);
}

function renameSheet(ex, ctx) {
  const input = el('input', { type: 'text', class: 'text-input', value: ex.name, 'aria-label': 'Exercise name' });
  sheet({
    title: 'Rename lift',
    body: [el('div', { class: 'field-block' }, [el('span', { class: 'field-label', text: 'Name' }), input])],
    actions: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Save', className: 'btn-primary', onClick: () => { store.updateExercise(ex.id, { name: input.value }); ctx.refresh(); } },
    ],
  });
}

function addSheet(ctx) {
  const s = ctx.settings;
  const draft = { name: '', base: 0, step: s.defaultStep, gainPerWeek: s.defaultGainPerWeek, setsPerSession: 3, setsPerWeek: 15 };
  const input = el('input', { type: 'text', class: 'text-input', placeholder: 'e.g. Romanian deadlift', 'aria-label': 'Exercise name' });
  input.addEventListener('input', () => { draft.name = input.value; });
  sheet({
    title: 'Add a lift',
    body: [
      el('div', { class: 'field-block' }, [el('span', { class: 'field-label', text: 'Name' }), input]),
      el('div', { class: 'lever-row' }, [
        stepper({ label: 'Starting weight', value: draft.base, step: 0.5, min: 0, max: 200, dp: 1, id: 'new-base', onChange: (v) => { draft.base = v; } }),
        stepper({ label: 'Weight step', value: draft.step, step: 0.1, min: 0.1, max: 25, dp: 1, id: 'new-step', onChange: (v) => { draft.step = v; } }),
      ]),
      el('p', { class: 'field-hint', text: 'Starting weight is the empty bar, or the lightest pin on the stack — every suggestion is that plus a whole number of steps. Leave it at 0 if anything is loadable.' }),
      el('div', { class: 'lever-row lever-row-half' }, [
        stepper({ label: 'Gain %/week', value: draft.gainPerWeek * 100, step: 0.05, min: 0, max: 5, dp: 2, id: 'new-gain', onChange: (v) => { draft.gainPerWeek = v / 100; } }),
      ]),
      el('div', { class: 'lever-row' }, [
        stepper({ label: 'Sets / session', value: draft.setsPerSession, step: 1, min: 1, max: 12, dp: 0, id: 'new-ss', onChange: (v) => { draft.setsPerSession = v; } }),
        stepper({ label: 'Sets / week', value: draft.setsPerWeek, step: 1, min: 0, max: 60, dp: 0, id: 'new-sw', onChange: (v) => { draft.setsPerWeek = v; } }),
      ]),
    ],
    actions: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Add', className: 'btn-primary', onClick: () => {
        if (!draft.name.trim()) { toast('Give the lift a name.'); return true; }
        store.addExercise(draft); ctx.refresh(); toast(`${draft.name.trim()} added`);
      } },
    ],
  });
}

function resetSheet(ctx) {
  sheet({
    title: 'Reset options',
    body: [el('p', { class: 'sheet-text', text: 'Both of these can be undone immediately afterwards from the toast.' })],
    actions: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Clear log only', className: 'btn-ghost', onClick: () => {
        confirmSheet({ title: 'Clear every logged entry?', message: 'Your lifts and settings stay. The log is emptied.', confirmLabel: 'Clear log',
          onConfirm: () => { store.clearAll(); ctx.refresh(); toast('Log cleared', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' }); } });
      } },
      { label: 'Back to spreadsheet data', className: 'btn-danger', onClick: () => {
        confirmSheet({ title: 'Reload the spreadsheet data?', message: 'Everything is replaced by the lifts, sessions and settings imported from Lifting Tracker.xlsx.', confirmLabel: 'Reload',
          onConfirm: () => { store.resetToSeed(); ctx.refresh(); toast('Spreadsheet data reloaded', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' }); } });
      } },
    ],
  });
}

/* ------------------------------------------------------- backup plumbing */

/** Share on iOS (which is how a file reaches Files/iCloud), download elsewhere. */
async function shareFile(filename, content, type) {
  const file = new File([content], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup saved to your downloads.');
}

function importPicker(ctx) {
  const input = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    sheet({
      title: 'Restore backup',
      body: [el('p', { class: 'sheet-text', text: `${file.name} — replace everything on this device, or merge it into what is already here?` })],
      actions: [
        { label: 'Cancel', className: 'btn-ghost' },
        { label: 'Merge', className: 'btn-ghost', onClick: () => run(text, true, ctx) },
        { label: 'Replace', className: 'btn-primary', onClick: () => run(text, false, ctx) },
      ],
    });
    input.remove();
  });
  document.body.append(input);
  input.click();
}

function run(text, merge, ctx) {
  try {
    store.importJSON(text, { merge });
    ctx.refresh();
    toast(merge ? 'Backup merged' : 'Backup restored', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' });
  } catch (err) {
    toast(err.message || 'That file could not be read.');
  }
}
