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

Every screen is the same screen for everyone — there is no simple/detailed
split any more, because two parallel designs is one too many. Each verdict is
given in plain words, with the arithmetic behind it one tap away under **Show
the numbers**. The only setting is whether those disclosures start open or
folded, in **Setup**.

**Next** — one card per lift, each with a single concrete prescription:
`5 × 5 @ 82.5 kg`, plus how big a jump that is. Lifts are grouped by whether they
are ready — recovered from the last session, stalest first — and the top card
opens itself, so the screen answers "what do I do today?" rather than listing
rows. A chip on each card carries its readiness: _ready in 1d_ while a lift is
still recovering, a plain day count once rest has stopped adding anything, and
`24 days · −4%` once a layoff has started costing you strength. Open a card and a
line under the prescription says why today's number is what it is. Tap **Log
this** and the log form opens pre-filled.
Tap a card to open it and you get the reps/sets levers, the target and the full
trade-off grid.

Under every prescription are **two ways to do it** — the option for strength and
the option for size, the first priced in what it scores and the second in hard
sets, each one tap away. Neither is the recommendation; both are simply there, because "how
heavy" and "how much" are different questions. Taking one moves the card onto
that scale, and **Reset to automatic** puts it back.

A lift you have finished for the day drops out of the readiness order into a
**Done today** group at the bottom, and leads with what it did rather than what
to do next.

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
| `↩` | Way back in    | Lighter than you were lifting, after time off.  |

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

**Done with this lift** is how a lift ends, either way. Not the set count
reaching a plan — four of a planned five can be the session you meant to have,
and a sixth can be the one that mattered — so it is a button, and it stops the
rest clock. Reaching the count you planned offers the same button in a toast
rather than deciding for you. The session rail above the form turns each lift
green as you finish it and counts them off: _2 of 3 lifts done_, then _Session
done_.

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
adjusted e1RM, its trend and a sparkline; **Table** shows the full Dashboard
grid, now including each lift's tonnage and its hard sets for the week. Each
lift's own page carries its strength trend beside its hard-set count: getting
stronger and getting enough of the work that grows you are different
achievements, and a lift can be doing one without the other.
Personal bests are ringed on the chart and badged in the history. Tap a lift for
its progression chart: every session, the fitted trend, the projection, and a ring
marking your next target. Drag across the chart to read any
session. Below that: weekly sets against your budget, working sets per week over
the last 8 weeks, and every session as a table.

**Setup** — how much detail to show, the rest timer's target (0 turns it off), your
lifts (tap one to edit), the maths dials, the fatigue/recovery/detraining model
and its six coefficients, light/dark theme, and your backups. The welcome tour can
lifts (tap one to edit), the maths dials, the fatigue/recovery/detraining model
and its six coefficients, light/dark theme, and your backups. The welcome tour can
be replayed from the bottom of the page.

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
- **Volume** = `weight × reps × sets`. Kept as a readout, because it does say
  something: 3×8 at 60 kg is 1,440 kg against 1,050 kg for 3×5 at 70 kg, while
  losing to it on e1RM. What it is no longer asked to do is judge whether a
  session built muscle — see _The second scale_ below for why it cannot.
- **Weekly sets** — a plain count of working sets in the last 7 days. Still
  reported, but the budget is measured in **hard sets** (below), because
  "10–20 per muscle per week" was never a count of any three reps you happened
  to do.
- **Trend** — least-squares fit of adjusted e1RM against date over the lookback
  window (84 days by default), reported in kg/week.
- **Flat target** = last session's adjusted e1RM × (1 + that lift's weekly gain).
  The planner then finds the lightest loadable weight that meets it — where
  _loadable_ means `starting weight + n × step` for that lift.

### The second scale: hard sets

Everything above measures what you can lift. Nothing above measures whether you
did enough of the kind of work that builds muscle, and those are different
questions.

The obvious candidate is volume load — `weight × reps × sets` — and it is a bad
one. It cannot tell these apart:

| Session            | Tonnage  | Hard sets |
| ------------------ | -------- | --------- |
| `1 × 3 @ 926 kg`   | 2,778 kg | **0**     |
| `5 × 8 @ 71 kg`    | 2,840 kg | **5**     |
| `1 × 30 @ 92.6 kg` | 2,778 kg | **1**     |

Those are three completely different sessions and one number. Tonnage rewards
whatever multiplies out largest, which is why it is still in the app as a
readout and is not asked to judge anything.

What hypertrophy actually responds to is **hard sets**: sets in a rep range that
produces the stimulus, taken close enough to failure to have produced it, added
up over the week. That is also the unit the usual advice is already phrased in —
10 to 20 per muscle per week — and the unit your per-lift budget in Setup has
always been set in. It was simply being counted badly.

- **Rep credit** = 1 from **6 to 20 reps**, which is roughly where the evidence
  sits: taken near failure, sets across that range grow muscle about as well as
  each other. Below six it ramps down to zero over three reps, so five reps is
  worth about two thirds of a set and a triple nothing. Above twenty it tapers
  to zero over ten, so a set of twenty-five is about half.
- **Failure credit** = 1 at **0–2 reps in reserve**, falling away past that. A
  set left five in reserve is worth 0.4. A set logged with **no RIR at all is
  assumed to have been a normal hard one**, so not recording it costs you
  nothing.
- **Hard sets** = rep credit × failure credit, summed. Where the per-set log has
  RIR, each set is credited on its own — a merged block keeps the _lowest_ RIR
  of the sets counted onto it, and applying that to all of them would credit
  five sets as though every one had finished as hard as the last.
- **Weekly budget** — hard sets in the last 7 days against that lift's
  `setsPerWeek`, with the same ±20% under/on-target/over bands as before.

Both numbers are heuristics, like the set bonus. The edges of the rep range are
genuinely fuzzy and the falloff past two reps in reserve is a judgement rather
than a measurement. What is not a judgement is that a heavy single is not
hypertrophy work, and tonnage said it was.

### One target, two rep ranges

There is no second weight calculation. Working out what you can do for twelve
reps is exactly what an e1RM estimate is _for_, so both picks on a card come off
the same target and the same ladder of loadable weights. What differs is the rep
range:

```
 3  ┐
 4  │ STRENGTH  3–6
 5  │
 6  ┴─┐   ← six is genuinely both
 8    │
10    │
12    │ SIZE  6–20
14    │
16    │
20    ┘
```

The grid runs to twenty reps now; the spreadsheet stopped at twelve, and a
hypertrophy range that stops there is not one. The original seven rep schemes
keep their exact positions, so `npm test` still checks them against the
workbook's own values cell by cell.

Each pick names the scheme its zone is about — five reps and twelve — at
whatever set count you have, so the two are comparable. Your own rep count
stands when it is already in range: somebody doing triples does not need telling
that five is the canonical strength scheme. Every cell in the grid also carries
what it is worth as a dose, so `3 × 3 @ 87.5 kg` reads _no hypertrophy credit_
and `3 × 12 @ 70 kg` reads _3 hard sets_.

There is no mode and no per-lift goal setting. Both picks are on every card,
always, and taking one is a per-lift override exactly like tapping a grid cell.

Added on top (Setup → _Fatigue, recovery and detraining_, on by default; switch it
off and every target falls back to the flat one above):

- **Next target** = `last adj e1RM × retention × (1 + accrual) × (1 − fatigue)`.
  Three separate things move between one session and the next, so they are
  modelled separately:
  - **Accrual** — the weekly gain, earned _per week of elapsed time_ rather than
    per session. Train a lift twice in a week and each session asks for half of
    it. Rest past the productive window (10 days by default) adds no more.
  - **Fatigue** — `peak × severity × e^(−days / τ)`, peak 6% and τ 1.5 days, so a
    normal hard session costs ~3% the next day and is spent inside three.
    _Severity_ comes from data you already log: sets relative to this lift's usual
    count, and RIR — eight sets to failure leaves a bigger hole than three easy
    ones. A lift counts as **ready** once the deficit drops under 3%.
  - **Retention** — detraining. Nothing for the first 14 days, then
    `floor + (1 − floor) × 0.5^((days − grace) / halfLife)`, half-life 42 days
    toward a floor of 75%: about −5% at four weeks off, −13% at eight, −23% at six
    months. Whatever you gained in the gap fades on the same curve — the newest
    adaptations are the least durable.

  The productive window and the grace period both stretch to fit how you actually
  train a lift, from the median gap in its own log: if your normal rhythm is a
  fortnight, day fifteen is not a layoff.

  Detraining discounts your recorded **best** as well as your target, because a
  comeback session should not be marked down for failing to beat a number you no
  longer own. Fatigue does not — being tired today has not taken a kilo off what
  you can do.

  All six coefficients are dials in Setup. They are the usual findings, not
  precise ones: recovery from heavy compound work in 48–72 hours, detraining
  showing up after about a fortnight, and a long layoff leaving you well above
  untrained. They vary by person and by lift, which is exactly why they are dials.

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
the values Excel itself calculated. Nine things are intentionally different:

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
7. **The gap between sessions counts.** The sheet adds the full weekly gain every
   session, whether the last one was yesterday or in March — so it asks for a step
   up the morning after a hard session, and for a PR after eight weeks off. The
   app models fatigue, accrual and detraining instead (section 4), and while a
   lift is coming back from a layoff it stops calling weights you have already
   lifted _too big a jump_: they are labelled **way back in**. Both numbers are
   still published — Progress → Table shows the flat target and the readiness one
   side by side — and the model can be switched off in Setup.
8. **Finishing is something you say.** The sheet had no notion of it, and the app
   used to infer it: a lift read as done once the sets logged reached the set
   target. That number is a plan, and a plan is a guess. So there is a button,
   and the set count is left to describe what happened rather than to decide it.
   It earns its keep twice over — the fatigue model used to measure your sets
   against that same guess, and now measures them against the median of the
   sessions you actually finished.
9. **Sets are counted for what they are worth.** The sheet counted working sets
   and compared them to a weekly budget borrowed from hypertrophy advice, which
   makes a week of heavy triples read as on target. The app counts hard sets
   instead — in range, near enough to failure — so the budget measures the thing
   it was always a budget for (section 4). The rep axis runs to twenty for the
   same reason, and every card names a strength option and a size one.

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
