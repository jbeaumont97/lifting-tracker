// charts.js — hand-built inline SVG. No libraries, so the app works offline and
// weighs nothing. Marks follow one fixed spec: 2px lines, >=8px end markers with
// a 2px surface ring, solid hairline gridlines, a 10% area wash, and labels only
// on the points that carry the story (last, best, projection, target).

import { fmt, fmtWeight, formatDate, formatDateShort, dayNumber, isoAddDays, isoToday } from './metrics.js';

const SVG = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/** Text is inserted with textContent — never innerHTML. Names are user data. */
function text(str, attrs = {}) {
  const node = svgEl('text', attrs);
  node.textContent = str;
  return node;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;              // only ever literals
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Axis ticks on round numbers, ~`count` of them, covering [min,max]. */
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1 };
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return { ticks, lo, hi, step };
}

/* ============================================================ progression */

/**
 * The main progression chart: one point per session (that day's best set),
 * the fitted trend, its dashed projection, and the next-session target.
 * Returns a figure element containing the SVG, a key, and a table-view twin.
 */
export function progressionChart(stats, settings, { width = 340, height = 210, showProjection = true, todayIso = isoToday() } = {}) {
  const sessions = stats.sessions;
  const fig = el('figure', { class: 'chart' });

  if (sessions.length === 0) {
    fig.append(el('p', { class: 'chart-empty', text: 'No sessions logged yet — log one and your progression appears here.' }));
    return fig;
  }

  const pad = { t: 18, r: 46, b: 26, l: 34 };
  const w = Math.max(260, width);
  const plotW = w - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const todayDay = dayNumber(todayIso);
  const firstDay = sessions[0].day;
  const lastDay = sessions[sessions.length - 1].day;

  // How far forward the fit is worth drawing. A projection that dwarfs the real
  // data makes the chart useless, so the horizon is capped by both the length of
  // the history and how far the line would travel vertically.
  const actual = sessions.map((s) => s.best.adj);
  const actualMax = Math.max(...actual, stats.nextTarget || -Infinity);
  const actualMin = Math.min(...actual, stats.nextTarget || Infinity);
  const headroom = Math.max(actualMax * 0.06, (actualMax - actualMin) * 0.6, 1);
  let horizon = 0;
  if (showProjection && stats.trendReliable && stats.trendPerDay != null) {
    horizon = Math.min(84, Math.max(14, lastDay - firstDay));
    if (Math.abs(stats.trendPerDay) > 1e-9) {
      const fits = headroom / Math.abs(stats.trendPerDay);
      horizon = Math.max(14, Math.min(horizon, Math.round(fits)));
    }
  }
  const xMin = firstDay;
  const xMax = Math.max(lastDay, todayDay) + horizon;
  const xSpan = Math.max(1, xMax - xMin);

  const projAt = (day) => stats.lastAdj + stats.trendPerDay * (day - lastDay);
  const values = actual.slice();
  if (stats.nextTarget) values.push(stats.nextTarget);
  if (horizon) values.push(projAt(xMax));
  const { ticks, lo, hi, step: tickStep } = niceTicks(Math.min(...values), Math.max(...values), 4);
  const tickDp = tickStep >= 1 ? 0 : tickStep >= 0.1 ? 1 : 2;

  const x = (day) => pad.l + ((day - xMin) / xSpan) * plotW;
  const y = (v) => pad.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${height}`, width: '100%', height,
    role: 'img', 'aria-label': `${stats.exercise.name} adjusted e1RM over time`,
    class: 'chart-svg', preserveAspectRatio: 'xMidYMid meet',
  });

  // --- gridlines + y ticks (recessive, solid hairlines) ---
  for (const t of ticks) {
    if (t < lo - 1e-9 || t > hi + 1e-9) continue;
    svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(text(fmt(t, tickDp), { x: pad.l - 6, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'end' }));
  }
  svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: pad.t + plotH, y2: pad.t + plotH, class: 'axis' }));

  // --- x ticks: first and last session, plus the projection edge ---
  const xLabels = [{ day: firstDay, label: formatDateShort(sessions[0].date) }];
  if (lastDay !== firstDay) xLabels.push({ day: lastDay, label: formatDateShort(sessions[sessions.length - 1].date) });
  if (horizon) xLabels.push({ day: xMax, label: `+${Math.round((xMax - Math.max(lastDay, todayDay)) / 7)} wk` });
  for (const [i, lab] of xLabels.entries()) {
    const anchor = i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle';
    svg.append(text(lab.label, { x: x(lab.day), y: height - 8, class: 'tick', 'text-anchor': anchor }));
  }

  // --- best-ever reference, only when it is not simply the last point ---
  if (Number.isFinite(stats.bestAdj) && stats.bestAdj > stats.lastAdj + 1e-9) {
    svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: y(stats.bestAdj), y2: y(stats.bestAdj), class: 'ref-best' }));
    svg.append(text('best', { x: pad.l + 2, y: y(stats.bestAdj) - 5, class: 'tick' }));
  }

  // --- trend line and its dashed projection ---
  if (stats.trendPerDay != null) {
    const fitAt = (day) => stats.lastAdj + stats.trendPerDay * (day - lastDay);
    const fitFrom = Math.max(xMin, todayDay - settings.lookbackDays);
    svg.append(svgEl('line', {
      x1: x(fitFrom), y1: y(fitAt(fitFrom)), x2: x(lastDay), y2: y(fitAt(lastDay)), class: 'trend',
    }));
    if (horizon) {
      svg.append(svgEl('line', {
        x1: x(lastDay), y1: y(fitAt(lastDay)), x2: x(xMax), y2: y(fitAt(xMax)), class: 'trend-proj',
      }));
      const py = y(fitAt(xMax));
      svg.append(svgEl('circle', { cx: x(xMax), cy: py, r: 3, class: 'proj-dot' }));
      svg.append(text(fmt(fitAt(xMax), 0), { x: x(xMax) - 4, y: py - 8, class: 'label-proj', 'text-anchor': 'end' }));
    }
  }

  // --- area wash + the actual line ---
  const pts = sessions.map((s) => [x(s.day), y(s.best.adj)]);
  const linePath = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  if (pts.length > 1) {
    svg.append(svgEl('path', {
      d: `${linePath} L${pts[pts.length - 1][0].toFixed(1)} ${pad.t + plotH} L${pts[0][0].toFixed(1)} ${pad.t + plotH} Z`,
      class: 'area',
    }));
  }
  // pathLength normalises the dash maths to 1 whatever the real length is, so
  // the draw-in animation is a plain 1 -> 0 dashoffset in CSS.
  svg.append(svgEl('path', { d: linePath, class: 'line', fill: 'none', pathLength: 1 }));

  // --- the next-session target: a ringed marker, directly labelled ---
  let targetPos = null;
  if (Number.isFinite(stats.nextTarget)) {
    const tx = x(Math.max(todayDay, lastDay + 1));
    const ty = y(stats.nextTarget);
    targetPos = [tx, ty];
    svg.append(svgEl('circle', { cx: tx, cy: ty, r: 6, class: 'target-ring' }));
    svg.append(svgEl('circle', { cx: tx, cy: ty, r: 2.5, class: 'target-dot' }));
    // Only label it where there is room; the key carries the number regardless.
    if (tx + 34 < pad.l + plotW + pad.r - 4) {
      svg.append(text(fmt(stats.nextTarget, 0), { x: tx + 9, y: ty + 3.5, class: 'label-target' }));
    }
  }

  // --- session dots, each with a 2px surface ring; PRs wear a ring of their own ---
  const stagger = Math.min(40, 420 / Math.max(1, sessions.length));
  let anyPR = false;
  for (const [i, s] of sessions.entries()) {
    const isLast = i === sessions.length - 1;
    const delay = `animation-delay:${Math.round(220 + i * stagger)}ms`;
    if (s.best.isPR) {
      anyPR = true;
      svg.append(svgEl('circle', { cx: x(s.day), cy: y(s.best.adj), r: isLast ? 8 : 6.5, class: 'dot-pr', style: delay }));
    }
    svg.append(svgEl('circle', {
      cx: x(s.day), cy: y(s.best.adj), r: isLast ? 5 : 3.6,
      class: isLast ? 'dot dot-last' : 'dot', style: delay,
    }));
  }
  // Last value, directly labelled — the one number the chart is about.
  const lp = pts[pts.length - 1];
  // Push the label to whichever side of the point the target marker is not on.
  const clash = targetPos && Math.abs(targetPos[1] - lp[1]) < 16;
  svg.append(text(fmt(stats.lastAdj, 1), {
    x: lp[0] - (clash ? 8 : 0), y: Math.max(pad.t + 8, lp[1] - 13), class: 'label-last',
    'text-anchor': clash ? 'end' : lp[0] > pad.l + plotW - 24 ? 'end' : 'middle',
  }));

  // --- hover / touch layer: crosshair snapping to the nearest session ---
  const hover = svgEl('g', { class: 'hover-layer', visibility: 'hidden' });
  const crosshair = svgEl('line', { y1: pad.t, y2: pad.t + plotH, class: 'crosshair' });
  const focusDot = svgEl('circle', { r: 6, class: 'focus-dot' });
  hover.append(crosshair, focusDot);
  svg.append(hover);

  const tip = el('div', { class: 'chart-tip', hidden: true, 'aria-hidden': 'true' });
  const capture = svgEl('rect', {
    x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent',
    class: 'capture', tabindex: '0', role: 'application',
    'aria-label': 'Session details — drag or use arrow keys',
  });
  svg.append(capture);

  let focusIdx = sessions.length - 1;
  const showAt = (idx) => {
    const s = sessions[Math.max(0, Math.min(sessions.length - 1, idx))];
    if (!s) return;
    focusIdx = sessions.indexOf(s);
    const px = x(s.day), py = y(s.best.adj);
    crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
    focusDot.setAttribute('cx', px); focusDot.setAttribute('cy', py);
    hover.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      el('strong', { text: `${fmt(s.best.adj, 1)} kg` }),
      el('span', { class: 'tip-sub', text: `${formatDate(s.date)} · ${s.best.sets}×${s.best.reps} @ ${fmtWeight(s.best.weight)} kg` }),
      el('span', { class: 'tip-sub', text: `e1RM ${fmt(s.best.e1rm, 1)} · ${s.sets} sets · ${fmt(s.volume, 0)} kg volume` }),
    );
    tip.hidden = false;
    const left = Math.max(4, Math.min(w - 132, px - 66));
    tip.style.left = `${(left / w) * 100}%`;
    tip.style.top = `${Math.max(0, py - 74)}px`;
  };
  const hide = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const day = xMin + ((clientX - box.left) / box.width * w - pad.l) / plotW * xSpan;
    let best = 0, bestD = Infinity;
    for (const [i, s] of sessions.entries()) {
      const d = Math.abs(s.day - day);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  capture.addEventListener('pointerdown', (e) => { capture.setPointerCapture?.(e.pointerId); showAt(nearest(e.clientX)); });
  capture.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') showAt(nearest(e.clientX)); });
  capture.addEventListener('pointerup', hide);
  capture.addEventListener('pointercancel', hide);
  capture.addEventListener('pointerleave', hide);
  capture.addEventListener('focus', () => showAt(focusIdx));
  capture.addEventListener('blur', hide);
  capture.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { showAt(focusIdx - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { showAt(focusIdx + 1); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });

  const plot = el('div', { class: 'chart-plot' }, [svg, tip]);
  fig.append(plot);

  // --- key: identity never rests on colour alone ---
  const key = el('div', { class: 'chart-key' }, [
    keyItem('line', 'Adj e1RM per session'),
    stats.trendPerDay != null ? keyItem('trend', `Trend ${fmt(stats.trendPerWeek, 2)} kg/wk`) : null,
    horizon ? keyItem('proj', `Projection, +${Math.round(horizon / 7)} wks`) : null,
    Number.isFinite(stats.nextTarget) ? keyItem('target', `Next target ${fmt(stats.nextTarget, 1)}`) : null,
    anyPR ? keyItem('pr', 'Personal best') : null,
  ]);
  fig.append(key);
  return fig;
}

function keyItem(kind, label) {
  return el('span', { class: 'key-item' }, [el('i', { class: `key-mark key-${kind}`, 'aria-hidden': 'true' }), label]);
}

/* ============================================================= sparkline */

/** 12-point sparkline for a stat tile: context in muted, latest in accent. */
export function sparkline(values, { width = 72, height = 24 } = {}) {
  const vals = values.slice(-12).filter(Number.isFinite);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark', 'aria-hidden': 'true', focusable: 'false' });
  if (vals.length < 2) return svg;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i) => 1 + (i / (vals.length - 1)) * (width - 2);
  const y = (v) => height - 3 - ((v - lo) / span) * (height - 6);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { d, class: 'spark-line', fill: 'none' }));
  svg.append(svgEl('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 2.6, class: 'spark-dot' }));
  return svg;
}

/* ================================================================= meter */

/**
 * Weekly sets against the weekly budget: one ratio against a limit, so a meter
 * rather than a chart. Status carries an icon and a word, never colour alone.
 */
export function setsMeter(stats) {
  const target = stats.setsPerWeekTarget;
  const value = stats.sets7;
  const status = stats.setStatus;
  const wrap = el('div', { class: 'meter' });
  if (!target) {
    wrap.append(el('div', { class: 'meter-head' }, [
      el('span', { class: 'meter-label', text: 'Sets last 7 days' }),
      el('span', { class: 'meter-value', text: String(value) }),
    ]));
    return wrap;
  }
  const pct = Math.max(0, Math.min(100, (value / target) * 100));
  const glyph = status === 'under' ? '↓' : status === 'over' ? '↑' : '✓';
  wrap.append(
    el('div', { class: 'meter-head' }, [
      el('span', { class: 'meter-label', text: 'Sets last 7 days' }),
      el('span', { class: 'meter-value', text: `${value} / ${target}` }),
    ]),
    el('div', { class: 'meter-track', role: 'meter', 'aria-valuenow': value, 'aria-valuemin': '0', 'aria-valuemax': target, 'aria-label': 'Working sets in the last 7 days' }, [
      el('div', { class: `meter-fill is-${(status || 'none').replace(' ', '-')}`, style: `width:${pct}%` }),
      el('div', { class: 'meter-mark', style: `left:${Math.min(100, 80)}%`, title: '80% of target' }),
    ]),
    el('div', { class: `status-chip is-${(status || 'none').replace(' ', '-')}` }, [
      el('span', { class: 'status-glyph', 'aria-hidden': 'true', text: glyph }),
      el('span', { text: status === 'on target' ? 'On target' : status === 'under' ? 'Under target' : 'Over target' }),
    ]),
  );
  return wrap;
}

/* ======================================================== weekly volume */

/**
 * Working sets per week over the last 8 weeks, with the weekly budget drawn as
 * a hairline reference. Single series, so no legend — the caption names it.
 */
export function weeklySetsChart(stats, { width = 340, height = 130, weeks = 8, todayIso = isoToday() } = {}) {
  const fig = el('figure', { class: 'chart chart-sm' });
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = isoAddDays(todayIso, -7 * i);
    const start = isoAddDays(end, -6);
    buckets.push({ start, end, startDay: dayNumber(start), endDay: dayNumber(end), sets: 0, volume: 0 });
  }
  for (const e of stats.entries) {
    for (const b of buckets) {
      if (e.day >= b.startDay && e.day <= b.endDay) { b.sets += Number(e.sets) > 0 ? Number(e.sets) : 1; b.volume += e.volume; }
    }
  }
  const target = stats.setsPerWeekTarget || 0;
  const maxVal = Math.max(target * 1.15, ...buckets.map((b) => b.sets), 1);

  const pad = { t: 14, r: 10, b: 22, l: 26 };
  const w = Math.max(240, width);
  const plotW = w - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${height}`, width: '100%', height, class: 'chart-svg',
    role: 'img', 'aria-label': 'Working sets per week over the last 8 weeks',
  });

  const { ticks, lo, hi } = niceTicks(0, maxVal, 3);
  const y = (v) => pad.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  for (const t of ticks) {
    if (t < lo - 1e-9 || t > hi + 1e-9) continue;
    svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(text(String(t), { x: pad.l - 5, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'end' }));
  }

  const band = plotW / buckets.length;
  const barW = Math.min(24, band - 6);                       // capped; the rest is air
  for (const [i, b] of buckets.entries()) {
    const bx = pad.l + i * band + (band - barW) / 2;
    const top = y(b.sets);
    const h = Math.max(b.sets > 0 ? 2 : 0, pad.t + plotH - top);
    if (h > 0) {
      svg.append(svgEl('path', {
        d: roundedTop(bx, top, barW, h, 4),
        class: i === buckets.length - 1 ? 'bar bar-current' : 'bar',
        style: `animation-delay:${i * 45}ms`,
      }));
    }
    if ((buckets.length - 1 - i) % 2 === 0) {
      const isNow = i === buckets.length - 1;
      svg.append(text(isNow ? 'now' : formatDateShort(b.end), {
        x: bx + barW / 2, y: height - 7, class: 'tick', 'text-anchor': 'middle',
      }));
    }
  }
  svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: pad.t + plotH, y2: pad.t + plotH, class: 'axis' }));
  if (target) {
    svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: y(target), y2: y(target), class: 'ref-target' }));
    svg.append(text(`target ${target}`, { x: pad.l + plotW, y: y(target) - 5, class: 'tick', 'text-anchor': 'end' }));
  }
  fig.append(el('div', { class: 'chart-plot' }, [svg]));
  fig.append(el('figcaption', { class: 'chart-cap', text: 'Working sets per week — the last bar is the current 7 days.' }));
  return fig;
}

function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}

/* ========================================================= the session so far */

/**
 * The set-by-set trace: what you have done this session, and what is left.
 *
 * This is the set-pill row grown a y-axis. A pill told you a set happened and
 * how many reps it was; a bar says the same thing and also shows the shape —
 * reps holding or falling away, how close to failure each set went, and how
 * long you actually rested between them. None of that was recordable before
 * the per-set log existed.
 *
 * One measure on the axis (reps) and one series, so there is no legend and no
 * second scale: RIR and rest ride along as direct labels rather than as a
 * second y, which is the one thing a chart like this must never do.
 *
 * `node.setPending(reps)` moves the dashed bar for the set you are about to do
 * without rebuilding anything, so a stepper can drive it at 60fps.
 */
export function setTrace(timeline, {
  width = 340, height = 148, planReps = null, planSets = 0, pendingReps = null,
} = {}) {
  const done = timeline.length;
  const slots = Math.max(done + (pendingReps != null ? 1 : 0), planSets || 0, 1);

  const pad = { t: 20, r: 6, b: 32, l: 6 };
  const w = Math.max(220, width);
  const plotW = w - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const ceiling = Math.max(planReps || 0, ...timeline.map((t) => t.reps), pendingReps || 0, 1);
  const y = (reps) => pad.t + plotH - (reps / (ceiling * 1.15)) * plotH;

  const band = plotW / slots;
  const barW = Math.min(38, Math.max(14, band - 10));
  const cx = (i) => pad.l + i * band + band / 2;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${height}`, width: '100%', height, class: 'chart-svg trace-svg',
    role: 'img', preserveAspectRatio: 'xMidYMid meet',
    'aria-label': traceLabel(timeline, planSets, planReps),
  });

  // The rep scheme you set out to do, so a short set reads as short.
  if (planReps > 0) {
    svg.append(svgEl('line', {
      x1: pad.l, x2: pad.l + plotW, y1: y(planReps), y2: y(planReps), class: 'ref-target',
    }));
    svg.append(text(`${planReps} reps`, { x: pad.l + plotW, y: y(planReps) - 5, class: 'tick', 'text-anchor': 'end' }));
  }

  // --- the sets you have done ---
  for (const [i, t] of timeline.entries()) {
    const top = y(t.reps);
    const h = Math.max(3, pad.t + plotH - top);
    const short = planReps > 0 && t.reps < planReps;
    svg.append(svgEl('path', {
      d: roundedTop(cx(i) - barW / 2, top, barW, h, 4),
      class: `bar trace-bar${i === done - 1 ? ' bar-current' : ''}${short ? ' is-short' : ''}`,
      style: `animation-delay:${Math.min(240, i * 40)}ms`,
    }));
    // The rep count rides on the bar: this is still a set tracker first.
    svg.append(text(String(t.reps), { x: cx(i), y: top - 6, class: 'trace-reps', 'text-anchor': 'middle' }));
    // RIR under the axis, where it cannot be mistaken for the value.
    svg.append(text(t.rir === null ? '·' : `RIR ${t.rir}`, {
      x: cx(i), y: height - 18, class: 'trace-rir', 'text-anchor': 'middle',
    }));
    // Rest sits in the gap it describes, and only where it was measured.
    if (t.restBefore !== null && i > 0) {
      svg.append(text(restLabel(t.restBefore), {
        x: (cx(i - 1) + cx(i)) / 2, y: height - 5, class: 'trace-rest', 'text-anchor': 'middle',
      }));
    }
  }

  // --- the set you are about to do, and anything still planned after it ---
  let pendingBar = null;
  let pendingLabel = null;
  if (pendingReps != null) {
    const i = done;
    pendingBar = svgEl('path', { class: 'trace-bar is-next', d: '' });
    pendingLabel = text('', { x: cx(i), y: 0, class: 'trace-reps is-next', 'text-anchor': 'middle' });
    svg.append(pendingBar, pendingLabel);
  }
  for (let i = done + (pendingReps != null ? 1 : 0); i < slots; i++) {
    svg.append(svgEl('line', {
      x1: cx(i) - barW / 2, x2: cx(i) + barW / 2, y1: pad.t + plotH, y2: pad.t + plotH,
      class: 'trace-slot',
    }));
  }

  svg.append(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: pad.t + plotH, y2: pad.t + plotH, class: 'axis' }));

  const fig = el('figure', { class: 'chart chart-trace' }, [el('div', { class: 'chart-plot' }, [svg])]);

  /** Move the dashed bar without touching anything else. */
  fig.setPending = (reps) => {
    if (!pendingBar) return;
    const r = Number(reps);
    if (!(r > 0)) { pendingBar.setAttribute('d', ''); pendingLabel.textContent = ''; return; }
    const capped = Math.min(r, ceiling * 1.15);
    const top = y(capped);
    const h = Math.max(3, pad.t + plotH - top);
    pendingBar.setAttribute('d', roundedTop(cx(done) - barW / 2, top, barW, h, 4));
    pendingLabel.setAttribute('y', String(top - 6));
    pendingLabel.textContent = String(Math.round(r));
  };
  fig.setPending(pendingReps);
  return fig;
}

/** "1:30" for a rest gap, "45s" under a minute. */
function restLabel(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function traceLabel(timeline, planSets, planReps) {
  if (!timeline.length) return 'No sets logged yet this session';
  const reps = timeline.map((t) => t.reps).join(', ');
  const of = planSets ? ` of ${planSets} planned` : '';
  return `${timeline.length} set${timeline.length === 1 ? '' : 's'}${of} this session`
    + `${planReps ? `, planned at ${planReps} reps` : ''}. Reps: ${reps}.`;
}

/* ================================================================ rest ring */

/**
 * A countdown drawn as a ring rather than a bar.
 *
 * Rest is the one thing in the app that is genuinely circular — a clock face —
 * and the ring reads at arm's length from across a rack in a way a 3px bar does
 * not. Returns the node with a `set(fraction)` that moves only the arc.
 */
export function restRing({ size = 30 } = {}) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size,
    class: 'rest-ring', 'aria-hidden': 'true', focusable: 'false',
  });
  svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r, class: 'rest-ring-track' }));
  const arc = svgEl('circle', {
    cx: size / 2, cy: size / 2, r, class: 'rest-ring-arc',
    'stroke-dasharray': circ.toFixed(2),
    'stroke-dashoffset': circ.toFixed(2),
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  svg.append(arc);
  svg.set = (fraction) => {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    arc.setAttribute('stroke-dashoffset', (circ * (1 - f)).toFixed(2));
  };
  return svg;
}
