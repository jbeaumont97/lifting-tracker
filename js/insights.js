// insights.js — everything the per-set log makes answerable.
//
// metrics.js is the spreadsheet, ported faithfully and checked against it. This
// is the part the spreadsheet could never do: what happened inside a session,
// where a lift is heading, and how the whole log looks from above.
//
// Pure functions only — no DOM, no storage — so it runs in Node beside
// metrics.js and gets tested the same way.
//
// Two rules hold throughout:
//   - A set with `at: null` was backfilled, not measured. Nothing here invents
//     a time for it; anything needing timing skips it and says so.
//   - Nothing here feeds back into scoring. The block fields stay canonical, so
//     no figure the spreadsheet fixture checks can move because of this file.

import {
  dayNumber, isoAddDays, isoToday, e1rm, volume, repFactor, setBonus, slope,
  fatigueAt, accrualAt, retentionAt, typicalInterval, readinessSettings,
  READY_AT,
} from './metrics.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ========================================================= inside a session */

/**
 * Every physical set of one lift on one day, in the order it happened.
 *
 * A fully timestamped day sorts by when each set was done, which matters
 * because logSet merges a repeat into the entry it matches rather than
 * appending a new one — so entry order alone would put both squat sets before
 * the bench set that happened between them.
 *
 * Anything less than fully timestamped keeps write order instead; see the note
 * on the sort below for why half-sorting is worse than not sorting.
 */
export function sessionSets(entries) {
  const ordered = [...entries].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const out = [];
  for (const e of ordered) {
    const log = Array.isArray(e.log) ? e.log : [];
    const n = Number(e.sets) > 0 ? Math.round(Number(e.sets)) : 1;
    for (let i = 0; i < n; i++) {
      const rec = log[i] || {};
      const at = Number(rec.at);
      const measured = Number.isFinite(at) && at > 0;
      out.push({
        entryId: e.id,
        exerciseId: e.exerciseId,
        date: e.date,
        weight: Number(e.weight),
        reps: Math.round(Number(e.reps)),
        rir: rec.rir === null || rec.rir === undefined ? null : Number(rec.rir),
        note: String(rec.note || ''),
        at: measured ? at : null,
        measured,
      });
    }
  }
  // Reordering is only safe when every set can be placed. Sorting a partly
  // measured day by timestamp pushes the unmeasured sets to the end, which
  // closes the gap they were sitting in and makes two sets look adjacent that
  // were not — restIntervals would then report a rest that spans a set nothing
  // is known about. Write order is the honest fallback: it never invents
  // adjacency, and for separate entries it is chronological anyway.
  if (out.length > 1 && out.every((s) => s.measured)) out.sort((a, b) => a.at - b.at);
  return out;
}

/** True once there is enough timing to talk about rest at all. */
export function hasTiming(sets) {
  return sets.filter((s) => s.measured).length >= 2;
}

/** True once per-set RIR is real rather than a block minimum spread thin. */
export function hasPerSetRir(sets) {
  return sets.filter((s) => s.rir !== null).length >= 2;
}

/**
 * The gap between consecutive sets, in seconds. Only where both ends were
 * measured — a pair with a backfilled end has no gap to report, as distinct
 * from a gap of zero.
 */
export function restIntervals(sets) {
  const out = [];
  for (let i = 1; i < sets.length; i++) {
    const a = sets[i - 1];
    const b = sets[i];
    if (!a.measured || !b.measured) continue;
    const seconds = Math.round((b.at - a.at) / 1000);
    if (seconds < 0) continue;
    out.push({ afterIndex: i - 1, seconds });
  }
  return out;
}

/**
 * The rest this session actually ran at.
 *
 * The median, not the mean, and long gaps are dropped rather than averaged in:
 * walking away for twenty minutes is not a rest interval, it is the end of one
 * session and the start of another.
 */
export function typicalRest(sets, { maxSeconds = 1200 } = {}) {
  const usable = restIntervals(sets).map((r) => r.seconds).filter((v) => v > 0 && v <= maxSeconds);
  return usable.length ? Math.round(median(usable)) : null;
}

/** First measured set to last, in seconds. Null until two were measured. */
export function sessionDuration(sets) {
  const times = sets.filter((s) => s.measured).map((s) => s.at);
  if (times.length < 2) return null;
  return Math.round((Math.max(...times) - Math.min(...times)) / 1000);
}

/**
 * The session set by set: what each one was worth, what it added to the pile,
 * and how long you rested before it.
 */
export function sessionTimeline(sets, settings) {
  let cum = 0;
  return sets.map((s, i) => {
    const vol = volume(s.weight, s.reps, 1);
    cum += vol;
    const prev = sets[i - 1];
    const restBefore = prev && prev.measured && s.measured
      ? Math.round((s.at - prev.at) / 1000)
      : null;
    return {
      i,
      at: s.at,
      measured: s.measured,
      weight: s.weight,
      reps: s.reps,
      rir: s.rir,
      note: s.note,
      e1rm: e1rm(s.weight, s.reps, settings.formula),
      volume: vol,
      cumVolume: cum,
      restBefore,
    };
  });
}

/**
 * How much the session cost you as it went — reps falling away, RIR closing on
 * zero. Slopes per set, so -0.5 means half a rep lost per set.
 *
 * `reliable` is the honest gate: two sets is not a trend, and a block logged
 * before per-set RIR existed has nothing to fit.
 */
export function withinSessionFade(timeline) {
  const reps = timeline.map((t, i) => [i, t.reps]);
  const rirs = timeline.map((t, i) => [i, t.rir]).filter(([, v]) => v !== null && Number.isFinite(v));
  const repDrop = timeline.length >= 3 ? slope(reps) : null;
  const rirDrop = rirs.length >= 3 ? slope(rirs) : null;
  const flatten = (v) => (v === null ? null : (Math.abs(v) < 1e-9 ? 0 : v));
  return {
    repDrop: flatten(repDrop),
    rirDrop: flatten(rirDrop),
    sets: timeline.length,
    reliable: timeline.length >= 3,
  };
}

/**
 * How hard a session was, read off the real per-set RIR rather than the block's
 * minimum.
 *
 * The stored block keeps min(RIR) because that is the right summary of a block.
 * As a severity signal it is biased: eight sets that finished at RIR 0 and
 * three that did score identically, and the longer session was plainly harder.
 * The mean over the sets actually recorded says so.
 *
 * Only meaningful where per-set RIR exists — sessionSeverity() in metrics.js
 * stays the answer for everything logged before it did.
 */
export function sessionSeverityV2(sets, exercise) {
  const usual = Number(exercise?.setsPerSession) > 0 ? Number(exercise.setsPerSession) : 3;
  const count = sets.length > 0 ? sets.length : usual;
  const setPart = clamp(count / usual, 0.5, 1.6);
  const rirs = sets.map((s) => s.rir).filter((r) => r !== null && Number.isFinite(r));
  const rirPart = rirs.length
    ? clamp(1.25 - 0.12 * (rirs.reduce((a, b) => a + b, 0) / rirs.length), 0.7, 1.25)
    : 1;
  return clamp(setPart * rirPart, 0.4, 1.8);
}

/* ============================================================ paths forward */

/**
 * The round numbers people actually chase. Nobody sets out to hit an adjusted
 * e1RM of 118.3; they set out to put a hundred on the bar.
 */
export function milestoneStep(value) {
  if (!(value > 0)) return 5;
  if (value < 100) return 5;
  if (value < 200) return 10;
  return 25;
}

/** The heaviest weight ever moved on this lift, whatever the reps. */
export function bestWeight(stats) {
  let best = null;
  for (const e of stats.entries || []) {
    const w = Number(e.weight);
    if (Number.isFinite(w) && (best === null || w > best)) best = w;
  }
  return best;
}

/**
 * The next round number up, on the bar and on the score.
 *
 * Measured from your best rather than your last: a milestone you have already
 * passed and drifted back below is not the next thing to chase.
 */
export function milestones(stats, { count = 1 } = {}) {
  const out = [];
  const w = bestWeight(stats);
  if (Number.isFinite(w) && w > 0) {
    const step = milestoneStep(w);
    for (let i = 1; i <= count; i++) {
      const value = (Math.floor(w / step) + i) * step;
      out.push({ kind: 'weight', value, from: w, step, label: `${value} kg on the bar` });
    }
  }
  const b = stats.bestAdj;
  if (Number.isFinite(b) && b > 0) {
    const step = milestoneStep(b);
    for (let i = 1; i <= count; i++) {
      const value = (Math.floor(b / step) + i) * step;
      out.push({ kind: 'e1rm', value, from: b, step, label: `${value} score` });
    }
  }
  return out;
}

/**
 * When today's trend gets you to a given adjusted e1RM.
 *
 * Gated on trendReliable, which is metrics.js's rule for a fit worth
 * extrapolating — three entries across a fortnight. Without it this returns
 * null rather than a confident-sounding date built on two points.
 */
export function etaTo(value, stats, { todayIso = isoToday(), maxDays = 730 } = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(stats.lastAdj)) return null;
  const gap = value - stats.lastAdj;
  if (gap <= 0) {
    return { days: 0, date: todayIso, sessions: 0, reached: true, reliable: true, tooFar: false };
  }
  const per = stats.trendPerDay;
  if (!stats.trendReliable || !(per > 0)) return null;
  const days = Math.ceil(gap / per);
  if (days > maxDays) {
    return { days, date: null, sessions: null, reached: false, reliable: true, tooFar: true };
  }
  const every = stats.readiness && stats.readiness.typicalInterval;
  return {
    days,
    date: isoAddDays(todayIso, days),
    sessions: every > 0 ? Math.max(1, Math.round(days / every)) : null,
    reached: false,
    reliable: true,
    tooFar: false,
  };
}

/**
 * The next milestone on the bar, and what it would take to get there.
 *
 * A weight milestone has to be converted before it can be dated: the trend is
 * measured in adjusted e1RM, so the real question is when the score reaches
 * what that weight would score at the reps and sets this lift is trained with.
 */
export function runway(stats, settings, { todayIso = isoToday() } = {}) {
  const [target] = milestones(stats).filter((m) => m.kind === 'weight');
  if (!target) return null;

  const reps = Number(stats.lastReps) > 0 ? Math.round(Number(stats.lastReps)) : 5;
  const sets = Number(stats.exercise.setsPerSession) > 0
    ? Math.round(Number(stats.exercise.setsPerSession))
    : (Number(stats.lastSets) > 0 ? Math.round(Number(stats.lastSets)) : 3);
  const factor = repFactor(reps, settings.formula) * setBonus(sets, settings.setBonusK);
  if (!Number.isFinite(factor) || factor <= 0) return null;

  const scoreNeeded = target.value * factor;
  const best = bestWeight(stats);
  return {
    milestone: target,
    reps,
    sets,
    scoreNeeded,
    from: stats.lastAdj,
    // How far along the climb from the last round number to this one you are.
    progress: clamp((best - (target.value - target.step)) / target.step, 0, 1),
    eta: etaTo(scoreNeeded, stats, { todayIso }),
  };
}

/**
 * The readiness model drawn as a curve rather than reported as today's scalar.
 *
 * Samples forward from the last session so the shape is visible: the dip while
 * fatigue clears, the plateau once rest stops being productive, the slide once
 * the grace period runs out. Same functions the planner uses, so the curve and
 * the number on the card cannot disagree.
 */
export function readinessCurve(stats, settings, { days = 28, step = 1 } = {}) {
  const rs = readinessSettings(settings);
  if (!rs.enabled || !Number.isFinite(stats.lastAdj)) return [];
  const sessions = stats.sessions || [];
  const last = sessions.length ? sessions[sessions.length - 1] : null;
  if (!last) return [];

  const typical = typicalInterval(sessions);
  const productiveWindow = Math.max(rs.productiveDays, typical ? typical * 1.5 : 0);
  const grace = Math.max(rs.graceDays, typical ? typical * 2 : 0);

  // The same severity metrics.js derives, from the same session shape.
  const usual = Number(stats.exercise?.setsPerSession) > 0 ? Number(stats.exercise.setsPerSession) : 3;
  const setPart = clamp((Number(last.sets) > 0 ? Number(last.sets) : usual) / usual, 0.5, 1.6);
  const rir = last.best && last.best.rir;
  const rirPart = rir === null || rir === undefined || !Number.isFinite(Number(rir))
    ? 1 : clamp(1.25 - 0.12 * Number(rir), 0.7, 1.25);
  const severity = clamp(setPart * rirPart, 0.4, 1.8);

  const out = [];
  for (let d = 0; d <= days; d += step) {
    const fatigue = fatigueAt(d, severity, rs);
    const retention = retentionAt(d, grace, rs);
    const durable = rs.retainedFloor < 1
      ? clamp((retention - rs.retainedFloor) / (1 - rs.retainedFloor), 0, 1) : 1;
    const accrual = accrualAt(d, stats.gainPerWeek, productiveWindow) * durable;
    const factor = retention * (1 + accrual) * (1 - fatigue);
    out.push({
      daysSince: d,
      day: last.day + d,
      date: isoAddDays(last.date, d),
      fatigue,
      accrual,
      retention,
      factor,
      target: stats.lastAdj * factor,
      recovered: fatigue <= READY_AT,
    });
  }
  return out;
}

/* ========================================================== the whole body */

/** Weekly totals across every lift — the tonnage curve the app never drew. */
export function tonnageSeries(allStats, { weeks = 12, todayIso = isoToday() } = {}) {
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = isoAddDays(todayIso, -7 * i);
    const start = isoAddDays(end, -6);
    buckets.push({
      start, end, startDay: dayNumber(start), endDay: dayNumber(end),
      volume: 0, sets: 0, dates: new Set(),
    });
  }
  for (const st of allStats) {
    for (const e of st.entries || []) {
      for (const b of buckets) {
        if (e.day < b.startDay || e.day > b.endDay) continue;
        b.volume += e.volume;
        b.sets += Number(e.sets) > 0 ? Number(e.sets) : 1;
        b.dates.add(e.date);
        break;                                   // the weeks do not overlap
      }
    }
  }
  return buckets.map((b) => ({
    start: b.start, end: b.end, volume: b.volume, sets: b.sets, sessions: b.dates.size,
  }));
}

/**
 * Every personal best across every lift, oldest first.
 *
 * exerciseStats already marks the entries that were a PR when they were logged;
 * this is the merge across lifts, plus how much each beat the one before it by.
 */
export function prTimeline(allStats) {
  const out = [];
  for (const st of allStats) {
    let running = -Infinity;
    for (const e of st.entries || []) {
      if (!e.isPR) {
        if (Number.isFinite(e.adj)) running = Math.max(running, e.adj);
        continue;
      }
      out.push({
        date: e.date,
        day: e.day,
        exerciseId: st.exercise.id,
        name: st.exercise.name,
        adj: e.adj,
        delta: running > -Infinity ? e.adj - running : null,
        weight: e.weight,
        reps: e.reps,
        sets: e.sets,
      });
      running = Math.max(running, e.adj);
    }
  }
  return out.sort((a, b) => a.day - b.day);
}

/** One row per day over the window — the shape a consistency grid needs. */
export function consistency(allStats, { days = 112, todayIso = isoToday() } = {}) {
  const today = dayNumber(todayIso);
  const byDay = new Map();
  for (const st of allStats) {
    for (const e of st.entries || []) {
      if (e.day > today || e.day <= today - days) continue;
      let hit = byDay.get(e.day);
      if (!hit) { hit = { sets: 0, volume: 0, lifts: new Set() }; byDay.set(e.day, hit); }
      hit.sets += Number(e.sets) > 0 ? Number(e.sets) : 1;
      hit.volume += e.volume;
      hit.lifts.add(st.exercise.id);
    }
  }
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = today - d;
    const hit = byDay.get(day);
    out.push({
      date: isoAddDays(todayIso, -d),
      day,
      sets: hit ? hit.sets : 0,
      volume: hit ? hit.volume : 0,
      lifts: hit ? hit.lifts.size : 0,
    });
  }
  return out;
}

/**
 * Working sets per lift over the window, against what that lift asks for.
 *
 * Per LIFT, not per muscle: exercises carry no muscle-group taxonomy, so
 * anything claiming to balance push against pull would be inventing the
 * mapping. Heaviest share first.
 */
export function balance(allStats, { weeks = 4, todayIso = isoToday() } = {}) {
  const from = dayNumber(todayIso) - weeks * 7;
  const rows = allStats.map((st) => {
    let sets = 0;
    let volume = 0;
    for (const e of st.entries || []) {
      if (e.day <= from) continue;
      sets += Number(e.sets) > 0 ? Number(e.sets) : 1;
      volume += e.volume;
    }
    const target = Number(st.setsPerWeekTarget) > 0 ? Number(st.setsPerWeekTarget) * weeks : null;
    return {
      exerciseId: st.exercise.id,
      name: st.exercise.name,
      sets,
      volume,
      perWeek: sets / weeks,
      target,
      ratio: target ? sets / target : null,
      status: !target ? null : sets < target * 0.8 ? 'under' : sets > target * 1.2 ? 'over' : 'on target',
    };
  });
  const total = rows.reduce((n, r) => n + r.sets, 0);
  for (const r of rows) r.share = total > 0 ? r.sets / total : 0;
  return rows.sort((a, b) => b.sets - a.sets);
}
