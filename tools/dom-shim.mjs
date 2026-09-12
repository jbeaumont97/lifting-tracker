// tools/dom-shim.mjs — just enough DOM to render the views in Node.
//
// The app has no build step and no dependencies, so there is no jsdom to reach
// for and adding one would cost the thing that makes this app what it is. But
// draw() wraps every view in a try/catch that falls back to "Something went
// wrong", which means a view that throws looks like a design choice rather than
// a crash. That is worth catching before the gym, not in it.
//
// This implements the narrow surface the views actually touch. It is a test
// harness, not a browser: layout is fake, and anything measuring real geometry
// gets a plausible constant.

const SVG_NS = 'http://www.w3.org/2000/svg';

class ClassList {
  constructor(node) { this.node = node; }
  get _set() { return new Set(String(this.node.className || '').split(/\s+/).filter(Boolean)); }
  _write(set) { this.node.className = [...set].join(' '); }
  add(...cs) { const s = this._set; for (const c of cs) s.add(c); this._write(s); }
  remove(...cs) { const s = this._set; for (const c of cs) s.delete(c); this._write(s); }
  contains(c) { return this._set.has(c); }
  toggle(c, force) {
    const has = this.contains(c);
    const want = force === undefined ? !has : !!force;
    if (want) this.add(c); else this.remove(c);
    return want;
  }
}

class Style {
  constructor() { this._props = new Map(); }
  setProperty(k, v) { this._props.set(k, v); }
  getPropertyValue(k) { return this._props.get(k) ?? ''; }
  removeProperty(k) { this._props.delete(k); }
}

class Node_ {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.childNodes;
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === document || n === document.documentElement || n.__isRoot === true;
  }
  _adopt(child) {
    if (child.parentNode) child.parentNode._detach(child);
    child.parentNode = this;
    return child;
  }
  _detach(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
  }
  append(...kids) {
    for (const k of kids) {
      const node = typeof k === 'object' && k !== null ? k : new Text_(String(k));
      this.childNodes.push(this._adopt(node));
    }
  }
  appendChild(k) { this.append(k); return k; }
  prepend(...kids) {
    for (const k of kids.reverse()) this.childNodes.unshift(this._adopt(k));
  }
  insertBefore(node, ref) {
    this._adopt(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(k) { this._detach(k); return k; }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
  replaceChildren(...kids) {
    for (const c of [...this.childNodes]) c.parentNode = null;
    this.childNodes = [];
    this.append(...kids);
  }
  contains(other) {
    let n = other;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }
}

class Text_ extends Node_ {
  constructor(text) { super(); this.nodeType = 3; this._text = String(text); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}

class Element_ extends Node_ {
  constructor(tag, ns = null) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = ns;
    this.attributes = new Map();
    this.className = '';
    this.dataset = {};
    this.style = new Style();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
  }
  get classList() { return new ClassList(this); }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'class') this.className = String(v);
    if (k === 'hidden') this.hidden = true;
    // Browsers mirror the value attribute onto the property as the initial
    // value, and every number field in the app is populated that way.
    if (k === 'value') this.value = String(v);
  }
  getAttribute(k) {
    if (k === 'class') return this.className || null;
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  removeAttribute(k) { this.attributes.delete(k); if (k === 'hidden') this.hidden = false; }
  hasAttribute(k) { return this.attributes.has(k) || (k === 'class' && !!this.className); }

  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.append(new Text_(v));
  }
  // el() sets this only with literals; the shim keeps the text so assertions work.
  set innerHTML(v) { this.textContent = String(v).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this.textContent; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(ev) {
    const type = typeof ev === 'string' ? ev : ev.type;
    // Extra fields on the passed-in event (key, shiftKey, ...) ride along, so a
    // test can simulate more than a bare type — target stays this element's own,
    // whatever the caller passed.
    const extra = typeof ev === 'object' && ev ? ev : {};
    for (const fn of this.listeners.get(type) || []) {
      fn({ preventDefault() {}, stopPropagation() {}, ...extra, type, target: this });
    }
    return true;
  }
  /** Fire a handler the way a user would, for the interaction tests. */
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = document.body; }
  select() {}
  setPointerCapture() {}
  releasePointerCapture() {}

  _walk(out = []) {
    for (const c of this.children) { out.push(c); c._walk(out); }
    return out;
  }
  querySelectorAll(sel) { return this._walk().filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }

  // Fake geometry — enough for the charts to lay themselves out.
  get clientWidth() { return 360; }
  get clientHeight() { return 220; }
  get offsetHeight() { return 44; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 220, right: 360, bottom: 220 }; }
}

/**
 * Supports the selector shapes the app actually uses: tag, .class, #id, [attr],
 * descendant chains, and comma lists.
 *
 * Descendants matter more than they look. Without them `.a .b` matched nothing,
 * which is not an error — it is an empty NodeList, so a test asserting one of
 * those is absent passes for the wrong reason and never says so.
 */
function matches(node, selector) {
  return String(selector).split(',').some((part) => matchChain(node, part.trim()));
}

/** The node matches the last step, and some ancestor chain matches the rest. */
function matchChain(node, sel) {
  if (!sel) return false;
  const steps = sel.split(/\s+/).filter(Boolean);
  if (!matchStep(node, steps[steps.length - 1])) return false;
  let n = node.parentNode;
  for (let i = steps.length - 2; i >= 0; i--) {
    let found = false;
    while (n && n.nodeType === 1) {
      const hit = matchStep(n, steps[i]);
      n = n.parentNode;
      if (hit) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

function matchStep(node, step) {
  return step.split(/(?=[.#[])/).every((tok) => {
    if (!tok) return true;
    if (tok.startsWith('.')) return node.classList.contains(tok.slice(1));
    if (tok.startsWith('#')) return node.getAttribute('id') === tok.slice(1);
    if (tok.startsWith('[')) {
      const m = /^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(tok);
      if (!m) return false;
      const has = node.hasAttribute(m[1]);
      return m[2] === undefined ? has : node.getAttribute(m[1]) === m[2];
    }
    if (tok === '*') return true;
    if (tok.startsWith(':')) return true;                 // :not(...) etc — treat as a pass
    return node.localName === tok.toLowerCase();
  });
}

class Document_ extends Node_ {
  constructor() {
    super();
    this.nodeType = 9;
    this.listeners = new Map();
    this.documentElement = new Element_('html');
    this.documentElement.__isRoot = true;
    this.body = new Element_('body');
    this.head = new Element_('head');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
    this.visibilityState = 'visible';
  }
  createElement(tag) { return new Element_(tag); }
  createElementNS(ns, tag) { return new Element_(tag, ns); }
  createTextNode(t) { return new Text_(t); }
  getElementById(id) { return this.documentElement.querySelectorAll(`#${id}`)[0] || null; }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent() { return true; }
  // Deliberately absent: startViewTransition. The app already falls back to a
  // plain cut where it is unsupported, and that is the path a test should take.
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

const document = new Document_();

/** Install the shim as globals. Call once, before importing any view module. */
export function installDom({ reducedMotion = false } = {}) {
  const timers = new Set();
  const win = {
    document,
    matchMedia: (q) => ({
      matches: reducedMotion && /prefers-reduced-motion/.test(q),
      media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }),
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(performance.now()), 0); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { clearTimeout(id); timers.delete(id); },
    addEventListener() {}, removeEventListener() {},
    scrollTo() {}, scrollY: 0, innerWidth: 390, innerHeight: 844,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { hostname: 'localhost', reload() {} },
    navigator: { vibrate() { return true; }, standalone: false },
  };

  globalThis.window = win;
  globalThis.document = document;
  // Only what the shim can actually honour: `'serviceWorker' in navigator` and
  // `navigator.share` are both feature-detected by the app, and declaring the
  // keys as undefined would make those checks lie.
  globalThis.navigator = win.navigator;
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.Event = class Event { constructor(type) { this.type = type; } preventDefault() {} stopPropagation() {} };
  globalThis.CustomEvent = globalThis.Event;

  return { document, window: win, drainTimers: () => new Promise((r) => setTimeout(r, 5)) };
}

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);

function escapeText(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(v) {
  return escapeText(v).replace(/"/g, '&quot;');
}

/**
 * Serialise a rendered tree back to HTML.
 *
 * Used by tools/preview.mjs to put the real views in front of a real browser:
 * the app builds its DOM imperatively, so without this there is no way to see
 * what a view produces short of running the whole app.
 */
export function serialize(node, indent = 0) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeText(node.textContent);
  if (node.nodeType !== 1) return '';

  const pad = '  '.repeat(indent);
  const attrs = [];
  if (node.className) attrs.push(`class="${escapeAttr(node.className)}"`);
  for (const [k, v] of node.attributes) {
    if (k === 'class') continue;
    attrs.push(v === '' ? k : `${k}="${escapeAttr(v)}"`);
  }
  for (const [k, v] of Object.entries(node.dataset)) attrs.push(`data-${k}="${escapeAttr(v)}"`);
  for (const [k, v] of node.style._props) attrs.push(`style="${escapeAttr(`${k}:${v}`)}"`);

  const tag = node.namespaceURI === SVG_NS ? node.localName : node.localName;
  const open = `${pad}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  if (VOID.has(tag)) return open;

  const kids = node.childNodes;
  const onlyText = kids.length && kids.every((k) => k.nodeType === 3);
  if (!kids.length) return `${open}</${tag}>`;
  if (onlyText) return `${open}${escapeText(node.textContent)}</${tag}>`;
  const inner = kids.map((k) => (k.nodeType === 3
    ? (k.textContent.trim() ? `${'  '.repeat(indent + 1)}${escapeText(k.textContent)}` : '')
    : serialize(k, indent + 1))).filter(Boolean).join('\n');
  return `${open}\n${inner}\n${pad}</${tag}>`;
}

/** Every element in a tree, for assertions. */
export function walk(node) { return node.nodeType === 1 ? [node, ...node._walk()] : []; }

/** All the text a tree renders, flattened — the cheapest way to assert on copy. */
export function textOf(node) { return node.textContent; }

/** Find rendered elements by class, anywhere in a tree. */
export function findAll(node, selector) { return node.querySelectorAll(selector); }

export { document };
