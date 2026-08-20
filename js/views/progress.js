// views/progress.js — the Dashboard sheet, plus the charts a spreadsheet on a
// phone could never give you. The list is the overview; tap a lift for its
// progression chart, weekly work, and full session history.

import { el, statTile, segmented, details, disclose, milestoneTrack, emptyState, chevron, accentDot, prBadge, tap } from '../ui.js';
import { runway } from '../insights.js';
import { progressionChart, readinessLane, sparkline, setsMeter, weeklySetsChart } from '../charts.js';
import { fmt, fmtWeight, fmtSigned, fmtCompact, relativeDate, formatDate, dayNumber } from '../metrics.js';
import * as ui from '../core/uistate.js';

// Which lift is drilled into, and how the list is drawn. Kept in uistate so a
// reload puts you back where you were rather than at the top of the list.
const SELECTED = 'progress.selectedId';
const MODE = 'progress.listMode';
const RANGE = 'progress.range';

const selected = () => ui.get(SELECTED, null);
const listMode = () => ui.get(MODE, 'cards');

export function openExercise(id) { ui.set(SELECTED, id); }
export function clearSelection() { ui.set(SELECTED, null); }
export function hasSelection() { return selected() !== null; }

export function renderProgress(ctx) {
  const { stats } = ctx;
  const id = selected();
  if (id) {
    const st = stats.find((s) => s.exercise.id === id);
    if (st) return detailView(st, ctx);
    clearSelection();                    // the lift was deleted underneath us
  }
  return listView(ctx);
}

function listView(ctx) {
  const { stats, settings } = ctx;
  const root = el('section', { class: 'view view-progress' });
  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: 'Progress' }),
    el('p', { class: 'view-sub', text: 'One number per lift, and which way it is going. Tap a lift for its chart and history.' }),
  ]));

  const trained = stats.filter((s) => s.entryCount > 0);
  if (!trained.length) {
    root.append(emptyState('Nothing to show yet', 'Log a couple of sessions and your trends appear here.', 'Go to Log', () => ctx.goTo('log')));
    return root;
  }

  // ---- week summary ----
  const sets7 = stats.reduce((n, s) => n + s.sets7, 0);
  const vol7 = stats.reduce((n, s) => n + s.volume7, 0);
  const days7 = new Set();
  for (const s of stats) for (const e of s.entries) if (e.day >= dayNumber(ctx.today) - 7) days7.add(e.date);
  const rising = trained.filter((s) => (s.trendPerWeek ?? 0) > 0).length;

  root.append(el('div', { class: 'kpi-row' }, [
    statTile({ label: 'Sets, last 7 days', value: fmtCompact(sets7) }),
    statTile({ label: 'Volume, last 7 days', value: fmtCompact(vol7), unit: 'kg' }),
    statTile({ label: 'Sessions, last 7 days', value: String(days7.size) }),
    statTile({ label: 'Lifts trending up', value: `${rising}/${trained.length}` }),
  ]));

  root.append(el('div', { class: 'section-head' }, [
    el('h2', { class: 'section-title', text: 'Your lifts' }),
    // Cards are the shape a phone can read; the table is the whole Dashboard
    // sheet for when you want to compare lifts side by side.
    segmented({
      label: 'View', value: listMode(),
      options: [{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }],
      onChange: (v) => { ui.set(MODE, v); ctx.refresh({ transition: true }); },
    }),
  ]));

  if (listMode() === 'table') {
    root.append(dashboardTable(stats));
    root.append(el('p', { class: 'field-hint', text: 'Swipe the table sideways for trend, projections and weekly sets.' }));
  } else {
    const list = el('div', { class: 'card-list' });
    for (const s of stats) list.append(exerciseRow(s, ctx));
    root.append(list);
  }

  root.append(details('What these numbers mean', [
    el('p', { text: 'Every lift is boiled down to one number — an estimate of the most you could lift once, adjusted for how many sets you did. It lets 8 reps at 60 kg and 5 reps at 70 kg be compared honestly, so the line goes up when you get stronger rather than when you simply do more reps.' }),
    el('p', { text: 'The trend is that number fitted against time over your recent sessions, in kilos per week. Two sessions is not a trend — give it a few.' }),
    el('p', { text: 'Weekly sets is a plain count of working sets. Roughly 10–20 hard sets per muscle per week is the usual recommendation, spread across every lift that trains it.' }),
    disclose('Show the formulas', [
      el('p', { text: 'e1RM (Epley) = weight × (1 + reps/30). It puts 8 reps at 60 kg and 5 reps at 70 kg on the same scale. Adjusted e1RM multiplies that by (1 + k × ln(sets)) — extra sets earn credit with diminishing returns: +3.5% for 2 sets, +5.5% for 3, +8.0% for 5 at the default k of 0.05.' }),
      el('p', { text: 'Volume (weight × reps × sets) is tracked separately because it measures a different thing. Weekly sets is a plain count of working sets, because sets per week is the unit training is actually prescribed in — commonly 10–20 per muscle per week, spread across every lift that trains it.' }),
      el('p', { text: 'Trend is a least-squares fit of adjusted e1RM against date over the lookback window. Projections extend that straight line; real progress decelerates, so treat +12 weeks as an optimistic ceiling rather than a forecast.' }),
    ], { open: ctx.numbersOpen }),
  ]));
  return root;
}

const FLAT = 0.01;   // kg/week below which a trend is a plateau, not a direction

function trendClass(st) {
  if (!st.trendReliable || st.trendPerWeek == null || Math.abs(st.trendPerWeek) < FLAT) return '';
  return st.trendPerWeek > 0 ? ' is-good' : ' is-bad';
}

function exerciseRow(st, ctx) {
  const trendGood = st.trendPerWeek == null || Math.abs(st.trendPerWeek) < FLAT ? null : st.trendPerWeek > 0;
  const spark = sparkline(st.sessions.map((s) => s.best.adj));
  const stale = st.lastDate ? dayNumber(ctx.today) - dayNumber(st.lastDate) : null;

  return el('article', {
    class: 'card card-row',
    style: `view-transition-name: row-${cssName(st.exercise.id)}`,
  }, [
    el('button', {
      type: 'button', class: 'row-open',
      onclick: () => { tap(); openExercise(st.exercise.id); ctx.refresh({ transition: true }); },
    }, [
      accentDot(st.exercise.id),
      el('div', { class: 'row-open-main' }, [
        el('div', { class: 'card-title-row' }, [
          el('h3', { class: 'card-title', text: st.exercise.name }),
          st.prCount ? prBadge({ compact: true }) : null,
        ]),
        el('p', { class: 'card-meta', text: st.entryCount
          ? `${st.sessionCount} session${st.sessionCount === 1 ? '' : 's'} · last ${relativeDate(st.lastDate)}${stale != null && stale > 9 ? ' · getting stale' : ''}`
          : 'No sessions logged' }),
      ]),
      st.entryCount ? el('div', { class: 'row-open-figs' }, [
        el('span', { class: 'row-adj-big' }, [fmt(st.lastAdj, 1), el('small', { text: ' kg' })]),
        st.trendPerWeek != null
          ? el('span', { class: `row-trend${st.trendReliable && trendGood ? ' is-good' : st.trendReliable && trendGood === false ? ' is-bad' : ' is-muted'}`,
              text: Math.abs(st.trendPerWeek) < FLAT ? 'flat' : `${fmtSigned(st.trendPerWeek, 2)} kg/wk${st.trendReliable ? '' : ' (early)'}` })
          : el('span', { class: 'row-trend is-muted', text: 'needs 2 sessions' }),
      ]) : null,
      st.sessions.length > 1 ? spark : null,
      chevron('card-chevron is-right'),
    ]),
  ]);
}

function detailView(st, ctx) {
  const { settings } = ctx;
  const root = el('section', { class: 'view view-detail' });
  root.append(el('div', { class: 'detail-bar' }, [
    el('button', {
      type: 'button', class: 'back-btn',
      onclick: () => { tap(); clearSelection(); ctx.refresh({ transition: true }); },
    }, ['‹ All lifts']),
    el('button', { type: 'button', class: 'link-btn', onclick: () => ctx.goTo('plan', { openExercise: st.exercise.id }) }, ['Plan next →']),
  ]));
  root.append(el('header', { class: 'view-head' }, [
    el('h1', {}, [accentDot(st.exercise.id), st.exercise.name]),
    el('p', { class: 'view-sub', text: st.entryCount
      ? `${st.sessionCount} session${st.sessionCount === 1 ? '' : 's'}`
        + (st.entryCount !== st.sessionCount ? ` · ${st.entryCount} entries` : '')
        + ` · last ${relativeDate(st.lastDate).toLowerCase()}`
      : 'No sessions logged yet' }),
  ]));

  if (!st.entryCount) {
    root.append(emptyState('No history', 'Log a session for this lift to see it charted.', 'Log a set', () => ctx.goTo('log', { exerciseId: st.exercise.id })));
    return root;
  }

  // --- the hero number: where this lift stands right now ---
  root.append(el('div', { class: 'hero' }, [
    el('span', { class: 'hero-label', text: 'Where this lift stands' }),
    el('span', { class: 'hero-value' }, [fmt(st.lastAdj, 1), el('small', { text: ' kg' })]),
    el('span', { class: `hero-delta${trendClass(st)}`, text: heroTrendText(st) }),
  ]));

  // The hero is what you last lifted, which is a fact. After a layoff it is no
  // longer what you can lift, which is the more useful number and one the model
  // has always computed and never shown. Only worth a line while it differs.
  const r = st.readiness;
  if (r && r.enabled && r.retention < 1 - 1e-9 && Number.isFinite(r.baseline)) {
    root.append(el('p', { class: 'baseline-note' }, [
      el('span', { 'aria-hidden': 'true', text: r.phase.glyph }),
      el('span', {}, [
        'Worth about ',
        el('strong', { text: `${fmt(r.baseline, 1)} kg` }),
        ` today — ${Math.round(r.days)} days off has taken roughly `
          + `${((1 - r.retention) * 100).toFixed(0)}% off it.`,
      ]),
    ]));
  }

  // The destination the chart's projection is heading toward.
  const run = runway(st, settings, { todayIso: ctx.today });
  if (run) root.append(milestoneTrack(run));

  // How far back the chart looks. Only offer a window the lift has history to
  // fill — "1 year" on three weeks of training is a joke at the user's expense.
  const spanDays = st.sessions.length
    ? st.sessions[st.sessions.length - 1].day - st.sessions[0].day : 0;
  const RANGES = [
    { value: '56', label: '8 wks', days: 56 },
    { value: '182', label: '6 mths', days: 182 },
    { value: '365', label: '1 yr', days: 365 },
  ].filter((r) => spanDays > r.days);
  const chosen = ui.get(RANGE, 'all');
  const range = RANGES.find((r) => r.value === chosen) ? Number(chosen) : null;

  const chartHost = el('div', { class: 'chart-card' });
  let drawn = false;
  const paintChart = () => {
    const width = chartHost.clientWidth || 340;
    const parts = [progressionChart(st, settings, {
      width, height: 220, range, todayIso: ctx.today, animate: !drawn,
    })];
    // Only offered once there is more history than the shortest window.
    if (RANGES.length) {
      parts.unshift(el('div', { class: 'chart-range' }, [segmented({
        label: 'How far back', value: range === null ? 'all' : String(range),
        options: [...RANGES.map((r) => ({ value: r.value, label: r.label })), { value: 'all', label: 'All' }],
        onChange: (v) => { ui.set(RANGE, v); ctx.refresh(); },
      })]));
    }
    chartHost.replaceChildren(...parts);
    drawn = true;
  };
  root.append(chartHost);
  requestAnimationFrame(paintChart);
  ctx.onResize(paintChart);

  // The fatigue model, as a shape rather than as today's scalar.
  const laneHost = el('div', { class: 'chart-card' });
  let laneDrawn = false;
  const paintLane = () => {
    const lane = readinessLane(st, settings, {
      width: laneHost.clientWidth || 340, height: 104, todayIso: ctx.today,
    });
    if (!lane) { laneHost.remove(); return; }
    if (laneDrawn) lane.classList.add('no-anim');
    laneHost.replaceChildren(lane);
    laneDrawn = true;
  };
  root.append(laneHost);
  requestAnimationFrame(paintLane);
  ctx.onResize(paintLane);

  root.append(el('div', { class: 'kpi-row kpi-row-2' }, [
    statTile({ label: 'Best ever', value: fmt(st.bestAdj, 1), unit: 'kg',
      delta: st.prCount ? `${st.prCount} PR${st.prCount === 1 ? '' : 's'} so far` : null }),
    statTile({ label: 'Next target', value: fmt(st.nextTarget, 1), unit: 'kg',
      delta: targetDelta(st), deltaLabel: targetDeltaLabel(st) }),
  ]));

  // Straight-line projections read as promises if you put them next to the
  // numbers you have actually lifted, so they sit behind a label that says what
  // they are rather than behind a setting that hides them.
  root.append(disclose('Where this is heading', [
    el('div', { class: 'kpi-row kpi-row-2' }, [
      statTile({ label: 'Projected +4 wks', value: st.proj4 != null ? fmt(st.proj4, 1) : '—', unit: st.proj4 != null ? 'kg' : '',
        delta: st.proj4 == null ? 'needs 3 sessions over 2 weeks' : null }),
      statTile({ label: 'Projected +12 wks', value: st.proj12 != null ? fmt(st.proj12, 1) : '—', unit: st.proj12 != null ? 'kg' : '',
        delta: 'a ceiling, not a forecast' }),
    ]),
    el('p', { text: 'Both numbers extend today’s straight-line trend. Real progress '
      + 'decelerates, so treat them as the best case rather than the plan.' }),
  ], { open: ctx.numbersOpen }));

  const volHost = el('div', { class: 'chart-card' }, [setsMeter(st)]);
  const paintVol = () => {
    const width = volHost.clientWidth || 340;
    volHost.replaceChildren(setsMeter(st), weeklySetsChart(st, { width, height: 140, todayIso: ctx.today }));
  };
  root.append(volHost);
  requestAnimationFrame(paintVol);
  ctx.onResize(paintVol);

  root.append(el('div', { class: 'kpi-row kpi-row-2' }, [
    statTile({ label: 'Volume, last 7 days', value: fmtCompact(st.volume7), unit: 'kg' }),
    statTile({ label: 'Last session', value: `${st.lastSets} × ${st.lastReps}`, deltaLabel: '', delta: `@ ${fmtWeight(st.sessions[st.sessions.length - 1].best.weight)} kg` }),
  ]));

  root.append(el('h2', { class: 'section-title', text: 'Every session' }));
  root.append(sessionTable(st, settings));
  return root;
}

function sessionTable(st, settings) {
  const rows = [...st.sessions].reverse();
  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'data-table' }, [
      el('caption', { text: 'Best set of each session. Adj e1RM is what the chart plots.' }),
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: 'Date' }), el('th', { scope: 'col', text: 'Best set' }),
        el('th', { scope: 'col', text: 'Adj' }), el('th', { scope: 'col', text: 'Sets' }),
        el('th', { scope: 'col', text: 'Vol' }),
      ])]),
      el('tbody', {}, rows.map((s) => el('tr', { class: s.best.isPR ? 'is-pr' : '' }, [
        el('th', { scope: 'row', text: formatDate(s.date) }),
        el('td', { text: `${s.best.sets} × ${s.best.reps} @ ${fmtWeight(s.best.weight)} kg` }),
        el('td', {}, [fmt(s.best.adj, 1), s.best.isPR ? prBadge({ compact: true }) : null]),
        el('td', { text: String(s.sets) }),
        el('td', { text: fmt(s.volume, 0) }),
      ]))),
    ]),
  ]);
}

/** What moved the target off the last session, in one word. */
function targetDelta(st) {
  const r = st.readiness;
  if (!r || !r.enabled || st.lastAdj == null) return `+${(st.gainPerWeek * 100).toFixed(2)}%`;
  const pct = ((st.nextTarget / st.lastAdj) - 1) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`;
}

function targetDeltaLabel(st) {
  const r = st.readiness;
  if (!r || !r.enabled) return 'per week';
  switch (r.phase.key) {
    case 'recovering': return 'on last, held back for fatigue';
    case 'detrained': return 'on last, after the layoff';
    default: return `on last, ${r.days === 1 ? 'a day' : `${r.days} days`} ago`;
  }
}

function dashboardTable(stats) {
  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'data-table data-table-wide' }, [
      el('caption', { text: 'The Dashboard sheet, one row per lift. * = provisional fit, fewer than 3 sessions or under 2 weeks. Flat target is the spreadsheet’s — last session plus the weekly gain; Next target is that number after fatigue and detraining.' }),
      el('thead', {}, [el('tr', {}, [
        'Lift', 'Sessions', 'Last', 'Last adj', 'Best adj', 'Trend kg/wk', '+4 wks', '+12 wks', 'Flat target', 'Next target', 'Vol 7d', 'Sets 7d', 'Target/wk', 'Status',
      ].map((h) => el('th', { scope: 'col', text: h })))]),
      el('tbody', {}, stats.map((s) => el('tr', {}, [
        el('th', { scope: 'row', text: s.exercise.name }),
        el('td', { text: s.sessionCount ? String(s.sessionCount) : '—' }),
        el('td', { text: s.lastDate ? formatDate(s.lastDate) : '—' }),
        el('td', { text: s.lastAdj != null ? fmt(s.lastAdj, 1) : '—' }),
        el('td', { text: s.bestAdj != null ? fmt(s.bestAdj, 1) : '—' }),
        el('td', { text: s.trendPerWeek != null ? fmtSigned(s.trendPerWeek, 2) + (s.trendReliable ? '' : '*') : '—' }),
        el('td', { text: s.proj4 != null ? fmt(s.proj4, 1) : '—' }),
        el('td', { text: s.proj12 != null ? fmt(s.proj12, 1) : '—' }),
        el('td', { text: s.baseTarget != null ? fmt(s.baseTarget, 1) : '—' }),
        el('td', { text: s.nextTarget != null ? fmt(s.nextTarget, 1) : '—' }),
        el('td', { text: fmtCompact(s.volume7) }),
        el('td', { text: String(s.sets7) }),
        el('td', { text: s.setsPerWeekTarget ? String(s.setsPerWeekTarget) : '—' }),
        el('td', {}, [s.setStatus ? el('span', { class: `status-chip is-${s.setStatus.replace(' ', '-')}` }, [
          el('span', { class: 'status-glyph', 'aria-hidden': 'true', text: s.setStatus === 'under' ? '↓' : s.setStatus === 'over' ? '↑' : '✓' }),
          el('span', { text: s.setStatus }),
        ]) : '—']),
      ]))),
    ]),
  ]);
}

/** The trend, said either as a fitted slope or as plain direction. */
function heroTrendText(st) {
  if (st.trendPerWeek == null) return 'trend needs two sessions in the window';
  if (Math.abs(st.trendPerWeek) < FLAT) return 'holding steady over your recent sessions';
  const dir = st.trendPerWeek > 0 ? 'going up' : 'drifting down';
  return `${dir} about ${Math.abs(st.trendPerWeek).toFixed(2)} kg a week`
    + (st.trendReliable ? '' : ' — early days, so treat it lightly');
}

/** Exercise ids are user data; a view-transition-name has to be an identifier. */
function cssName(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

