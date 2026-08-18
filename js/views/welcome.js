// views/welcome.js — the first-run tour.
//
// Three cards explaining what the app is for, then the one decision a new
// arrival actually has to make: keep the sample sessions to poke at, or empty
// the log and start their own. Reachable again later from Setup.

import { el, tap } from '../ui.js';
import * as store from '../store.js';

const STEPS = [
  {
    glyph: '🏋️',
    title: 'One plan per lift',
    body: 'The Next tab turns your last session into a single concrete prescription — sets, reps and a weight you can actually load. No programme to follow, no spreadsheet to keep.',
  },
  {
    glyph: '✍️',
    title: 'Log it in seconds',
    body: 'Tap Log this, adjust with the big +/− pads if the session went differently, and save. One row per lift per session: 3 × 5 at 100 kg is a single entry.',
  },
  {
    glyph: '📈',
    title: 'Watch it move',
    body: 'Progress charts one number per lift — adjusted e1RM — with the trend fitted across your recent sessions. Everything stays on this device; there is no account and nothing is uploaded.',
  },
];

export function showWelcome({ onDone } = {}) {
  let step = 0;

  const wrap = el('div', { class: 'welcome-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Lifting Tracker' });
  const panel = el('div', { class: 'welcome' });
  wrap.append(panel);

  const finish = (fresh) => {
    tap();
    if (fresh) store.startFresh();
    else store.setOnboarded(true);
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('is-in');
    setTimeout(() => wrap.remove(), 220);
    document.body.classList.remove('has-sheet');
    onDone?.();
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  }

  const paint = () => {
    const s = STEPS[step];
    const last = step === STEPS.length - 1;
    panel.replaceChildren(
      el('div', { class: 'welcome-art', 'aria-hidden': 'true', text: s.glyph }),
      el('h1', { class: 'welcome-title', text: s.title }),
      el('p', { class: 'welcome-body', text: s.body }),
      el('div', { class: 'welcome-dots', 'aria-hidden': 'true' },
        STEPS.map((_, i) => el('span', { class: `welcome-dot${i === step ? ' is-on' : ''}` }))),
      last
        ? el('div', { class: 'welcome-actions welcome-actions-end' }, [
            el('button', {
              type: 'button', class: 'btn btn-primary btn-block',
              onclick: () => finish(true),
            }, ['Start my own log']),
            el('button', {
              type: 'button', class: 'btn btn-ghost btn-block',
              onclick: () => finish(false),
            }, ['Explore the sample sessions first']),
            el('p', { class: 'welcome-note', text: 'Either way you can change your lifts, clear the log or reload the samples from Setup.' }),
          ])
        : el('div', { class: 'welcome-actions' }, [
            el('button', {
              type: 'button', class: 'btn btn-ghost', disabled: step === 0,
              onclick: () => { step = Math.max(0, step - 1); paint(); },
            }, ['Back']),
            el('button', {
              type: 'button', class: 'btn btn-primary',
              onclick: () => { tap(); step++; paint(); },
            }, ['Next']),
            el('button', { type: 'button', class: 'link-btn welcome-skip', onclick: () => finish(false) }, ['Skip']),
          ]),
    );
    panel.classList.remove('is-stepping');
    requestAnimationFrame(() => panel.classList.add('is-stepping'));
    panel.querySelector('.btn-primary')?.focus?.({ preventScroll: true });
  };

  paint();
  document.body.append(wrap);
  document.body.classList.add('has-sheet');
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => wrap.classList.add('is-in'));
}
