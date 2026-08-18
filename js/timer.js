// timer.js — the rest timer.
//
// It lives in a dock above the tab bar rather than inside a view, because the
// whole point is that it survives every re-render and every tab change while
// you are standing next to the rack. Time is always recomputed from the clock,
// never accumulated, so a backgrounded tab does not lose count.

import { el, tap } from './ui.js';

let state = null;                 // { startedAt, target, label, tick }
let host = null;
let bar = null;

function dockHost() {
  if (!host || !host.isConnected) {
    host = document.getElementById('dock') || el('div', { class: 'dock', id: 'dock' });
    if (!host.isConnected) document.body.append(host);
  }
  return host;
}

/** Publish the dock's height so the toasts and the action button stack on it. */
function measure() {
  const h = host && host.isConnected ? host.offsetHeight : 0;
  document.documentElement.style.setProperty('--dock-h', `${h ? h + 8 : 0}px`);
}

function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function isResting() { return state !== null; }

/**
 * Start (or restart) the rest clock. `seconds` is the target rest, not a limit:
 * the clock keeps counting past it, because knowing you have rested four
 * minutes is more useful than a timer that silently stopped at three.
 */
export function startRest(seconds, { label = 'Rest' } = {}) {
  const target = Number(seconds) > 0 ? Number(seconds) : 0;
  if (!target) return;
  stopRest({ quiet: true });
  state = { startedAt: Date.now(), target, label, rang: false, tick: null };

  bar = el('div', { class: 'rest', role: 'timer', 'aria-live': 'off' }, [
    el('div', { class: 'rest-fill', 'aria-hidden': 'true' }),
    el('div', { class: 'rest-main' }, [
      el('span', { class: 'rest-label', text: label }),
      el('span', { class: 'rest-time', text: '0:00' }),
    ]),
    el('button', { type: 'button', class: 'rest-btn', onclick: () => { add(30); } }, ['+30s']),
    el('button', { type: 'button', class: 'rest-btn rest-close', 'aria-label': 'Dismiss the rest timer', onclick: () => stopRest() }, ['Done']),
  ]);
  const d = dockHost();
  d.replaceChildren(bar);
  requestAnimationFrame(() => { bar.classList.add('is-in'); measure(); });
  paint();
  state.tick = setInterval(paint, 500);
}

function add(seconds) {
  if (!state) return;
  state.target += seconds;
  state.rang = false;
  bar.classList.remove('is-done');
  tap();
  paint();
}

function paint() {
  if (!state || !bar) return;
  const elapsed = (Date.now() - state.startedAt) / 1000;
  const pct = Math.max(0, Math.min(100, (elapsed / state.target) * 100));
  bar.querySelector('.rest-fill').style.width = `${pct}%`;
  bar.querySelector('.rest-time').textContent = mmss(elapsed);
  bar.querySelector('.rest-label').textContent = elapsed >= state.target
    ? `${state.label} — ready`
    : `${state.label} · ${mmss(state.target - elapsed)} left`;
  bar.setAttribute('aria-label', `${state.label}, ${mmss(elapsed)} elapsed of ${mmss(state.target)}`);
  if (!state.rang && elapsed >= state.target) {
    state.rang = true;
    bar.classList.add('is-done');
    // The one moment worth interrupting for: rest is up.
    bar.setAttribute('aria-live', 'polite');
    tap([40, 80, 40]);
  }
}

export function stopRest({ quiet = false } = {}) {
  if (state) { clearInterval(state.tick); state = null; }
  if (bar) {
    const leaving = bar;
    bar = null;
    if (quiet) { leaving.remove(); }
    else {
      leaving.classList.add('is-leaving');
      setTimeout(() => { leaving.remove(); measure(); }, 200);
    }
  }
  if (!quiet) measure();
}

// A timer running while the app is backgrounded still has to be right when it
// comes back, and the dock's height may have changed with the viewport.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paint(); });
window.addEventListener('resize', measure);
