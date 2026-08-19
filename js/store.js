// store.js — all state lives in localStorage on this device. Nothing leaves it.
//
// One key holds one JSON document. Every mutation writes synchronously and
// notifies subscribers, so the UI is always a pure function of this document.

import { SEED } from './seed.js';
import { isoToday, setKey, READINESS_DEFAULTS } from './metrics.js';

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
  // One design now, not two: the verdict is always the headline and the
  // arithmetic sits behind a disclosure. This only decides whether those
  // disclosures start open.
  numbersOpen: false,
  restSeconds: 150,        // rest timer target; 0 turns the timer off
  unit: 'kg',

  // Fatigue / recovery / detraining — see readinessFor() in metrics.js.
  // 'off' falls back to the spreadsheet's flat per-session step.
  readiness: 'on',
  ...READINESS_DEFAULTS,
};

const STRING_SETTINGS = new Set(['formula', 'unit', 'readiness']);
const BOOL_SETTINGS = new Set(['numbersOpen']);

let doc = null;
const listeners = new Set();
let undoStack = [];

// Bumped by every commit. Anything that derives from the document memoises on
// this, so a render triggered by view state alone (a stepper nudge, a card
// opening) costs nothing to recompute. See js/core/select.js.
let version = 0;
export const getVersion = () => version;

/* ------------------------------------------------------------- lifecycle */

function blank() {
  return { schema: SCHEMA, exercises: [], entries: [], settings: { ...DEFAULT_SETTINGS }, seq: 1 };
}

function normalise(raw) {
  const d = { ...blank(), ...raw };
  d.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  // The simple/detailed split is gone: everything is reachable now, and the
  // only question is whether the numbers start open. Someone who chose the
  // detailed view was asking to see them, so they still do — and a document
  // predating the split kept everything, so it counts as detailed too.
  const legacy = raw.settings ? raw.settings.detailLevel : undefined;
  if (raw.settings && raw.settings.numbersOpen === undefined) {
    d.settings.numbersOpen = legacy === undefined || legacy === 'detailed';
  }
  d.settings.numbersOpen = d.settings.numbersOpen === true;
  delete d.settings.detailLevel;
  if (d.settings.readiness !== 'off') d.settings.readiness = 'on';
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
  // A spread over every entry blows the call stack on a long log; fold instead.
  d.seq = d.entries.reduce((m, e) => (e.seq + 1 > m ? e.seq + 1 : m), 1);
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
    // numbersOpen is stated explicitly so normalise() reads this as a new
    // document rather than an upgrade from before the disclosure change.
    settings: { numbersOpen: false, ...DEFAULT_SETTINGS, ...SEED.settings },
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
    // An install that predates the welcome tour has already been "onboarded" by
    // simply having been used — do not greet a returning user with a tour.
    if (doc.onboarded === undefined) doc.onboarded = true;
  } else {
    doc = seedDoc();          // first run: carry the spreadsheet's data across
    doc.onboarded = false;
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

/**
 * Mutate the document through this so saving and notifying never get skipped.
 *
 * Undo used to stringify the whole document before every mutation — O(document)
 * on the hot path, once per logged set. Instead a mutator hands back the inverse
 * of what it just did through `record()`, and only the coarse, rare operations
 * (import, reset, clear, deleting a lift) still pay for a full snapshot.
 */
function commit(fn, meta = {}) {
  load();
  const before = meta.coarse ? JSON.stringify(doc) : null;
  let inverse = null;
  fn(doc, (f) => { inverse = f; });
  if (meta.undoable && (before !== null || inverse)) {
    undoStack.push(before !== null
      ? { snapshot: before, label: meta.label || 'change' }
      : { inverse, label: meta.label || 'change' });
    if (undoStack.length > 20) undoStack.shift();
  }
  version++;
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
  if (last.snapshot !== undefined) {
    doc = normalise(JSON.parse(last.snapshot));
  } else {
    // The inverse restores an exactly-valid prior state, so there is nothing for
    // normalise() to fix. `seq` is deliberately left where it is: letting it fall
    // back would hand a future entry an id ordering that has already been used.
    last.inverse(doc);
  }
  version++;
  persist();
  notify({ type: 'change', undone: last.label });
  return true;
}

/**
 * Re-read a document another tab just wrote. The app used to answer the storage
 * event with location.reload(), which threw away whatever was half-typed; this
 * keeps the page, and the view state with it.
 *
 * The undo stack goes, because its inverses describe a document this tab no
 * longer has.
 */
export function reload() {
  doc = null;
  undoStack = [];
  load();
  version++;
  notify({ type: 'change', external: true });
  return doc;
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
  commit((d, record) => {
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
    const id = created.id;
    record((u) => { u.entries = u.entries.filter((e) => e.id !== id); });
  }, { undoable: true, label: 'set logged' });
  return created;
}

/** Every set logged for one lift on one day, oldest first. */
export function entriesOn(exerciseId, date) {
  return load().entries
    .filter((e) => e.exerciseId === exerciseId && e.date === date)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Log a single set, as it happens.
 *
 * Sets that match an existing one — same weight, reps, RIR and note — are
 * counted onto that entry rather than added beside it, so logging 3x5 set by
 * set produces exactly the row that logging it all at once would. A set that
 * differs in any way (the last one at four reps, say) becomes its own entry.
 */
export function logSet(set) {
  let created = null;
  commit((d, record) => {
    const date = set.date || isoToday();
    const candidate = {
      weight: Number(set.weight),
      reps: Math.round(Number(set.reps)),
      rir: set.rir === '' || set.rir === null || set.rir === undefined ? null : Number(set.rir),
      notes: String(set.notes || ''),
    };
    const key = setKey(candidate);
    const match = d.entries.find((e) => e.exerciseId === set.exerciseId && e.date === date && setKey(e) === key);
    if (match) {
      const prev = { id: match.id, sets: match.sets, rir: match.rir, notes: match.notes };
      match.sets += 1;
      // The block keeps the hardest set's RIR — the one closest to failure is
      // what the number is for — and collects any notes rather than losing one.
      if (candidate.rir !== null) match.rir = match.rir === null ? candidate.rir : Math.min(match.rir, candidate.rir);
      if (candidate.notes && !String(match.notes).includes(candidate.notes)) {
        match.notes = match.notes ? `${match.notes}; ${candidate.notes}` : candidate.notes;
      }
      created = match;
      record((u) => {
        const m = u.entries.find((e) => e.id === prev.id);
        if (m) { m.sets = prev.sets; m.rir = prev.rir; m.notes = prev.notes; }
      });
      return;
    }
    created = { id: uid('en'), date, exerciseId: set.exerciseId, ...candidate, sets: 1, seq: d.seq++ };
    d.entries.push(created);
    const id = created.id;
    record((u) => { u.entries = u.entries.filter((e) => e.id !== id); });
  }, { undoable: true, label: 'set logged' });
  return created;
}

/**
 * Take one set back off. `preferId` is the entry the caller last added to,
 * which is the only way to be exact about ordering — merged entries do not
 * record which set arrived when. Without it, the newest entry loses a set.
 */
export function removeLastSet(exerciseId, date, preferId = null) {
  let removed = null;
  commit((d, record) => {
    const mine = d.entries.filter((e) => e.exerciseId === exerciseId && e.date === date);
    if (!mine.length) return;
    const target = (preferId && mine.find((e) => e.id === preferId)) || mine.reduce((a, b) => (b.seq > a.seq ? b : a));
    removed = { weight: target.weight, reps: target.reps };
    if (target.sets > 1) {
      const id = target.id;
      target.sets -= 1;
      record((u) => { const m = u.entries.find((e) => e.id === id); if (m) m.sets += 1; });
    } else {
      const idx = d.entries.indexOf(target);
      const copy = { ...target };
      d.entries = d.entries.filter((e) => e.id !== target.id);
      record((u) => { u.entries.splice(Math.min(idx, u.entries.length), 0, copy); });
    }
  }, { undoable: true, label: 'set removed' });
  return removed;
}

export function updateEntry(id, patch) {
  commit((d, record) => {
    const e = d.entries.find((x) => x.id === id);
    if (!e) return;
    const prev = {
      date: e.date, weight: e.weight, reps: e.reps, sets: e.sets,
      rir: e.rir, notes: e.notes, exerciseId: e.exerciseId,
    };
    record((u) => { const t = u.entries.find((x) => x.id === id); if (t) Object.assign(t, prev); });
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
  commit((d, record) => {
    const idx = d.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const copy = { ...d.entries[idx] };
    d.entries.splice(idx, 1);
    record((u) => { u.entries.splice(Math.min(idx, u.entries.length), 0, copy); });
  }, { undoable: true, label: 'entry deleted' });
}

export function addExercise(ex) {
  const s = getSettings();
  let created = null;
  commit((d, record) => {
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
    const id = created.id;
    record((u) => { u.exercises = u.exercises.filter((e) => e.id !== id); });
  }, { undoable: true, label: 'exercise added' });
  return created;
}

export function updateExercise(id, patch) {
  commit((d, record) => {
    const ex = d.exercises.find((x) => x.id === id);
    if (!ex) return;
    const prev = { ...ex };
    record((u) => { const t = u.exercises.find((x) => x.id === id); if (t) Object.assign(t, prev); });
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
  }, { undoable: true, coarse: true, label: 'exercise deleted' });
}

export function moveExercise(id, delta) {
  commit((d, record) => {
    const i = d.exercises.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.exercises.length) return;
    [d.exercises[i], d.exercises[j]] = [d.exercises[j], d.exercises[i]];
    record((u) => { [u.exercises[i], u.exercises[j]] = [u.exercises[j], u.exercises[i]]; });
  }, { undoable: true, label: 'order changed' });
}

export function updateSettings(patch) {
  commit((d, record) => {
    const prev = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      prev[k] = d.settings[k];
      d.settings[k] = STRING_SETTINGS.has(k) ? String(v)
        : BOOL_SETTINGS.has(k) ? v === true || v === 'true'
        : num(v, d.settings[k]);
    }
    record((u) => { Object.assign(u.settings, prev); });
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
  }, { undoable: true, coarse: true, label: 'backup restored' });
  return doc;
}

export function resetToSeed() {
  commit((d) => {
    const s = seedDoc();
    d.exercises = s.exercises;
    d.entries = s.entries;
    d.settings = s.settings;
    d.seq = s.seq;
  }, { undoable: true, coarse: true, label: 'reset to spreadsheet data' });
}

/* ------------------------------------------------------------ onboarding */

export const isOnboarded = () => load().onboarded === true;

export function setOnboarded(value = true) {
  commit((d) => { d.onboarded = value !== false; }, { label: 'welcome tour' });
}

/** Keep the standard lifts, drop the sample sessions — "this is my log now". */
export function startFresh() {
  commit((d) => { d.entries = []; d.onboarded = true; }, { undoable: true, coarse: true, label: 'started fresh' });
}

export function clearAll() {
  commit((d) => { d.entries = []; }, { undoable: true, coarse: true, label: 'log cleared' });
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
  paintThemeColor(theme);
}

/**
 * Keep the browser chrome in step with the theme.
 *
 * index.html carries two <meta name="theme-color"> tags picked by
 * prefers-color-scheme, which is right until someone overrides the theme in the
 * app: forcing dark on a light phone left a pale status bar sitting above a
 * dark screen. A tag with no media query matches unconditionally, and the first
 * matching tag wins, so the override goes in front of the pair rather than
 * replacing them — with the theme back on "system" it is simply removed and the
 * original two take over again.
 *
 * The colour is read back off the stylesheet so the palette stays in one place.
 */
function paintThemeColor(theme) {
  const head = document.head;
  if (!head) return;
  head.querySelector('meta[name="theme-color"][data-override]')?.remove();
  if (theme === 'system') return;
  const plane = getComputedStyle(document.documentElement).getPropertyValue('--plane').trim();
  if (!plane) return;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', plane);
  meta.setAttribute('data-override', '');
  head.insertBefore(meta, head.firstChild);
}
