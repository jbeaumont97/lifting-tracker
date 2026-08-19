// ui.js — the small set of controls the whole app is built from. Everything is
// sized for a thumb: 44px minimum targets, big +/- steppers, chips instead of
// dropdowns, and numeric keypads on every number field.

import { el } from './charts.js';
export { el };

/** A labelled number field with big decrement/increment buttons. */
/**
 * `origin` sets where the +/- ladder starts — an empty bar, say — so nudging
 * walks origin, origin+step, origin+2*step rather than multiples of the step.
 */
export function stepper({ label, value, step = 1, min = 0, max = 9999, dp = 1, suffix = '', placeholder = '', origin = 0, onChange, id }) {
  const field = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', autocorrect: 'off',
    spellcheck: 'false', class: 'stepper-input', value: format(value), id,
    placeholder, 'aria-label': label,
  });

  function format(v) {
    if (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) return '';
    const n = Number(v);
    return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(dp);
  }
  const clamp = (n) => Math.min(max, Math.max(min, n));

  function nudge(dir) {
    const cur = Number(field.value);
    const from = Number.isFinite(cur) ? cur : Number(value) || 0;
    const o = Number.isFinite(Number(origin)) ? Number(origin) : 0;
    // Snap onto the ladder so +/- always lands on a weight you can load.
    const rungs = Math.round((from - o) / step) + dir;
    const next = clamp(Number((o + rungs * step).toFixed(6)));
    field.value = format(next);
    onChange?.(next);
    field.dispatchEvent(new Event('lt:nudge'));
  }

  const commit = () => {
    const n = Number(field.value.replace(',', '.'));
    if (!Number.isFinite(n)) { field.value = format(value); onChange?.(Number(value)); return; }
    const c = clamp(n);
    field.value = format(c);
    onChange?.(c);
  };
  field.addEventListener('change', commit);
  field.addEventListener('blur', commit);
  field.addEventListener('focus', () => field.select());

  const down = el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Decrease ${label}` }, ['−']);
  const up = el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Increase ${label}` }, ['+']);
  holdToRepeat(down, () => nudge(-1));
  holdToRepeat(up, () => nudge(1));

  const wrap = el('div', { class: 'stepper' }, [
    el('label', { class: 'stepper-label', for: id, text: label }),
    el('div', { class: 'stepper-row' }, [
      down,
      el('div', { class: 'stepper-field' }, [field, suffix ? el('span', { class: 'stepper-suffix', text: suffix }) : null]),
      up,
    ]),
  ]);
  wrap.setValue = (v) => { field.value = format(v); };
  wrap.getValue = () => Number(field.value);
  wrap.input = field;
  return wrap;
}

/**
 * Tap once to step; hold to repeat, accelerating. 60 -> 100 kg becomes a few
 * seconds of holding rather than sixteen taps.
 *
 * The trailing click after a hold is swallowed, otherwise the release would add
 * one more step than the finger asked for.
 */
export function holdToRepeat(btn, fn, { delay = 420, rate = 110, fast = 45 } = {}) {
  let start = null, repeat = null, repeated = false, fired = 0;
  const stop = () => {
    clearTimeout(start); clearInterval(repeat);
    start = repeat = null;
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    repeated = false; fired = 0;
    start = setTimeout(() => {
      repeated = true;
      fn(); tap();
      repeat = setInterval(() => {
        fn();
        // After a second of holding, speed up — long journeys are the point.
        if (++fired === 8) { clearInterval(repeat); repeat = setInterval(fn, fast); }
      }, rate);
    }, delay);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', () => {
    stop();
    if (repeated) { repeated = false; return; }
    fn(); tap();
  });
}

/**
 * A hint of haptic feedback where the platform offers one. iOS Safari does not
 * implement the Vibration API, so this is simply a no-op there.
 */
export function tap(pattern = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/** A chevron that CSS can rotate — a glyph swap cannot animate. */
export function chevron(className = 'card-chevron') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 9.5 12 15.5 18 9.5');
  svg.append(path);
  return svg;
}

/* --------------------------------------------------------------- identity */

const ACCENTS = 8;

/** A stable colour slot per lift, derived from its id so nothing is stored. */
export function accentIndex(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % ACCENTS;
}

/** The small coloured dot that gives a lift an identity across the app. */
export function accentDot(id) {
  return el('span', { class: `accent-dot accent-${accentIndex(id)}`, 'aria-hidden': 'true' });
}

/** Marks a set that was a personal best at the moment it was logged. */
export function prBadge({ compact = false } = {}) {
  return el('span', { class: 'pr-badge', title: 'Personal best when it was logged' }, [
    el('span', { class: 'pr-glyph', 'aria-hidden': 'true', text: '🏆' }),
    compact ? null : el('span', { text: 'PR' }),
  ]);
}

/** Horizontal single-choice chips — faster and clearer than a <select>. */
export function chipGroup({ label, options, value, onChange, allowNull = false, nullLabel = '—', className = '' }) {
  const group = el('div', { class: `chips ${className}`, role: 'radiogroup', 'aria-label': label });
  const render = (v) => {
    group.replaceChildren();
    if (allowNull) group.append(chip(nullLabel, v === null || v === undefined || v === '', () => { onChange?.(null); render(null); }));
    for (const opt of options) {
      const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
      group.append(chip(o.label, String(o.value) === String(v), () => { onChange?.(o.value); render(o.value); }, o.sub));
    }
  };
  render(value);
  group.setValue = render;
  return group;
}

function chip(label, selected, onClick, sub) {
  return el('button', {
    type: 'button', class: `chip${selected ? ' is-selected' : ''}`, role: 'radio',
    'aria-checked': selected ? 'true' : 'false', onclick: () => { tap(); onClick(); },
  }, [el('span', { text: label }), sub ? el('small', { text: sub }) : null]);
}

/** Two-or-three-way view switch (e.g. Weights | Scores | Table). */
export function segmented({ options, value, onChange, label }) {
  const group = el('div', { class: 'segmented', role: 'tablist', 'aria-label': label });
  const render = (v) => {
    group.replaceChildren();
    for (const o of options) {
      group.append(el('button', {
        type: 'button', role: 'tab', class: `seg${String(o.value) === String(v) ? ' is-selected' : ''}`,
        'aria-selected': String(o.value) === String(v) ? 'true' : 'false',
        onclick: () => { onChange?.(o.value); render(o.value); },
      }, [o.label]));
    }
  };
  render(value);
  group.setValue = render;
  return group;
}

export function statTile({ label, value, unit, delta, deltaLabel, spark, good }) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value' }, [value, unit ? el('small', { text: ` ${unit}` }) : null]),
    delta !== undefined && delta !== null
      ? el('span', { class: `stat-delta${good === true ? ' is-good' : good === false ? ' is-bad' : ''}` }, [delta, deltaLabel ? el('small', { text: ` ${deltaLabel}` }) : null])
      : null,
    spark || null,
  ]);
}

export function bandChip(band, { compact = false } = {}) {
  if (!band) return null;
  return el('span', { class: 'band-chip', dataset: { band: band.key }, title: band.hint }, [
    el('span', { class: 'band-glyph', 'aria-hidden': 'true', text: band.glyph }),
    compact ? null : el('span', { text: band.label }),
  ]);
}

/* ------------------------------------------------------------------ toast */

let toastHost = null;

export function toast(message, { action, actionLabel, duration = 4200 } = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: 'toast' }, [
    el('span', { class: 'toast-msg', text: message }),
    action ? el('button', { type: 'button', class: 'toast-action', onclick: () => { action(); dismiss(); } }, [actionLabel || 'Undo']) : null,
  ]);
  const dismiss = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(dismiss, duration);
  return dismiss;
}

/* ------------------------------------------------------------- celebration */

/**
 * A short burst for a personal best. Purely decorative, so it is skipped
 * outright when the reader has asked for reduced motion.
 */
export function celebrate({ count = 18 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const host = el('div', { class: 'confetti-host', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    const piece = el('i', { class: `confetti confetti-${i % 4}` });
    piece.style.left = `${6 + Math.random() * 88}%`;
    piece.style.animationDelay = `${Math.round(Math.random() * 220)}ms`;
    piece.style.setProperty('--drift', `${Math.round((Math.random() * 2 - 1) * 70)}px`);
    piece.style.setProperty('--spin', `${Math.round(Math.random() * 620 - 310)}deg`);
    host.append(piece);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 2400);
}

/* ------------------------------------------------------------------ sheet */

let openSheets = 0;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet — used for confirmations and the entry editor.
 *
 * Focus is trapped inside the panel while it is up and handed back to whatever
 * opened it on close, and the key handler is torn down however the sheet goes
 * away — not only when it is dismissed with Escape.
 */
export function sheet({ title, body, actions = [], onClose }) {
  const opener = document.activeElement;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.add('is-leaving');
    wrap.classList.remove('is-in');
    setTimeout(() => wrap.remove(), 200);
    if (--openSheets <= 0) { openSheets = 0; document.body.classList.remove('has-sheet'); }
    if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    onClose?.();
  };

  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('h2', { class: 'sheet-title', text: title }),
    el('div', { class: 'sheet-body' }, [].concat(body || [])),
    el('div', { class: 'sheet-actions' }, actions.map((a) => el('button', {
      type: 'button', class: `btn ${a.className || 'btn-ghost'}`,
      onclick: () => { const keep = a.onClick?.(); if (!keep) close(); },
    }, [a.label]))),
  ]);
  const wrap = el('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, [panel]);

  // A sheet opened from a sheet (confirm-on-top-of-edit) owns the keyboard
  // until it goes; the one underneath must not react to Escape or Tab.
  function onKey(e) {
    const live = document.querySelectorAll('.sheet-wrap:not(.is-leaving)');
    if (live[live.length - 1] !== wrap) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled && !n.hidden);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const inside = panel.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { first.focus(); e.preventDefault(); }
  }

  document.body.append(wrap);
  openSheets++;
  document.body.classList.add('has-sheet');
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => wrap.classList.add('is-in'));
  panel.querySelector(FOCUSABLE)?.focus?.({ preventScroll: true });
  return { close, panel };
}

export function confirmSheet({ title, message, confirmLabel = 'Delete', onConfirm }) {
  sheet({
    title,
    body: [el('p', { class: 'sheet-text', text: message })],
    actions: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: confirmLabel, className: 'btn-danger', onClick: onConfirm },
    ],
  });
}

/**
 * The numbers behind a verdict.
 *
 * The app used to run two parallel designs off a settings flag — a plain one
 * and an arithmetic one — which meant every screen had to be drawn twice and
 * half the app was invisible to anyone who never found the toggle. There is one
 * design now: the plain-English verdict is always the headline and the workings
 * sit one tap underneath it. The Setup switch only decides whether that tap has
 * already been made for you.
 */
export function disclose(label, bodyNodes, { open = false } = {}) {
  const body = [].concat(bodyNodes).filter(Boolean);
  if (!body.length) return null;
  return el('details', { class: 'disclose', open: open ? '' : null }, [
    el('summary', { class: 'disclose-summary' }, [
      el('span', { class: 'disclose-label', text: label }),
      chevron('disclose-chevron'),
    ]),
    el('div', { class: 'disclose-body' }, body),
  ]);
}

/** A collapsible explainer — the spreadsheet's HowTo notes, kept out of the way. */
export function details(summaryText, bodyNodes) {
  return el('details', { class: 'note' }, [
    el('summary', { text: summaryText }),
    el('div', { class: 'note-body' }, [].concat(bodyNodes)),
  ]);
}

export function emptyState(title, message, actionLabel, onAction) {
  return el('div', { class: 'empty' }, [
    el('h3', { text: title }),
    el('p', { text: message }),
    actionLabel ? el('button', { type: 'button', class: 'btn btn-primary', onclick: onAction }, [actionLabel]) : null,
  ]);
}
