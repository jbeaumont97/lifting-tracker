// views/progress.js — the Dashboard sheet, plus the charts a spreadsheet on a
// phone could never give you. The list is the overview; tap a lift for its
// progression chart, weekly work, and full session history.

import { el, statTile, segmented, details, emptyState } from '../ui.js';
import { progressionChart, sparkline, setsMeter, weeklySetsChart } from '../charts.js';
import { fmt, fmtWeight, fmtSigned, fmtCompact, relativeDate, formatDate, isoToday } from '../metrics.js';

let selectedId = null;
let listMode = 'cards';

export function openExercise(id) { selectedId = id; }
export function clearSelection() { selectedId = null; }

export function renderProgress(ctx) {
  const { stats } = ctx;
  if (selectedId) {
    const st = stats.find((s) => s.exercise.id === selectedId);
    if (st) return detailView(st, ctx);
    selectedId = null;
  }
  return listView(ctx);
}

function listView(ctx) {
  const { stats, settings } = ctx;
  const root = el('section', { class: 'view view-progress' });
  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: 'Progress' }),
    el('p', { class: 'view-sub', text: 'Adjusted e1RM is the single number to watch. Trend is kilos per week fitted over your recent sessions.' }),
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
  for (const s of stats) for (const e of s.entries) if (e.day >= dayOf(isoToday()) - 7) days7.add(e.date);
  const rising = trained.filter((s) => (s.trendPerWeek ?? 0) > 0).length;

  root.append(el('div', { class: 'kpi-row' }, [
    statTile({ label: 'Sets, last 7 days', value: fmtCompact(sets7) }),
    statTile({ label: 'Volume, last 7 days', value: fmtCompact(vol7), unit: 'kg' }),
    statTile({ label: 'Sessions, last 7 days', value: String(days7.size) }),
    statTile({ label: 'Lifts trending up', value: `${rising}/${trained.length}` }),
  ]));

  root.append(el('div', { class: 'section-head' }, [
    el('h2', { class: 'section-title', text: 'Your lifts' }),
    segmented({
      label: 'View', value: listMode,
      options: [{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }],
      onChange: (v) => { listMode = v; ctx.refresh(); },
    }),
  ]));

  if (listMode === 'table') {
    root.append(dashboardTable(stats));
    root.append(el('p', { class: 'field-hint', text: 'Swipe the table sideways for trend, projections and weekly sets.' }));
  } else {
    const list = el('div', { class: 'card-list' });
    for (const s of stats) list.append(exerciseRow(s, ctx));
    root.append(list);
  }

  root.append(details('What these numbers mean', [
    el('p', { text: 'e1RM (Epley) = weight × (1 + reps/30). It puts 8 reps at 60 kg and 5 reps at 70 kg on the same scale. Adjusted e1RM multiplies that by (1 + k × ln(sets)) — extra sets earn credit with diminishing returns: +3.5% for 2 sets, +5.5% for 3, +8.0% for 5 at the default k of 0.05.' }),
    el('p', { text: 'Volume (weight × reps × sets) is tracked separately because it measures a different thing. Weekly sets is a plain count of working sets, because sets per week is the unit training is actually prescribed in — commonly 10–20 per muscle per week, spread across every lift that trains it.' }),
    el('p', { text: 'Trend is a least-squares fit of adjusted e1RM against date over the lookback window. Projections extend that straight line; real progress decelerates, so treat +12 weeks as an optimistic ceiling rather than a forecast.' }),
  ]));
  return root;
}

const FLAT = 0.01;   // kg/week below which a trend is a plateau, not a direction

function trendClass(st) {
  if (!st.trendReliable || st.trendPerWeek == null || Math.abs(st.trendPerWeek) < FLAT) return '';
  return st.trendPerWeek > 0 ? ' is-good' : ' is-bad';
}

function trendWords(perWeek) {
  return Math.abs(perWeek) < FLAT ? 'flat' : `${fmtSigned(perWeek, 2)} kg/week`;
}

function exerciseRow(st, ctx) {
  const trendGood = st.trendPerWeek == null || Math.abs(st.trendPerWeek) < FLAT ? null : st.trendPerWeek > 0;
  const spark = sparkline(st.sessions.map((s) => s.best.adj));
  const stale = st.lastDate ? dayOf(isoToday()) - dayOf(st.lastDate) : null;

  return el('article', { class: 'card card-row' }, [
    el('button', { type: 'button', class: 'row-open', onclick: () => { selectedId = st.exercise.id; ctx.refresh(); } }, [
      el('div', { class: 'row-open-main' }, [
        el('h3', { class: 'card-title', text: st.exercise.name }),
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
      el('span', { class: 'card-chevron', 'aria-hidden': 'true', text: '›' }),
    ]),
  ]);
}

function detailView(st, ctx) {
  const { settings } = ctx;
  const root = el('section', { class: 'view view-detail' });
  root.append(el('div', { class: 'detail-bar' }, [
    el('button', { type: 'button', class: 'back-btn', onclick: () => { selectedId = null; ctx.refresh(); } }, ['‹ All lifts']),
    el('button', { type: 'button', class: 'link-btn', onclick: () => ctx.goTo('plan', { openExercise: st.exercise.id }) }, ['Plan next →']),
  ]));
  root.append(el('header', { class: 'view-head' }, [
    el('h1', { text: st.exercise.name }),
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
    el('span', { class: 'hero-label', text: 'Adjusted e1RM, last session' }),
    el('span', { class: 'hero-value' }, [fmt(st.lastAdj, 1), el('small', { text: ' kg' })]),
    el('span', { class: `hero-delta${trendClass(st)}`, text:
      st.trendPerWeek == null ? 'trend needs two sessions in the window'
        : st.trendReliable ? `${trendWords(st.trendPerWeek)}, fitted over ${st.trendWindowCount} entries`
        : `${trendWords(st.trendPerWeek)} — provisional, only ${st.trendWindowCount} entries across ${st.trendWindowDays} days` }),
  ]));

  const chartHost = el('div', { class: 'chart-card' });
  const paintChart = () => {
    const width = chartHost.clientWidth || 340;
    chartHost.replaceChildren(progressionChart(st, settings, { width, height: 220 }));
  };
  root.append(chartHost);
  requestAnimationFrame(paintChart);
  ctx.onResize(paintChart);

  root.append(el('div', { class: 'kpi-row' }, [
    statTile({ label: 'Best ever', value: fmt(st.bestAdj, 1), unit: 'kg' }),
    statTile({ label: 'Next target', value: fmt(st.nextTarget, 1), unit: 'kg', delta: `+${(st.gainPerWeek * 100).toFixed(2)}%`, deltaLabel: 'per week' }),
    statTile({ label: 'Projected +4 wks', value: st.proj4 != null ? fmt(st.proj4, 1) : '—', unit: st.proj4 != null ? 'kg' : '',
      delta: st.proj4 == null ? 'needs 3 sessions over 2 weeks' : null }),
    statTile({ label: 'Projected +12 wks', value: st.proj12 != null ? fmt(st.proj12, 1) : '—', unit: st.proj12 != null ? 'kg' : '',
      delta: st.proj12 == null ? 'a ceiling, not a forecast' : 'a ceiling, not a forecast' }),
  ]));

  const volHost = el('div', { class: 'chart-card' }, [setsMeter(st)]);
  const paintVol = () => {
    const width = volHost.clientWidth || 340;
    volHost.replaceChildren(setsMeter(st), weeklySetsChart(st, { width, height: 140 }));
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
      el('tbody', {}, rows.map((s) => el('tr', {}, [
        el('th', { scope: 'row', text: formatDate(s.date) }),
        el('td', { text: `${s.best.sets} × ${s.best.reps} @ ${fmtWeight(s.best.weight)} kg` }),
        el('td', { text: fmt(s.best.adj, 1) }),
        el('td', { text: String(s.sets) }),
        el('td', { text: fmt(s.volume, 0) }),
      ]))),
    ]),
  ]);
}

function dashboardTable(stats) {
  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'data-table data-table-wide' }, [
      el('caption', { text: 'The Dashboard sheet, one row per lift. * = provisional fit, fewer than 3 sessions or under 2 weeks.' }),
      el('thead', {}, [el('tr', {}, [
        'Lift', 'Sessions', 'Last', 'Last adj', 'Best adj', 'Trend kg/wk', '+4 wks', '+12 wks', 'Next target', 'Vol 7d', 'Sets 7d', 'Target/wk', 'Status',
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

function dayOf(iso) {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse('2020-01-01T00:00:00Z')) / 86400000);
}
