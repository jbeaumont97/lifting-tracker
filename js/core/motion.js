// core/motion.js — the kinetic primitives.
//
// Numbers that count up to where they landed, marks that arrive with a bit of
// weight behind them. All of it decorative: every function here writes the
// final state immediately when the reader has asked for reduced motion, so the
// app is never waiting on an animation to tell it something.
//
// Timings come off the CSS tokens rather than being repeated here, so the feel
// of the whole app is tuned in one place.

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

let tokens = null;
function token(name, fallback) {
  if (!tokens) {
    try {
      tokens = getComputedStyle(document.documentElement);
    } catch {
      tokens = { getPropertyValue: () => '' };
    }
  }
  const v = String(tokens.getPropertyValue(name) || '').trim();
  return v || fallback;
}

/** "320ms" / "0.32s" -> 320. */
function ms(value, fallback) {
  const m = /^([\d.]+)(ms|s)?$/.exec(String(value).trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;
  return m[2] === 's' ? n * 1000 : n;
}

export const durations = {
  get fast() { return ms(token('--dur-fast', '140ms'), 140); },
  get base() { return ms(token('--dur-base', '200ms'), 200); },
  get slow() { return ms(token('--dur-slow', '320ms'), 320); },
};

export const easings = {
  get out() { return token('--ease-out', 'cubic-bezier(0.2, 0.7, 0.3, 1)'); },
  get spring() { return token('--ease-spring', 'cubic-bezier(0.22, 1.2, 0.36, 1)'); },
};

/* --------------------------------------------------------------- count up */

const running = new WeakMap();

/**
 * Run a number up to its new value.
 *
 * `format` turns the running number into what the node shows, so the digits
 * on the way are formatted exactly like the one that lands. Reading starts
 * from whatever the node already says unless `from` is given, which means a
 * value that moves twice in quick succession picks up where it was rather than
 * snapping back.
 */
export function countUp(node, to, { from, duration, format = (v) => v.toFixed(1) } = {}) {
  const target = Number(to);
  if (!node) return;
  if (!Number.isFinite(target)) { node.textContent = format(NaN); return; }

  const prev = running.get(node);
  if (prev) { cancelAnimationFrame(prev.raf); running.delete(node); }

  // An empty node has no previous value, and Number('') is 0 — which would run
  // the hero number up from zero every time the screen was rendered rather than
  // only when it actually moved.
  const text = String(node.textContent || '').replace(/[^0-9.-]/g, '');
  const parsed = from === undefined ? (text === '' ? NaN : Number(text)) : Number(from);
  const start = prev && Number.isFinite(prev.value) ? prev.value : parsed;

  if (!Number.isFinite(start) || Math.abs(target - start) < 1e-9 || reduced()
      || typeof requestAnimationFrame !== 'function') {
    node.textContent = format(target);
    return;
  }

  const span = duration ?? durations.slow;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / span);
    // Ease out cubic: fast off the mark, settling rather than stopping.
    const eased = 1 - Math.pow(1 - p, 3);
    const value = start + (target - start) * eased;
    node.textContent = format(value);
    if (p < 1) {
      running.set(node, { raf: requestAnimationFrame(step), value });
    } else {
      running.delete(node);
      node.textContent = format(target);
    }
  };
  running.set(node, { raf: requestAnimationFrame(step), value: start });
}

/* ----------------------------------------------------------------- accent */

/**
 * A short spring on arrival — the set that just landed, the number that just
 * moved. Returns the Animation so a caller can await it, or null when nothing
 * ran.
 */
export function spring(node, { scale = 1.06, duration } = {}) {
  if (!node || reduced() || typeof node.animate !== 'function') return null;
  return node.animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${scale})`, offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    { duration: duration ?? durations.slow, easing: easings.spring },
  );
}

/** A one-shot attention pulse, for a value that changed while you were looking. */
export function pulse(node, { duration } = {}) {
  if (!node || reduced() || typeof node.animate !== 'function') return null;
  return node.animate(
    [{ opacity: 1 }, { opacity: 0.45, offset: 0.35 }, { opacity: 1 }],
    { duration: duration ?? durations.base, easing: easings.out },
  );
}

/** True when the reader has asked us to sit still — exported so views can ask. */
export const prefersReducedMotion = reduced;
