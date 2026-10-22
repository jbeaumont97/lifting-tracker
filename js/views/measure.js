// views/measure.js — body measurements, under Progress.
//
// The lift screens can tell you that you are stronger. Only this one can tell
// you that you are bigger, and it does it the boring way that works: a tape,
// the same conditions, every couple of weeks, and the change since you started.

import { el, stepper, statTile, details, toast, confirmSheet, tap, chipGroup } from '../ui.js';
import { sparkline, measureChart, measureCompareChart } from '../charts.js';
import * as store from '../store.js';
import * as ui from '../core/uistate.js';
import { fmt, fmtSigned, formatDate, relativeDate } from '../metrics.js';
import { SITES, measureDue, siteChange, waistFlag, sortedMeasurements } from '../measure.js';

const DRAFT = 'measure.draft';   // the half-filled check-in, so a reload keeps it
const FORM_OPEN = 'measure.formOpen';
const CHART = 'measure.chart';     // 'all' or a site key

/** "Today" reads as "today" mid-sentence; "Thu, Nov 5" stays as it is. */
function inSentence(rel) {
  return /^(Today|Yesterday|Tomorrow|In |\d)/.test(rel) ? rel.charAt(0).toLowerCase() + rel.slice(1) : rel;
}

/** Open the check-in form next time the screen draws — the prompt uses this. */
export function openMeasureForm() { ui.set(FORM_OPEN, true); }

export function renderMeasure(ctx, header) {
  const { settings, today } = ctx;
  const list = store.getMeasurements();
  const root = el('section', { class: 'view view-measure' });
  root.append(header);

  const due = measureDue(list, settings, today, store.getMeasureSnooze());
  const formOpen = ui.get(FORM_OPEN, false) || !list.length;

  if (formOpen) root.append(checkInForm(ctx, list));
  else {
    root.append(el('div', { class: 'measure-cta' }, [
      el('p', { class: 'card-note', text: due.due
        ? `A check-in is due — it has been ${due.days} days.`
        : due.interval
          ? `Last check-in ${inSentence(relativeDate(sortedMeasurements(list)[0].date, today))}. The next is due ${inSentence(relativeDate(due.nextOn, today))}.`
          : 'Check-in reminders are off. Turn them on in Setup.' }),
      el('button', {
        type: 'button', class: `btn ${due.due ? 'btn-primary' : 'btn-ghost'} btn-block`,
        onclick: () => { tap(); ui.set(FORM_OPEN, true); ctx.refresh({ transition: true }); },
      }, ['Take measurements']),
    ]));
  }

  if (list.length) {
    root.append(chartCard(ctx, list));
    root.append(el('h2', { class: 'section-title', text: 'Since you started' }));
    const tiles = [];
    const picked = ui.get(CHART, 'all');
    for (const site of SITES) {
      const c = siteChange(list, site.key);
      if (!c) continue;
      const d = c.sinceFirst;
      // Growth sites are good going up; bodyweight and waist are neither good
      // nor bad on their own, so they get no colour at all.
      const good = d === null || Math.abs(d) < 1e-9 || !site.growth ? undefined : d > 0;
      const tile = statTile({
        label: site.label,
        value: fmt(c.latest, 1),
        unit: site.unit,
        delta: d === null ? null : `${fmtSigned(d, 1)} ${site.unit}`,
        deltaLabel: d === null ? null : `since ${formatDate(c.firstDate)}`,
        good,
        spark: c.points.length > 1 ? sparkline(c.points.map((p) => p.value)) : null,
      });
      // A tile is a way into its own chart: tap it and the chart above shows
      // that site in full.
      tile.classList.add('is-pickable');
      if (picked === site.key) tile.classList.add('is-picked');
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', `Chart ${site.label.toLowerCase()}`);
      const pick = () => {
        tap();
        ui.set(CHART, site.key);
        ctx.refresh();
        requestAnimationFrame(() => document.querySelector('.measure-chart-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
      };
      tile.addEventListener('click', pick);
      tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      tiles.push(tile);
    }
    root.append(el('div', { class: 'kpi-row measure-tiles' }, tiles));

    const flag = waistFlag(list);
    if (flag) {
      root.append(el('p', { class: 'measure-flag' }, [
        el('span', { class: 'measure-flag-glyph', 'aria-hidden': 'true', text: '!' }),
        el('span', { text: `Your waist is up ${fmt(flag.waist, 1)} cm in ${Math.round(flag.days / 7)} weeks, more than any of the sites you are training. Some of that is normal when eating for size; if it keeps outpacing your chest and arms, the surplus is probably bigger than it needs to be.` }),
      ]));
    }

    root.append(history(ctx, list));
  }

  root.append(details('How to measure', [
    el('p', { text: 'Same time of day, same conditions, every time — first thing in the morning, before food, is easiest to repeat. Pull the tape snug against the skin without pressing in, and take each site twice; if the two disagree by more than half a centimetre, take a third.' }),
    el('ul', { class: 'measure-how' }, SITES.map((s) => el('li', {}, [el('strong', { text: `${s.label}. ` }), s.how]))),
    el('p', { text: 'Expect small numbers. Around 0.5–1 cm a month on the arms is good going for someone newer to lifting, and a single check-in can move a centimetre either way on water alone. The trend over two or three months is what means something.' }),
  ]));
  return root;
}

/**
 * The chart: every trained site on one percent scale, or one site in its own
 * units. "All" is the default because it is the motivating view — everything
 * you are training, going up together — and one site is a tap away.
 */
function chartCard(ctx, list) {
  const withData = SITES.filter((s) => siteChange(list, s.key));
  let chosen = ui.get(CHART, 'all');
  if (chosen !== 'all' && !withData.some((s) => s.key === chosen)) chosen = 'all';
  const host = el('div', { class: 'chart-card measure-chart-card' });
  let drawn = false;
  let paintedAt = null;
  const paint = () => {
    const width = host.clientWidth || 340;
    paintedAt = width;
    const chart = chosen === 'all'
      ? measureCompareChart(
        SITES.filter((s) => s.growth).map((s) => ({ key: s.key, label: s.label, points: siteChange(list, s.key)?.points || [] })),
        { width, height: 220, animate: !drawn },
      )
      : measureChart(siteChange(list, chosen).points, SITES.find((s) => s.key === chosen), { width, height: 210, animate: !drawn });
    host.replaceChildren(
      el('h2', { class: 'section-title', text: chosen === 'all' ? 'Growth, all together' : SITES.find((s) => s.key === chosen).label }),
      chipGroup({
        label: 'Which measurement to chart',
        value: chosen,
        options: [{ value: 'all', label: 'All' }, ...withData.map((s) => ({ value: s.key, label: s.label }))],
        onChange: (v) => { ui.set(CHART, v); ctx.refresh(); },
      }),
      chart,
    );
    drawn = true;
  };
  // Painted on the next frame, once the card is on the page and has a real
  // width — the same as the lift charts, since the viewBox has to match it for
  // one unit to be one pixel. Resizes repaint without replaying the draw-in.
  requestAnimationFrame(paint);
  ctx.onResize(() => { if (host.clientWidth !== paintedAt) paint(); });
  return host;
}

function checkInForm(ctx, list) {
  const { settings, today } = ctx;
  // Start from the last values: most sites move a few millimetres, and nudging
  // from there is far quicker than typing every number fresh.
  const last = sortedMeasurements(list)[0] || {};
  const draft = ui.get(DRAFT, null) || { date: today, photos: false, notes: '' };
  const save = (patch) => { Object.assign(draft, patch); ui.set(DRAFT, { ...draft }); };
  const valueOf = (k) => (draft[k] !== undefined ? draft[k] : last[k] ?? '');

  const steppers = SITES.map((s) => stepper({
    label: `${s.label} (${s.unit})`,
    value: valueOf(s.key),
    step: s.step,
    min: 0,
    max: s.unit === 'kg' ? 400 : 250,
    dp: 1,
    suffix: s.unit,
    placeholder: '—',
    id: `measure-${s.key}`,
    onChange: (v) => save({ [s.key]: v }),
  }));

  const photos = settings.measurePhotos
    ? el('label', { class: 'check-row' }, [
      el('input', {
        type: 'checkbox', checked: draft.photos ? true : null,
        onchange: (e) => save({ photos: e.target.checked }),
      }),
      el('span', {}, [
        el('strong', { text: 'Progress photos taken' }),
        el('small', { text: ' Front, side and back, same light and spot as last time. They stay in your camera roll; the app only notes that you took them.' }),
      ]),
    ])
    : null;

  const notes = el('textarea', { class: 'text-input', rows: 2, placeholder: 'Anything worth remembering (optional)', 'aria-label': 'Notes' });
  notes.value = draft.notes || '';
  notes.addEventListener('input', () => save({ notes: notes.value }));

  return el('div', { class: 'card measure-form' }, [
    el('div', { class: 'card-body' }, [
      el('h2', { class: 'section-title', text: 'Check-in' }),
      el('p', { class: 'card-note', text: list.length
        ? 'Filled in with last time’s numbers — nudge whatever changed, and clear any site you skipped.'
        : 'Your first check-in. Fill in whatever you can measure; you can skip any site.' }),
      el('div', { class: 'measure-grid' }, steppers),
      photos,
      notes,
      el('div', { class: 'card-actions' }, [
        el('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => {
            const rec = { date: draft.date || today, photos: draft.photos === true, notes: draft.notes || '' };
            for (const s of steppers) {
              const key = SITES[steppers.indexOf(s)].key;
              const v = s.getValue();
              if (s.input.value.trim() !== '' && Number.isFinite(v) && v > 0) rec[key] = v;
            }
            const saved = store.addMeasurement(rec);
            if (!saved) { toast('Enter at least one measurement first.'); return; }
            ui.set(DRAFT, undefined);
            ui.set(FORM_OPEN, false);
            tap([20, 40, 20]);
            toast('Check-in saved', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' });
            ctx.refresh({ transition: true });
          },
        }, ['Save check-in']),
        list.length ? el('button', {
          type: 'button', class: 'btn btn-ghost',
          onclick: () => { ui.set(FORM_OPEN, false); ctx.refresh({ transition: true }); },
        }, ['Cancel']) : null,
      ]),
    ]),
  ]);
}

function history(ctx, list) {
  const rows = sortedMeasurements(list).slice(0, 12);
  return el('div', { class: 'measure-history' }, [
    el('h2', { class: 'section-title', text: 'Check-ins' }),
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'data-table measure-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Date' }),
          ...SITES.map((s) => el('th', { scope: 'col', text: s.label })),
          el('th', { scope: 'col', text: 'Photos' }),
          el('th', { scope: 'col', 'aria-label': 'Delete' }),
        ])]),
        el('tbody', {}, rows.map((m) => el('tr', {}, [
          el('th', { scope: 'row', text: formatDate(m.date) }),
          ...SITES.map((s) => el('td', { text: Number.isFinite(m[s.key]) ? fmt(m[s.key], 1) : '—' })),
          el('td', { text: m.photos ? '✓' : '' }),
          el('td', {}, [el('button', {
            type: 'button', class: 'link-btn', 'aria-label': `Delete check-in from ${formatDate(m.date)}`,
            onclick: () => confirmSheet({
              title: 'Delete this check-in?',
              message: `The measurements from ${formatDate(m.date)} will be removed.`,
              onConfirm: () => {
                store.deleteMeasurement(m.id);
                toast('Check-in deleted', { action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo' });
                ctx.refresh();
              },
            }),
          }, ['✕'])]),
        ]))),
      ]),
    ]),
    el('p', { class: 'field-hint', text: 'Bodyweight in kg, everything else in cm. Swipe the table sideways for every site.' }),
  ]);
}
