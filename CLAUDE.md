# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An offline-first iPhone PWA that replaces a lifting spreadsheet (`Lifting Tracker.xlsx`). It is plain static files: vanilla ES modules the browser loads directly, with no build step, dependencies, framework, network calls or analytics, and all data in the device's `localStorage`. Keep it that way: no packages, bundlers, CDN scripts or `fetch` calls. `README.md` is the user-facing spec for behaviour (§3), the maths (§4) and the deliberate departures from the spreadsheet (§5); update it when any of those change.

## Commands

```bash
npm start                    # python3 -m http.server 8080 (ES modules and the service worker need a real server; file:// won't work)
npm test                     # node tools/test.mjs && node tools/test-views.mjs
node tools/test.mjs          # maths + store, checked against Excel's own values
node tools/test-views.mjs    # every view rendered in Node on tools/dom-shim.mjs
npm run preview              # writes preview.html (gitignored): every view and the CSS tokens, both themes, on one page
npm run seed                 # regenerate js/seed.js from Lifting Tracker.xlsx (not in the repo; needs openpyxl); `-- --no-log` drops the sessions
python3 tools/make_icons.py  # regenerate icons/ (needs Pillow)
```

There is no lint, format or typecheck step. Neither test file can be filtered: each runs top to bottom, collects failures by name, lists them at the end and exits 1. `npm test` chains with `&&`, so a maths failure skips the view tests — run the file you care about directly.

## Architecture

### Render loop (`js/app.js`)

The UI is a pure function of the stored document. Each view is `renderX(ctx)` returning a `<section class="view …">`; `ctx` carries `settings`, `numbersOpen`, `stats`, `today`, `route`, `refresh`, `tick`, `goTo` and `onResize`.

- `ctx.refresh()` rebuilds the active view (coalesced into one frame; `{ transition: true }` animates through the View Transitions API, or cuts where unsupported). Use it when the *shape* changes.
- `ctx.tick()` re-runs the `core/bind.js` bindings (`bind`, `bindText`, `bindClass`, `bindAttr`) without rebuilding, so focus and the caret survive. Use it when only *values* move; the log form depends on this. `patch()` reconciles keyed lists in place so nodes already on screen don't replay their entrance animation.
- Every draw resets bindings and resize handlers; whatever a render doesn't re-register is gone.
- `draw()` catches anything a view throws and shows "Something went wrong" instead, so a broken view never crashes — it quietly apologises. Catching that is what `test-views.mjs` is for.
- Horizontal swipes on `<main>` change tab. Anything that scrolls or drags sideways must match `NO_SWIPE` in `app.js`.

### Layers, in dependency order (nothing imports from a layer below it)

1. **Pure — no DOM, no storage, runs in Node:** `metrics.js` (the spreadsheet's maths ported faithfully: e1RM, set bonus, planner and grids, verdict bands, and the fatigue/recovery/detraining "readiness" model), `insights.js` (what the per-set log makes answerable; it must never feed back into scoring), `measure.js`, `muscles.js`, `export.js` (analysis CSVs and a hand-written zip).
2. **`store.js`** — the only owner of persisted state (see below).
3. **`core/`** — `select.js` memoises `exerciseStats` per store version and settings signature; `ctx.stats` is its `allStats(settings, today)`, not `metrics.allStats(exercises, entries, settings, today)`. `uistate.js` keeps view state (open card, half-typed form, plan overrides) in `sessionStorage` under `<view>.<name>` keys, out of the document and out of backups. `motion.js` writes final values immediately under reduced motion and takes its timings from the CSS `--dur-*`/`--ease-*` tokens.
4. **Components:** `charts.js` (hand-built SVG, plus the `el(tag, attrs, children)` helper that `ui.js` re-exports), `ui.js` (steppers, chips, sheets, toasts), `timer.js` (the rest-clock dock, which lives outside the views so it survives re-renders).
5. **`views/`** — one module per tab: `plan.js` (the "Next" tab, the home screen), `log.js`, `progress.js` (with `measure.js` for body check-ins) and `setup.js`. `welcome.js` is the first-run tour.

### Data model (`js/store.js`)

One JSON document in `localStorage['liftingTracker.v1']`. The key says v1 though the document's `schema` is 2; renaming it would orphan installed data. Its collections are `exercises`, `entries`, `done`, `days`, `measurements`, plus `settings`.

- Every mutation goes through `commit(fn, meta)`, which bumps the version (invalidating `core/select.js`), persists and notifies. Undoable mutators hand back an inverse through `record()`; rare bulk operations pass `coarse: true` and take a full snapshot instead.
- `normalise()` runs on every load, import and snapshot undo, and is the migration layer: old shapes are upgraded and known bad data repaired there (`fixTopsetRoles`, for example). It must stay idempotent.
- An **entry** is a block: `weight × reps × sets` of one lift on one date. The block fields are canonical, and every published number comes from them. `log[]` hangs one `{ at, rir, note }` per physical set off the side, reconciled to `sets` on load. `logSet()` counts a set onto an existing same-day entry when `setKey()` (weight and reps) and the plan role match, keeping the lowest RIR; otherwise it starts a new entry.
- `entry.plan` records what was prescribed (`zone` strength/hypertrophy/topset, `role` top/backoff, weight, reps, sets, target, band). `done[]` holds explicit per-lift, per-day "finished" markers — finishing is something the user says, never inferred from set counts. `days[]` is the daily sleep/energy check-in.
- **Unknown is stored as unknown, never guessed or back-filled.** Backfilled sets have `at: null`, entries from before plans existed have `plan: null`, a skipped measurement site is absent rather than 0, and "Can't remember" is `unknown: true`. Keep to this even when a guess would make a chart or export tidier.

### Spreadsheet fidelity

`tools/xlsx-fixture.json` holds values Excel calculated and is ground truth: when a check fails, fix the code, not the fixture. `test.mjs` recomputes them from `js/seed.js` with `TODAY` pinned to `2026-08-18` and must match to the decimal — every Dashboard row (`lastAdj`, `bestAdj`, `trendPerWeek`, `baseTarget`, `volume7`, `sets7`…) and both planner grids (with `readiness: 'off'`) over the first `SHEET_REP_SCHEMES` entries of `REP_SCHEMES` and five set columns. So:

- `baseTarget` is the sheet's flat target and `nextTarget` is that after the readiness model. Keep them separate.
- New rep schemes go after the sheet's seven, which keep their order.
- `js/seed.js` is generated, is every new install's first-run data, *and* is the input the fixture is checked against. Regenerating it (especially with `--no-log`) changes what `npm test` measures.
- A new intentional departure from the sheet belongs in README §5.

## Cross-file checklists

- **Any precached file changes:** bump `CACHE` (`lifting-tracker-vN`) in `sw.js`, or installed phones keep serving the old copy (assets are stale-while-revalidate). On `localhost` the worker is network-first, so local development doesn't need it. Commits mention it: "Offline cache bumped to vN".
- **New `.js` under `js/`:** add it to `SHELL` in `sw.js`. *Tested.*
- **New or renamed band in `metrics.BANDS`:** add the matching `[data-band="…"]` rules in `css/app.css`; there are no per-band `.is-*` classes. *Tested.*
- **New setting:** add it to `DEFAULT_SETTINGS` (`updateSettings` silently drops unknown keys), to `STRING_SETTINGS` or `BOOL_SETTINGS` if it isn't a number (everything else is coerced to one), and — if it reaches the maths — to `STATS_KEYS` (read by `exerciseStats`) or `PLAN_KEYS` (read by `bandFor`/`planFor`) in `core/select.js`, or the memo serves stale figures.
- **New collection in the document:** `blank()`, `normalise()`, both branches of `importJSON()` (replace and merge), the clear/reset functions as appropriate, and `export.js`.
- **Dark palette:** declared twice in `app.css`, under `@media (prefers-color-scheme: dark)` and under `:root[data-theme="dark"]`, with identical tokens. Change both.

## Tests and the DOM shim

`tools/dom-shim.mjs` implements only the DOM the views touch; there is no jsdom, and adding it would break the no-dependencies rule. When a view needs an API the shim lacks, add a stub to the shim rather than guarding app code. Its quirks:

- `querySelectorAll` returns an **Array**, where a browser returns a `NodeList`. Tests call `.filter`/`.find` on it freely; app code must spread it first (`[...node.querySelectorAll(…)]`) or it will pass the tests and break on the phone.
- Selectors: tag, `.class`, `#id`, `[attr]`, `[attr=v]`, descendant chains and comma lists. `>`, `+` and `~` never match and pseudo-classes always do, so an assertion built on them can pass for the wrong reason.
- No `startViewTransition`, so tests take the plain-cut path. Geometry is a fixed 360×220.

When writing view tests, open each block with `reset()` (a fresh page load) and build contexts with `ctx()`. Call `checkIn()` before logging, because the daily check-in gates the first set, and `pickRir()` before each set, because RIR is required. `await settle()` lets queued animation frames run. `app.js` boots on import, so it is imported once, near the end; every other module must stay importable in Node.

## Conventions

- British English in identifiers, comments and copy (`normalise`, `colour`, `memoise`; `lang="en-GB"`).
- Each module opens with `// path — what it is for`, and comments explain *why* in full sentences. Keep that up in code you touch.
- No formatter or linter is configured and quote style varies by file: match the file, and don't reformat whole files.
- Build DOM with `el()`. Text goes in through `text`/`textContent` (exercise names are user data); `html` is for literals only. `el()` skips null and false children; never append `null` directly, which prints "null" in a browser (tested).
- One design for everyone: the verdict in plain words first, the arithmetic behind a "Show the numbers" disclosure. `settings.numbersOpen` only sets whether those start open. The old simple/detailed split was removed on purpose; don't gate features behind a mode again.
- The lifts are listed in one order everywhere: `liftOrder(stats)` in `views/plan.js` (ready, stalest first; then recovering; then never logged; then done today). Next, the Log picker and the "Next lift" buttons all use it; don't sort lifts separately in a new place.

## UI and UX principles

The design target is an iPhone 16 Pro Max (440×956 pt) used one-handed mid-session, and the measure is **taps and scrolls to finish a workout**. Keep to these when adding UI:

- **Show the answer first, everything else on demand.** A closed Next row is the lift's plan plus a **Log** button, with no body. The open card leads with the prescription and **Log this**. The levers and grid sit behind **Adjust** (`plan.adjustId`; `openCard(id, { adjust: true })` opens both). Tests that need the grid open it that way.
- **No explanatory paragraphs on working screens.** No `view-sub` subtitles and no hint text under controls on Next or Log. Explanations go in Setup → How this works (`details()`), or in a "Show the numbers" disclosure. Keep the hints in Setup to one line.
- **Adjust follows the pick.** When Both (top set + back-offs) is the pick, `detail()` hands over to `topsetDetail()`: a top-set row from `plan.topsetOptions`, plus direct back-off levers (`backoffReps` and `backoffPct` overrides, bounded by `TOPSET.backoffRepRange` and `TOPSET.backoffFractions`). Never show the straight-sets grid or the "smallest jump" hint for a top-set session; their weights aren't the top set's.
- **Keep what a set needs under the thumb.** In the log form, RIR and the save button sit in `.log-dock`, which sticks above the tab bar and rest timer. `.card-form` must keep `overflow: visible`, or the sticky positioning stops working. When the lift is finished the dock is no longer sticky.
- **Fold away what isn't in use.** Once a lift is chosen, the Log picker collapses into the session rail (`log.pickerOpen`). The check-in folds to one line once answered, and the warm-ups sit in a disclosure.
- **Search appears only for long lists.** Next, the Log picker and Setup show a search box past 8 lifts. It filters in place without a `refresh()`, so the keyboard stays open.
- **Every tap target is at least 44 pt** (`--tap`). The page gutter is 16 pt.
- **Rendering is not proof of usability.** For layout work, screenshot the real app at 440×956 (headless Chromium via Playwright, outside the repo, so the no-dependencies rule still holds), not just `npm run preview`.

- Commits use a Conventional Commits prefix and a capitalised subject (`feat: Charts for body measurements`, `fix: …`, `chore: …`, `test: …`, `docs: …`, `perf: …`), with a body that explains why.
- The app is deployed as static files. The README recommends GitHub Pages from the root of `main`, so whatever lands on `main` is probably what the phone loads next.
