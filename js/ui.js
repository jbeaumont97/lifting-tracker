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

  const wrap = el('div', { class: 'stepper' }, [
    el('label', { class: 'stepper-label', for: id, text: label }),
    el('div', { class: 'stepper-row' }, [
      el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Decrease ${label}`, onclick: () => nudge(-1) }, ['−']),
      el('div', { class: 'stepper-field' }, [field, suffix ? el('span', { class: 'stepper-suffix', text: suffix }) : null]),
      el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Increase ${label}`, onclick: () => nudge(1) }, ['+']),
    ]),
  ]);
  wrap.setValue = (v) => { field.value = format(v); };
  wrap.getValue = () => Number(field.value);
  wrap.input = field;
  return wrap;
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
    'aria-checked': selected ? 'true' : 'false', onclick: onClick,
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
  return el('span', { class: `band-chip is-${band.key}`, title: band.hint }, [
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

/* ------------------------------------------------------------------ sheet */

/** A bottom sheet — used for confirmations and the entry editor. */
export function sheet({ title, body, actions = [], onClose }) {
  const close = () => { wrap.remove(); document.body.classList.remove('has-sheet'); onClose?.(); };
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
  document.body.append(wrap);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => wrap.classList.add('is-in'));
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  panel.querySelector('button, input, select')?.focus?.();
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
