// core/bind.js — change a node in place instead of rebuilding the tree.
//
// The render loop replaces the whole view on every refresh, which is right for
// structural change (a tab, a card opening) and wrong for a number moving. It
// costs a full rebuild, it replays every entrance animation, and it takes the
// focus and the caret with it — which is why the log form had to stop using it
// and hand-patch its preview instead.
//
// This is that hand-patching, generalised. A binding reads a value and writes
// text, a class or an attribute. Nothing else moves, so a stepper can repeat at
// 45ms with an input focused and the caret stays exactly where it was.

let updaters = [];
let scheduled = null;

/**
 * Forget every binding. The render loop calls this before it builds a new view,
 * the same way it resets its resize handlers — the old nodes are about to be
 * thrown away and their updaters must not outlive them.
 */
export function resetBindings() {
  updaters = [];
  if (scheduled) { cancelAnimationFrame(scheduled); scheduled = null; }
}

/**
 * Keep `node` in step with `read()`.
 *
 * `apply(node, value, previous)` does the writing. It is called once up front so
 * a binding is also the thing that paints the initial value — there is no way
 * to register one and forget to render it.
 */
export function bind(node, read, apply) {
  let prev;
  let first = true;
  const run = () => {
    const v = read();
    if (!first && Object.is(v, prev)) return;   // nothing moved; touch nothing
    apply(node, v, prev);
    prev = v;
    first = false;
  };
  run();
  updaters.push(run);
  return node;
}

/** Keep a node's text in step with a value. */
export function bindText(node, read) {
  return bind(node, read, (n, v) => { n.textContent = v === null || v === undefined ? '' : String(v); });
}

/** Keep the variable part of a node's class list in step with a value. */
export function bindClass(node, base, read) {
  return bind(node, read, (n, v) => { n.className = v ? `${base} ${v}` : base; });
}

/** Keep one attribute in step. A null or false value removes it. */
export function bindAttr(node, name, read) {
  return bind(node, read, (n, v) => {
    if (v === null || v === undefined || v === false) n.removeAttribute(name);
    else n.setAttribute(name, String(v));
  });
}

/**
 * Re-run every binding, coalesced into one frame. This is the cheap sibling of
 * ctx.refresh(): use it when values moved, and refresh() when the shape did.
 */
export function tick() {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = null;
    for (const run of updaters) {
      try { run(); } catch (err) { console.error(err); }
    }
  });
}

/**
 * Reconcile a keyed list in place.
 *
 * Nodes already present keep their identity, so a set pill that has landed does
 * not replay its animation when the next one lands beside it — which is the
 * whole reason this exists rather than another replaceChildren().
 */
export function patch(parent, items, keyOf, render) {
  const existing = new Map();
  for (const node of parent.children) {
    if (node.dataset && node.dataset.k !== undefined) existing.set(node.dataset.k, node);
  }

  const next = [];
  for (const item of items) {
    const k = String(keyOf(item));
    let node = existing.get(k);
    if (node) existing.delete(k);
    else {
      node = render(item);
      node.dataset.k = k;
    }
    next.push(node);
  }

  for (const stale of existing.values()) stale.remove();

  // Walk backwards so each node is placed before the one already settled to its
  // right, and only touch the DOM where the order actually changed.
  let ref = null;
  for (let i = next.length - 1; i >= 0; i--) {
    const node = next[i];
    if (node.parentNode !== parent || node.nextSibling !== ref) parent.insertBefore(node, ref);
    ref = node;
  }
  return next;
}
