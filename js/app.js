// app.js — shell, router and render loop.
//
// The whole UI is a pure function of the stored document: any mutation calls
// refresh(), which rebuilds the active view. Views keep their own tiny bits of
// local state (which card is open, what is half-typed) in module scope.
//
// Because every render replaces the DOM, no CSS transition can survive one — so
// motion between states is done with the View Transitions API, which snapshots
// the old and new trees and animates between them. Where it is unsupported (or
// unwanted, per prefers-reduced-motion) the app simply cuts, exactly as before.

import * as store from './store.js';
import { isoToday } from './metrics.js';
import { allStats } from './core/select.js';
import { resetBindings, tick } from './core/bind.js';
import * as uistate from './core/uistate.js';
import { el, toast } from './ui.js';
import { renderPlan, openCard } from './views/plan.js';
import { renderLog, setPrefill } from './views/log.js';
import { renderProgress, openExercise, clearSelection, hasSelection } from './views/progress.js';
import { renderSetup } from './views/setup.js';
import { showWelcome } from './views/welcome.js';

const TABS = [
  { id: 'plan', label: 'Next', icon: 'M4 12h3l3-7 4 14 3-7h3' },
  { id: 'log', label: 'Log', icon: 'M12 5v14M5 12h14' },
  { id: 'progress', label: 'Progress', icon: 'M4 19V9M10 19V5M16 19v-6M22 19H2' },
  { id: 'setup', label: 'Setup', icon: 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2m12 0h2M12 4v2m0 12v2' },
];

let route = 'plan';
let today = isoToday();
const scrollTop = new Map();
let resizeHandlers = [];
let raf = null;
let pendingTransition = false;

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');
const fabHost = el('div', { class: 'fab-host' });
document.body.append(fabHost);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function ctx() {
  const settings = store.getSettings();
  return {
    settings,
    // Not a mode — every screen is the same screen for everyone. This only says
    // whether the "show the numbers" disclosures start open.
    numbersOpen: settings.numbersOpen === true,
    // Memoised in core/select.js: a render caused by view state alone — a card
    // opening, a stepper moving — reads this straight out of the cache.
    stats: allStats(settings, today),
    today,
    route,
    refresh,
    // The cheap sibling of refresh(): re-read every binding without rebuilding
    // anything. Use it when values moved and the shape did not.
    tick,
    goTo,
    onResize: (fn) => resizeHandlers.push(fn),
  };
}

function goTo(next, payload = {}) {
  if (route !== next) scrollTop.set(route, window.scrollY);
  route = next;
  if (next === 'log') setPrefill(payload);
  if (next === 'progress' && payload.exerciseId) openExercise(payload.exerciseId);
  if (next === 'progress' && !payload.exerciseId && payload.list) clearSelection();
  if (next === 'plan' && payload.openExercise) openCard(payload.openExercise);
  render({ restore: true, transition: true });
}

/**
 * `transition: true` asks for an animated swap. Callers that merely repaint
 * after a keystroke leave it off, so typing never animates.
 */
function refresh({ transition = false } = {}) {
  if (transition) pendingTransition = true;
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = null;
    const t = pendingTransition;
    pendingTransition = false;
    render({ keepScroll: true, transition: t });
  });
}

function render(opts = {}) {
  const paint = () => draw(opts);
  if (!opts.transition || reducedMotion() || typeof document.startViewTransition !== 'function') {
    paint();
    return;
  }
  document.startViewTransition(paint);
}

function draw({ restore = false, keepScroll = false } = {}) {
  const y = window.scrollY;
  resizeHandlers = [];
  // The nodes these point at are about to be thrown away.
  resetBindings();
  const c = ctx();
  let view;
  try {
    view = route === 'log' ? renderLog(c)
      : route === 'progress' ? renderProgress(c)
      : route === 'setup' ? renderSetup(c)
      : renderPlan(c);
  } catch (err) {
    console.error(err);
    view = el('section', { class: 'view' }, [
      el('h1', { text: 'Something went wrong' }),
      el('p', { class: 'view-sub', text: String(err?.message || err) }),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, ['Reload']),
    ]);
  }
  main.replaceChildren(view);
  paintTabs();
  paintFab();

  if (keepScroll) window.scrollTo(0, y);
  else if (restore) window.scrollTo(0, scrollTop.get(route) || 0);
  else window.scrollTo(0, 0);
}

function paintTabs() {
  tabbar.replaceChildren(...TABS.map((t) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'tab-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', t.icon);
    svg.append(path);
    return el('button', {
      type: 'button', class: `tab${route === t.id ? ' is-active' : ''}`,
      'aria-current': route === t.id ? 'page' : null,
      onclick: () => {
        // Tapping the tab you are already on takes you back to the top of it —
        // and out of a drilled-in lift, which is what "Progress" now means.
        if (route === t.id) {
          if (t.id === 'progress' && hasSelection()) { clearSelection(); render({ transition: true }); return; }
          window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
          return;
        }
        goTo(t.id, t.id === 'progress' ? { list: true } : {});
      },
    }, [svg, el('span', { class: 'tab-label', text: t.label })]);
  }));
}

/** One always-available primary action: log a set, from wherever you are. */
function paintFab() {
  if (route === 'log' || !store.getExercises().length) { fabHost.replaceChildren(); return; }
  fabHost.replaceChildren(el('button', {
    type: 'button', class: 'fab', 'aria-label': 'Log a set',
    onclick: () => goTo('log', {}),
  }, [
    el('span', { class: 'fab-plus', 'aria-hidden': 'true', text: '+' }),
    el('span', { class: 'fab-label', text: 'Log' }),
  ]));
}

/* ------------------------------------------------------------ swipe between */

// Horizontal drags move between tabs. Anything that scrolls sideways, or that
// interprets a drag itself, opts out — otherwise reading the trade-off grid
// would keep throwing you into another tab.
const NO_SWIPE = '.grid-scroll, .table-scroll, .chart-plot, .chips, .segmented, .swipe-row, input, textarea, select';
let swipe = null;

main.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || e.target.closest?.(NO_SWIPE)) { swipe = null; return; }
  swipe = { x: e.clientX, y: e.clientY };
});
main.addEventListener('pointerup', (e) => {
  const s = swipe;
  swipe = null;
  if (!s) return;
  const dx = e.clientX - s.x;
  const dy = e.clientY - s.y;
  if (Math.abs(dx) < 72 || Math.abs(dy) > 46) return;
  // Inside a lift's detail, a swipe right is "back to all lifts" first.
  if (dx > 0 && route === 'progress' && hasSelection()) { clearSelection(); render({ transition: true }); return; }
  const i = TABS.findIndex((t) => t.id === route);
  const next = TABS[dx < 0 ? i + 1 : i - 1];
  if (next) goTo(next.id, next.id === 'progress' ? { list: true } : {});
});
main.addEventListener('pointercancel', () => { swipe = null; });

/* ------------------------------------------------------------------ boot */

store.applyTheme();
store.load();
render();

if (!store.isOnboarded()) showWelcome({ onDone: () => render({ transition: true }) });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { for (const fn of resizeHandlers) { try { fn(); } catch { /* ignore */ } } }, 150);
});

// Coming back to the app after midnight must not leave "today" stale — and
// going away must not lose whatever was half-typed on the way out.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { uistate.flush(); return; }
  const now = isoToday();
  if (now !== today) { today = now; refresh(); }
});

window.addEventListener('pagehide', () => uistate.flush());

// Another tab (or another window) changed the data. Re-read it and repaint —
// reloading the page, as this used to, threw away whatever was half-typed.
window.addEventListener('storage', (e) => {
  if (e.key !== 'liftingTracker.v1') return;
  store.reload();
  refresh({ transition: true });
});

store.subscribe((evt) => { if (evt.type === 'error') toast(evt.message); });

/* --------------------------------------------------------- service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready.', { action: () => location.reload(), actionLabel: 'Reload' });
          }
        });
      });
    }).catch((err) => console.warn('Service worker not registered:', err));
  });
}
