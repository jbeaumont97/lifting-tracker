// store.js — all state lives in localStorage on this device. Nothing leaves it.
//
// One key holds one JSON document. Every mutation writes synchronously and
// notifies subscribers, so the UI is always a pure function of this document.

import { SEED } from './seed.js';
import { isoToday } from './metrics.js';

const KEY = 'liftingTracker.v1';
const THEME_KEY = 'liftingTracker.theme';
const SCHEMA = 1;

export const DEFAULT_SETTINGS = {
  formula: 'epley',        // 'epley' | 'brzycki'
  setBonusK: 0.05,         // Adj e1RM = e1RM x (1 + k x ln(sets))
  lookbackDays: 84,        // trend window
  defaultStep: 2.5,
  defaultGainPerWeek: 0.0075,
  idealBand: 0.01,         // <= target x (1+this)  -> ideal
  stretchBand: 0.03,       // <= target x (1+this)  -> stretch, above -> too big
  unit: 'kg',
};

let doc = null;
const listeners = new Set();
let undoStack = [];

/* ------------------------------------------------------------- lifecycle */

function blank() {
  return { schema: SCHEMA, exercises: [], entries: [], settings: { ...DEFAULT_SETTINGS }, seq: 1 };
}

function normalise(raw) {
  const d = { ...blank(), ...raw };
  d.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  d.exercises = (raw.exercises || []).map((e, i) => ({
    id: String(e.id ?? `ex-${i}`),
    name: String(e.name ?? 'Exercise'),
    step: num(e.step, d.settings.defaultStep),
    base: Math.max(0, num(e.base, 0)),          // empty bar / lightest pin

    gainPerWeek: num(e.gainPerWeek, d.settings.defaultGainPerWeek),
    setsPerSession: num(e.setsPerSession, 3),
    setsPerWeek: num(e.setsPerWeek, 15),
    notes: String(e.notes ?? ''),
  }));
  const known = new Set(d.exercises.map((e) => e.id));
  d.entries = (raw.entries || [])
    .filter((e) => e && e.date && known.has(e.exerciseId) && Number.isFinite(Number(e.weight)) && Number(e.reps) > 0)
    .map((e, i) => ({
      id: String(e.id ?? `en-${i}`),
      date: String(e.date).slice(0, 10),
      exerciseId: String(e.exerciseId),
      weight: Number(e.weight),
      reps: Math.round(Number(e.reps)),
      sets: Number(e.sets) > 0 ? Math.round(Number(e.sets)) : 1,
      rir: e.rir === null || e.rir === undefined || e.rir === '' ? null : Number(e.rir),
      notes: String(e.notes ?? ''),
      seq: Number(e.seq) || i + 1,
    }));
  d.seq = Math.max(1, ...d.entries.map((e) => e.seq + 1));
  d.schema = SCHEMA;
  return d;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function seedDoc() {
  return normalise({
    exercises: SEED.exercises,
    entries: SEED.entries,
    settings: { ...DEFAULT_SETTINGS, ...SEED.settings },
  });
}

export function load() {
  if (doc) return doc;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch { raw = null; }
  if (raw && (raw.exercises || raw.entries)) {
    doc = normalise(raw);
  } else {
    doc = seedDoc();          // first run: carry the spreadsheet's data across
    persist();
  }
  return doc;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
    return true;
  } catch (err) {
    console.error('Could not save — storage may be full or blocked.', err);
    notify({ type: 'error', message: 'Could not save to this device’s storage.' });
    return false;
  }
}

/** Mutate the document through this so saving and notifying never get skipped. */
function commit(fn, meta = {}) {
  load();
  const before = JSON.stringify(doc);
  fn(doc);
  if (meta.undoable) {
    undoStack.push({ snapshot: before, label: meta.label || 'change' });
    if (undoStack.length > 20) undoStack.shift();
  }
  persist();
  notify({ type: 'change', ...meta });
  return doc;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(evt) {
  for (const fn of listeners) {
    try { fn(evt); } catch (err) { console.error(err); }
  }
}

export function canUndo() { return undoStack.length > 0; }

export function undo() {
  const last = undoStack.pop();
  if (!last) return false;
  doc = normalise(JSON.parse(last.snapshot));
  persist();
  notify({ type: 'change', undone: last.label });
  return true;
}

/* --------------------------------------------------------------- getters */

export const getDoc = () => load();
export const getSettings = () => load().settings;
export const getExercises = () => load().exercises;
export const getEntries = () => load().entries;
export const getExercise = (id) => load().exercises.find((e) => e.id === id) || null;

/** Exercises ordered by most recently trained, so the picker matches habit. */
export function exercisesByRecency() {
  const d = load();
  const lastSeen = new Map();
  for (const e of d.entries) {
    const key = `${e.date}|${String(e.seq).padStart(9, '0')}`;
    if (!lastSeen.has(e.exerciseId) || key > lastSeen.get(e.exerciseId)) lastSeen.set(e.exerciseId, key);
  }
  return [...d.exercises].sort((a, b) => (lastSeen.get(b.id) || '').localeCompare(lastSeen.get(a.id) || ''));
}

/** The most recent entry for an exercise — what the log form prefills from. */
export function lastEntryFor(exerciseId) {
  const mine = load().entries.filter((e) => e.exerciseId === exerciseId);
  if (!mine.length) return null;
  return mine.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)[mine.length - 1];
}

/* -------------------------------------------------------------- mutators */

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addEntry(entry) {
  let created = null;
  commit((d) => {
    created = {
      id: uid('en'),
      date: entry.date || isoToday(),
      exerciseId: entry.exerciseId,
      weight: Number(entry.weight),
      reps: Math.round(Number(entry.reps)),
      sets: Number(entry.sets) > 0 ? Math.round(Number(entry.sets)) : 1,
      rir: entry.rir === '' || entry.rir === null || entry.rir === undefined ? null : Number(entry.rir),
      notes: String(entry.notes || ''),
      seq: d.seq++,
    };
    d.entries.push(created);
  }, { undoable: true, label: 'set logged' });
  return created;
}

export function updateEntry(id, patch) {
  commit((d) => {
    const e = d.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, {
      date: patch.date ?? e.date,
      weight: patch.weight !== undefined ? Number(patch.weight) : e.weight,
      reps: patch.reps !== undefined ? Math.round(Number(patch.reps)) : e.reps,
      sets: patch.sets !== undefined ? Math.round(Number(patch.sets)) : e.sets,
      rir: patch.rir === undefined ? e.rir : (patch.rir === '' || patch.rir === null ? null : Number(patch.rir)),
      notes: patch.notes ?? e.notes,
      exerciseId: patch.exerciseId ?? e.exerciseId,
    });
  }, { undoable: true, label: 'entry edited' });
}

export function deleteEntry(id) {
  commit((d) => { d.entries = d.entries.filter((e) => e.id !== id); }, { undoable: true, label: 'entry deleted' });
}

export function addExercise(ex) {
  const s = getSettings();
  let created = null;
  commit((d) => {
    created = {
      id: uid('ex'),
      name: String(ex.name || 'New exercise').trim(),
      step: num(ex.step, s.defaultStep),
      base: Math.max(0, num(ex.base, 0)),
      gainPerWeek: num(ex.gainPerWeek, s.defaultGainPerWeek),
      setsPerSession: num(ex.setsPerSession, 3),
      setsPerWeek: num(ex.setsPerWeek, 15),
      notes: String(ex.notes || ''),
    };
    d.exercises.push(created);
  }, { undoable: true, label: 'exercise added' });
  return created;
}

export function updateExercise(id, patch) {
  commit((d) => {
    const ex = d.exercises.find((x) => x.id === id);
    if (!ex) return;
    if (patch.name !== undefined) ex.name = String(patch.name).trim() || ex.name;
    for (const k of ['step', 'base', 'gainPerWeek', 'setsPerSession', 'setsPerWeek']) {
      if (patch[k] !== undefined) ex[k] = num(patch[k], ex[k]);
    }
    if (patch.notes !== undefined) ex.notes = String(patch.notes);
  }, { undoable: true, label: 'exercise edited' });
}

/** Removing an exercise takes its history with it — the caller must confirm. */
export function deleteExercise(id) {
  commit((d) => {
    d.exercises = d.exercises.filter((e) => e.id !== id);
    d.entries = d.entries.filter((e) => e.exerciseId !== id);
  }, { undoable: true, label: 'exercise deleted' });
}

export function moveExercise(id, delta) {
  commit((d) => {
    const i = d.exercises.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.exercises.length) return;
    [d.exercises[i], d.exercises[j]] = [d.exercises[j], d.exercises[i]];
  }, { undoable: true, label: 'order changed' });
}

export function updateSettings(patch) {
  commit((d) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      d.settings[k] = k === 'formula' || k === 'unit' ? String(v) : num(v, d.settings[k]);
    }
  }, { undoable: true, label: 'settings changed' });
}

/* ------------------------------------------------------- backup & restore */

export function exportJSON() {
  return JSON.stringify({ ...load(), exportedAt: new Date().toISOString(), app: 'lifting-tracker' }, null, 2);
}

export function exportCSV() {
  const d = load();
  const names = new Map(d.exercises.map((e) => [e.id, e.name]));
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Date', 'Exercise', 'Weight (kg)', 'Reps', 'Sets', 'RIR', 'Notes']];
  for (const e of [...d.entries].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)) {
    rows.push([e.date, names.get(e.exerciseId) || '', e.weight, e.reps, e.sets, e.rir ?? '', e.notes]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

/** Replace everything with a previously exported document. Throws on junk. */
export function importJSON(text, { merge = false } = {}) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.exercises) && !Array.isArray(raw.entries))) {
    throw new Error('That file is not a Lifting Tracker backup.');
  }
  const incoming = normalise(raw);
  commit((d) => {
    if (!merge) {
      d.exercises = incoming.exercises;
      d.entries = incoming.entries;
      d.settings = incoming.settings;
      d.seq = incoming.seq;
      return;
    }
    const byName = new Map(d.exercises.map((e) => [e.name.toLowerCase(), e]));
    const remap = new Map();
    for (const ex of incoming.exercises) {
      const existing = byName.get(ex.name.toLowerCase());
      if (existing) { remap.set(ex.id, existing.id); continue; }
      const copy = { ...ex, id: uid('ex') };
      remap.set(ex.id, copy.id);
      d.exercises.push(copy);
    }
    const seen = new Set(d.entries.map((e) => `${e.date}|${e.exerciseId}|${e.weight}|${e.reps}|${e.sets}`));
    for (const en of incoming.entries) {
      const exId = remap.get(en.exerciseId);
      if (!exId) continue;
      const key = `${en.date}|${exId}|${en.weight}|${en.reps}|${en.sets}`;
      if (seen.has(key)) continue;             // same set, same day — skip
      seen.add(key);
      d.entries.push({ ...en, id: uid('en'), exerciseId: exId, seq: d.seq++ });
    }
  }, { undoable: true, label: 'backup restored' });
  return doc;
}

export function resetToSeed() {
  commit((d) => {
    const s = seedDoc();
    d.exercises = s.exercises;
    d.entries = s.entries;
    d.settings = s.settings;
    d.seq = s.seq;
  }, { undoable: true, label: 'reset to spreadsheet data' });
}

export function clearAll() {
  commit((d) => { d.entries = []; }, { undoable: true, label: 'log cleared' });
}

/* ----------------------------------------------------------------- theme */

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  applyTheme(theme);
  notify({ type: 'theme' });
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
