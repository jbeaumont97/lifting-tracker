// export.js — "Export for analysis": the whole log as tidy tables in one .zip.
//
// The JSON backup holds everything, but nested and keyed by internal ids, and
// the CSV export is one table of the lift log in the shape it has always had.
// Neither answers "what has been working?" without code to unpick them first.
// This writes one flat table per kind of thing — a row per set, per session,
// per check-in, per day, per lift, per muscle per week — with the app's own
// numbers already worked out, plus a README describing every column, so the
// files open straight into a spreadsheet or a dataframe.
//
// No dependencies: the zip is written by hand below (stored, not deflated —
// the tables are small and the point is that it works offline).

import { setStimulus, isBodyweight, isoAddDays, hardSets } from './metrics.js';
import { SITES, bodyweightOn } from './measure.js';
import { MUSCLES, creditFor } from './muscles.js';

/* -------------------------------------------------------------- CSV */

const q = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';

/** Local wall-clock ISO time for a set's timestamp — the day is in its own column. */
const clock = (ms) => {
  if (!ms) return null;
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
};

/** Monday of the week a date falls in, as an ISO date. */
export function weekStart(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const back = (d.getDay() + 6) % 7;      // Monday = 0
  return isoAddDays(iso, -back);
}

/* ------------------------------------------------------------ tables */

/**
 * Build every table from the document and the computed stats.
 * `doc` is the store document; `stats` is allStats() for the same settings.
 */
export function buildTables(doc, stats) {
  const lifts = new Map(doc.exercises.map((e) => [e.id, e]));
  const days = new Map((doc.days || []).map((d) => [d.date, d]));
  const done = new Set((doc.done || []).map((d) => `${d.exerciseId}|${d.date}`));
  const measurements = doc.measurements || [];
  const dayCols = (date) => {
    const d = days.get(date);
    return d ? [d.unknown ? null : d.sleepHours, d.unknown ? null : d.energy, d.unknown ? 'yes' : 'no'] : [null, null, null];
  };
  const musclesOf = (ex, which) => (ex?.muscles?.[which] || []).join(';');

  // --- sets: one row per physical set ---
  const setRows = [];
  for (const st of stats) {
    const ex = st.exercise;
    const bw = isBodyweight(ex);
    for (const e of st.entries) {
      const n = Number(e.sets) > 0 ? Math.round(Number(e.sets)) : 1;
      const log = Array.isArray(e.log) && e.log.length === n ? e.log : null;
      for (let i = 0; i < n; i++) {
        const rec = log ? log[i] : null;
        const setRir = rec && rec.rir !== null && rec.rir !== undefined ? rec.rir : null;
        const rir = setRir ?? e.rir ?? null;
        const p = e.plan || {};
        setRows.push([
          e.date, clock(rec?.at), ex.name, bw ? 'bodyweight' : 'weight', e.id, i + 1, n,
          bw ? null : e.weight, e.reps, rir, setRir !== null ? 'set' : e.rir !== null && e.rir !== undefined ? 'block' : 'none',
          rec?.note || (i === 0 ? e.notes : '') || null,
          Number.isFinite(e.e1rm) ? e.e1rm : null,
          setStimulus(e.reps, rir),
          p.zone ?? null, p.role ?? null, p.weight ?? null, p.reps ?? null, p.sets ?? null, p.target ?? null, p.band ?? null,
          bw ? bodyweightOn(measurements, e.date)?.value ?? null : null,
          ...dayCols(e.date),
          musclesOf(ex, 'primary'), musclesOf(ex, 'secondary'),
        ]);
      }
    }
  }
  setRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1] || '').localeCompare(String(b[1] || '')));

  // --- sessions: one row per lift per day ---
  const sessionRows = [];
  for (const st of stats) {
    const ex = st.exercise;
    for (const s of st.sessions) {
      const todays = st.entries.filter((e) => e.date === s.date);
      const planned = todays.find((e) => e.plan)?.plan || null;
      const rirs = [];
      for (const e of todays) {
        const n = Number(e.sets) > 0 ? Math.round(Number(e.sets)) : 1;
        const log = Array.isArray(e.log) && e.log.length === n ? e.log : null;
        for (let i = 0; i < n; i++) {
          const r = log && log[i].rir !== null && log[i].rir !== undefined ? log[i].rir : e.rir;
          if (r !== null && r !== undefined) rirs.push(Number(r));
        }
      }
      const reps = todays.reduce((m, e) => m + e.reps * (Number(e.sets) || 1), 0);
      sessionRows.push([
        s.date, ex.name, s.sets, isBodyweight(ex) ? null : s.best.weight, s.best.reps,
        Number.isFinite(s.best.e1rm) ? s.best.e1rm : null, Number.isFinite(s.best.adj) ? s.best.adj : null,
        s.best.isPR ? 'yes' : 'no', isBodyweight(ex) ? null : s.volume, reps, s.hardSets,
        rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null, rirs.length ? Math.min(...rirs) : null,
        planned?.zone ?? null, planned?.target ?? null,
        planned?.target && Number.isFinite(s.best.adj) ? (s.best.adj >= planned.target - 1e-9 ? 'yes' : 'no') : null,
        done.has(`${ex.id}|${s.date}`) ? 'yes' : 'no',
        ...dayCols(s.date),
      ]);
    }
  }
  sessionRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

  // --- measurements: one row per check-in ---
  const measureRows = [...measurements]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => [m.date, ...SITES.map((s) => (Number.isFinite(m[s.key]) ? m[s.key] : null)), m.photos ? 'yes' : 'no', m.notes || null]);

  // --- days: every day with a check-in or a set ---
  const allDates = new Set([...(doc.days || []).map((d) => d.date), ...doc.entries.map((e) => e.date)]);
  const dayRows = [...allDates].sort().map((date) => {
    const es = doc.entries.filter((e) => e.date === date);
    const sets = es.reduce((n, e) => n + (Number(e.sets) || 1), 0);
    const liftsOn = [...new Set(es.map((e) => lifts.get(e.exerciseId)?.name).filter(Boolean))];
    return [date, ...dayCols(date), es.length ? 'yes' : 'no', sets, hardSets(es), liftsOn.join(';')];
  });

  // --- lifts: each lift's setup ---
  const liftRows = doc.exercises.map((e) => [
    e.id, e.name, e.kind, musclesOf(e, 'primary'), musclesOf(e, 'secondary'), e.muscles?.guessed ? 'yes' : 'no',
    e.kind === 'bodyweight' ? null : e.step, e.kind === 'bodyweight' ? null : e.base,
    e.setsPerSession, e.setsPerWeek, e.gainPerWeek, (e.tags || []).join(';'), e.notes || null,
  ]);

  // --- weekly muscles: hard sets per muscle per week, long format ---
  const weekly = new Map();   // `${week}|${muscle}` -> { hard, sets }
  const weeks = new Set();
  for (const st of stats) {
    for (const e of st.entries) {
      const wk = weekStart(e.date);
      weeks.add(wk);
      const dose = hardSets([e]);
      const n = Number(e.sets) || 1;
      for (const m of MUSCLES) {
        const c = creditFor(st.exercise, m.key);
        if (!c) continue;
        const k = `${wk}|${m.key}`;
        const cur = weekly.get(k) || { hard: 0, sets: 0 };
        cur.hard += dose * c;
        cur.sets += n * c;
        weekly.set(k, cur);
      }
    }
  }
  const weeklyRows = [];
  for (const wk of [...weeks].sort()) {
    for (const m of MUSCLES) {
      const v = weekly.get(`${wk}|${m.key}`) || { hard: 0, sets: 0 };
      weeklyRows.push([wk, m.key, v.hard, v.sets]);
    }
  }

  return {
    'sets.csv': csv(
      ['date', 'time', 'lift', 'lift_kind', 'block_id', 'set_in_block', 'sets_in_block', 'weight_kg', 'reps',
        'rir', 'rir_source', 'note', 'e1rm', 'hard_set_credit',
        'plan_zone', 'plan_role', 'plan_weight_kg', 'plan_reps', 'plan_sets', 'plan_target', 'plan_band',
        'bodyweight_kg', 'sleep_hours', 'energy', 'day_not_remembered', 'muscles_primary', 'muscles_secondary'],
      setRows),
    'sessions.csv': csv(
      ['date', 'lift', 'sets', 'best_weight_kg', 'best_reps', 'best_e1rm', 'adj_e1rm', 'pr',
        'tonnage_kg', 'total_reps', 'hard_sets', 'mean_rir', 'min_rir',
        'plan_zone', 'plan_target', 'met_target', 'marked_done', 'sleep_hours', 'energy', 'day_not_remembered'],
      sessionRows),
    'measurements.csv': csv(
      ['date', ...SITES.map((s) => `${s.key}_${s.unit}`), 'photos', 'notes'],
      measureRows),
    'days.csv': csv(
      ['date', 'sleep_hours', 'energy', 'day_not_remembered', 'trained', 'sets', 'hard_sets', 'lifts'],
      dayRows),
    'lifts.csv': csv(
      ['lift_id', 'name', 'kind', 'muscles_primary', 'muscles_secondary', 'muscles_guessed',
        'step_kg', 'base_kg', 'sets_per_session', 'sets_per_week_target', 'gain_per_week', 'tags', 'notes'],
      liftRows),
    'weekly-muscles.csv': csv(
      ['week_start', 'muscle', 'hard_sets', 'working_sets'],
      weeklyRows),
    'README.txt': README,
  };
}

const README = `Lifting Tracker — export for analysis
=====================================

Plain CSV, one table per kind of thing. Dates are ISO (YYYY-MM-DD), times
are local. Weights are kg, measurements cm unless the column says otherwise.
An empty cell means "not recorded", never zero. Lists inside a cell (muscles,
tags, lifts) are separated by semicolons.

sets.csv — one row per physical set
  block_id / set_in_block / sets_in_block  identical sets are stored as one
      block (3 x 5 @ 100 kg); this unrolls them, and block_id ties them back.
  time            when the set was logged; empty for sets written up afterwards.
  rir             reps in reserve. rir_source says where it came from: "set"
                  (recorded for that set), "block" (the block's lowest, from
                  before per-set RIR), or "none" (never recorded).
  e1rm            Epley estimated one-rep max for the set (empty on bodyweight lifts).
  hard_set_credit 0-1: how much of a hard set this was for hypertrophy — rep
                  credit (1 from 6 to 20 reps, tapering outside) x failure credit
                  (1 at 0-2 RIR, falling after; no RIR counts as 1).
  plan_*          what the app prescribed when the set was logged. plan_zone is
                  strength | hypertrophy | topset; plan_role is top | backoff for
                  the two halves of a topset session. Empty for sets logged
                  before plans were recorded — never back-filled.
  bodyweight_kg   bodyweight lifts only: the last weigh-in on or before that day.
  sleep_hours / energy (1-5)  the day's check-in. day_not_remembered = yes when
                  a past day was logged as "can't remember".

sessions.csv — one row per lift per day
  best_*          that day's best set by raw e1RM.
  adj_e1rm        the app's session score: best e1RM credited for every set.
  pr              whether the session beat every earlier one.
  hard_sets       sum of hard_set_credit for the session.
  met_target      whether adj_e1rm reached the plan's target.
  marked_done     whether "Done with this lift" was tapped.

measurements.csv — one row per body check-in
days.csv         — one row per day with a check-in or a set
lifts.csv        — each lift's setup, including the muscles it works
                   (muscles_guessed = yes if never confirmed in Setup).

weekly-muscles.csv — long format: one row per week (starting Monday) per muscle
  hard_sets       hard-set credit, counted in full for muscles a lift mainly
                  works and half for ones it also works.
  working_sets    the same weighting applied to plain set counts.

Useful joins: sets/sessions <-> days on date; sets/sessions <-> lifts on the
lift name; weekly-muscles <-> measurements by week_start (measurements are every
two weeks or so, so compare change between check-ins with the hard sets in
between).
`;

/* --------------------------------------------------------------- zip */

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A minimal zip: every file stored uncompressed, UTF-8 names. Enough for
 * Files, Finder, Windows, Excel and Python to open; nothing more.
 */
export function makeZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // UTF-8 names
    local.setUint16(8, 0, true);           // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The finished archive for the current document. */
export function exportForAnalysis(doc, stats, now = new Date()) {
  return makeZip(buildTables(doc, stats), now);
}

