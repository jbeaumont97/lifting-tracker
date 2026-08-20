// tools/preview.mjs — build a design reference sheet from the real app.
//
//   node tools/preview.mjs [outfile]
//
// The app has no build step and renders its DOM imperatively, so there is no
// static HTML anywhere to look at. This runs the actual views through the DOM
// shim, serialises what they produce, and drops the result into a page next to
// the token values pulled straight out of the stylesheet.
//
// The point is to be able to SEE a change to the design system — the whole app,
// both themes, every component, on one page — rather than clicking through four
// screens twice and trusting memory for the difference.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { installDom, serialize } from './dom-shim.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'preview.html'));

installDom();

const M = await import('../js/metrics.js');
const store = await import('../js/store.js');
const select = await import('../js/core/select.js');
const { renderPlan, openCard } = await import('../js/views/plan.js');
const { renderLog, setPrefill } = await import('../js/views/log.js');
const { renderProgress, openExercise, clearSelection } = await import('../js/views/progress.js');
const { renderSetup } = await import('../js/views/setup.js');

const TODAY = '2026-08-18';
const css = readFileSync(join(root, 'css', 'app.css'), 'utf8');

function ctx(over = {}) {
  const settings = store.getSettings();
  return {
    settings,
    numbersOpen: settings.numbersOpen === true,
    stats: select.allStats(settings, TODAY),
    today: TODAY,
    route: 'plan',
    refresh() {}, tick() {}, goTo() {}, onResize() {},
    ...over,
  };
}

/* ------------------------------------------------ pull the tokens out of CSS */

/** Everything declared in the first :root block, in source order. */
function rootTokens() {
  const block = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
  const map = new Map();
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

/** The dark overrides, so the colour table can show both. */
function darkTokens() {
  const i = css.indexOf('@media (prefers-color-scheme: dark)');
  const block = css.slice(i, css.indexOf('/* ---', i));
  const map = new Map();
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const T = rootTokens();
const D = darkTokens();

/** How many times a token is actually referenced — proof it is load-bearing. */
function uses(name) {
  return (css.match(new RegExp(`var\\(${name}[,)]`, 'g')) || []).length;
}

const px = (rem) => {
  const m = /^([\d.]+)rem$/.exec(rem);
  return m ? `${(Number(m[1]) * 16).toFixed(1).replace(/\.0$/, '')}px` : rem;
};

/* ---------------------------------------------------------- render the app */

/**
 * Views that draw charts paint them inside a requestAnimationFrame, so the
 * frame has to be allowed to run before the tree is worth serialising —
 * otherwise the chart cards come out empty and the preview quietly understates
 * what the screen shows.
 */
const settle = () => new Promise((r) => setTimeout(r, 30));

async function screen(name, node, note) {
  await settle();
  return { name, note, html: serialize(node) };
}

const screens = [];

// Next, with the top card open so the grid and the disclosures are visible.
{
  store.reload();
  select.invalidate();
  const c = ctx();
  const trained = c.stats.find((s) => s.entryCount > 0);
  openCard(trained.exercise.id);
  screens.push(await screen('Next', renderPlan(ctx()),
    'The card is open, so this shows the prescription, the verdict, the readiness note, both disclosures and the full trade-off grid.'));
}

// Log, mid-session: two lifts under way, sets already down, the rest between
// them real rather than backfilled.
{
  const [a, b] = store.getExercises();
  const spaced = (fn, gapMs) => { const t = Date.now; let n = t(); Date.now = () => n; fn(() => { n += gapMs; }); Date.now = t; };
  spaced((tick) => {
    store.logSet({ exerciseId: a.id, date: TODAY, weight: 100, reps: 5, rir: 3 }); tick();
    store.logSet({ exerciseId: a.id, date: TODAY, weight: 100, reps: 5, rir: 2 }); tick();
    store.logSet({ exerciseId: a.id, date: TODAY, weight: 100, reps: 4, rir: 0 }); tick();
    store.logSet({ exerciseId: b.id, date: TODAY, weight: 60, reps: 8, rir: 3, notes: 'belt on, felt fast' });
  }, 165000);
  select.invalidate();
  setPrefill({ exerciseId: a.id, date: TODAY, mode: 'sets' });
  screens.push(await screen('Log', renderLog(ctx({ route: 'log' })),
    'Mid-session: the rail across the top is every lift today, the trace under the form is this lift set by set with its RIR and real rest between sets, and the third squat set shows short against the plan.'));
  for (let i = 0; i < 4; i++) store.undo();
  select.invalidate();
}

{
  clearSelection();
  screens.push(await screen('Progress', renderProgress(ctx({ route: 'progress' })),
    'Sparklines, trend colours and the KPI row.'));
}

{
  const trained = ctx().stats.find((s) => s.entryCount > 0);
  openExercise(trained.exercise.id);
  screens.push(await screen('One lift', renderProgress(ctx({ route: 'progress' })),
    'The hero number, the progression chart with its trend and projection, the sets meter, the eight-week bars and the full session table.'));
  clearSelection();
}

// A lift with enough history to have a trend worth extrapolating. The seed is
// twelve entries, so nothing in it clears metrics.js's bar for a reliable fit —
// which is correct, and also means the projection, the milestone ETA and the
// readiness curve are all invisible on seed data alone.
{
  const ex = store.getExercises()[0];
  const entries = store.getEntries().filter((e) => e.exerciseId !== ex.id);
  let seq = 5000;
  for (let w = 13; w >= 0; w--) {
    for (const offset of [0, 3]) {
      const date = M.isoAddDays(TODAY, -(w * 7 + offset));
      const weight = Math.round((72.5 + (13 - w) * 1.15) / 2.5) * 2.5;
      entries.push({
        id: `h-${seq}`, date, exerciseId: ex.id, weight, reps: 5, sets: 3,
        rir: offset ? 2 : 1, notes: '', seq: seq++,
      });
    }
  }
  store.importJSON(JSON.stringify({ exercises: store.getExercises(), entries, settings: store.getSettings() }));
  select.invalidate();
  openExercise(ex.id);
  screens.push(await screen('One lift, with history',
    renderProgress(ctx({ route: 'progress' })),
    'Fourteen weeks of squats twice a week. Only with a fit this long does the app publish a projection at all — so this is the screen where the trend cone, the next milestone and its estimated date are actually visible.'));
  clearSelection();
  screens.push(await screen('Next, with history', renderPlan(ctx()),
    'The same history on the planner: the top card now carries a runway to the next round number on the bar, which stays hidden while the fit is too thin to date.'));
}

{
  screens.push(await screen('Setup', renderSetup(ctx({ route: 'setup' })),
    'The disclosure switch that replaced the simple/detailed toggle, plus the per-lift and coefficient cards folded away.'));
}

/* ---------------------------------------------------------------- the page */

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TYPE_STEPS = ['--text-3xs', '--text-2xs', '--text-xs', '--text-sm', '--text-md',
  '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl', '--text-5xl'];
const SPACE_STEPS = [...T.keys()].filter((k) => k.startsWith('--space-'));
const RADII = ['--radius-xs', '--radius-sm', '--radius', '--radius-lg', '--radius-pill'];
const WEIGHTS = ['--fw-normal', '--fw-medium', '--fw-semi', '--fw-bold'];
const COLOUR_GROUPS = [
  ['Ground', ['--plane', '--surface-1', '--surface-2']],
  ['Ink', ['--text-primary', '--text-secondary', '--muted']],
  ['Line', ['--border', '--border-strong', '--grid', '--axis']],
  ['Data', ['--series-1', '--series-1-deep', '--series-wash']],
  ['Verdict', ['--good', '--good-ink', '--good-tint', '--warning', '--warn-ink', '--warn-tint',
    '--critical', '--crit-ink', '--crit-tint', '--neutral-ink', '--neutral-tint']],
];
const ACCENTS = [...T.keys()].filter((k) => /^--accent-\d$/.test(k));

const typeRows = TYPE_STEPS.map((k) => `
  <li class="spec">
    <code class="spec-name">${k}</code>
    <span class="spec-demo" style="font-size:${T.get(k)}">Squat 102.5</span>
    <span class="spec-val">${px(T.get(k))}</span>
    <span class="spec-uses">${uses(k)}</span>
  </li>`).join('');

const weightRows = WEIGHTS.map((k) => `
  <li class="spec">
    <code class="spec-name">${k}</code>
    <span class="spec-demo" style="font-weight:${T.get(k)}">Deadlift 140</span>
    <span class="spec-val">${T.get(k)}</span>
    <span class="spec-uses">${uses(k)}</span>
  </li>`).join('');

const spaceRows = SPACE_STEPS.map((k) => `
  <li class="spec">
    <code class="spec-name">${k}</code>
    <span class="spec-demo"><i class="bar" style="width:${T.get(k)}"></i></span>
    <span class="spec-val">${T.get(k)}</span>
    <span class="spec-uses">${uses(k)}</span>
  </li>`).join('');

const radiusRows = RADII.map((k) => `
  <li class="spec">
    <code class="spec-name">${k}</code>
    <span class="spec-demo"><i class="chip-demo" style="border-radius:${T.get(k)}"></i></span>
    <span class="spec-val">${T.get(k)}</span>
    <span class="spec-uses">${uses(k)}</span>
  </li>`).join('');

const colourRows = COLOUR_GROUPS.map(([label, keys]) => `
  <div class="swatch-group">
    <h4>${label}</h4>
    <ul class="swatches">
      ${keys.map((k) => `<li class="swatch">
        <span class="chipset">
          <i style="background:${T.get(k)}" title="light"></i><i style="background:${D.get(k) || T.get(k)}" title="dark"></i>
        </span>
        <code>${k}</code>
        <span class="swatch-val">${esc(T.get(k))}</span>
        <span class="swatch-val alt">${D.has(k) ? esc(D.get(k)) : '—'}</span>
      </li>`).join('')}
    </ul>
  </div>`).join('');

const accentRow = ACCENTS.map((k) => `<i class="accent" style="background:${T.get(k)}" title="${k}"></i>`).join('');

const frames = screens.map((s, i) => `
  <section class="screen" id="screen-${i}">
    <div class="screen-head">
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.note)}</p>
    </div>
    <div class="frames">
      <figure><figcaption>Light</figcaption><iframe data-screen="${i}" data-theme="light" title="${esc(s.name)}, light"></iframe></figure>
      <figure><figcaption>Dark</figcaption><iframe data-screen="${i}" data-theme="dark" title="${esc(s.name)}, dark"></iframe></figure>
    </div>
  </section>`).join('');

const page = `<title>Lifting Tracker Tokens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root {
  --ink: #101216;
  --ink-2: #191c22;
  --ink-3: #232733;
  --paper: #f6f6f4;
  --edge: rgba(255,255,255,0.10);
  --fg: #eceef2;
  --fg-dim: #a2a8b8;
  --fg-faint: #6d7484;
  --blue: #4f97ee;
  --blue-deep: #2a78d6;
  --bg: var(--ink);
  --panel: var(--ink-2);
  --sunk: var(--ink-3);
  --display: 'Archivo', 'Helvetica Neue', sans-serif;
  --body: 'Public Sans', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 400 16px/1.6 var(--body);
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px 96px; }
h1, h2, h3, h4 { font-family: var(--display); margin: 0; text-wrap: balance; letter-spacing: -0.015em; }

/* ---- masthead: a parts-catalogue cover ---- */
.mast { padding: 72px 0 36px; border-bottom: 1px solid var(--edge); }
.eyebrow {
  font: 500 11px/1 var(--mono); letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--blue); margin-bottom: 18px;
}
.mast h1 { font-size: clamp(2.5rem, 1.6rem + 4vw, 4rem); font-weight: 700; line-height: 0.98; }
.mast p { max-width: 62ch; margin: 18px 0 0; color: var(--fg-dim); font-size: 1.0625rem; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 40px; margin-top: 32px; }
.stat { display: flex; flex-direction: column; gap: 2px; }
.stat b { font: 600 1.75rem/1 var(--display); font-variant-numeric: tabular-nums; }
.stat span { font: 400 11px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-faint); }
.stat .down { color: var(--blue); }

section.block { padding: 56px 0 0; }
section.block > h2 {
  font-size: 1.5rem; font-weight: 600; padding-bottom: 14px;
  border-bottom: 1px solid var(--edge); margin-bottom: 22px;
  display: flex; align-items: baseline; gap: 14px;
}
section.block > h2 em {
  font: 400 11px/1 var(--mono); font-style: normal; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--fg-faint);
}
.lede { max-width: 68ch; color: var(--fg-dim); margin: 0 0 24px; }

/* ---- specimen list: label, rendering, value, usage count ---- */
.specs { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--edge); }
.spec {
  display: grid; grid-template-columns: 148px 1fr 78px 46px;
  align-items: center; gap: 20px;
  padding: 12px 0; border-bottom: 1px solid var(--edge);
}
.spec-name { font: 400 12px/1 var(--mono); color: var(--blue); white-space: nowrap; }
.spec-demo { min-width: 0; overflow: hidden; white-space: nowrap; font-variant-numeric: tabular-nums; }
.spec-val, .spec-uses {
  font: 400 12px/1 var(--mono); color: var(--fg-dim); text-align: right;
  font-variant-numeric: tabular-nums;
}
.spec-uses { color: var(--fg-faint); }
.spec-uses::after { content: '\\00d7'; margin-left: 2px; opacity: 0.5; }
.specs-head { color: var(--fg-faint); font: 400 10px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; }
.specs-head .spec-demo { color: var(--fg-faint); }
.bar { display: block; height: 12px; background: var(--blue); border-radius: 2px; }
.chip-demo { display: block; width: 46px; height: 26px; background: var(--sunk); border: 1px solid var(--edge); }

/* ---- colour ---- */
.swatch-group + .swatch-group { margin-top: 26px; }
.swatch-group h4 {
  font: 400 10px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--fg-faint); margin-bottom: 10px;
}
.swatches { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
.swatch {
  display: grid; grid-template-columns: 56px 1fr 168px 168px; align-items: center; gap: 16px;
  padding: 7px 0; border-bottom: 1px solid var(--edge);
}
.swatch code { font: 400 12px/1 var(--mono); color: var(--fg); }
.chipset { display: flex; border-radius: 5px; overflow: hidden; border: 1px solid var(--edge); }
.chipset i { display: block; width: 28px; height: 24px; }
.swatch-val { font: 400 11px/1 var(--mono); color: var(--fg-dim); font-variant-numeric: tabular-nums; }
.swatch-val.alt { color: var(--fg-faint); }
.accents { display: flex; gap: 6px; margin-top: 12px; }
.accent { display: block; width: 38px; height: 38px; border-radius: 7px; }

/* ---- screens ---- */
.screen { margin-top: 42px; }
.screen-head h3 { font-size: 1.125rem; font-weight: 600; }
.screen-head p { margin: 6px 0 16px; color: var(--fg-dim); max-width: 68ch; font-size: 0.9375rem; }
.frames { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.frames figure { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.frames figcaption {
  font: 400 10px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-faint);
}
.frames iframe {
  width: 100%; border: 1px solid var(--edge); border-radius: 10px; background: var(--paper);
  height: 640px; display: block;
}
.note {
  margin-top: 14px; padding: 14px 16px; border-left: 2px solid var(--blue);
  background: var(--panel); border-radius: 0 8px 8px 0; color: var(--fg-dim); font-size: 0.9375rem;
}
.note b { color: var(--fg); font-weight: 600; }
.check { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 9px; }
.check li { display: grid; grid-template-columns: 20px 1fr; gap: 10px; color: var(--fg-dim); }
.check li::before {
  content: ''; width: 13px; height: 13px; margin-top: 6px;
  border: 1.5px solid var(--blue); border-radius: 3px;
}
.check b { color: var(--fg); font-weight: 600; }

@media (max-width: 860px) {
  .frames { grid-template-columns: 1fr; }
  .spec { grid-template-columns: 118px 1fr 66px 38px; gap: 12px; }
  .swatch { grid-template-columns: 50px 1fr 100px; }
  .swatch-val.alt { display: none; }
  .wrap { padding: 0 18px 72px; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="mast">
    <div class="eyebrow">Phase 2 &middot; design system</div>
    <h1>Lifting&nbsp;Tracker<br>Tokens</h1>
    <p>Every value below is read out of <code>css/app.css</code>, and every screen below that is the
       real view rendered through the app's own code. Nothing here is a mock-up, so if it looks
       wrong here it looks wrong in the gym.</p>
    <div class="stats">
      <div class="stat"><b>25 <span class="down">&rarr; 12</span></b><span>type sizes</span></div>
      <div class="stat"><b>7 <span class="down">&rarr; 4</span></b><span>font weights</span></div>
      <div class="stat"><b>9</b><span>space steps</span></div>
      <div class="stat"><b>2 <span class="down">&rarr; 1</span></b><span>designs</span></div>
    </div>
  </header>

  <section class="block">
    <h2>Type <em>12 steps</em></h2>
    <p class="lede">Twenty-five hard-coded pixel sizes, many at half-pixel precision, collapsed onto
      twelve steps &mdash; and moved to <code>rem</code>, so the browser's own text-size setting can
      reach them. The smallest UI text used to be a fixed 9.5&thinsp;px that no setting could touch.
      Only the two hero numbers are fluid.</p>
    <ul class="specs">
      <li class="spec specs-head"><span>token</span><span class="spec-demo">specimen</span><span class="spec-val">size</span><span class="spec-uses">used</span></li>
      ${typeRows}
      <li class="spec">
        <code class="spec-name">--display</code>
        <span class="spec-demo" style="font-size:var(--display-demo,3rem);font-weight:700;line-height:1">102.5</span>
        <span class="spec-val">50&ndash;60px</span>
        <span class="spec-uses">${uses('--display')}</span>
      </li>
    </ul>
    <div class="note"><b>Fluid hero.</b> <code>clamp(2.875rem, 2.647rem + 1.96vw, 3.75rem)</code> resolves to
      exactly 50&thinsp;px at a 390&thinsp;px viewport and 60&thinsp;px at 900&thinsp;px, which replaces the
      hard step the old 900&thinsp;px breakpoint made.</div>
  </section>

  <section class="block">
    <h2>Weight <em>4 of 7</em></h2>
    <p class="lede">This is the one change that is genuinely visible rather than a tidy-up.
      <code>system-ui</code> is a variable font on Apple platforms, so 550, 650 and 680 were rendering
      as real intermediate weights &mdash; not rounding to 600/700 as they would with a static face.
      Headings were 650 and are now 600; hero numbers were 680 and are now 700.</p>
    <ul class="specs">
      <li class="spec specs-head"><span>token</span><span class="spec-demo">specimen</span><span class="spec-val">value</span><span class="spec-uses">used</span></li>
      ${weightRows}
    </ul>
    <div class="note"><b>Worth a close look.</b> Headings a shade lighter, the big numbers a shade
      heavier. If the headings now read too light, moving <code>--fw-semi</code> to 650 restores the
      old look in one line &mdash; that is what the token is for.</div>
  </section>

  <section class="block">
    <h2>Space &amp; shape <em>9 + 5</em></h2>
    <p class="lede">The step values were chosen so the sizes already used most often land on one
      exactly: 8, 10, 2, 6 and 12&thinsp;px are unchanged. Everything else moved by at most a pixel.</p>
    <ul class="specs">${spaceRows}</ul>
    <ul class="specs" style="margin-top:26px">${radiusRows}</ul>
  </section>

  <section class="block">
    <h2>Colour <em>light / dark</em></h2>
    <p class="lede">Untouched this phase &mdash; the base / ink / tint convention was already the
      strongest part of the stylesheet. Shown here because the verdict colours now reach the UI
      through <code>[data-band]</code> rather than through a class per band, which retired eighteen
      specificity-fighting rules.</p>
    ${colourRows}
    <div class="swatch-group">
      <h4>Lift identity &mdash; decorative only, never the sole carrier of meaning</h4>
      <div class="accents">${accentRow}</div>
    </div>
  </section>

  <section class="block">
    <h2>The screens <em>rendered, not mocked</em></h2>
    <p class="lede">Each frame is the real view, built by the real code, styled by the real
      stylesheet &mdash; charts included, drawn by the same inline-SVG functions the app uses.</p>
    <ul class="check">
      <li><b>The verdict leads, the numbers follow.</b> Every screen should read plainly with a
        &ldquo;Show the numbers&rdquo; disclosure underneath, rather than switching between two designs.</li>
      <li><b>The trade-off grid is on every open card.</b> It used to be locked behind a settings toggle.</li>
      <li><b>Band tints.</b> Green, amber, red and grey across the grid &mdash; if every cell reads grey,
        the <code>data-band</code> contract has broken.</li>
      <li><b>Dark mode.</b> Same hierarchy, no washed-out text, no light patches.</li>
    </ul>
    ${frames}
  </section>
</div>

<script>
const SCREENS = ${JSON.stringify(screens.map((s) => s.html))};
const CSS = ${JSON.stringify(css)};
const shell = (html, theme) =>
  '<!doctype html><html lang="en-GB" data-theme="' + theme + '"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS
  + 'body{padding:0}main{padding:14px}</style></head><body><main>' + html + '</main></body></html>';

for (const frame of document.querySelectorAll('iframe[data-screen]')) {
  frame.srcdoc = shell(SCREENS[Number(frame.dataset.screen)], frame.dataset.theme);
  frame.addEventListener('load', () => {
    try {
      const h = frame.contentDocument.documentElement.scrollHeight;
      frame.style.height = Math.min(2400, Math.max(360, h + 8)) + 'px';
    } catch { /* leave the default height */ }
  });
}
</script>
`;

writeFileSync(out, page);
console.log(`wrote ${out}`);
console.log(`  ${screens.length} screens, ${T.size} light tokens, ${D.size} dark overrides`);
