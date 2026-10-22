// muscles.js — which muscles a lift trains, and how much work each one got.
//
// Size is built per muscle, not per lift. Ten hard sets of bench and ten of
// incline press are twenty sets of chest; ten of bench and none of anything
// else for the side delts is a pair of shoulders that will not grow. The only
// way to see that is to know what each lift works, so every lift carries two
// lists: the muscles it mainly works, which earn a full set, and the ones it
// also works, which earn half — the usual convention, and a judgement rather
// than a measurement, like the rest of the hard-set maths.

import { hardSets, dayNumber, isoToday } from './metrics.js';

export const MUSCLES = [
  { key: 'chest', label: 'Chest' },
  { key: 'front-delts', label: 'Front delts' },
  { key: 'side-delts', label: 'Side delts' },
  { key: 'rear-delts', label: 'Rear delts' },
  { key: 'lats', label: 'Lats' },
  { key: 'upper-back', label: 'Upper back' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'forearms', label: 'Forearms' },
  { key: 'quads', label: 'Quads' },
  { key: 'hamstrings', label: 'Hamstrings' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'lower-back', label: 'Lower back' },
  { key: 'calves', label: 'Calves' },
  { key: 'abs', label: 'Abs' },
];

export const MUSCLE_KEYS = MUSCLES.map((m) => m.key);
export const muscleLabel = (key) => MUSCLES.find((m) => m.key === key)?.label || key;

/** Credit a set earns for a muscle the lift mainly works, and one it also works. */
export const PRIMARY_CREDIT = 1;
export const SECONDARY_CREDIT = 0.5;

/** The usual weekly range for hard sets per muscle. */
export const WEEKLY_RANGE = { low: 10, high: 20 };

// Matched against the lift's name, first hit wins, so the specific patterns
// come before the general ones ("rear delt" before "delt", "romanian" before
// "deadlift"). Only a starting point: every lift's muscles can be changed.
const GUESSES = [
  [/rear\s*delt|face\s*pull|reverse\s*fl[yi]/i, ['rear-delts'], ['upper-back']],
  [/lateral|side\s*raise|lat(eral)?\s*raise/i, ['side-delts'], []],
  [/front\s*raise/i, ['front-delts'], []],
  [/incline/i, ['chest', 'front-delts'], ['triceps']],
  [/bench|chest\s*press|push[\s-]*up|press[\s-]*up|dip|fl[yi]e?s?\b|pec/i, ['chest'], ['front-delts', 'triceps']],
  [/overhead|ohp|military|shoulder\s*press|arnold/i, ['front-delts'], ['side-delts', 'triceps']],
  [/tricep|skull|push[\s-]*down|extension.*(arm|tri)|close[\s-]*grip/i, ['triceps'], []],
  [/pull[\s-]*up|chin[\s-]*up|pull[\s-]*down|pulldown/i, ['lats'], ['biceps', 'upper-back']],
  [/row/i, ['upper-back', 'lats'], ['biceps', 'rear-delts']],
  [/shrug/i, ['upper-back'], []],
  [/romanian|rdl|stiff|good\s*morning/i, ['hamstrings', 'glutes'], ['lower-back']],
  [/deadlift/i, ['hamstrings', 'glutes', 'lower-back'], ['quads', 'upper-back', 'forearms']],
  [/hip\s*thrust|glute\s*bridge/i, ['glutes'], ['hamstrings']],
  [/leg\s*curl|hamstring\s*curl|nordic/i, ['hamstrings'], []],
  [/leg\s*ext/i, ['quads'], []],
  [/squat|leg\s*press|lunge|split|step[\s-]*up|hack/i, ['quads', 'glutes'], ['hamstrings', 'lower-back']],
  [/calf|calves/i, ['calves'], []],
  [/crunch|plank|sit[\s-]*up|ab\b|abs\b|leg\s*raise|core/i, ['abs'], []],
];

/**
 * A first guess at what a lift works, from its name. Returns empty lists when
 * nothing matches — an honest "not set" rather than a wrong answer.
 */
export function guessMuscles(name) {
  const n = String(name || '');
  // Curls are the one name that means two different muscles.
  if (/curl/i.test(n)) {
    if (/leg|hamstring|lying|seated\s*leg|nordic/i.test(n)) return { primary: ['hamstrings'], secondary: [] };
    if (/wrist/i.test(n)) return { primary: ['forearms'], secondary: [] };
    return { primary: ['biceps'], secondary: ['forearms'] };
  }
  for (const [re, primary, secondary] of GUESSES) {
    if (re.test(n)) return { primary: [...primary], secondary: [...secondary] };
  }
  return { primary: [], secondary: [] };
}

/** Clean a stored muscles object; a muscle can only be in one of the two lists. */
export function normaliseMuscles(raw, name) {
  if (!raw || typeof raw !== 'object') return { ...guessMuscles(name), guessed: true };
  const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => MUSCLE_KEYS.includes(k)))];
  const primary = clean(raw.primary);
  const secondary = clean(raw.secondary).filter((k) => !primary.includes(k));
  return { primary, secondary, guessed: raw.guessed === true };
}

/** How much one set of this lift counts towards `muscle`: 1, 0.5 or 0. */
export function creditFor(exercise, muscle) {
  const m = exercise?.muscles;
  if (!m) return 0;
  if (m.primary.includes(muscle)) return PRIMARY_CREDIT;
  if (m.secondary.includes(muscle)) return SECONDARY_CREDIT;
  return 0;
}

/**
 * Hard sets per muscle, averaged per week over the last `weeks` weeks.
 *
 * Built on the same hardSets() as the per-lift numbers, so a heavy triple is
 * still worth nothing here and a set left five in reserve still counts for
 * less. Muscles nothing trains are included at zero — "what is lacking" is
 * the whole point, and a missing row cannot say so.
 */
export function muscleVolume(allStats, { weeks = 4, todayIso = isoToday() } = {}) {
  const from = dayNumber(todayIso) - weeks * 7;
  const rows = MUSCLES.map((m) => ({ ...m, hardSets: 0, lifts: [] }));
  for (const st of allStats) {
    const recent = (st.entries || []).filter((e) => e.day > from);
    const dose = hardSets(recent);
    if (!(dose > 0)) continue;
    for (const row of rows) {
      const c = creditFor(st.exercise, row.key);
      if (c > 0) {
        row.hardSets += dose * c;
        row.lifts.push(st.exercise.name);
      }
    }
  }
  for (const r of rows) {
    r.perWeek = r.hardSets / weeks;
    r.status = r.perWeek < WEEKLY_RANGE.low ? 'under' : r.perWeek > WEEKLY_RANGE.high ? 'over' : 'on target';
  }
  return rows;
}
