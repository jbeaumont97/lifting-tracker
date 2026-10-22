// measure.js — body measurements, the other half of training for size.
//
// The lifts say whether you are getting stronger. Whether you are getting
// bigger is a different question, and the only honest answer is a tape measure
// read under the same conditions every couple of weeks. Everything here is
// pure: the store keeps the records, the views draw them.

import { isoAddDays, dayNumber } from './metrics.js';

/**
 * What gets measured, in the order a tape goes round you. Bodyweight is in kg,
 * every other site in cm. `growth` marks the sites that should go up when the
 * training is working; the waist is there to tell muscle from fat, and a waist
 * running ahead of everything else is the one result worth flagging.
 */
export const SITES = [
  { key: 'bodyweight', label: 'Bodyweight', unit: 'kg', step: 0.1, growth: false,
    how: 'Morning, after the toilet, before food.' },
  { key: 'shoulders', label: 'Shoulders', unit: 'cm', step: 0.5, growth: true,
    how: 'Round the widest point, arms relaxed at your sides.' },
  { key: 'chest', label: 'Chest', unit: 'cm', step: 0.5, growth: true,
    how: 'Across the nipples, at the end of a normal breath out.' },
  { key: 'arms', label: 'Arms', unit: 'cm', step: 0.5, growth: true,
    how: 'Flexed, round the peak of the biceps. Same arm every time.' },
  { key: 'waist', label: 'Waist', unit: 'cm', step: 0.5, growth: false,
    how: 'At the navel, relaxed — not sucked in.' },
  { key: 'thighs', label: 'Thighs', unit: 'cm', step: 0.5, growth: true,
    how: 'Halfway between hip and knee, standing, weight on both feet.' },
  { key: 'calves', label: 'Calves', unit: 'cm', step: 0.5, growth: true,
    how: 'Round the widest point, standing. Same leg every time.' },
];

export const SITE_KEYS = SITES.map((s) => s.key);

export const MEASURE_DEFAULTS = {
  measureEveryDays: 14,   // 0 switches the prompt off
  measurePhotos: true,    // remind to take progress photos at each check-in
};

/** Newest first is what every screen wants. */
export function sortedMeasurements(list) {
  return [...(list || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0));
}

/**
 * The most recent value of one site on or before `date`, with when it was
 * taken — or null. Each site is read on its own, because a check-in that
 * skipped the calves should not make the calves disappear.
 */
export function latestValue(list, key, date = null) {
  for (const m of sortedMeasurements(list)) {
    if (date && m.date > date) continue;
    const v = m[key];
    if (Number.isFinite(v) && v > 0) return { value: v, date: m.date };
  }
  return null;
}

/** Bodyweight as of a day: the last weigh-in on or before it. */
export function bodyweightOn(list, date) {
  return latestValue(list, 'bodyweight', date);
}

/**
 * Is a check-in due? `{ due, days, never, interval }`.
 *
 * Due once `interval` days have passed since the last one, or straight away if
 * there has never been one. A snooze holds it off until its date, and a
 * check-in taken since the snooze clears it — the snooze was about that one.
 */
export function measureDue(list, settings, today, snoozedUntil = null) {
  const interval = Number(settings?.measureEveryDays) || 0;
  if (!(interval > 0)) return { due: false, days: null, never: false, interval: 0 };
  const last = sortedMeasurements(list)[0];
  if (snoozedUntil && today < snoozedUntil) return { due: false, days: last ? dayNumber(today) - dayNumber(last.date) : null, never: !last, interval };
  if (!last) return { due: true, days: null, never: true, interval };
  const days = dayNumber(today) - dayNumber(last.date);
  return { due: days >= interval, days, never: false, interval, nextOn: isoAddDays(last.date, interval) };
}

/**
 * Change in one site: since the first reading, and since the one before the
 * latest. Null where there is nothing to compare against.
 */
export function siteChange(list, key) {
  const pts = sortedMeasurements(list)
    .filter((m) => Number.isFinite(m[key]) && m[key] > 0)
    .reverse();                                   // oldest first
  if (!pts.length) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  return {
    latest: last[key],
    latestDate: last.date,
    sinceFirst: pts.length > 1 ? last[key] - first[key] : null,
    firstDate: first.date,
    sinceLast: prev ? last[key] - prev[key] : null,
    points: pts.map((m) => ({ date: m.date, value: m[key] })),
  };
}

/**
 * The one reading worth a sentence: is the waist outpacing everything else?
 *
 * Some waist gain is normal when eating for size. What is worth knowing is when
 * it grows faster than the sites the training is aimed at, which usually means
 * the surplus is bigger than it needs to be. Needs at least four weeks between
 * first and last reading — a fortnight of tape noise is not a trend.
 */
export function waistFlag(list) {
  const waist = siteChange(list, 'waist');
  if (!waist || waist.sinceFirst === null) return null;
  const span = dayNumber(waist.latestDate) - dayNumber(waist.firstDate);
  if (span < 28 || waist.sinceFirst < 1) return null;
  const gains = SITES.filter((s) => s.growth)
    .map((s) => siteChange(list, s.key))
    .filter((c) => c && c.sinceFirst !== null)
    .map((c) => c.sinceFirst);
  const best = gains.length ? Math.max(...gains) : 0;
  if (waist.sinceFirst <= best) return null;
  return { waist: waist.sinceFirst, best, days: span };
}
