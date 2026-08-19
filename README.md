# Lifting Tracker

Everything is stored in your iPhone's local storage. No accounts, no server, no
network calls, no analytics. The app works with aeroplane mode on.

---

## 1. Put it on your iPhone

The app is plain static files, so any HTTPS host works. Two things need to be true
for it to install as a proper app and work offline: it must be served over
**HTTPS** (or `localhost`), and you must add it to the Home Screen **from Safari**.

### Option A — GitHub Pages (recommended)

Best if you want to change the app later: push a commit, and the phone picks up the
new version next time it opens.

```bash
cd "/lifting-tracker"

git init
git add .
git commit -m "Lifting Tracker app"

# Create the repo and push (needs the gh CLI, or do it on github.com by hand)
gh repo create lifting-tracker --public --source=. --push
```

Then turn Pages on:

1. On github.com, open the repo → **Settings** → **Pages**.
2. Under _Build and deployment_, set **Source** = `Deploy from a branch`,
   **Branch** = `main`, folder = `/ (root)`. Save.
3. Wait a minute or two. Your URL appears at the top of that page:
   `https://<your-username>.github.io/lifting-tracker/`

**One caveat:** GitHub Pages is free only for **public** repos, and `js/seed.js`
contains the lifts and 12 sessions imported from your spreadsheet. If you would
rather not publish your training history, regenerate the seed without it first:

```bash
python3 tools/seed_from_xlsx.py --no-log     # keeps your lifts, drops the log
```

Your day-to-day data is never affected by this — it lives only on your phone, and
nothing the app records ever leaves the device.

### Option B — Cloudflare Pages or Netlify (no repo needed)

Drag this folder onto [Cloudflare Pages](https://pages.cloudflare.com/) or
[Netlify Drop](https://app.netlify.com/drop). You get an HTTPS URL in seconds and
the files stay private. Re-drag the folder to update.

### Option C — a quick look first, over your Wi-Fi

No hosting, but no offline support either (iOS only allows service workers on
HTTPS), and your Mac has to stay awake.

```bash
cd "/lifting-tracker"
npm start                                   # serves on port 8080
ipconfig getifaddr en0                      # your Mac's address on the network
```

On the iPhone, with both on the same Wi-Fi, open `http://<that-address>:8080`.

### Then: add it to the Home Screen

1. Open the URL in **Safari** on your iPhone.
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

It now launches full-screen with no browser chrome, keeps working offline, and
holds its own data. Launching it from the Home Screen icon — rather than from a
Safari tab — is what makes iOS treat the storage as permanent.

> Once installed, open it from the icon rather than the Safari tab. Both work, but
> the Home Screen copy is the one iOS protects from routine cache clearing.

---

## 2. Your spreadsheet data is already in it

On first launch the app loads what `tools/seed_from_xlsx.py` read out of the
workbook: your 7 lifts with their steps, weekly gain targets and set targets, your
12 logged sessions from August, and your settings (Epley, k = 0.05, 84-day
lookback, 1% / 3% bands). After that, the app is the source of truth — the
spreadsheet is never read again.

To pull the spreadsheet across again after editing it:

```bash
python3 tools/seed_from_xlsx.py       # rewrites js/seed.js
```

then, on the phone, **Setup → Reset options → Back to spreadsheet data**. This
needs `Lifting Tracker.xlsx` sitting beside the project; the app itself does not,
since everything the workbook held is already in `js/seed.js`.

The importer also reads an optional **column G** on the Exercises sheet as each
lift's starting weight. There was no such column when the data was imported, so
every lift starts at 0 — set them in the app, or add the column and re-import.

---

## 3. Using it

The app has two levels of detail, set in **Setup**. **Simple** — the default for a
new install — gives you the prescription and how big a step it is, in plain words.
**Detailed** adds the e1RM maths, the target each suggestion is measured against,
the trade-off grid and the projections. Nothing is calculated differently; it is
only what gets shown. An existing install stays on Detailed.

**Next** — one card per lift, each with a single concrete prescription:
`5 × 5 @ 82.5 kg`, plus how big a jump that is. Lifts are grouped by whether they
are ready — rested at least a day, stalest first — and the top card opens itself,
so the screen answers "what do I do today?" rather than listing rows. A lift left
ten days or more is flagged. Tap **Log this** and the log form opens pre-filled.
Tap a card to open it and you get the reps/sets levers, and in the detailed view
the target and the full trade-off grid.

- **Weight** grid: the load to lift for every reps × sets combination that meets
  your target. Tap any cell to plan it.
- **Scores** grid: what each of those options actually scores once the weight is
  rounded up to a loadable step.
- **Table**: the same information as text, for the set count you are planning.

The colours are the spreadsheet's, and every cell also carries a glyph so the
meaning never rests on colour alone:

|     | Band           | Meaning                                         |
| --- | -------------- | ----------------------------------------------- |
| `=` | Already beaten | At or below your current best. Not progression. |
| `✓` | Ideal step     | The smallest honest step forward.               |
| `▲` | Stretch        | Ambitious but usually doable.                   |
| `!` | Too big a jump | You will probably miss reps.                    |

Aim for green most sessions, take amber when you feel strong. If nearly everything
reads amber, your weight step is simply large relative to the lift — widen the
ideal band in **Setup** until green means what you want it to mean.

**Log** — pick the date, tap a lift, and the form arrives pre-filled with the plan.
Weight has its own row with big `−` / `+` keys that step by that lift's increment;
hold one down to travel. A live readout shows what the session would score and
which band it lands in. RIR is one tap.

There are two ways to log, because there are two situations:

- **Set by set** — the default for today. One tap logs the set you have just
  finished, the rest clock starts above the tab bar, and the tracker moves on:
  `5 5 5 5 ·`. Drop the reps before your last set and the short set is recorded as
  it happened. **Undo last set** takes exactly one back off.
- **All at once** — the default for any earlier date. The whole block as one row,
  exactly as it has always worked.

Both store the same thing. Sets that match on **weight and reps** are counted onto
one entry, so `3 × 5 @ 100 kg` is a single row however you typed it, and logging
set by set scores identically to writing the session up afterwards. A set that
differs becomes its own row: four at five reps plus a last one at four is stored as
`4 × 5` and `1 × 4`, and the session is scored on the four honest sets — the short
one neither inflates the number nor erases the work before it.

RIR and notes are recorded per set. Where sets are counted onto one row, that row
keeps the **lowest** RIR — the set closest to failure — and collects the notes;
splitting the row on them instead would split the set count with it, and five sets
would score as five separate single sets.

The first time a session passes your best from before today, that one set is
marked as a personal best — once, not once per set from there on. Swipe a row in
the history left to delete it; a toast offers **Undo**.

**Progress** — the Dashboard, with charts. The list gives each lift's current
adjusted e1RM, its trend and a sparkline; **Table** shows the full Dashboard grid.
Personal bests are ringed on the chart and badged in the history. Tap a lift for
its progression chart: every session, the fitted trend, the projection, and a ring
marking your next target. Drag across the chart to read any
session. Below that: weekly sets against your budget, working sets per week over
the last 8 weeks, and every session as a table.

**Setup** — how much detail to show, the rest timer's target (0 turns it off), your
lifts (tap one to edit), the maths dials, light/dark theme, and your backups. The
welcome tour can be replayed from the bottom of the page.

Each lift has a **starting weight** and a **weight step**, and together they
describe the loads that actually exist for it. A 20 kg bar with 2.5 kg steps means
20, 22.5, 25 — and nothing in between; a machine whose lowest pin is 11.5 kg with
2.3 kg plates means 11.5, 13.8, 16.1. Every suggestion the planner makes is rounded
up onto that ladder, never below the starting weight, and the `−` / `+` keys in the
log form walk the same rungs. Leave the starting weight at 0 for dumbbells, or
anywhere the step alone describes what you can load.

---

## 4. The maths

Unchanged from the workbook:

- **e1RM (Epley)** = `weight × (1 + reps / 30)`. This is what puts 8 reps at 60 kg
  (76.0) and 5 reps at 70 kg (81.7) on one scale. Brzycki —
  `weight × 36 / (37 − reps)` — is available in Setup and reads lower at high reps.
- **Adjusted e1RM** = `e1RM × (1 + k × ln(sets))`, k = 0.05 by default. Extra sets
  earn credit with diminishing returns: 2 sets +3.5%, 3 sets +5.5%, 5 sets +8.0%.
  Set k to 0 to ignore sets entirely.
- **Volume** = `weight × reps × sets`. Tracked separately because it measures a
  different thing: 3×8 at 60 kg is 1,440 kg against 1,050 kg for 3×5 at 70 kg,
  while losing to it on e1RM. Both readings are correct; they answer different
  questions.
- **Weekly sets** — a plain count of working sets in the last 7 days, because sets
  per week is the unit training is actually prescribed in. Roughly 10–20 hard sets
  per muscle per week, spread across every lift that trains it.
- **Trend** — least-squares fit of adjusted e1RM against date over the lookback
  window (84 days by default), reported in kg/week.
- **Next target** = last session's adjusted e1RM × (1 + that lift's weekly gain).
  The planner then finds the lightest loadable weight that meets it — where
  _loadable_ means `starting weight + n × step` for that lift.

### Things to keep in mind

- e1RM formulas drift above roughly 10–12 reps and will overestimate. Keep
  comparisons inside 1–10 reps where you can.
- A set to failure and a set with 3 reps left produce the same e1RM but are not the
  same session. That is what RIR is for.
- The set bonus is a heuristic. There is no agreed formula for folding sets into
  one strength number, so treat k as a dial you tune, not a constant to trust.
- Projections are straight lines. Real progress is roughly linear for a few months
  and then flattens, so +12 weeks is a ceiling, not a forecast. The trend is only
  honest if your set count is reasonably stable.

---

## 5. Where it deliberately differs from the spreadsheet

Everything the workbook publishes, the app reproduces to the decimal —
`npm test` checks each Dashboard row and every cell of both planner grids against
the values Excel itself calculated. Six things are intentionally different:

1. **Projections are withheld until the fit earns them.** The sheet will happily
   extrapolate two sessions three days apart to +12 weeks; on your August data that
   produced a 167 kg squat projection. The app shows a projection only with at
   least 3 sessions spanning 2 weeks, and marks thinner fits _provisional_. The
   trend figure itself is still shown, and the maths is identical.
2. **"Sessions" counts session days**, not logged rows. The trend still fits every
   logged set, exactly as the sheet does.
3. **"Last session" means that day's best block** — the best set, credited for the
   number of times it was repeated. With one row per lift per session this is
   identical to the sheet's "last row". It differs once a day holds more than one
   row, which set-by-set logging makes ordinary: a session of four fives and a
   final four is read as the four fives, not as the single short set.
4. **The planner takes any reps and sets**, computing the weight directly rather
   than looking it up in a 5-column grid. The grid runs to 6 sets, and reps snap to
   the nearest scheme only for choosing which cell to highlight.
5. **Each lift has a starting weight.** The sheet rounds up to a multiple of the
   step, which assumes every lift can be loaded from zero. Here the ladder starts
   at the bar (or the lowest pin), so a 20 kg bar in 2.5 kg steps offers 22.5 and
   25 rather than a theoretical 21.25.
6. **A way out of "already beaten".** Because the target comes from your _last_
   session, a good session followed by a poor one can make the plan suggest
   something you have already beaten — the sheet greys it out and stops there. The
   app offers a one-tap _aim past your best_ instead.

---

## 6. Back up your data

The log lives in one browser origin's local storage on one phone. That is what
makes it private and fast, and it is also the risk. **Setup → Back up (JSON)**
opens the iOS share sheet, so you can drop a backup into Files or iCloud Drive.
**Restore a backup** takes it back, either replacing everything or merging
(duplicate sets on the same day are skipped). **Export log (CSV)** gives you a
spreadsheet-shaped copy of the log.

Take one after any big session block. Clearing Safari's website data, or deleting
the Home Screen app, takes the local storage with it.

---

## 7. Updating the app

Edit the files, redeploy, and open the app on the phone. The service worker fetches
the new version in the background and a toast offers **Reload**.

If you change a file, bump `CACHE` in `sw.js` (`lifting-tracker-v1` → `v2`) so old
copies are dropped rather than served from cache.

---

## 8. What is in here

```
index.html               the shell: four tabs, one <main>
manifest.webmanifest     name, icons, standalone display
sw.js                    offline cache of the app shell
css/app.css              one stylesheet; light and dark palettes as tokens
js/metrics.js            all the maths, as pure functions (no DOM, no storage)
js/store.js              localStorage: load, mutate, undo, import/export
js/charts.js             hand-built SVG — progression chart, sparkline, meter, bars
js/ui.js                 steppers, chips, toasts, bottom sheets, celebration
js/timer.js              the rest clock, docked above the tab bar
js/seed.js               generated from the workbook; loaded once on first run
js/app.js                router, render loop, view transitions, service worker
js/views/                one module per tab: plan, log, progress, setup
                         plus welcome.js, the first-run tour
tools/seed_from_xlsx.py  regenerates js/seed.js from Lifting Tracker.xlsx
tools/make_icons.py      regenerates the app icons
tools/test.mjs           the maths, checked against the workbook's own values
tools/xlsx-fixture.json  values Excel calculated, used by the tests
```

```bash
npm start      # serve on http://localhost:8080
npm test       # check the maths against the spreadsheet
npm run seed   # re-import Lifting Tracker.xlsx into js/seed.js
```

No build step, no dependencies, no framework — the browser loads the ES modules
directly. Note that ES modules and service workers both need a real server, so
opening `index.html` from Finder will not work; use `npm start`.
