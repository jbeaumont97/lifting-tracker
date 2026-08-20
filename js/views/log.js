// views/log.js — the Log sheet. Optimised for logging mid-session with one hand.
//
// There are two situations, so there are two ways in:
//
//   Set by set  — you are in the gym now. One tap logs the set you just did,
//                 the rest clock starts, and the tracker moves on. Drop the
//                 reps before the last set and the short set is recorded as it
//                 actually happened.
//   All at once — you are writing up a session that is already over. One row:
//                 3 × 5 at 100 kg, exactly as before.
//
// Both produce the same stored shape — identical sets are one entry with a
// count — so nothing downstream needs to know which way you logged.
//
// The form updates its own preview in place rather than re-rendering the view,
// so a stepper never steals focus while you are typing.

import { el, stepper, chipGroup, segmented, toast, sheet, confirmSheet, emptyState, celebrate, prBadge, accentDot, tap } from '../ui.js';
import { startRest, stopRest } from '../timer.js';
import * as store from '../store.js';
import {
  isoToday, isoAddDays, relativeDate, formatDate, fmt, fmtWeight, fmtSigned,
  adjE1rm, e1rm, volume, planFor, bandFor, exerciseStats, sessionAdjWith,
} from '../metrics.js';
import { bandChip } from '../ui.js';
import { setTrace } from '../charts.js';
import { sessionSets, sessionTimeline, typicalRest, sessionDuration } from '../insights.js';
import * as ui from '../core/uistate.js';
import { bind } from '../core/bind.js';

const FORM = 'log.form';
const NOTES_OPEN = 'log.showNotes';
const LAST_SET = 'log.lastSetId';   // the entry the last set landed on, so undo is exact

let form = null;      // { exerciseId, date, weight, reps, sets, rir, notes, mode }

/**
 * The form writes itself to uistate as you fill it in.
 *
 * It used to be plain module state, so a reload lost a half-entered set — and
 * the app forced a reload whenever another tab wrote, which meant a second
 * device syncing mid-session could take the set out from under you. A proxy
 * rather than fifty explicit saves: every existing `form.x = y` persists.
 */
function persisted(obj) {
  return new Proxy(obj, {
    set(t, k, v) { t[k] = v; ui.set(FORM, { ...t }); return true; },
    deleteProperty(t, k) { delete t[k]; ui.set(FORM, { ...t }); return true; },
  });
}

const lastSetId = () => ui.get(LAST_SET, null);
const setLastSetId = (v) => ui.set(LAST_SET, v);

export function setPrefill(prefill = {}) {
  const date = prefill.date || form?.date || isoToday();
  const next = {
    exerciseId: prefill.exerciseId ?? form?.exerciseId ?? null,
    date,
    weight: prefill.weight ?? null,
    reps: prefill.reps ?? null,
    sets: prefill.sets ?? null,
    rir: prefill.rir ?? null,
    notes: '',
    fromPlan: prefill.weight != null,
    // Logging set by set only makes sense for a session happening now; writing
    // up an older one goes straight to the whole-session form.
    mode: prefill.mode ?? modeForDate(date),
  };
  form = persisted(next);
  ui.set(FORM, { ...next });
  setLastSetId(null);
}

/** Start again from nothing — used when the log is reset or a lift is deleted. */
export function clearForm() {
  form = null;
  ui.set(FORM, undefined);
  setLastSetId(null);
}

function modeForDate(date) {
  return date === isoToday() ? 'sets' : 'bulk';
}

export function renderLog(ctx) {
  const { settings, stats } = ctx;
  const root = el('section', { class: 'view view-log' });
  if (!form) {
    const saved = ui.get(FORM, null);
    if (saved && saved.date) form = persisted({ ...saved });
    else setPrefill({});
  }
  // A lift can be deleted while its half-filled form is still sitting here.
  if (form.exerciseId && !store.getExercise(form.exerciseId)) form.exerciseId = null;

  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: 'Log' }),
    el('p', { class: 'view-sub', text: 'Log each set as you do it, or write the whole session up at once. Identical sets are stored as one row: 3×5 at 100 kg.' }),
  ]));

  const exercises = store.exercisesByRecency();
  if (!exercises.length) {
    root.append(emptyState('No lifts set up', 'Add your lifts in Setup and they appear here.', 'Go to Setup', () => ctx.goTo('setup')));
    return root;
  }

  // ---- date ----
  const setDate = (iso) => {
    form.date = iso;
    // Changing the day changes which situation you are in.
    form.mode = modeForDate(iso);
    setLastSetId(null);
    ctx.refresh();
  };
  const dateInput = el('input', { type: 'date', class: 'date-input', value: form.date, max: isoAddDays(isoToday(), 1) });
  dateInput.addEventListener('change', () => { if (dateInput.value) setDate(dateInput.value); });
  root.append(el('div', { class: 'field-block' }, [
    el('span', { class: 'field-label', text: 'Session date' }),
    el('div', { class: 'date-row' }, [
      quickDate('Today', isoToday(), form.date, setDate),
      quickDate('Yesterday', isoAddDays(isoToday(), -1), form.date, setDate),
      dateInput,
    ]),
  ]));

  // ---- exercise ----
  const picker = el('div', { class: 'chips chips-wrap', role: 'radiogroup', 'aria-label': 'Exercise' });
  for (const ex of exercises) {
    const selected = ex.id === form.exerciseId;
    const done = store.entriesOn(ex.id, form.date).reduce((n, e) => n + setCount(e), 0);
    picker.append(el('button', {
      type: 'button', class: `chip chip-lift${selected ? ' is-selected' : ''}`, role: 'radio',
      'aria-checked': selected ? 'true' : 'false',
      onclick: () => { tap(); setPrefill({ exerciseId: ex.id, date: form.date, mode: form.mode }); ctx.refresh(); },
    }, [
      accentDot(ex.id),
      el('span', { text: ex.name }),
      // What you have already done today, so the picker doubles as a checklist.
      done ? el('span', { class: 'chip-done', text: `${done}` }) : null,
    ]));
  }
  root.append(el('div', { class: 'field-block' }, [
    el('span', { class: 'field-label', text: 'Exercise' }),
    picker,
  ]));

  const rail = sessionRail(ctx);
  if (rail) root.append(rail);

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

function setCount(entry) {
  return Number(entry.sets) > 0 ? Number(entry.sets) : 1;
}

/**
 * Today's session, all of it.
 *
 * Every other view in the app is one lift at a time; standing in the gym the
 * question is usually "what is left", across everything. Lifts appear in the
 * order their first set actually happened — which only became knowable with
 * the per-set log, since merging a repeat set leaves the entry's own ordering
 * where the block started.
 */
function sessionRail(ctx) {
  const date = form.date;
  const byLift = new Map();
  for (const e of store.getEntries()) {
    if (e.date !== date) continue;
    if (!byLift.has(e.exerciseId)) byLift.set(e.exerciseId, []);
    byLift.get(e.exerciseId).push(e);
  }
  // The lift you are about to start belongs in the session even with no sets.
  if (form.exerciseId && !byLift.has(form.exerciseId)) byLift.set(form.exerciseId, []);
  if (!byLift.size) return null;

  const rows = [];
  for (const [id, entries] of byLift) {
    const ex = store.getExercise(id);
    if (!ex) continue;
    const done = entries.reduce((n, e) => n + setCount(e), 0);
    const target = id === form.exerciseId && Number(form.sets) > 0
      ? Math.round(Number(form.sets))
      : (Number(ex.setsPerSession) > 0 ? Math.round(Number(ex.setsPerSession)) : 0);
    const started = sessionSets(entries).find((x) => x.measured);
    rows.push({
      ex, done, target,
      startedAt: started ? started.at : Infinity,
      seq: entries.length ? Math.min(...entries.map((e) => e.seq || 0)) : Infinity,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq);

  const totalDone = rows.reduce((n, r) => n + r.done, 0);
  const totalTarget = rows.reduce((n, r) => n + r.target, 0);
  const complete = totalTarget > 0 && totalDone >= totalTarget;

  const track = el('div', { class: 'rail-track', role: 'tablist', 'aria-label': 'Lifts in this session' });
  for (const r of rows) {
    const id = r.ex.id;
    const isCurrent = id === form.exerciseId;
    const filled = r.target > 0 ? Math.min(100, (r.done / r.target) * 100) : (r.done ? 100 : 0);
    track.append(el('button', {
      type: 'button', role: 'tab',
      class: `rail-seg${isCurrent ? ' is-current' : ''}${r.target && r.done >= r.target ? ' is-complete' : ''}`,
      'aria-selected': isCurrent ? 'true' : 'false',
      onclick: () => { tap(); setPrefill({ exerciseId: id, date: form.date, mode: form.mode }); ctx.refresh({ transition: true }); },
    }, [
      el('span', { class: 'rail-seg-name' }, [accentDot(id), el('span', { text: r.ex.name })]),
      el('span', { class: 'rail-seg-count', text: r.target ? `${r.done} of ${r.target} sets` : `${r.done} set${r.done === 1 ? '' : 's'}` }),
      el('div', { class: 'rail-seg-bar', 'aria-hidden': 'true' }, [
        el('span', { class: 'rail-seg-fill', style: `width:${filled}%` }),
      ]),
    ]));
  }

  const sets = sessionSets(store.getEntries().filter((e) => e.date === date));
  const mins = sessionDuration(sets);
  const facts = [];
  if (mins !== null) facts.push(`${Math.max(1, Math.round(mins / 60))} min`);
  const rest = typicalRest(sets);
  if (rest !== null) facts.push(`${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} rest`);

  return el('section', { class: 'rail', 'aria-label': 'This session' }, [
    el('div', { class: 'rail-head' }, [
      el('span', { class: 'rail-title', text: date === isoToday() ? 'This session' : formatDate(date) }),
      facts.length ? el('span', { class: 'rail-sub', text: facts.join(' · ') }) : null,
    ]),
    totalTarget > 0 ? el('div', { class: `rail-total${complete ? ' is-complete' : ''}` }, [
      el('div', {
        class: 'rail-total-track', role: 'meter',
        'aria-valuenow': totalDone, 'aria-valuemin': '0', 'aria-valuemax': totalTarget,
        'aria-label': 'Sets done in this session',
      }, [
        el('span', { class: 'rail-total-fill', style: `width:${Math.min(100, (totalDone / totalTarget) * 100)}%` }),
      ]),
      el('span', { class: 'rail-total-value', text: complete ? `${totalDone} sets — done` : `${totalDone} of ${totalTarget} sets` }),
    ]) : null,
    track,
  ]);
}

function quickDate(label, iso, current, onPick) {
  return el('button', {
    type: 'button', class: `chip${iso === current ? ' is-selected' : ''}`,
    onclick: () => { tap(); onPick(iso); },
  }, [label]);
}

function entryForm(st, ctx, settings) {
  const ex = st.exercise;
  const base = Number(ex.base) > 0 ? Number(ex.base) : 0;
  const plan = st.entryCount ? planFor(st, settings, {}) : null;
  const last = store.lastEntryFor(ex.id);
  const todays = store.entriesOn(ex.id, form.date);
  const doneSoFar = todays.reduce((n, e) => n + setCount(e), 0);
  const volSoFar = todays.reduce((n, e) => n + volume(e.weight, e.reps, e.sets), 0);
  const live = form.mode === 'sets';

  // Prefill order: what you are already doing today, then an explicit plan
  // hand-off, then the plan, then last session.
  const inProgress = todays.length ? todays[todays.length - 1] : null;
  if (form.weight == null) form.weight = (live && inProgress ? inProgress.weight : null) ?? (plan?.ready ? plan.weight : last?.weight ?? (base || 20));
  if (Number(form.weight) < base) form.weight = base;
  if (form.reps == null) form.reps = (live && inProgress ? inProgress.reps : null) ?? (plan?.ready ? plan.reps : last?.reps ?? 5);
  if (form.sets == null) form.sets = plan?.ready ? plan.sets : last?.sets ?? 3;

  const target = Number(form.sets) > 0 ? Math.round(Number(form.sets)) : 0;
  const complete = live && target > 0 && doneSoFar >= target;

  // A personal best has to beat the sessions that came BEFORE today. Measured
  // against everything, adding a fourth set to today's block would "beat" the
  // third set of the same block, and every set would set a record.
  const bestBefore = st.entries.reduce((m, e) => (e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m), -Infinity);

  const modeSwitch = segmented({
    label: 'How to log', value: form.mode,
    options: [{ value: 'sets', label: 'Set by set' }, { value: 'bulk', label: 'All at once' }],
    onChange: (v) => { form.mode = v; ctx.refresh({ transition: true }); },
  });

  const preview = el('div', { class: 'preview' });

  // The rep scheme this session set out to do: the first set is the intent,
  // and every bar after it is measured against that line.
  const planReps = todays.length ? Math.round(Number(todays[0].reps))
    : (plan?.ready ? plan.reps : Math.round(Number(form.reps)) || null);
  const traceFig = live
    ? setTrace(sessionTimeline(sessionSets(todays), settings), {
      planReps, planSets: target, pendingReps: Math.round(Number(form.reps)) || null,
    })
    : null;

  const paint = () => {
    const w = Number(form.weight), r = Number(form.reps), s = Number(form.sets);
    if (traceFig) traceFig.setPending(r);
    if (!(w > 0) || !(r > 0)) { preview.replaceChildren(el('span', { class: 'preview-hint', text: 'Enter a weight and reps.' })); return; }

    // In live mode the number that matters is what the SESSION will be worth
    // once this set is in — not what one set on its own scores.
    const adj = live
      ? sessionAdjWith(todays, { weight: w, reps: r }, settings)
      : adjE1rm(w, r, s, settings);
    const target1rm = plan?.ready ? plan.target : null;
    const band = target1rm ? bandFor(adj, target1rm, bestBefore === -Infinity ? null : bestBefore, settings) : null;
    // "Already ahead" and "about to go ahead" are different things: the badge
    // belongs on the set that crosses your best, not on every set after it.
    const adjSoFar = live && todays.length ? sessionAdjWith(todays, null, settings) : -Infinity;
    const alreadyBest = bestBefore > -Infinity && adjSoFar > bestBefore + 1e-9;
    const beatsBest = bestBefore > -Infinity && adj > bestBefore + 1e-9 && !alreadyBest;
    const work = volSoFar + volume(w, r, live ? 1 : s);

    preview.replaceChildren(
      el('div', { class: 'preview-main' }, [
        el('span', { class: 'preview-value' }, [fmt(adj, 1), el('small', { text: ' score' })]),
        band ? bandChip(band) : null,
        beatsBest ? prBadge() : null,
      ]),
      el('div', { class: 'preview-sub', text: live
        ? `after ${doneSoFar + 1} set${doneSoFar ? 's' : ''} · ${fmt(work, 0)} kg of work`
          + (alreadyBest ? ' · already your best session'
            : bestBefore > -Infinity ? ` · best before today ${fmt(bestBefore, 1)}` : '')
        : `${fmt(work, 0)} kg of work`
          + (target1rm ? ` · target ${fmt(target1rm, 1)} (${fmtSigned(adj - target1rm, 1)})` : '')
          + (bestBefore > -Infinity ? ` · best ${fmt(bestBefore, 1)}` : '') }),
    );
  };

  const weightStep = stepper({
    label: `Weight (${settings.unit})`, value: form.weight, step: ex.step || settings.defaultStep,
    min: base, max: 999, dp: 1, origin: base, id: 'log-weight',
    onChange: (v) => { form.weight = v; ctx.tick(); },
  });
  const repsStep = stepper({
    label: live ? 'Reps this set' : 'Reps', value: form.reps, step: 1, min: 1, max: 50, dp: 0, id: 'log-reps',
    onChange: (v) => { form.reps = v; ctx.tick(); },
  });
  const setsStep = stepper({
    label: live ? 'Sets planned' : 'Sets', value: form.sets, step: 1, min: 1, max: 20, dp: 0, id: 'log-sets',
    onChange: (v) => { form.sets = v; ctx.tick(); },
  });

  const rir = chipGroup({
    label: 'Reps in reserve', value: form.rir, allowNull: true, nullLabel: 'not noted',
    options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: v === 4 ? '4+' : String(v) })),
    onChange: (v) => { form.rir = v; },
  });

  const notesArea = el('textarea', { class: 'notes-input', rows: '2', placeholder: 'Felt heavy, belt on, …' });
  notesArea.value = form.notes || '';
  notesArea.addEventListener('input', () => { form.notes = notesArea.value; });

  const primary = el('button', {
    type: 'button', class: 'btn btn-primary btn-block btn-save',
    onclick: () => (live ? logOneSet(st, ctx, settings) : save(st, ctx)),
  }, ['…']);

  const relabel = () => {
    const w = fmtWeight(form.weight), r = Math.round(Number(form.reps)) || '', s = Math.round(Number(form.sets)) || '';
    primary.textContent = live
      ? (complete ? `Log another set — ${r} @ ${w} ${settings.unit}`
        : `Log set ${doneSoFar + 1}${target ? ` of ${target}` : ''} — ${r} @ ${w} ${settings.unit}`)
      : `Save ${s} × ${r} @ ${w} ${settings.unit}`;
  };

  const body = el('div', { class: 'form-body' }, [
    el('div', { class: 'mode-row' }, [modeSwitch]),
    plan?.ready ? el('div', { class: 'plan-strip' }, [
      el('span', { class: 'plan-strip-label', text: 'Planned' }),
      el('span', { class: 'plan-strip-value', text: `${plan.sets} × ${plan.reps} @ ${fmtWeight(plan.weight)} kg` }),
      bandChip(plan.band, { compact: true }),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: () => {
          form.weight = plan.weight; form.reps = plan.reps; form.sets = plan.sets;
          weightStep.setValue(plan.weight); repsStep.setValue(plan.reps); setsStep.setValue(plan.sets);
          ctx.tick();
        },
      }, ['Use']),
    ]) : null,
    el('div', { class: 'lever-row lever-row-wide' }, [weightStep]),
    el('div', { class: 'lever-row' }, [repsStep, setsStep]),
    live ? tracker(traceFig, doneSoFar, target, complete, ex, ctx) : null,
    preview,
    el('div', { class: 'field-block' }, [
      el('span', { class: 'field-label', text: live
        ? 'RIR — how many more you could have done on this set'
        : 'RIR — how many more you could have done' }),
      rir,
    ]),
    el('button', {
      type: 'button', class: 'link-btn link-btn-block',
      onclick: (e) => {
        const open = !ui.get(NOTES_OPEN, false);
        ui.set(NOTES_OPEN, open);
        e.target.closest('.form-body').querySelector('.notes-wrap').hidden = !open;
      },
    }, ['Notes']),
    el('div', { class: 'notes-wrap', hidden: !ui.get(NOTES_OPEN, false) }, [notesArea]),
    primary,
  ]);
  // The preview and the button label follow the levers without re-rendering.
  // Rebuilding the view would take the caret out of whichever field is being
  // typed into, which is why this screen used to repaint itself by hand; bind()
  // is that same idea, minus the bookkeeping. The key is the three numbers the
  // preview actually depends on, so moving RIR or typing a note writes nothing.
  const levers = () => `${form.weight}|${form.reps}|${form.sets}`;
  bind(preview, levers, paint);
  bind(primary, levers, relabel);

  // Steppers that are typed into rather than nudged still have to be heard.
  for (const s of [weightStep, repsStep, setsStep]) {
    for (const ev of ['lt:nudge', 'change', 'blur']) s.input.addEventListener(ev, ctx.tick);
  }

  return el('div', { class: 'card card-form' }, [
    el('div', { class: 'card-head static' }, [
      accentDot(ex.id),
      el('div', { class: 'card-head-main' }, [
        el('h2', { class: 'card-title', text: ex.name }),
        el('p', { class: 'card-meta', text: live && doneSoFar
          ? `${doneSoFar} set${doneSoFar === 1 ? '' : 's'} logged ${form.date === isoToday() ? 'today' : formatDate(form.date)}`
          : last
            ? `${relativeDate(last.date)} · ${last.sets}×${last.reps} @ ${fmtWeight(last.weight)} kg`
            : 'First time logging this lift' }),
      ]),
    ]),
    body,
  ]);
}

/** Total weight moved across a set of entries. */
function volSoFarAfter(entries) {
  return entries.reduce((n, e) => n + volume(e.weight, e.reps, e.sets), 0);
}

/* ------------------------------------------------------------- tracker */

/**
 * The session so far. The pills grew an axis: same one-mark-per-set idea, now
 * also showing whether the reps held up, how close to failure each set went and
 * how long you actually rested — none of which was recordable before the
 * per-set log.
 */
function tracker(traceFig, doneSoFar, target, complete, ex, ctx) {
  return el('div', { class: `set-track${complete ? ' is-complete' : ''}` }, [
    el('div', { class: 'set-track-head' }, [
      el('span', { class: 'set-track-label', text: !target ? `Set ${doneSoFar + 1}`
        : complete ? `${doneSoFar} of ${target} sets done`
        : `Set ${doneSoFar + 1} of ${target}` }),
      doneSoFar ? el('button', {
        type: 'button', class: 'link-btn',
        onclick: () => {
          const removed = store.removeLastSet(form.exerciseId, form.date, lastSetId());
          setLastSetId(null);
          stopRest();
          ctx.refresh();
          if (removed) toast(`Took back ${removed.reps} @ ${fmtWeight(removed.weight)} kg`, {
            action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo',
          });
        },
      }, ['Undo last set']) : null,
    ]),
    traceFig,
    complete ? el('p', { class: 'set-track-note', text: `${ex.name} done — ${doneSoFar} set${doneSoFar === 1 ? '' : 's'}. Log another if you have one in you.` }) : null,
  ]);
}

/* --------------------------------------------------------------- saving */

/** Set-by-set: one tap, one set, rest clock. */
function logOneSet(st, ctx, settings) {
  const w = Number(form.weight), r = Number(form.reps);
  if (!(w > 0) || !(r > 0)) { toast('Enter a weight and reps first.'); return; }

  const bestBefore = st.entries.reduce((m, e) => (e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m), -Infinity);
  const before = store.entriesOn(form.exerciseId, form.date);
  const adjBefore = before.length ? sessionAdjWith(before, null, settings) : -Infinity;

  const created = store.logSet({
    exerciseId: form.exerciseId, date: form.date, weight: w, reps: r,
    rir: form.rir, notes: form.notes,
  });
  setLastSetId(created?.id ?? null);
  // A note belongs to the set it was written for, not to every set after it.
  form.notes = '';

  const after = store.entriesOn(form.exerciseId, form.date);
  const doneAfter = after.reduce((n, e) => n + setCount(e), 0);
  const adj = sessionAdjWith(after, null, settings);
  const target = Number(form.sets) > 0 ? Math.round(Number(form.sets)) : 0;

  // Once the session is past your best, every further set beats it again —
  // celebrate the crossing, not each step beyond it.
  const crossed = Number.isFinite(adj) && bestBefore > -Infinity
    && adj > bestBefore + 1e-9 && !(adjBefore > bestBefore + 1e-9);
  if (crossed) {
    celebrate();
    tap([30, 60, 30]);
    toast(`🏆 New best for ${st.exercise.name} — ${fmt(adj, 1)}`);
  }

  // Only the set that finishes the plan ends the session. Carrying on past it
  // is a decision to keep training, so the clock comes back.
  if (target && doneAfter === target) {
    stopRest();
    const spent = sessionDuration(sessionSets(after));
    const bits = [`${doneAfter} set${doneAfter === 1 ? '' : 's'}`];
    if (spent !== null && spent >= 60) bits.push(`${Math.round(spent / 60)} min`);
    bits.push(`${fmt(volSoFarAfter(after), 0)} kg`);
    toast(`${st.exercise.name} done · ${bits.join(' · ')}`, {
      action: () => { store.undo(); setLastSetId(null); ctx.refresh(); }, actionLabel: 'Undo',
    });
  } else {
    // Past the plan there is no "of five" to count towards any more.
    const ofTarget = target && doneAfter + 1 <= target ? ` of ${target}` : '';
    startRest(settings.restSeconds, {
      label: `${st.exercise.name} · set ${doneAfter + 1}${ofTarget} next`,
      // What this lift has actually been getting today, rather than the setting.
      usual: typicalRest(sessionSets(after)),
    });
  }
  ctx.refresh();
}

/** All at once: the whole block as one row, as it has always worked. */
function save(st, ctx) {
  const w = Number(form.weight), r = Number(form.reps), s = Number(form.sets);
  if (!(w > 0) || !(r > 0)) { toast('Enter a weight and reps first.'); return; }
  const bestBefore = st.entries.reduce((m, e) => (e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m), -Infinity);
  const created = store.addEntry({
    exerciseId: form.exerciseId, date: form.date, weight: w, reps: r, sets: s,
    rir: form.rir, notes: form.notes,
  });
  const adj = adjE1rm(w, r, s, ctx.settings);
  const beatBest = bestBefore > -Infinity && adj > bestBefore + 1e-9;
  // A personal best is the moment the whole app exists for — mark it.
  if (beatBest) { celebrate(); tap([30, 60, 30]); }
  toast(beatBest ? `🏆 New best for ${st.exercise.name} — ${fmt(adj, 1)}`
    : `Saved · ${fmt(adj, 1)}`, {
    action: () => { store.undo(); ctx.refresh(); },
    actionLabel: 'Undo',
  });
  // You are now standing between sets, so the clock starts itself.
  if (form.date === isoToday()) startRest(ctx.settings.restSeconds, { label: `Rest · ${st.exercise.name}` });
  // Keep the lift selected but drop back to plan-based prefill for the next set.
  setPrefill({ exerciseId: form.exerciseId, date: form.date, mode: form.mode });
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
    el('span', { class: 'row-adj', text: fmt(adjE1rm(entry.weight, entry.reps, entry.sets, ctx.settings), 1) }),
    entry.rir !== null && entry.rir !== undefined ? el('span', { class: 'row-rir', text: `RIR ${entry.rir}` }) : null,
    // Notes have been captured, merged and exported since the first version and
    // shown nowhere. If it was worth typing at the rack it is worth reading back.
    entry.notes ? el('span', { class: 'row-note', text: entry.notes }) : null,
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
