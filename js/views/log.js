// views/log.js — the Log sheet. Optimised for logging mid-session with one hand:
// pick a lift, the form arrives pre-filled with the plan, adjust with +/-, save.
//
// The form updates its own preview in place rather than re-rendering the view,
// so a stepper never steals focus while you are typing.

import { el, stepper, chipGroup, toast, sheet, confirmSheet, emptyState, celebrate, prBadge, accentDot, tap } from '../ui.js';
import { startRest } from '../timer.js';
import * as store from '../store.js';
import {
  isoToday, isoAddDays, relativeDate, formatDate, fmt, fmtWeight, fmtSigned,
  adjE1rm, e1rm, volume, planFor, bandFor, exerciseStats,
} from '../metrics.js';
import { bandChip } from '../ui.js';

let form = null;      // { exerciseId, date, weight, reps, sets, rir, notes }
let showNotes = false;

export function setPrefill(prefill = {}) {
  const date = prefill.date || form?.date || isoToday();
  form = {
    exerciseId: prefill.exerciseId ?? form?.exerciseId ?? null,
    date,
    weight: prefill.weight ?? null,
    reps: prefill.reps ?? null,
    sets: prefill.sets ?? null,
    rir: prefill.rir ?? null,
    notes: '',
    fromPlan: prefill.weight != null,
  };
}

export function renderLog(ctx) {
  const { settings, stats } = ctx;
  const root = el('section', { class: 'view view-log' });
  if (!form) setPrefill({});

  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: 'Log' }),
    el('p', { class: 'view-sub', text: 'One row per lift per session. For straight sets, 3×5 at 100 kg is a single entry.' }),
  ]));

  const exercises = store.exercisesByRecency();
  if (!exercises.length) {
    root.append(emptyState('No lifts set up', 'Add your lifts in Setup and they appear here.', 'Go to Setup', () => ctx.goTo('setup')));
    return root;
  }

  // ---- date ----
  const dateInput = el('input', { type: 'date', class: 'date-input', value: form.date, max: isoAddDays(isoToday(), 1) });
  dateInput.addEventListener('change', () => {
    if (dateInput.value) { form.date = dateInput.value; ctx.refresh(); }
  });
  root.append(el('div', { class: 'field-block' }, [
    el('span', { class: 'field-label', text: 'Session date' }),
    el('div', { class: 'date-row' }, [
      quickDate('Today', isoToday(), form.date, ctx),
      quickDate('Yesterday', isoAddDays(isoToday(), -1), form.date, ctx),
      dateInput,
    ]),
  ]));

  // ---- exercise ----
  const picker = el('div', { class: 'chips chips-wrap', role: 'radiogroup', 'aria-label': 'Exercise' });
  for (const ex of exercises) {
    const selected = ex.id === form.exerciseId;
    picker.append(el('button', {
      type: 'button', class: `chip chip-lift${selected ? ' is-selected' : ''}`, role: 'radio',
      'aria-checked': selected ? 'true' : 'false',
      onclick: () => { tap(); setPrefill({ exerciseId: ex.id, date: form.date }); ctx.refresh(); },
    }, [accentDot(ex.id), el('span', { text: ex.name })]));
  }
  root.append(el('div', { class: 'field-block' }, [
    el('span', { class: 'field-label', text: 'Exercise' }),
    picker,
  ]));

  if (form.exerciseId) {
    const st = stats.find((s) => s.exercise.id === form.exerciseId)
      || exerciseStats(store.getExercise(form.exerciseId), store.getEntries(), settings);
    root.append(entryForm(st, ctx, settings));
  } else {
    root.append(el('p', { class: 'card-note', text: 'Pick a lift to log.' }));
  }

  root.append(history(ctx, settings));
  return root;
}

function quickDate(label, iso, current, ctx) {
  return el('button', {
    type: 'button', class: `chip${iso === current ? ' is-selected' : ''}`,
    onclick: () => { form.date = iso; ctx.refresh(); },
  }, [label]);
}

function entryForm(st, ctx, settings) {
  const ex = st.exercise;
  const base = Number(ex.base) > 0 ? Number(ex.base) : 0;
  const plan = st.entryCount ? planFor(st, settings, {}) : null;
  const last = store.lastEntryFor(ex.id);

  // Prefill order: an explicit plan hand-off, then the plan, then last session.
  if (form.weight == null) form.weight = plan?.ready ? plan.weight : last?.weight ?? (base || 20);
  if (Number(form.weight) < base) form.weight = base;
  if (form.reps == null) form.reps = plan?.ready ? plan.reps : last?.reps ?? 5;
  if (form.sets == null) form.sets = plan?.ready ? plan.sets : last?.sets ?? 3;

  const preview = el('div', { class: 'preview' });
  const paint = () => {
    const w = Number(form.weight), r = Number(form.reps), s = Number(form.sets);
    if (!(w > 0) || !(r > 0)) { preview.replaceChildren(el('span', { class: 'preview-hint', text: 'Enter a weight and reps.' })); return; }
    const adj = adjE1rm(w, r, s, settings);
    const target = plan?.ready ? plan.target : null;
    const band = target ? bandFor(adj, target, st.bestAdj, settings) : null;
    const beatsBest = Number.isFinite(st.bestAdj) && adj > st.bestAdj + 1e-9;
    preview.replaceChildren(
      el('div', { class: 'preview-main' }, [
        el('span', { class: 'preview-value' }, [fmt(adj, 1), el('small', { text: ctx.simple ? ' score' : ' kg adj e1RM' })]),
        band ? bandChip(band) : null,
        beatsBest ? prBadge() : null,
      ]),
      el('div', { class: 'preview-sub', text: ctx.simple
        ? `${fmt(volume(w, r, s), 0)} kg of work`
          + (Number.isFinite(st.bestAdj) ? (beatsBest ? ' · this would be your best yet' : ` · your best is ${fmt(st.bestAdj, 1)}`) : '')
        : `e1RM ${fmt(e1rm(w, r, settings.formula), 1)} · volume ${fmt(volume(w, r, s), 0)} kg`
          + (target ? ` · target ${fmt(target, 1)} (${fmtSigned(adj - target, 1)})` : '')
          + (Number.isFinite(st.bestAdj) ? ` · best ${fmt(st.bestAdj, 1)}` : '') }),
    );
  };

  const weightStep = stepper({
    label: `Weight (${settings.unit})`, value: form.weight, step: ex.step || settings.defaultStep,
    min: base, max: 999, dp: 1, origin: base, id: 'log-weight',
    onChange: (v) => { form.weight = v; paint(); },
  });
  const repsStep = stepper({
    label: 'Reps', value: form.reps, step: 1, min: 1, max: 50, dp: 0, id: 'log-reps',
    onChange: (v) => { form.reps = v; paint(); },
  });
  const setsStep = stepper({
    label: 'Sets', value: form.sets, step: 1, min: 1, max: 20, dp: 0, id: 'log-sets',
    onChange: (v) => { form.sets = v; paint(); },
  });

  const rir = chipGroup({
    label: 'Reps in reserve', value: form.rir, allowNull: true, nullLabel: 'not noted',
    options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: v === 4 ? '4+' : String(v) })),
    onChange: (v) => { form.rir = v; },
  });

  const notesArea = el('textarea', { class: 'notes-input', rows: '2', placeholder: 'Felt heavy, belt on, …' });
  notesArea.value = form.notes || '';
  notesArea.addEventListener('input', () => { form.notes = notesArea.value; });

  const body = el('div', { class: 'form-body' }, [
    plan?.ready ? el('div', { class: 'plan-strip' }, [
      el('span', { class: 'plan-strip-label', text: 'Planned' }),
      el('span', { class: 'plan-strip-value', text: `${plan.sets} × ${plan.reps} @ ${fmtWeight(plan.weight)} kg` }),
      bandChip(plan.band, { compact: true }),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: () => {
          form.weight = plan.weight; form.reps = plan.reps; form.sets = plan.sets;
          weightStep.setValue(plan.weight); repsStep.setValue(plan.reps); setsStep.setValue(plan.sets);
          paint();
        },
      }, ['Use']),
    ]) : null,
    el('div', { class: 'lever-row lever-row-wide' }, [weightStep]),
    el('div', { class: 'lever-row' }, [repsStep, setsStep]),
    preview,
    el('div', { class: 'field-block' }, [
      el('span', { class: 'field-label', text: 'RIR — how many more you could have done' }),
      rir,
    ]),
    el('button', {
      type: 'button', class: 'link-btn link-btn-block',
      onclick: (e) => { showNotes = !showNotes; e.target.closest('.form-body').querySelector('.notes-wrap').hidden = !showNotes; },
    }, ['Notes']),
    el('div', { class: 'notes-wrap', hidden: !showNotes }, [notesArea]),
    el('button', {
      type: 'button', class: 'btn btn-primary btn-block btn-save',
      onclick: () => save(st, ctx),
    }, [`Save ${form.sets || ''} × ${form.reps || ''} @ ${fmtWeight(form.weight)} ${settings.unit}`]),
  ]);
  paint();

  // Keep the save button's label honest as the steppers move.
  const saveBtn = body.querySelector('.btn-save');
  const relabel = () => { saveBtn.textContent = `Save ${form.sets} × ${form.reps} @ ${fmtWeight(form.weight)} ${settings.unit}`; };
  for (const s of [weightStep, repsStep, setsStep]) {
    s.input.addEventListener('lt:nudge', relabel);
    s.input.addEventListener('change', relabel);
    s.input.addEventListener('blur', relabel);
  }

  return el('div', { class: 'card card-form' }, [
    el('div', { class: 'card-head static' }, [
      accentDot(ex.id),
      el('div', { class: 'card-head-main' }, [
        el('h2', { class: 'card-title', text: ex.name }),
        el('p', { class: 'card-meta', text: last
          ? `${relativeDate(last.date)} · ${last.sets}×${last.reps} @ ${fmtWeight(last.weight)} kg`
          : 'First time logging this lift' }),
      ]),
    ]),
    body,
  ]);
}

function save(st, ctx) {
  const w = Number(form.weight), r = Number(form.reps), s = Number(form.sets);
  if (!(w > 0) || !(r > 0)) { toast('Enter a weight and reps first.'); return; }
  const created = store.addEntry({
    exerciseId: form.exerciseId, date: form.date, weight: w, reps: r, sets: s,
    rir: form.rir, notes: form.notes,
  });
  const adj = adjE1rm(w, r, s, ctx.settings);
  const beatBest = Number.isFinite(st.bestAdj) && adj > st.bestAdj + 1e-9;
  // A personal best is the moment the whole app exists for — mark it.
  if (beatBest) { celebrate(); tap([30, 60, 30]); }
  toast(beatBest ? `🏆 New best for ${st.exercise.name} — ${fmt(adj, 1)}${ctx.simple ? '' : ' kg adj e1RM'}`
    : `Saved · ${fmt(adj, 1)}${ctx.simple ? '' : ' kg adj e1RM'}`, {
    action: () => { store.undo(); ctx.refresh(); },
    actionLabel: 'Undo',
  });
  // You are now standing between sets, so the clock starts itself.
  if (form.date === isoToday()) startRest(ctx.settings.restSeconds, { label: `Rest · ${st.exercise.name}` });
  // Keep the lift selected but drop back to plan-based prefill for the next set.
  setPrefill({ exerciseId: form.exerciseId, date: form.date });
  ctx.refresh();
  if (created) requestAnimationFrame(() => document.querySelector('.view-log .history')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

/* ------------------------------------------------------------- history */

function history(ctx, settings) {
  const entries = store.getEntries();
  const names = new Map(store.getExercises().map((e) => [e.id, e.name]));
  const wrap = el('div', { class: 'history' }, [el('h2', { class: 'section-title', text: 'Recent sessions' })]);
  if (!entries.length) {
    wrap.append(el('p', { class: 'card-note', text: 'Nothing logged yet.' }));
    return wrap;
  }
  // Which of these were a personal best when they were logged — the stats
  // layer has already worked it out, so the badge costs a lookup.
  const prIds = new Set();
  for (const s of ctx.stats) for (const e of s.entries) if (e.isPR) prIds.add(e.id);

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const byDate = new Map();
  for (const e of sorted) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  let shown = 0;
  for (const [date, rows] of byDate) {
    if (shown >= 10) break;
    shown++;
    const totalSets = rows.reduce((n, e) => n + e.sets, 0);
    const totalVol = rows.reduce((n, e) => n + volume(e.weight, e.reps, e.sets), 0);
    wrap.append(el('div', { class: 'day' }, [
      el('div', { class: 'day-head' }, [
        el('span', { class: 'day-when', text: relativeDate(date) }),
        el('span', { class: 'day-meta', text: `${formatDate(date)} · ${totalSets} sets · ${fmt(totalVol, 0)} kg` }),
      ]),
      el('ul', { class: 'day-list' }, rows.map((e) => historyRow(e, names.get(e.exerciseId) || 'Unknown', prIds.has(e.id), ctx, settings))),
    ]));
  }
  if (byDate.size > shown) {
    wrap.append(el('p', { class: 'card-note', text: `${byDate.size - shown} earlier session days — see Progress for the full history.` }));
  }
  return wrap;
}

/** One logged entry: tap to edit, swipe left to delete. */
function historyRow(entry, name, isPR, ctx, settings) {
  const btn = el('button', { type: 'button', class: 'row-btn', onclick: () => editSheet(entry, ctx, settings) }, [
    el('span', { class: 'row-name' }, [accentDot(entry.exerciseId), name, isPR ? prBadge({ compact: true }) : null]),
    el('span', { class: 'row-set', text: `${entry.sets} × ${entry.reps} @ ${fmtWeight(entry.weight)} kg` }),
    el('span', { class: 'row-adj', text: ctx.simple
      ? fmt(adjE1rm(entry.weight, entry.reps, entry.sets, ctx.settings), 1)
      : `${fmt(adjE1rm(entry.weight, entry.reps, entry.sets, ctx.settings), 1)} adj` }),
    entry.rir !== null && entry.rir !== undefined ? el('span', { class: 'row-rir', text: `RIR ${entry.rir}` }) : null,
  ]);
  const li = el('li', { class: 'swipe-row' }, [
    el('div', { class: 'swipe-action', 'aria-hidden': 'true' }, [el('span', { text: 'Delete' })]),
    btn,
  ]);
  swipeToDelete(li, btn, () => {
    store.deleteEntry(entry.id);
    ctx.refresh();
    toast(`${name} entry deleted`, { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' });
  });
  return li;
}

/**
 * Drag a row leftwards to delete it. The gesture only takes over once it is
 * clearly horizontal, so the list still scrolls normally under a thumb, and it
 * deletes straight away rather than asking — the toast carries the undo.
 */
function swipeToDelete(li, surface, onDelete) {
  const LIMIT = 112, ARM = 72;
  let start = null, dx = 0, engaged = false, swallowClick = false;

  const reset = () => {
    surface.style.transition = 'transform 0.18s ease';
    surface.style.transform = '';
    li.classList.remove('is-armed', 'is-swiping');
    setTimeout(() => { surface.style.transition = ''; }, 200);
    start = null; dx = 0; engaged = false;
  };

  surface.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY };
    dx = 0; engaged = false; swallowClick = false;
  });
  surface.addEventListener('pointermove', (e) => {
    if (!start) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!engaged) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { start = null; return; }   // scrolling
      if (Math.abs(mx) < 12) return;
      engaged = true;
      li.classList.add('is-swiping');
      surface.setPointerCapture?.(e.pointerId);
    }
    dx = Math.max(-LIMIT, Math.min(0, mx));
    surface.style.transform = `translateX(${dx}px)`;
    li.classList.toggle('is-armed', dx <= -ARM);
  });
  const end = () => {
    if (!start) return;
    const armed = dx <= -ARM;
    // The click that follows the release is checked against this, not against
    // dx — reset() has already zeroed dx by the time the click arrives.
    swallowClick = engaged && dx < -4;
    reset();
    if (armed) { tap(20); onDelete(); }
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', reset);
  // A row that was swiped must not also open the editor.
  surface.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

function editSheet(entry, ctx, settings) {
  const draft = { ...entry };
  const ex = store.getExercise(entry.exerciseId);
  const dateInput = el('input', { type: 'date', class: 'date-input', value: draft.date });
  dateInput.addEventListener('change', () => { draft.date = dateInput.value || draft.date; });

  const s = sheet({
    title: `Edit — ${ex?.name || 'entry'}`,
    body: [
      el('div', { class: 'field-block' }, [el('span', { class: 'field-label', text: 'Date' }), dateInput]),
      el('div', { class: 'lever-row' }, [
        stepper({ label: `Weight (${settings.unit})`, value: draft.weight, step: ex?.step || settings.defaultStep,
          min: 0, max: 999, dp: 1, origin: Number(ex?.base) > 0 ? Number(ex.base) : 0, id: 'ed-w',
          onChange: (v) => { draft.weight = v; } }),
        stepper({ label: 'Reps', value: draft.reps, step: 1, min: 1, max: 50, dp: 0, id: 'ed-r', onChange: (v) => { draft.reps = v; } }),
        stepper({ label: 'Sets', value: draft.sets, step: 1, min: 1, max: 20, dp: 0, id: 'ed-s', onChange: (v) => { draft.sets = v; } }),
      ]),
      el('div', { class: 'field-block' }, [
        el('span', { class: 'field-label', text: 'RIR' }),
        chipGroup({ label: 'RIR', value: draft.rir, allowNull: true, nullLabel: 'not noted', options: [0, 1, 2, 3, 4], onChange: (v) => { draft.rir = v; } }),
      ]),
    ],
    actions: [
      { label: 'Delete', className: 'btn-danger', onClick: () => {
        confirmSheet({
          title: 'Delete this entry?', message: 'It is removed from every calculation. You can undo straight afterwards.',
          onConfirm: () => { store.deleteEntry(entry.id); ctx.refresh(); toast('Entry deleted', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' }); },
        });
      } },
      { label: 'Save', className: 'btn-primary', onClick: () => {
        store.updateEntry(entry.id, draft);
        ctx.refresh();
        toast('Entry updated', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' });
      } },
    ],
  });
  return s;
}
