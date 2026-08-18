// app.js — shell, router and render loop.
//
// The whole UI is a pure function of the stored document: any mutation calls
// refresh(), which rebuilds the active view. Views keep their own tiny bits of
// local state (which card is open, what is half-typed) in module scope.

import * as store from './store.js';
import { allStats, isoToday } from './metrics.js';
import { el, toast } from './ui.js';
import { renderPlan, openCard } from './views/plan.js';
import { renderLog, setPrefill } from './views/log.js';
import { renderProgress, openExercise, clearSelection } from './views/progress.js';
import { renderSetup } from './views/setup.js';

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

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');

function ctx() {
  return {
    settings: store.getSettings(),
    stats: allStats(store.getExercises(), store.getEntries(), store.getSettings(), today),
    today,
    route,
    refresh,
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
  render({ restore: true });
}

function refresh() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { raf = null; render({ keepScroll: true }); });
}

function render({ restore = false, keepScroll = false } = {}) {
  const y = window.scrollY;
  resizeHandlers = [];
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
      onclick: () => { if (route === t.id && t.id === 'progress') clearSelection(); goTo(t.id, t.id === 'progress' ? { list: true } : {}); },
    }, [svg, el('span', { class: 'tab-label', text: t.label })]);
  }));
}

/* ------------------------------------------------------------------ boot */

store.applyTheme();
store.load();
render();

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { for (const fn of resizeHandlers) { try { fn(); } catch { /* ignore */ } } }, 150);
});

// Coming back to the app after midnight must not leave "today" stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = isoToday();
  if (now !== today) { today = now; refresh(); }
});

// Another tab (or another window) changed the data.
window.addEventListener('storage', (e) => {
  if (e.key === 'liftingTracker.v1') { location.reload(); }
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
            toast('A new version is ready.', { action: () => location.reload(), actionLabel: 'Reload', duration: 9000 });
          }
        });
      });
    }).catch((err) => console.warn('Service worker not registered:', err));
  });
}
