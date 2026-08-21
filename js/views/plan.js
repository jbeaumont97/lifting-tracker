// views/plan.js — the NextSession sheet, rebuilt as the app's home screen.
//
// The screen answers one question: what do I do today? Lifts are grouped by
// whether they are ready, the stalest first, and the top card opens itself so
// the first thing on screen is a weight rather than a list of closed rows.
//
// Every lift gets one card carrying a single concrete prescription. Open a card
// and you get the target and the reps/sets levers; in the detailed view you
// also get the full trade-off grid the spreadsheet drew, colour-banded against
// your target.

import { el, stepper, segmented, bandChip, toast, details, disclose, milestoneTrack, chevron, accentDot, tap } from '../ui.js';
import * as store from '../store.js';
import { runway, looksBodyweight } from '../insights.js';
import * as ui from '../core/uistate.js';
import {
  planFor,
  BANDS,
  fmt,
  fmtWeight,
  fmtSigned,
  relativeDate,
  weekdayName,
  plainVerdict,
  snapReps,
  readinessNote,
  readinessMaths,
  READY_AT,
  isBodyweight,
  REP_SCHEMES,
  SET_COLUMNS,
} from '../metrics.js';

// View state lives in core/uistate.js so a reload does not throw it away.
const OV = 'plan.overrides';   // exerciseId -> { target, reps, sets }
const GRID = 'plan.gridMode';  // exerciseId -> { mode: 'weights'|'scores'|'table' }
const OPEN = 'plan.openId';
// undefined = nothing decided yet, so the view may open the top card itself.
// null = every card is deliberately closed.
const openId = () => ui.get(OPEN, undefined);
const setOpenId = (v) => ui.set(OPEN, v);

// Readiness is decided by the model now (metrics.js: readinessFor), not by a
// day count here. These two are only the fallback for a document written before
// the model existed, or with it switched off.
const RESTED_DAYS = 2;   // trained today or yesterday is still recovering
const STALE_DAYS = 10;   // past this, a lift is drifting rather than resting

/** Fit to be trained hard today. */
function isReady(s) {
  if (s.readiness && s.readiness.enabled) return s.readiness.recovered;
  return (s.daysSince ?? 999) >= RESTED_DAYS;
}

/** The card's manual overrides. A read-only copy — write through setOv(). */
function ov(id) {
  return ui.forExercise(OV, id, { target: null, reps: null, sets: null });
}

function setOv(id, patch) { ui.setForExercise(OV, id, patch); }

export function renderPlan(ctx) {
  const { settings, stats } = ctx;
  const root = el('section', { class: 'view view-plan' });

  root.append(
    el('header', { class: 'view-head' }, [
      el('h1', { text: 'Next session' }),
      el('p', {
        class: 'view-sub',
        text: 'One prescription per lift, sized to be a small step up on your last session.',
      }),
    ]),
  );

  const trained = stats.filter((s) => s.entryCount > 0);
  if (!trained.length) {
    root.append(
      el('div', { class: 'empty' }, [
        el('h3', { text: 'Nothing logged yet' }),
        el('p', { text: 'The planner needs one session to work from. Log a set and a plan appears here.' }),
        el('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => ctx.goTo('log'),
        }, ['Log your first set']),
      ]),
    );
    return root;
  }

  root.append(sessionStrip(ctx, trained));

  // --- who is ready, stalest first ---
  const ready = trained
    .filter(isReady)
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0));
  const resting = trained
    .filter((s) => !isReady(s))
    .sort((a, b) => (a.daysSince ?? 0) - (b.daysSince ?? 0));
  const unlogged = stats.filter((s) => !s.entryCount);

  // The top of the readiness order opens itself: a home screen should show you
  // a weight, not four collapsed rows.
  if (openId() === undefined) setOpenId((ready[0] || resting[0])?.exercise.id ?? null);

  for (const group of [
    { title: 'Ready now', rows: ready, hint: 'Recovered from the last session — stalest first.' },
    { title: 'Still recovering', rows: resting, hint: 'Trained recently enough that a hard session would be uphill. The plans below are held back to match.' },
    { title: 'Not logged yet', rows: unlogged, hint: null },
  ]) {
    if (!group.rows.length) continue;
    root.append(el('div', { class: 'group-head' }, [
      el('h2', { class: 'section-title', text: group.title }),
      el('span', { class: 'group-count', text: String(group.rows.length) }),
    ]));
    if (group.hint) root.append(el('p', { class: 'group-hint', text: group.hint }));
    const list = el('div', { class: 'card-list' });
    for (const s of group.rows) list.append(card(s, ctx, settings));
    root.append(list);
  }

  root.append(
    details('How the planner decides', [
      el('p', { text: 'Each plan starts from your last session for that lift and adds a small step — the weekly gain you set per lift in Setup, earned by the week rather than by the session, so a lift you train twice a week is not asked to gain twice as fast as one you train once.' }),
      el('p', { text: 'Then it takes the gap into account. Train again a day later and the step is held back, because you are still carrying the last session. Come back after a month and the suggestion drops below what you last did, because some of it will have gone. Both of those settle back to nothing in between: a few days of rest is simply rest.' }),
      el('p', { text: 'The colour tells you how big the jump is: green is the smallest honest step forward, amber is ambitious but usually doable, red will probably cost you reps.' }),
      disclose('Show the maths', [
        el('p', { text: 'Your target is last session’s adjusted e1RM, moved by three things and then multiplied together: fitness earned in the gap (this lift’s weekly gain, pro-rated over the days since, and only while the rest is still productive); strength lost to a layoff (nothing for the first fortnight, then a half-life decay toward a floor you keep indefinitely); and fatigue still owed to the last session (a deficit that decays over roughly three days, scaled by how many sets you did and how close to failure you took them). The planner holds your rep scheme and set count steady and adds weight; the grid is there for when you would rather trade sets against load.' }),
        el('p', { text: 'Detraining discounts your recorded best as well as your target — a comeback session should not be marked down for failing to be a PR against a number you no longer own. Fatigue does not: being tired today has not taken a kilo off what you can do. All six coefficients are yours to change in Setup, and the whole model can be switched off there, which puts the flat per-session step back.' }),
        el('p', { text: 'Weights always round UP to a loadable step, so no suggestion can undershoot the target.' }),
        el('p', { text: 'If nearly everything reads amber, your weight step is simply large relative to the lift — one plate on a 40 kg press is a bigger percentage than on a 140 kg deadlift. Widen the ideal band in Setup until green means what you want it to mean.' }),
      ], { open: ctx.numbersOpen }),
      legend(),
    ]),
  );
  return root;
}

/** "Tuesday · last trained 2 days ago · 9 sets this week." */
function sessionStrip(ctx, trained) {
  const { stats, today } = ctx;
  const lastDate = trained.map((s) => s.lastDate).sort().pop();
  const sets7 = stats.reduce((n, s) => n + s.sets7, 0);
  const readyCount = trained.filter(isReady).length;
  return el('div', { class: 'day-strip' }, [
    el('span', { class: 'day-strip-day', text: weekdayName(today) }),
    el('span', { class: 'day-strip-sep', 'aria-hidden': 'true', text: '·' }),
    el('span', { class: 'day-strip-fact', text: lastDate ? `last trained ${relativeDate(lastDate).toLowerCase()}` : 'nothing logged yet' }),
    el('span', { class: 'day-strip-sep', 'aria-hidden': 'true', text: '·' }),
    el('span', { class: 'day-strip-fact', text: `${sets7} set${sets7 === 1 ? '' : 's'} this week` }),
    el('span', { class: 'day-strip-sep', 'aria-hidden': 'true', text: '·' }),
    el('span', { class: 'day-strip-fact', text: `${readyCount} ready` }),
  ]);
}

function card(stats, ctx, settings) {
  const id = stats.exercise.id;
  const o = ov(id);
  const isOpen = openId() === id;
  const plan = stats.entryCount ? planFor(stats, settings, o) : null;

  const head = el('button', {
    type: 'button', class: 'card-head', 'aria-expanded': isOpen ? 'true' : 'false',
    onclick: () => { tap(); setOpenId(isOpen ? null : id); ctx.refresh({ transition: true }); },
  }, [
    accentDot(id),
    el('div', { class: 'card-head-main' }, [
      el('div', { class: 'card-title-row' }, [
        el('h2', { class: 'card-title', text: stats.exercise.name }),
        readinessChip(stats),
      ]),
      el('p', {
        class: 'card-meta',
        text: stats.lastDate
          ? `${relativeDate(stats.lastDate)} · ${fmtNum(stats.lastSets)}×${fmtNum(stats.lastReps)}`
            + (isBodyweight(stats.exercise) ? ' reps' : ` @ ${fmtWeight(lastWeight(stats))} kg`)
          : 'Never logged',
      }),
    ]),
    chevron(),
  ]);

  const body = el('div', { class: 'card-body' });

  if (!plan || !plan.ready) {
    // A lift whose every session was logged with no weight has no score to
    // plan from. Saying "log a session" to somebody who has logged nine is the
    // least helpful thing the card could do.
    if (looksBodyweight(stats)) {
      body.append(el('p', { class: 'card-note', text:
        `Every session logged for ${stats.exercise.name} has no weight on it, so there is nothing to `
        + 'work a target out from. If this is a bodyweight lift, mark it as one and it will be planned '
        + 'in reps instead.' }));
      body.append(el('button', {
        type: 'button', class: 'btn btn-primary btn-block',
        onclick: () => {
          store.updateExercise(id, { kind: 'bodyweight' });
          ctx.refresh({ transition: true });
          toast(`${stats.exercise.name} is now a bodyweight lift`, {
            action: () => { store.undo(); ctx.refresh(); }, actionLabel: 'Undo',
          });
        },
      }, ['Mark as bodyweight']));
      return el('article', { class: 'card', style: `view-transition-name: card-${cssName(id)}` }, [head, body]);
    }
    body.append(el('p', { class: 'card-note', text: 'Log a session for this lift and its plan appears here.' }));
    body.append(el('button', {
      type: 'button', class: 'btn btn-primary btn-block',
      onclick: () => ctx.goTo('log', { exerciseId: id }),
    }, ['Log a set']));
    return el('article', { class: 'card', style: `view-transition-name: card-${cssName(id)}` }, [head, body]);
  }

  // --- the prescription, the one thing to read ---
  // On a reps lift the rep count IS the prescription, so it takes the big type
  // that the weight has on every other card.
  const repsOnly = isBodyweight(stats.exercise);
  const lw = repsOnly ? Number(stats.lastReps) : lastWeight(stats);
  const now = repsOnly ? plan.reps : plan.weight;
  const delta = Number.isFinite(lw) && lw != null ? now - lw : null;
  const changeText = describeChange(plan, stats, delta, repsOnly);
  // The prescription is laid out in pieces with the spacing done by flex, which
  // means its text content runs together — "5 reps@102.5 kg". Say it once,
  // properly, and hide the pieces from anything reading rather than looking.
  const spoken = repsOnly
    ? `${plan.sets} sets of ${plan.reps} reps`
    : `${plan.sets} sets of ${plan.reps} reps at ${fmtWeight(plan.weight)} kilos`;
  body.append(
    el('div', { class: 'presc' }, [
      el('div', { class: isOpen ? 'presc-hero' : 'presc-line' }, [
        el('span', { class: 'visually-hidden', text: spoken }),
        ...(repsOnly ? [
          el('span', { class: 'presc-scheme', 'aria-hidden': 'true', text: `${plan.sets} sets ×` }),
          el('span', { class: 'presc-weight', 'aria-hidden': 'true' }, [String(plan.reps), el('small', { text: ' reps' })]),
        ] : [
          el('span', { class: 'presc-scheme', 'aria-hidden': 'true', text: `${plan.sets} sets × ${plan.reps} reps` }),
          el('span', { class: 'presc-at', 'aria-hidden': 'true', text: '@' }),
          el('span', { class: 'presc-weight', 'aria-hidden': 'true' }, [fmtWeight(plan.weight), el('small', { text: ' kg' })]),
        ]),
      ]),
      el('div', { class: 'presc-side' }, [
        bandChip(plan.band),
        changeText ? el('span', { class: 'presc-delta', text: changeText }) : null,
      ]),
    ]),
  );

  // Plain words carry the verdict; the arithmetic sits under them.
  body.append(el('p', {
    class: 'presc-explain',
    text: plainVerdict(plan.band, delta, repsOnly ? 'reps' : 'kg')
      + (plan.atBase ? ` That is the bar on its own — ${fmtWeight(plan.base)} kg.` : ''),
  }));

  // Why today's number is what it is: fatigue still owed, or strength lost to a
  // layoff. Only worth the line when it is actually saying something, or when
  // the card is open and there is room for the detail.
  const rNote = readinessNote(stats.readiness);
  if (rNote && (isOpen || stats.readiness.phase.key !== 'ready')) {
    body.append(el('p', { class: `presc-readiness is-${stats.readiness.phase.key}` }, [
      el('span', { class: 'presc-readiness-glyph', 'aria-hidden': 'true', text: stats.readiness.phase.glyph }),
      el('span', { text: rNote }),
    ]));
  }

  body.append(disclose('Show the numbers', [
    el('p', { text: `Scores ${fmt(plan.score, 1)} against a target of ${fmt(plan.target, 1)} `
      + `(${fmtSigned(plan.overshoot, 1)}${repsOnly ? '' : ' kg'} over). ${plan.band.hint}.`
      + (plan.atBase ? ` That is the lightest this lift loads — ${fmtWeight(plan.base)} kg is the bar.` : '') }),
    readinessMaths(stats.readiness) ? el('p', { text: readinessMaths(stats.readiness) }) : null,
    el('div', { class: 'target-facts' }, [
      factLine(repsOnly ? 'Target score' : 'Target adj e1RM', `${fmt(plan.target, 1)}${repsOnly ? '' : ' kg'}`,
        plan.usingManualTarget ? 'your override' : targetSub(stats, plan)),
      factLine('Current best', `${fmt(plan.bestNow, 1)}${repsOnly ? '' : ' kg'}`,
        plan.bestNow < stats.bestAdj - 0.05
          ? `${fmt(stats.bestAdj, 1)} less ${((1 - stats.readiness.retention) * 100).toFixed(1)}% detraining`
          : stats.bestAdj > stats.lastAdj + 1e-9 ? 'beat this to set a PR' : 'set last session'),
    ]),
  ], { open: ctx.numbersOpen }));

  if (plan.band.key === 'beaten' && Number.isFinite(plan.bestNow)) {
    body.append(el('button', {
      type: 'button', class: 'hint-btn',
      onclick: () => { setOv(id, { target: round1(plan.bestNow * (1 + stats.gainPerWeek)) }); ctx.refresh(); },
    }, [
      el('span', { class: 'hint-label', text: 'This does not beat your best' }),
      el('span', {
        class: 'hint-value',
        text: repsOnly
          ? 'This does not get past the best set you have done. Aim past it instead →'
          : 'Your last session was lighter than your best. Aim past your best instead →',
      }),
    ]));
  }

  // Where this lift is heading, with somewhere to be heading to. Only when the
  // fit is good enough to date — a milestone with "cannot say yet" under it on
  // all seven cards is noise, and the Progress screen carries that case.
  const run = runway(stats, settings, { todayIso: ctx.today });
  if (run && run.eta && !run.eta.tooFar) body.append(milestoneTrack(run, { compact: true }));

  const actions = el('div', { class: 'card-actions' }, [
    el('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => ctx.goTo('log', { exerciseId: id, weight: plan.weight, reps: plan.reps, sets: plan.sets }),
    }, ['Log this']),
    el('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: () => { tap(); setOpenId(isOpen ? null : id); ctx.refresh({ transition: true }); },
    }, [isOpen ? 'Close' : 'Adjust']),
  ]);
  body.append(actions);

  if (isOpen) body.append(detail(stats, plan, ctx, settings));

  return el('article', {
    class: `card${isOpen ? ' is-open' : ''}`,
    style: `view-transition-name: card-${cssName(id)}`,
  }, [head, body]);
}

function detail(stats, plan, ctx, settings) {
  const id = stats.exercise.id;
  const o = ov(id);
  const wrap = el('div', { class: 'card-detail' });

  // --- levers ---
  // On a reps lift the rep count is the answer, not a lever — the only thing
  // left to choose is how many sets to spread it over.
  const repsOnly = plan.kind === 'bodyweight';
  const repsStepper = repsOnly ? null : stepper({
    label: 'Reps', value: plan.reps, step: 1, min: 1, max: 20, dp: 0, id: `reps-${id}`,
    onChange: (v) => { setOv(id, { reps: v }); ctx.refresh(); },
  });
  const setsStepper = stepper({
    label: 'Sets', value: plan.sets, step: 1, min: 1, max: 10, dp: 0, id: `sets-${id}`,
    onChange: (v) => { setOv(id, { sets: v }); ctx.refresh(); },
  });
  wrap.append(el('div', { class: repsOnly ? 'lever-row lever-row-half' : 'lever-row' },
    [repsStepper, setsStepper].filter(Boolean)));

  wrap.append(disclose('Set the target myself', [
    el('p', { text: 'The planner works this out from your last session. Put a number in to '
      + 'override it — the grid below re-solves against whatever you set.' }),
    stepper({
      label: repsOnly ? 'Override target (score)' : 'Override target (kg)', value: o.target ?? '', step: 0.5, min: 0, max: 999, dp: 1,
      id: `tgt-${id}`, placeholder: fmt(plan.autoTarget, 1) + ' auto',
      onChange: (v) => { setOv(id, { target: v > 0 ? v : null }); ctx.refresh(); },
    }),
  ], { open: plan.usingManualTarget }));

  if (plan.gentlest && plan.gentlest.score < plan.score - 1e-9) {
    wrap.append(el('button', {
      type: 'button', class: 'hint-btn',
      onclick: () => {
        setOv(id, repsOnly ? { sets: plan.gentlest.sets } : { reps: plan.gentlest.reps });
        ctx.refresh();
      },
    }, [
      el('span', { class: 'hint-label', text: repsOnly ? 'A gentler way up' : `Smallest jump at ${plan.sets} sets` }),
      el('span', {
        class: 'hint-value',
        text: repsOnly
          ? `${plan.gentlest.sets} sets of ${plan.gentlest.reps} — one more set asks for fewer reps`
          : `${plan.sets} × ${plan.gentlest.reps} @ ${fmtWeight(plan.gentlest.weight)} kg — an easier way up`,
      }),
    ]));
  }

  if (repsOnly) {
    // --- one row, not a grid: sets against the reps they ask for ---
    wrap.append(el('div', { class: 'grid-block' }, [
      el('div', { class: 'grid-head' }, [el('h3', { text: 'Trade sets against reps' })]),
      el('div', { class: 'grid-scroll' }, [
        el('table', { class: 'grid', 'aria-label': 'Reps needed at each number of sets' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'grid-corner', scope: 'col' }, [el('span', { text: 'sets' })]),
            ...plan.options.map((o) => el('th', { scope: 'col', class: o.isPick ? 'is-col' : '', text: String(o.sets) })),
          ])]),
          el('tbody', {}, [el('tr', {}, [
            el('th', { scope: 'row', class: 'is-row', text: 'reps' }),
            ...plan.options.map((o) => el('td', {
              class: `cell${o.isPick ? ' is-pick' : ''}`, dataset: { band: o.band.key },
            }, [
              el('button', {
                type: 'button', class: 'cell-btn',
                'aria-label': `${o.sets} sets of ${o.reps} reps, scores ${fmt(o.score, 1)}, ${o.band.label}`,
                onclick: () => { tap(); setOv(id, { sets: o.sets }); ctx.refresh(); },
              }, [
                el('span', { class: 'cell-value', text: String(o.reps) }),
                el('span', { class: 'cell-glyph', 'aria-hidden': 'true', text: o.band.glyph }),
              ]),
            ])),
          ])]),
        ]),
        el('p', { class: 'grid-note', text: 'Tap a column to plan that many sets. One whole rep is a big step low down, so spreading it over another set is often the smaller one.' }),
      ]),
      legend(),
    ]));
  } else {
    // --- the trade-off grid ---
    const mode = ui.forExercise(GRID, id, { mode: 'weights' }).mode;
    const gridHost = el('div', { class: 'grid-host' });
    const seg = segmented({
      label: 'Grid view', value: mode,
      options: [
        { value: 'weights', label: 'Weight' },
        { value: 'scores', label: 'Scores' },
        { value: 'table', label: 'Table' },
      ],
      onChange: (v) => { ui.setForExercise(GRID, id, { mode: v }); gridHost.replaceChildren(gridFor(v, stats, plan, ctx, settings)); },
    });
    gridHost.append(gridFor(mode, stats, plan, ctx, settings));

    wrap.append(el('div', { class: 'grid-block' }, [
      el('div', { class: 'grid-head' }, [el('h3', { text: 'Trade sets against weight' }), seg]),
      gridHost,
      legend(),
    ]));
  }

  if (o.reps !== null || o.sets !== null || o.target !== null) {
    wrap.append(el('button', {
      type: 'button', class: 'btn btn-ghost btn-block',
      onclick: () => {
        ui.clearForExercise(OV, id);
        ctx.refresh();
        toast('Back to automatic');
      },
    }, ['Reset to automatic']));
  }
  return wrap;
}

function gridFor(mode, stats, plan, ctx, settings) {
  if (mode === 'table') return tableView(stats, plan);
  const id = stats.exercise.id;
  const o = ov(id);
  const scores = mode === 'scores';
  const table = el('table', {
    class: 'grid',
    'aria-label': scores ? 'Adjusted e1RM each option scores' : 'Weight to lift for each reps and sets option',
  });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { class: 'grid-corner', scope: 'col' }, [
        el('span', { text: 'reps' }),
        el('small', { text: 'sets →' }),
      ]),
      ...SET_COLUMNS.map((s) => el('th', { scope: 'col', class: s === plan.sets ? 'is-col' : '', text: String(s) })),
    ]),
  ]);
  const tbody = el('tbody');
  for (const [ri, reps] of REP_SCHEMES.entries()) {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row', class: reps === snapReps(plan.reps) ? 'is-row' : '', text: String(reps) }));
    for (const [ci, sets] of SET_COLUMNS.entries()) {
      const cell = plan.grid[ri][ci];
      const value = scores ? fmt(cell.score, 1) : fmtWeight(cell.weight);
      const isPick = reps === snapReps(plan.reps) && sets === plan.sets;
      tr.append(el('td', { class: `cell${isPick ? ' is-pick' : ''}`, dataset: { band: cell.band.key } }, [
        el('button', {
          type: 'button', class: 'cell-btn',
          'aria-label': `${sets} sets of ${reps} reps at ${fmtWeight(cell.weight)} kg, scores ${fmt(cell.score, 1)}, ${cell.band.label}`,
          onclick: () => { tap(); setOv(id, { reps, sets }); ctx.refresh(); },
        }, [
          el('span', { class: 'cell-value', text: value }),
          el('span', { class: 'cell-glyph', 'aria-hidden': 'true', text: cell.band.glyph }),
        ]),
      ]));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const note = scores
    ? 'What each option actually scores once the weight is rounded up to a loadable step.'
    : 'Tap any cell to plan that combination.';
  return el('div', { class: 'grid-scroll' }, [table, el('p', { class: 'grid-note', text: note })]);
}

function tableView(stats, plan) {
  const rows = plan.grid.map((row) => row.find((c) => c.sets === plan.sets)).filter(Boolean);
  const table = el('table', { class: 'data-table' }, [
    el('caption', { text: `Every rep scheme at ${plan.sets} sets, against a target of ${fmt(plan.target, 1)} kg.` }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Reps' }),
        el('th', { scope: 'col', text: 'Weight' }),
        el('th', { scope: 'col', text: 'Scores' }),
        el('th', { scope: 'col', text: 'Volume' }),
        el('th', { scope: 'col', text: 'Verdict' }),
      ]),
    ]),
    el('tbody', {}, rows.map((c) => el('tr', { class: c.isPick ? 'is-pick' : '' }, [
      el('th', { scope: 'row', text: String(c.reps) }),
      el('td', { text: `${fmtWeight(c.weight)} kg` }),
      el('td', { text: fmt(c.score, 1) }),
      el('td', { text: fmt(c.volume, 0) }),
      el('td', {}, [bandChip(c.band)]),
    ]))),
  ]);
  return el('div', { class: 'grid-scroll' }, [table]);
}

function legend() {
  return el('ul', { class: 'legend' }, Object.values(BANDS).map((b) => el('li', { class: 'legend-item', dataset: { band: b.key } }, [
    el('span', { class: 'legend-glyph', 'aria-hidden': 'true', text: b.glyph }),
    el('span', { class: 'legend-label', text: b.label }),
    el('span', { class: 'legend-hint', text: b.hint }),
  ])));
}

/** "last 126.1 · +0.21% in 2 days · −1.6% fatigue" — the target, itemised. */
function targetSub(stats, plan) {
  const r = stats.readiness;
  if (!r || !r.enabled) return `last ${fmt(stats.lastAdj, 1)} + ${(stats.gainPerWeek * 100).toFixed(2)}%/wk`;
  const bits = [`last ${fmt(stats.lastAdj, 1)}`];
  if (r.retention < 1 - 1e-9) bits.push(`−${((1 - r.retention) * 100).toFixed(1)}% detraining`);
  bits.push(`+${(r.accrual * 100).toFixed(2)}% earned in ${r.days === 1 ? 'a day' : `${r.days} days`}`);
  if (r.fatigue > 0) bits.push(`−${(r.fatigue * 100).toFixed(1)}% fatigue`);
  return bits.join(' · ');
}

/** The phase badge on the card head. Silent when a lift is simply ready. */
function readinessChip(stats) {
  const r = stats.readiness;
  if (!r || !r.enabled || r.days === null) {
    return (stats.daysSince ?? 0) >= STALE_DAYS
      ? el('span', { class: 'stale-chip', text: `${stats.daysSince} days` }) : null;
  }
  const cls = `stale-chip is-${r.phase.key}`;
  switch (r.phase.key) {
    case 'detrained':
      return el('span', { class: cls, text: `${r.days} days · −${((1 - r.retention) * 100).toFixed(0)}%` });
    case 'recovering':
      return el('span', { class: cls, text: r.readyIn > 0 ? `ready in ${r.readyIn}d` : 'recovering' });
    case 'holding':
      return el('span', { class: cls, text: `${r.days} days` });
    default:
      return null;
  }
}

function factLine(label, value, sub) {
  return el('div', { class: 'fact' }, [
    el('span', { class: 'fact-label', text: label }),
    el('span', { class: 'fact-value', text: value }),
    sub ? el('span', { class: 'fact-sub', text: sub }) : null,
  ]);
}

function lastWeight(stats) {
  if (!stats.sessions.length) return null;
  return stats.sessions[stats.sessions.length - 1].best.weight;
}

/** "+2.5 kg on last" / "+1 set at the same weight" / "same as last session". */
function describeChange(plan, stats, delta, repsOnly) {
  const setsDelta = Number.isFinite(Number(stats.lastSets)) ? plan.sets - Number(stats.lastSets) : 0;
  const repsDelta = Number.isFinite(Number(stats.lastReps)) ? plan.reps - Number(stats.lastReps) : 0;
  if (delta === null || !Number.isFinite(delta)) return null;
  const bits = [];
  // On a reps lift the rep change IS the change; saying it twice reads as two.
  if (!repsOnly && Math.abs(delta) > 1e-9) bits.push(`${fmtSigned(delta, 1).replace('.0', '')} kg`);
  if (setsDelta) bits.push(`${setsDelta > 0 ? '+' : '−'}${Math.abs(setsDelta)} set${Math.abs(setsDelta) === 1 ? '' : 's'}`);
  if (repsDelta) bits.push(`${repsDelta > 0 ? '+' : '−'}${Math.abs(repsDelta)} rep${Math.abs(repsDelta) === 1 ? '' : 's'}`);
  if (!bits.length) return 'same as last session';
  return `${bits.join(', ')} on last`;
}

/** Exercise ids are user data; a view-transition-name has to be an identifier. */
function cssName(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function round1(n) { return Math.round(n * 10) / 10; }

function fmtNum(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : String(Math.round(Number(n)));
}

export function clearOverrides() { ui.set(OV, {}); }

export function openCard(id) { setOpenId(id); }
