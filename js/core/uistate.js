// core/uistate.js — the view state that is not part of the document.
//
// Which card is open, which lift is drilled into, what is half-typed in the log
// form. All of it used to live in module scope in each view, so a reload lost
// it — and the app forced a reload whenever another tab wrote, which meant a
// second device syncing could discard a set you were in the middle of entering.
//
// sessionStorage is the right shelf for this: per tab, cleared when the tab
// goes, and never mixed into the backup the user exports.

const KEY = 'liftingTracker.ui';

let state = null;
let writeTimer = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(sessionStorage.getItem(KEY) || 'null') || {};
  } catch {
    state = {};                                  // private mode, or junk
  }
  return state;
}

/** Debounced: a stepper hold must not write to storage twenty times a second. */
function save() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, 150);
}

export function get(key, fallback) {
  const s = load();
  return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : fallback;
}

export function set(key, value) {
  const s = load();
  if (Object.is(s[key], value)) return value;
  if (value === undefined) delete s[key];
  else s[key] = value;
  save();
  return value;
}

/** Merge a patch into a stored object — the shape most views keep. */
export function patchObject(key, patch) {
  const cur = get(key, {}) || {};
  return set(key, { ...cur, ...patch });
}

/**
 * A per-exercise record, for the maps the views keep (overrides, grid mode).
 * Reads return a copy so a caller cannot mutate the store behind its back.
 */
export function forExercise(key, id, fallback = {}) {
  const all = get(key, {}) || {};
  return { ...fallback, ...(all[id] || {}) };
}

export function setForExercise(key, id, patch) {
  const all = { ...(get(key, {}) || {}) };
  all[id] = { ...(all[id] || {}), ...patch };
  return set(key, all);
}

export function clearForExercise(key, id) {
  const all = { ...(get(key, {}) || {}) };
  delete all[id];
  return set(key, all);
}

/**
 * Write immediately rather than waiting out the debounce. The app calls this
 * when the page is being hidden or torn down, so the last thing typed before
 * a phone locks or the tab is swiped away is still there on the way back.
 */
export function flush() {
  clearTimeout(writeTimer);
  writeTimer = null;
  if (!state) return;
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/**
 * Drop the in-memory copy so the next read comes off sessionStorage again.
 * What a page load does implicitly; tests need to ask for it.
 */
export function rehydrate() {
  clearTimeout(writeTimer);
  state = null;
}

/** Wipe everything. Used by the welcome tour when the log is started fresh. */
export function clearAll() {
  state = {};
  try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}
