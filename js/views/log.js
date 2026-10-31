// views/log.js — the Log sheet. Optimised for logging mid-session with one hand.
//
// There are two situations, so there are two ways in:
//
//   Set by set  — you are in the gym now. One tap logs the set you just did,
//                 the rest clock starts, and the tracker moves on. Drop the
//                 reps before the last set and the short set is recorded as it
//                 actually happened.
//   All at once — you are writing up a session that is already over. One row:
//                 3 × 5 at 100 kg, exactly as before.
//
// Both produce the same stored shape — identical sets are one entry with a
// count — so nothing downstream needs to know which way you logged.
//
// The form updates its own preview in place rather than re-rendering the view,
// so a stepper never steals focus while you are typing.

import {
  el,
  disclose,
  stepper,
  chipGroup,
  segmented,
  toast,
  sheet,
  confirmSheet,
  emptyState,
  celebrate,
  prBurst,
  prBadge,
  accentDot,
  tap,
} from "../ui.js";
import { startRest, stopRest } from "../timer.js";
import * as store from "../store.js";
import {
  isoToday,
  isoAddDays,
  relativeDate,
  formatDate,
  fmt,
  fmtWeight,
  fmtSigned,
  adjE1rm,
  e1rm,
  volume,
  planFor,
  bandFor,
  exerciseStats,
  sessionAdjWith,
  isBodyweight,
  describeSet,
  hardSets,
  repCredit,
  warmupPlan,
  dayNumber,
} from "../metrics.js";
import { bandChip } from "../ui.js";
import { setTrace } from "../charts.js";
import {
  sessionSets,
  sessionTimeline,
  typicalRest,
  sessionDuration,
} from "../insights.js";
import * as ui from "../core/uistate.js";
import { bind } from "../core/bind.js";
import { countUp } from "../core/motion.js";
import { bodyweightOn } from "../measure.js";
import { liftOrder } from "./plan.js";

const FORM = "log.form";
const NOTES_OPEN = "log.showNotes";
const LAST_SET = "log.lastSetId"; // the entry the last set landed on, so undo is exact
const SCORE_FROM = "log.scoreFrom"; // the session score before the set just logged
const PR_FLASH = "log.prFlash"; // a PR was crossed by the set just logged
const LANDED = "log.landed"; // a set just landed: the button gives a bounce
const PICKER_OPEN = "log.pickerOpen"; // the lift list, unfolded while a lift is chosen
const PICKER_SEARCH = "log.pickerSearch";
const SEARCH_FROM = 8; // lifts before the picker grows a search box

let form = null; // { exerciseId, date, weight, reps, sets, rir, notes, mode }

/**
 * The form writes itself to uistate as you fill it in.
 *
 * It used to be plain module state, so a reload lost a half-entered set — and
 * the app forced a reload whenever another tab wrote, which meant a second
 * device syncing mid-session could take the set out from under you. A proxy
 * rather than fifty explicit saves: every existing `form.x = y` persists.
 */
function persisted(obj) {
  return new Proxy(obj, {
    set(t, k, v) {
      t[k] = v;
      ui.set(FORM, { ...t });
      return true;
    },
    deleteProperty(t, k) {
      delete t[k];
      ui.set(FORM, { ...t });
      return true;
    },
  });
}

const lastSetId = () => ui.get(LAST_SET, null);
const setLastSetId = (v) => ui.set(LAST_SET, v);

export function setPrefill(prefill = {}) {
  const date = prefill.date || form?.date || isoToday();
  const next = {
    exerciseId: prefill.exerciseId ?? form?.exerciseId ?? null,
    date,
    weight: prefill.weight ?? null,
    reps: prefill.reps ?? null,
    sets: prefill.sets ?? null,
    rir: prefill.rir ?? null,
    notes: "",
    fromPlan: prefill.weight != null,
    // Logging set by set only makes sense for a session happening now; writing
    // up an older one goes straight to the whole-session form.
    mode: prefill.mode ?? modeForDate(date),
    // A top set + back-offs plan: the form starts on the top set and moves
    // itself onto the back-offs once that set is in.
    backoff: prefill.backoff
      ? { weight: Number(prefill.backoff.weight), reps: Number(prefill.backoff.reps), sets: Number(prefill.backoff.sets) }
      : null,
    // What the card was prescribing when "Log this" was tapped, recorded with
    // every set this form logs. See planFor() below for the fallback.
    plan: prefill.plan ?? null,
  };
  // All at once, the top set is a row of its own, so the form asks for one.
  if (next.backoff && next.mode === "bulk") next.sets = 1;
  form = persisted(next);
  ui.set(FORM, { ...next });
  setLastSetId(null);
}

/** Start again from nothing — used when the log is reset or a lift is deleted. */
export function clearForm() {
  form = null;
  ui.set(FORM, undefined);
  setLastSetId(null);
}

function modeForDate(date) {
  return date === isoToday() ? "sets" : "bulk";
}

export function renderLog(ctx) {
  const { settings, stats } = ctx;
  const root = el("section", { class: "view view-log" });
  if (!form) {
    const saved = ui.get(FORM, null);
    if (saved && saved.date) form = persisted({ ...saved });
    else setPrefill({});
  }
  // A lift can be deleted while its half-filled form is still sitting here.
  if (form.exerciseId && !store.getExercise(form.exerciseId))
    form.exerciseId = null;

  const exercises = store.exercisesByRecency();
  if (!exercises.length) {
    root.append(el("header", { class: "view-head" }, [el("h1", { text: "Log" })]));
    root.append(
      emptyState(
        "No lifts set up",
        "Add your lifts in Setup and they appear here.",
        "Go to Setup",
        () => ctx.goTo("setup"),
      ),
    );
    return root;
  }

  // ---- date ----
  // In the header, not a section of its own: it is almost always today.
  const setDate = (iso) => {
    form.date = iso;
    // Changing the day changes which situation you are in.
    form.mode = modeForDate(iso);
    setLastSetId(null);
    ctx.refresh();
  };
  const dateInput = el("input", {
    type: "date",
    class: "date-input",
    value: form.date,
    max: isoAddDays(isoToday(), 1),
    "aria-label": "Session date",
  });
  dateInput.addEventListener("change", () => {
    if (dateInput.value) setDate(dateInput.value);
  });
  root.append(
    el("header", { class: "view-head log-head" }, [
      el("h1", { text: "Log" }),
      el("div", { class: "date-row", role: "group", "aria-label": "Session date" }, [
        quickDate("Today", isoToday(), form.date, setDate),
        quickDate("Yesterday", isoAddDays(isoToday(), -1), form.date, setDate),
        dateInput,
      ]),
    ]),
  );

  // ---- how the day started ----
  // Asked once per day, before its first set: the context that turns a log
  // into something you can analyse. A bad session after five hours' sleep is
  // a different thing from a bad session after eight.
  root.append(dayCheckIn(form.date, ctx));

  // ---- exercise ----
  // Once a lift is chosen the picker folds away into the session rail — the
  // form is what you need on screen between sets, not every lift you own.
  const pickerOpen = !form.exerciseId || ui.get(PICKER_OPEN, false);
  const rail = sessionRail(ctx, pickerOpen);
  if (rail) root.append(rail);
  if (pickerOpen) root.append(liftPicker(ctx, exercises));
  if (form.exerciseId) {
    const st =
      stats.find((s) => s.exercise.id === form.exerciseId) ||
      exerciseStats(
        store.getExercise(form.exerciseId),
        store.getEntries(),
        settings,
      );
    root.append(entryForm(st, ctx, settings));
  }

  root.append(history(ctx, settings));
  return root;
}

function setCount(entry) {
  return Number(entry.sets) > 0 ? Number(entry.sets) : 1;
}

/**
 * Today's session, all of it.
 *
 * Every other view in the app is one lift at a time; standing in the gym the
 * question is usually "what is left", across everything. Lifts appear in the
 * order their first set actually happened — which only became knowable with
 * the per-set log, since merging a repeat set leaves the entry's own ordering
 * where the block started.
 */
function sessionRail(ctx, pickerOpen = false) {
  const date = form.date;
  const byLift = new Map();
  for (const e of store.getEntries()) {
    if (e.date !== date) continue;
    if (!byLift.has(e.exerciseId)) byLift.set(e.exerciseId, []);
    byLift.get(e.exerciseId).push(e);
  }
  // The lift you are about to start belongs in the session even with no sets.
  if (form.exerciseId && !byLift.has(form.exerciseId))
    byLift.set(form.exerciseId, []);
  if (!byLift.size) return null;

  const rows = [];
  for (const [id, entries] of byLift) {
    const ex = store.getExercise(id);
    if (!ex) continue;
    const done = entries.reduce((n, e) => n + setCount(e), 0);
    const target =
      id === form.exerciseId && Number(form.sets) > 0
        ? Math.round(Number(form.sets))
        : Number(ex.setsPerSession) > 0
          ? Math.round(Number(ex.setsPerSession))
          : 0;
    const started = sessionSets(entries).find((x) => x.measured);
    rows.push({
      ex,
      done,
      target,
      finished: store.isDone(id, date),
      startedAt: started ? started.at : Infinity,
      seq: entries.length
        ? Math.min(...entries.map((e) => e.seq || 0))
        : Infinity,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq);

  const totalDone = rows.reduce((n, r) => n + r.done, 0);
  const totalTarget = rows.reduce((n, r) => n + r.target, 0);
  // Once anything has been called done, the session is counted in lifts rather
  // than in sets: "two of three lifts" is the question you are actually asking
  // between exercises, and sets are the wrong unit to add up across them.
  const started = rows.filter((r) => r.done > 0);
  const finishedCount = started.filter((r) => r.finished).length;
  const anyFinished = finishedCount > 0;
  const complete = started.length > 0 && finishedCount === started.length;

  const track = el("div", {
    class: "rail-track",
    role: "tablist",
    "aria-label": "Lifts in this session",
  });
  for (const r of rows) {
    const id = r.ex.id;
    const isCurrent = id === form.exerciseId;
    const filled =
      r.target > 0
        ? Math.min(100, (r.done / r.target) * 100)
        : r.done
          ? 100
          : 0;
    track.append(
      el(
        "button",
        {
          type: "button",
          role: "tab",
          class: `rail-seg${isCurrent ? " is-current" : ""}${r.finished || (r.target && r.done >= r.target) ? " is-complete" : ""}`,
          "aria-selected": isCurrent ? "true" : "false",
          onclick: () => {
            tap();
            setPrefill({ exerciseId: id, date: form.date, mode: form.mode });
            ctx.refresh({ transition: true });
          },
        },
        [
          el("span", { class: "rail-seg-name" }, [
            accentDot(id),
            el("span", { text: r.ex.name }),
          ]),
          el("span", {
            class: "rail-seg-count",
            text: r.target
              ? `${r.done} of ${r.target} sets`
              : `${r.done} set${r.done === 1 ? "" : "s"}`,
          }),
          el("div", { class: "rail-seg-bar", "aria-hidden": "true" }, [
            el("span", { class: "rail-seg-fill", style: `width:${filled}%` }),
          ]),
        ],
      ),
    );
  }

  // The way to the next lift: the whole list, unfolded on demand.
  if (form.exerciseId)
    track.append(
      el(
        "button",
        {
          type: "button",
          class: `rail-add${pickerOpen ? " is-open" : ""}`,
          "aria-expanded": pickerOpen ? "true" : "false",
          onclick: () => {
            tap();
            ui.set(PICKER_OPEN, !pickerOpen);
            ctx.refresh({ transition: true });
          },
        },
        [pickerOpen ? "Close" : "+ Lift"],
      ),
    );

  const sets = sessionSets(store.getEntries().filter((e) => e.date === date));
  const mins = sessionDuration(sets);
  const facts = [];
  if (mins !== null) facts.push(`${Math.max(1, Math.round(mins / 60))} min`);
  const rest = typicalRest(sets);
  if (rest !== null)
    facts.push(
      `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")} rest`,
    );

  const railNode = el("section", { class: "rail", "aria-label": "This session" }, [
    el("div", { class: "rail-head" }, [
      el("span", {
        class: "rail-title",
        text: date === isoToday() ? "This session" : formatDate(date),
      }),
      facts.length
        ? el("span", { class: "rail-sub", text: facts.join(" · ") })
        : null,
    ]),
    track,
  ]);
  // The total sits in the head row: one line, not a row of its own.
  const total = totalTarget > 0
      ? el("div", { class: `rail-total${complete ? " is-complete" : ""}` }, [
          el(
            "div",
            {
              class: "rail-total-track",
              role: "meter",
              "aria-valuenow": totalDone,
              "aria-valuemin": "0",
              "aria-valuemax": totalTarget,
              "aria-label": "Sets done in this session",
            },
            [
              el("span", {
                class: "rail-total-fill",
                style: `width:${Math.min(100, (totalDone / totalTarget) * 100)}%`,
              }),
            ],
          ),
          el("span", {
            class: "rail-total-value",
            text: complete
              ? `${totalDone} sets — done`
              : `${totalDone} of ${totalTarget} sets`,
          }),
        ])
      : null;
  if (total) railNode.firstChild.insertBefore(total, railNode.firstChild.children[1] || null);
  return railNode;
}

/**
 * Every lift, in the order you are most likely to want them: ready first and
 * stalest at the top, the same order Next uses, with what is done for today
 * at the end. A long list grows a search box, and the groups are labelled so
 * the eye can skip straight to the part that matters.
 */
function liftPicker(ctx, exercises) {
  const { ready, resting, unlogged, finished } = liftOrder(ctx.stats);
  const seen = new Set();
  const take = (rows) => rows.map((s) => s.exercise).filter((ex) => !seen.has(ex.id) && seen.add(ex.id));
  const groups = [
    { title: "Ready", lifts: take(ready) },
    { title: "Recovering", lifts: take(resting) },
    { title: "Not logged yet", lifts: take(unlogged) },
    { title: "Done today", lifts: take(finished) },
  ];
  // Anything the stats have not caught up with yet still has to be pickable.
  const rest = exercises.filter((ex) => !seen.has(ex.id));
  if (rest.length) groups.push({ title: "Other", lifts: rest });

  const chip = (ex) => {
    const selected = ex.id === form.exerciseId;
    const done = store
      .entriesOn(ex.id, form.date)
      .reduce((n, e) => n + setCount(e), 0);
    return el(
      "button",
      {
        type: "button",
        class: `chip chip-lift${selected ? " is-selected" : ""}`,
        role: "radio",
        "aria-checked": selected ? "true" : "false",
        onclick: () => {
          tap();
          setPrefill({ exerciseId: ex.id, date: form.date, mode: form.mode });
          ui.set(PICKER_OPEN, false);
          ui.set(PICKER_SEARCH, undefined);
          ctx.refresh({ transition: true });
        },
      },
      [
        accentDot(ex.id),
        el("span", { text: ex.name }),
        // What you have already done today, so the picker doubles as a checklist.
        done ? el("span", { class: "chip-done", text: `${done}` }) : null,
      ],
    );
  };

  const host = el("div", { class: "picker-groups" });
  const paint = () => {
    const q = String(ui.get(PICKER_SEARCH, "") || "").trim().toLowerCase();
    const nodes = [];
    for (const g of groups) {
      const lifts = g.lifts.filter((ex) => !q || ex.name.toLowerCase().includes(q));
      if (!lifts.length) continue;
      nodes.push(
        el("div", { class: "picker-group" }, [
          el("span", { class: "picker-group-title", text: g.title }),
          el("div", { class: "chips chips-wrap", role: "radiogroup", "aria-label": g.title }, lifts.map(chip)),
        ]),
      );
    }
    if (!nodes.length) nodes.push(el("p", { class: "card-note", text: "No lifts match." }));
    host.replaceChildren(...nodes);
  };

  let search = null;
  if (exercises.length > SEARCH_FROM) {
    // Filters in place: a refresh would rebuild the input and drop the keyboard.
    search = el("input", {
      type: "search",
      class: "text-input",
      placeholder: "Find a lift…",
      "aria-label": "Find a lift",
      value: ui.get(PICKER_SEARCH, "") || "",
    });
    search.addEventListener("input", () => {
      ui.set(PICKER_SEARCH, search.value);
      paint();
    });
  }
  paint();
  return el("div", { class: "field-block lift-picker", "aria-label": "Exercise" }, [
    form.exerciseId ? null : el("span", { class: "field-label", text: "Pick a lift" }),
    search,
    host,
  ]);
}

function quickDate(label, iso, current, onPick) {
  return el(
    "button",
    {
      type: "button",
      class: `chip${iso === current ? " is-selected" : ""}`,
      onclick: () => {
        tap();
        onPick(iso);
      },
    },
    [label],
  );
}

function entryForm(st, ctx, settings) {
  const ex = st.exercise;
  const base = Number(ex.base) > 0 ? Number(ex.base) : 0;
  const plan = st.entryCount ? planFor(st, settings, {}) : null;
  // warmupPlan already returns nothing for a lift with no weight to ramp, so
  // this needs no bodyweight check of its own.
  const warmups = plan?.ready
    ? warmupPlan(plan.weight, ex.step || settings.defaultStep, base, ex.kind)
    : [];
  const last = store.lastEntryFor(ex.id);
  const todays = store.entriesOn(ex.id, form.date);
  const doneSoFar = todays.reduce((n, e) => n + setCount(e), 0);
  const volSoFar = todays.reduce(
    (n, e) => n + volume(e.weight, e.reps, e.sets),
    0,
  );
  const live = form.mode === "sets";

  // Prefill order: what you are already doing today, then an explicit plan
  // hand-off, then the plan, then last session.
  const inProgress = todays.length ? todays[todays.length - 1] : null;
  // A lift with nothing to load has no weight to prefill, remember or ask for.
  const repsOnly = isBodyweight(ex);
  if (repsOnly) form.weight = 0;
  else {
    if (form.weight == null)
      form.weight =
        (live && inProgress ? inProgress.weight : null) ??
        (plan?.ready ? plan.weight : (last?.weight ?? (base || 20)));
    if (Number(form.weight) < base) form.weight = base;
  }
  if (form.reps == null)
    form.reps =
      (live && inProgress ? inProgress.reps : null) ??
      (plan?.ready ? plan.reps : (last?.reps ?? 5));
  if (form.sets == null)
    form.sets = plan?.ready ? plan.sets : (last?.sets ?? 3);

  const target = Number(form.sets) > 0 ? Math.round(Number(form.sets)) : 0;
  // Finished is something you say, not something the set count works out. The
  // planned number is still worth showing — "set 4 of 5" tells you where you
  // are — but it decides nothing now: stopping at four is not a lift left
  // hanging, and a sixth is not a session that never ended.
  const finished = store.isDone(ex.id, form.date);

  // A personal best has to beat the sessions that came BEFORE today. Measured
  // against everything, adding a fourth set to today's block would "beat" the
  // third set of the same block, and every set would set a record.
  const bestBefore = st.entries.reduce(
    (m, e) =>
      e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m,
    -Infinity,
  );

  const modeSwitch = segmented({
    label: "How to log",
    value: form.mode,
    options: [
      { value: "sets", label: "Set by set" },
      { value: "bulk", label: "All at once" },
    ],
    onChange: (v) => {
      form.mode = v;
      if (form.backoff)
        form.sets = v === "bulk" ? 1 : 1 + form.backoff.sets;
      ctx.refresh({ transition: true });
    },
  });

  const preview = el("div", { class: "preview" });

  // The rep scheme this session set out to do: the first set is the intent,
  // and every bar after it is measured against that line.
  const planReps = todays.length
    ? Math.round(Number(todays[0].reps))
    : plan?.ready
      ? plan.reps
      : Math.round(Number(form.reps)) || null;
  const traceFig = live
    ? setTrace(sessionTimeline(sessionSets(todays), settings), {
        planReps,
        planSets: target,
        pendingReps: Math.round(Number(form.reps)) || null,
      })
    : null;

  // Set by set, the session score is the number that moves — so it moves rather
  // than jumping. Only on the paint straight after a set lands: while a stepper
  // is being scrubbed the value has to track the thumb exactly.
  let scoreFrom = ui.get(SCORE_FROM, null);
  const prFlash = ui.get(PR_FLASH, false);
  if (scoreFrom !== null) ui.set(SCORE_FROM, undefined);
  if (prFlash) ui.set(PR_FLASH, undefined);

  const paint = () => {
    const w = Number(form.weight),
      r = Number(form.reps),
      s = Number(form.sets);
    if (traceFig) traceFig.setPending(r);
    if (!(r > 0) || (!repsOnly && !(w > 0))) {
      preview.replaceChildren(
        el("span", {
          class: "preview-hint",
          text: repsOnly
            ? "Enter the reps you did."
            : "Enter a weight and reps.",
        }),
      );
      return;
    }

    // In live mode the number that matters is what the SESSION will be worth
    // once this set is in — not what one set on its own scores.
    const adj = live
      ? sessionAdjWith(todays, { weight: w, reps: r, rir: form.rir }, settings, ex.kind)
      : adjE1rm(w, r, s, settings, ex.kind, form.rir);
    const target1rm = plan?.ready ? plan.target : null;
    const band = target1rm
      ? bandFor(
          adj,
          target1rm,
          bestBefore === -Infinity ? null : bestBefore,
          settings,
        )
      : null;
    // "Already ahead" and "about to go ahead" are different things: the badge
    // belongs on the set that crosses your best, not on every set after it.
    const adjSoFar =
      live && todays.length
        ? sessionAdjWith(todays, null, settings, ex.kind)
        : -Infinity;
    const alreadyBest = bestBefore > -Infinity && adjSoFar > bestBefore + 1e-9;
    const beatsBest =
      bestBefore > -Infinity && adj > bestBefore + 1e-9 && !alreadyBest;
    const done = repsOnly
      ? todays.reduce((n, e) => n + e.reps * setCount(e), 0) +
        r * (live ? 1 : s)
      : volSoFar + volume(w, r, live ? 1 : s);
    const workText = repsOnly
      ? `${fmt(done, 0)} reps in total`
      : `${fmt(done, 0)} kg of work`;
    // What this set is worth as a hypertrophy dose. A heavy triple scores well
    // above and counts for nothing here, which is the point of saying both.
    const credit = repCredit(r);

    const scoreNum = el("span", { class: "preview-num" });
    preview.replaceChildren(
      el("div", { class: "preview-main" }, [
        el("span", { class: "preview-value" }, [
          scoreNum,
          el("small", { text: " score" }),
        ]),
        band ? bandChip(band, { compact: true }) : null,
        beatsBest ? prBadge() : null,
      ]),
      el("div", {
        class: "preview-hard",
        text:
          credit > 0
            ? `${fmt(hardSets(todays) + credit, 1)} hard sets this session` +
              (credit < 1
                ? ` — ${r} reps counts ${Math.round(credit * 100)}% of one`
                : "")
            : `${r} reps is below the range that builds size — this one is strength work`,
      }),
      el("div", {
        class: "preview-sub",
        text: live
          ? `after ${doneSoFar + 1} set${doneSoFar ? "s" : ""} · ${workText}` +
            (alreadyBest
              ? " · already your best session"
              : bestBefore > -Infinity
                ? ` · best before today ${fmt(bestBefore, 1)}`
                : "")
          : workText +
            (target1rm
              ? ` · target ${fmt(target1rm, 1)} (${fmtSigned(adj - target1rm, 1)})`
              : "") +
            (bestBefore > -Infinity ? ` · best ${fmt(bestBefore, 1)}` : ""),
      }),
    );

    if (scoreFrom !== null && Math.abs(adj - scoreFrom) > 0.05) {
      countUp(scoreNum, adj, { from: scoreFrom, format: (v) => fmt(v, 1) });
    } else {
      scoreNum.textContent = fmt(adj, 1);
    }
    scoreFrom = null; // the climb happens once, not per tick
    preview.classList.toggle("is-pr", prFlash);
  };

  const weightStep = stepper({
    label: `Weight (${settings.unit})`,
    value: form.weight,
    step: ex.step || settings.defaultStep,
    min: base,
    max: 999,
    dp: 1,
    origin: base,
    id: "log-weight",
    onChange: (v) => {
      form.weight = v;
      ctx.tick();
    },
  });
  const repsStep = stepper({
    label: live ? "Reps this set" : "Reps",
    value: form.reps,
    step: 1,
    min: 1,
    max: 50,
    dp: 0,
    id: "log-reps",
    onChange: (v) => {
      form.reps = v;
      ctx.tick();
    },
  });
  const setsStep = stepper({
    label: live ? "Sets planned" : "Sets",
    value: form.sets,
    step: 1,
    min: 1,
    max: 20,
    dp: 0,
    id: "log-sets",
    onChange: (v) => {
      form.sets = v;
      ctx.tick();
    },
  });

  // Required, and never remembered from the last set: every set gets its own
  // answer. A default would quietly become the answer to all of them, which is
  // how the log ended up with no RIR at all for weeks.
  const rir = chipGroup({
    label: "Reps in reserve",
    value: form.rir,
    options: [0, 1, 2, 3, 4].map((v) => ({
      value: v,
      label: v === 4 ? "4+" : String(v),
    })),
    onChange: (v) => {
      form.rir = v;
      rirBlock.classList.remove("needs-answer");
      ctx.tick();
    },
  });

  // What each answer means is in Setup → How this works; at the rack the
  // question is enough.
  const rirBlock = el("div", { class: "field-block rir-block" }, [
    el("span", {
      class: "field-label",
      text: live ? "Reps left in the tank (RIR)" : "Reps left in the tank (RIR) — hardest set",
    }),
    rir,
  ]);

  const notesArea = el("textarea", {
    class: "notes-input",
    rows: "2",
    placeholder: "Felt heavy, belt on, …",
  });
  notesArea.value = form.notes || "";
  notesArea.addEventListener("input", () => {
    form.notes = notesArea.value;
  });

  const primary = el(
    "button",
    {
      type: "button",
      class: "btn btn-primary btn-block btn-save",
      onclick: () => (live ? logOneSet(st, ctx, settings) : save(st, ctx)),
    },
    ["…"],
  );

  if (ui.get(LANDED, false)) {
    ui.set(LANDED, undefined);
    primary.classList.add("is-landed");
  }

  const relabel = () => {
    const w = fmtWeight(form.weight),
      r = Math.round(Number(form.reps)) || "",
      s = Math.round(Number(form.sets)) || "";
    const at = repsOnly ? `${r} reps` : `${r} @ ${w} ${settings.unit}`;
    const blocked = !store.getDay(form.date) ? "day" : form.rir === null || form.rir === undefined ? "rir" : null;
    primary.classList.toggle("is-blocked", !!blocked);
    primary.setAttribute("aria-disabled", blocked ? "true" : "false");
    if (blocked === "day") {
      primary.textContent = "Check in for the day first";
      return;
    }
    if (blocked === "rir") {
      primary.textContent = live ? "Pick RIR for this set" : "Pick RIR first";
      return;
    }
    primary.textContent = live
      ? finished || (target && doneSoFar >= target)
        ? `Log another set — ${at}`
        : `Log set ${doneSoFar + 1}${target ? ` of ${target}` : ""} — ${at}`
      : repsOnly
        ? `Save ${s} × ${r} reps`
        : `Save ${s} × ${r} @ ${w} ${settings.unit}`;
  };

  const body = el("div", { class: "form-body" }, [
    // While the top set is still to come, say what follows it — otherwise the
    // form reads as a one-set session.
    form.backoff && !repsOnly
      ? el("div", { class: "plan-strip plan-strip-topset" }, [
          el("span", { class: "plan-strip-label", text: "Top set first" }),
          el("span", {
            class: "plan-strip-value",
            text: `then ${form.backoff.sets} × ${form.backoff.reps} @ ${fmtWeight(form.backoff.weight)} kg`,
          }),
        ])
      : null,
    bodyweightNote(ex, form.date),
    plan?.ready
      ? el("div", { class: "plan-strip" }, [
          el("span", { class: "plan-strip-label", text: "Planned" }),
          el("span", {
            class: "plan-strip-value",
            text: repsOnly
              ? `${plan.sets} × ${plan.reps} reps`
              : `${plan.sets} × ${plan.reps} @ ${fmtWeight(plan.weight)} kg`,
          }),
          bandChip(plan.band, { compact: true }),
          el(
            "button",
            {
              type: "button",
              class: "link-btn",
              onclick: () => {
                form.weight = repsOnly ? 0 : plan.weight;
                form.reps = plan.reps;
                form.sets = plan.sets;
                if (!repsOnly) weightStep.setValue(plan.weight);
                repsStep.setValue(plan.reps);
                setsStep.setValue(plan.sets);
                ctx.tick();
              },
            },
            ["Use"],
          ),
        ])
      : null,
    warmups.length
      ? disclose(`Warm-up · ${warmups.length} set${warmups.length === 1 ? "" : "s"}`, [
          el(
            "div",
            { class: "warmup-steps" },
            warmups.map((wu) =>
              el("div", { class: "warmup-step" }, [
                el("span", {
                  class: "warmup-step-value",
                  text: `${fmtWeight(wu.weight)} kg × ${wu.reps}`,
                }),
                el(
                  "button",
                  {
                    type: "button",
                    class: "link-btn",
                    onclick: () => {
                      form.weight = wu.weight;
                      form.reps = wu.reps;
                      form.sets = wu.sets;
                      weightStep.setValue(wu.weight);
                      repsStep.setValue(wu.reps);
                      setsStep.setValue(wu.sets);
                      ctx.tick();
                    },
                  },
                  ["Use"],
                ),
              ]),
            ),
          ),
        ], { open: false })
      : null,
    repsOnly
      ? null
      : el("div", { class: "lever-row lever-row-wide" }, [weightStep]),
    el("div", { class: "lever-row" }, [repsStep, setsStep]),
    preview,
    // The two things every set needs, kept under the thumb: they stick to the
    // bottom of the screen while the rest of the form scrolls past.
    el("div", { class: `log-dock${finished ? " is-finished" : ""}` }, [rirBlock, primary]),
    live
      ? tracker(traceFig, doneSoFar, target, finished, ex, ctx)
      : doneSoFar
        ? el("div", { class: `set-track${finished ? " is-complete" : ""}` }, [
            finished ? summary(doneSoFar, ex, ctx) : null,
            doneControl(finished, ex, ctx),
          ])
        : null,
    el(
      "button",
      {
        type: "button",
        class: "link-btn link-btn-block",
        onclick: (e) => {
          const open = !ui.get(NOTES_OPEN, false);
          ui.set(NOTES_OPEN, open);
          e.target.closest(".form-body").querySelector(".notes-wrap").hidden =
            !open;
        },
      },
      ["Notes"],
    ),
    el("div", { class: "notes-wrap", hidden: !ui.get(NOTES_OPEN, false) }, [
      notesArea,
    ]),
    // Chosen for you by the date; switching is rare, so it sits last.
    el("div", { class: "mode-row" }, [modeSwitch]),
  ]);
  // The preview and the button label follow the levers without re-rendering.
  // Rebuilding the view would take the caret out of whichever field is being
  // typed into, which is why this screen used to repaint itself by hand; bind()
  // is that same idea, minus the bookkeeping. The key is what the preview
  // actually depends on — the levers, and RIR, which a reps-in-reserve plan
  // credits — so typing a note writes nothing.
  const levers = () => `${form.weight}|${form.reps}|${form.sets}`;
  bind(preview, () => `${levers()}|${form.rir}`, paint);
  bind(primary, () => `${levers()}|${form.rir}|${store.getDay(form.date) ? 1 : 0}`, relabel);

  // Steppers that are typed into rather than nudged still have to be heard.
  for (const s of [weightStep, repsStep, setsStep]) {
    for (const ev of ["lt:nudge", "change", "blur"])
      s.input.addEventListener(ev, ctx.tick);
  }

  return el("div", { class: "card card-form" }, [
    el("div", { class: "card-head static" }, [
      accentDot(ex.id),
      el("div", { class: "card-head-main" }, [
        el("h2", { class: "card-title", text: ex.name }),
        el("p", {
          class: "card-meta",
          text:
            live && doneSoFar
              ? `${doneSoFar} set${doneSoFar === 1 ? "" : "s"} logged ${form.date === isoToday() ? "today" : formatDate(form.date)}`
              : last
                ? `${relativeDate(last.date)} · ${describeSet(ex, last.sets, last.reps, last.weight)}`
                : "First time logging this lift",
        }),
      ]),
    ]),
    body,
  ]);
}

/** Total weight moved across a set of entries. */
function volSoFarAfter(entries) {
  return entries.reduce((n, e) => n + volume(e.weight, e.reps, e.sets), 0);
}

/* ------------------------------------------------------------- tracker */

/**
 * The session so far. The pills grew an axis: same one-mark-per-set idea, now
 * also showing whether the reps held up, how close to failure each set went and
 * how long you actually rested — none of which was recordable before the
 * per-set log.
 */
function tracker(traceFig, doneSoFar, target, finished, ex, ctx) {
  return el("div", { class: `set-track${finished ? " is-complete" : ""}` }, [
    el("div", { class: "set-track-head" }, [
      el("span", {
        class: "set-track-label",
        text: finished
          ? `${doneSoFar} set${doneSoFar === 1 ? "" : "s"} — done`
          : !target
            ? `Set ${doneSoFar + 1}`
            : doneSoFar >= target
              ? `${doneSoFar} of ${target} sets`
              : `Set ${doneSoFar + 1} of ${target}`,
      }),
      doneSoFar
        ? el(
            "button",
            {
              type: "button",
              class: "link-btn",
              onclick: () => {
                const removed = store.removeLastSet(
                  form.exerciseId,
                  form.date,
                  lastSetId(),
                );
                setLastSetId(null);
                stopRest();
                ctx.refresh();
                if (removed)
                  toast(
                    `Took back ${removed.reps}${isBodyweight(ex) ? " reps" : ` @ ${fmtWeight(removed.weight)} kg`}`,
                    {
                      action: () => {
                        store.undo();
                        ctx.refresh();
                      },
                      actionLabel: "Undo",
                    },
                  );
              },
            },
            ["Undo last set"],
          )
        : null,
    ]),
    traceFig,
    finished ? summary(doneSoFar, ex, ctx) : null,
    doneSoFar ? doneControl(finished, ex, ctx) : null,
  ]);
}

/**
 * The one thing that says a lift is finished.
 *
 * It is a button rather than a threshold because only you know: four of a
 * planned five can be the session you meant to have, and a sixth can be the
 * one that mattered. Marking it stops the rest clock — you are not between
 * sets any more — and nothing about the log itself moves, so logging another
 * set afterwards simply changes what the marker is true of.
 */
function doneControl(finished, ex, ctx) {
  return el(
    "button",
    {
      type: "button",
      class: `btn btn-ghost btn-block btn-sm done-btn${finished ? " is-done" : ""}`,
      onclick: () => {
        const nowDone = store.toggleDone(ex.id, form.date);
        tap();
        if (nowDone) {
          stopRest();
          // A finished lift is worth a little noise; a finished session more.
          const started = new Set(
            store.getEntries().filter((e) => e.date === form.date).map((e) => e.exerciseId),
          );
          const all = [...started].every((id) => store.isDone(id, form.date));
          celebrate({ count: all ? 48 : 16 });
          if (all) tap([20, 40, 20, 40, 60]);
        }
        ctx.refresh({ transition: true });
        toast(
          nowDone
            ? `${ex.name} done for the day.`
            : `${ex.name} is open again.`,
          {
            action: () => {
              store.undo();
              ctx.refresh();
            },
            actionLabel: "Undo",
          },
        );
      },
    },
    [finished ? "Not done after all" : "Done with this lift"],
  );
}

/**
 * What the lift just did, once the plan is complete.
 *
 * The toast says the same thing and then leaves; this stays on the screen you
 * are standing in front of. Duration only appears where it was measured — a
 * session written up afterwards has sets and tonnage and nothing else true to
 * say about how long it took.
 */
function summary(doneSoFar, ex, ctx) {
  const todays = store.entriesOn(ex.id, form.date);
  const sets = sessionSets(todays);
  const spent = sessionDuration(sets);
  const rest = typicalRest(sets);
  const work = todays.reduce((n, e) => n + volume(e.weight, e.reps, e.sets), 0);
  const prs = (
    ctx.stats.find((s) => s.exercise.id === ex.id)?.entries || []
  ).filter((e) => e.date === form.date && e.isPR).length;

  const facts = [
    `${doneSoFar} set${doneSoFar === 1 ? "" : "s"}`,
    `${fmt(work, 0)} kg moved`,
  ];
  if (spent !== null && spent >= 60)
    facts.push(`${Math.round(spent / 60)} min`);
  if (rest !== null)
    facts.push(
      `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")} rest`,
    );

  return el("div", { class: "session-summary" }, [
    el("p", { class: "summary-head" }, [
      el("span", { class: "summary-tick", "aria-hidden": "true", text: "✓" }),
      el("span", { text: `${ex.name} done` }),
      prs ? prBadge({ compact: true }) : null,
    ]),
    el(
      "ul",
      { class: "summary-facts" },
      facts.map((f) => el("li", { text: f })),
    ),
    nextUp(ex, ctx),
  ]);
}

/**
 * Where to go once a lift is done: the next few in readiness order, one tap
 * each, so finishing a lift never means hunting through the list for the next.
 */
function nextUp(ex, ctx) {
  const { ready, resting, unlogged } = liftOrder(ctx.stats);
  const next = [...ready, ...resting, ...unlogged]
    .map((s) => s.exercise)
    .filter((x) => x.id !== ex.id && !store.isDone(x.id, form.date))
    .slice(0, 3);
  if (!next.length)
    return el("p", { class: "summary-note", text: "Log another if you have one in you." });
  return el("div", { class: "next-up" }, [
    el("span", { class: "next-up-label", text: "Next lift" }),
    ...next.map((x, i) =>
      el(
        "button",
        {
          type: "button",
          class: `btn ${i === 0 ? "btn-primary" : "btn-ghost"} btn-sm next-up-btn`,
          onclick: () => {
            tap();
            setPrefill({ exerciseId: x.id, date: form.date, mode: form.mode });
            ui.set(PICKER_OPEN, false);
            ctx.refresh({ transition: true });
            window.scrollTo?.({ top: 0, behavior: "smooth" });
          },
        },
        [accentDot(x.id), el("span", { text: x.name })],
      ),
    ),
  ]);
}

/* --------------------------------------------------------------- saving */

/**
 * On a bodyweight lift, what you weigh is the load. The reps are still the
 * score — that is what the plan and the trend are built on — but eight pull-ups
 * at 90 kg and twelve at 85 kg are different achievements, and only the weigh-in
 * can say so. Shown, not scored.
 */
function bodyweightNote(ex, date) {
  if (!isBodyweight(ex)) return null;
  const bw = bodyweightOn(store.getMeasurements(), date);
  if (!bw)
    return el("p", {
      class: "bw-note is-missing",
      text: "Add your bodyweight in a check-in under Progress → Body and it is shown with every set of this lift.",
    });
  const age = dayNumber(date) - dayNumber(bw.date);
  return el("p", { class: "bw-note" }, [
    el("span", { class: "bw-note-label", text: "Bodyweight" }),
    el("span", { class: "bw-note-value", text: `${fmtWeight(bw.value)} kg` }),
    el("span", {
      class: "bw-note-sub",
      text: age <= 0 ? "weighed today" : `weighed ${age} day${age === 1 ? "" : "s"} before`,
    }),
  ]);
}

/**
 * Both answers a set needs before it can be logged: how the day started, and
 * how close to failure this set was. Says which is missing and points at it
 * rather than greying the button out — a disabled button explains nothing.
 */
function readyToLog() {
  if (!store.getDay(form.date)) {
    toast("Check in for the day first — sleep and energy, at the top.");
    document.querySelector(".day-check")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    document.querySelector(".day-check")?.classList.add("needs-answer");
    return false;
  }
  if (form.rir === null || form.rir === undefined) {
    toast("How many more could you have done? Pick an RIR first.");
    const b = document.querySelector(".rir-block");
    b?.classList.add("needs-answer");
    b?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    return false;
  }
  return true;
}

/**
 * The plan this lift's session is following today, as one whole: for a topset
 * session, the top set's prescription AND the back-offs'. In order: the plan
 * the card handed over; the plan today's first set of this lift was logged
 * against; or, logging with no hand-off, the card's plan as it stands now —
 * including any pick taken on it. The middle step matters: once a set is in,
 * the target moves, and set three must not be recorded against a plan that
 * set one made.
 */
function sessionPlan(st, settings) {
  if (form.plan) return form.plan;
  const first = store.entriesOn(form.exerciseId, form.date).find((e) => e.plan);
  if (first) {
    const p = first.plan;
    // A session logged before roles were fixed may open on a back-off; its
    // top prescription is then unknown, but its back-offs are not.
    return p.zone === "topset" && p.role !== "top"
      ? { ...p, weight: null, reps: null, sets: 1, backoff: p.backoff ?? { weight: p.weight, reps: p.reps, sets: p.sets } }
      : { ...p };
  }
  if (!st.entryCount) return null;
  const p = planFor(st, settings, ui.forExercise("plan.overrides", st.exercise.id, {}));
  if (!p.ready) return null;
  return p.topset
    ? { zone: "topset", weight: p.topset.top.weight, reps: p.topset.top.reps, sets: 1, target: p.target, band: p.band?.key,
      backoff: { ...p.topset.backoff } }
    : { zone: p.zone, weight: p.weight, reps: p.reps, sets: p.sets, target: p.target, band: p.band?.key };
}

/**
 * What THIS set was meant to be. Outside a topset session that is simply the
 * session's plan. Inside one, the first set of the lift today is the top set
 * and everything after it is a back-off — decided by what is already in the
 * log, not by how the form was opened, which is what got it backwards before.
 */
function planForSet(session) {
  if (!session) return null;
  if (session.zone !== "topset") return { ...session, role: null, backoff: null };
  const isTop = store.entriesOn(form.exerciseId, form.date).length === 0;
  const bo = session.backoff ?? null;
  return isTop
    ? { zone: "topset", role: "top", weight: session.weight, reps: session.reps, sets: 1,
      target: session.target, band: session.band, backoff: bo }
    : { zone: "topset", role: "backoff", weight: bo?.weight ?? null, reps: bo?.reps ?? null, sets: bo?.sets ?? null,
      target: session.target, band: session.band, backoff: bo };
}

/**
 * The once-a-day check-in: hours slept and energy out of five. Required before
 * the first set of a day. For a day other than today there is also "Can't
 * remember" — an honest blank, rather than a number made up to get past it.
 */
function dayCheckIn(date, ctx) {
  const day = store.getDay(date);
  const isToday = date === (ctx.today || isoToday());
  if (day) {
    const bits = day.unknown
      ? ["Sleep and energy not remembered"]
      : [`Slept ${fmt(day.sleepHours, 1)} h`, `energy ${day.energy}/5`];
    return el("div", { class: "day-check is-done" }, [
      el("span", { class: "summary-tick", "aria-hidden": "true", text: "✓" }),
      el("span", { class: "day-check-facts", text: bits.join(" · ") }),
      el("button", {
        type: "button", class: "link-btn",
        onclick: () => {
          // Reopen the questions with the old answers filled in.
          if (!day.unknown) ui.set("log.dayDraft", { date, sleepHours: day.sleepHours, energy: day.energy });
          store.clearDay(date);
          ctx.refresh({ transition: true });
        },
      }, ["Change"]),
    ]);
  }
  const draft = ui.get("log.dayDraft", null);
  const mine = draft && draft.date === date ? draft : { date, sleepHours: null, energy: null };
  const save = (patch) => { Object.assign(mine, patch); ui.set("log.dayDraft", { ...mine }); };
  const sleep = stepper({
    label: "Hours slept", value: mine.sleepHours ?? "", step: 0.5, min: 0, max: 16, dp: 1,
    placeholder: "—", suffix: "h", id: "day-sleep", onChange: (v) => save({ sleepHours: v }),
  });
  const energy = chipGroup({
    label: "Energy",
    value: mine.energy,
    options: [
      { value: 1, label: "1", sub: "drained" },
      { value: 2, label: "2" },
      { value: 3, label: "3", sub: "normal" },
      { value: 4, label: "4" },
      { value: 5, label: "5", sub: "great" },
    ],
    onChange: (v) => {
      save({ energy: v });
      // Energy is the second answer: with sleep already in, it is the last tap.
      if (sleepValue() !== null) done();
    },
  });
  const sleepValue = () => {
    const h = sleep.input.value.trim() === "" ? null : sleep.getValue();
    return h !== null && h >= 0 ? h : null;
  };
  const done = () => {
    const h = sleepValue();
    if (h === null || !(mine.energy >= 1)) {
      toast("Both, please — hours slept and how your energy is.");
      return;
    }
    store.setDay(date, { sleepHours: h, energy: mine.energy });
    ui.set("log.dayDraft", undefined);
    tap();
    ctx.refresh({ transition: true });
  };
  return el("div", { class: "card card-pad day-check" }, [
    el("h2", { class: "section-title", text: isToday ? "Check in for today" : `Check in for ${formatDate(date)}` }),
    el("div", { class: "day-check-row" }, [
      sleep,
      el("div", { class: "field-block" }, [el("span", { class: "stepper-label", text: "Energy" }), energy]),
    ]),
    el("div", { class: "card-actions" }, [
      el("button", { type: "button", class: "btn btn-primary", onclick: done }, ["Save"]),
      isToday ? null : el("button", {
        type: "button", class: "btn btn-ghost",
        onclick: () => { store.setDay(date, { unknown: true }); ctx.refresh({ transition: true }); },
      }, ["Can’t remember"]),
    ]),
  ]);
}

/** Set-by-set: one tap, one set, rest clock. */
function logOneSet(st, ctx, settings) {
  // A bodyweight lift has nothing on the bar, so a weight of 0 is the right
  // answer rather than a missing one. Requiring one here is what stopped these
  // lifts being logged set by set; the whole-session save already knew better.
  const repsOnly = isBodyweight(st.exercise);
  const w = repsOnly ? 0 : Number(form.weight),
    r = Number(form.reps);
  if (!(r > 0) || (!repsOnly && !(w > 0))) {
    toast(repsOnly ? "Enter the reps first." : "Enter a weight and reps first.");
    return;
  }
  if (!readyToLog()) return;
  const session = sessionPlan(st, settings);
  const plan = planForSet(session);

  const bestBefore = st.entries.reduce(
    (m, e) =>
      e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m,
    -Infinity,
  );
  const before = store.entriesOn(form.exerciseId, form.date);
  const adjBefore = before.length
    ? sessionAdjWith(before, null, settings, st.exercise.kind)
    : -Infinity;

  const created = store.logSet({
    exerciseId: form.exerciseId,
    date: form.date,
    weight: w,
    reps: r,
    rir: form.rir,
    notes: form.notes,
    plan,
  });
  setLastSetId(created?.id ?? null);
  // A note belongs to the set it was written for, not to every set after it —
  // and so does an RIR. The next set has to be answered for itself.
  form.notes = "";
  form.rir = null;
  // Keep the session's plan for the sets that follow: once a set is in, the
  // app's own target moves, and the plan this session set out with must not.
  form.plan = session;
  // The top set is in: the rest of the session is the back-offs.
  if (form.backoff) {
    form.weight = form.backoff.weight;
    form.reps = form.backoff.reps;
    form.backoff = null;
  }

  const after = store.entriesOn(form.exerciseId, form.date);
  const doneAfter = after.reduce((n, e) => n + setCount(e), 0);
  const adj = sessionAdjWith(after, null, settings, st.exercise.kind);
  const target = Number(form.sets) > 0 ? Math.round(Number(form.sets)) : 0;

  // Once the session is past your best, every further set beats it again —
  // celebrate the crossing, not each step beyond it.
  // Hand the next render the two things it cannot work out for itself: where
  // the score was a moment ago, and whether this set was the one that crossed.
  ui.set(SCORE_FROM, Number.isFinite(adjBefore) ? adjBefore : 0);

  const crossed =
    Number.isFinite(adj) &&
    bestBefore > -Infinity &&
    adj > bestBefore + 1e-9 &&
    !(adjBefore > bestBefore + 1e-9);
  ui.set(LANDED, true);
  if (crossed) {
    ui.set(PR_FLASH, true);
    prBurst({
      lift: st.exercise.name,
      value: fmt(adj, 1),
      sub: `+${fmt(adj - bestBefore, 1)} on your best of ${fmt(bestBefore, 1)}`,
    });
  } else tap(12);

  // Only the set that finishes the plan ends the session. Carrying on past it
  // is a decision to keep training, so the clock comes back.
  if (target && doneAfter === target) {
    stopRest();
    const spent = sessionDuration(sessionSets(after));
    const bits = [`${doneAfter} set${doneAfter === 1 ? "" : "s"}`];
    if (spent !== null && spent >= 60)
      bits.push(`${Math.round(spent / 60)} min`);
    bits.push(`${fmt(volSoFarAfter(after), 0)} kg`);
    toast(`${st.exercise.name} done · ${bits.join(" · ")}`, {
      action: () => {
        store.undo();
        setLastSetId(null);
        ctx.refresh();
      },
      actionLabel: "Undo",
    });
  } else {
    // Past the plan there is no "of five" to count towards any more.
    const ofTarget = target && doneAfter + 1 <= target ? ` of ${target}` : "";
    startRest(settings.restSeconds, {
      label: `${st.exercise.name} · set ${doneAfter + 1}${ofTarget} next`,
      // What this lift has actually been getting today, rather than the setting.
      usual: typicalRest(sessionSets(after)),
    });
  }
  ctx.refresh();
}

/** All at once: the whole block as one row, as it has always worked. */
function save(st, ctx) {
  const repsOnly = isBodyweight(st.exercise);
  const w = repsOnly ? 0 : Number(form.weight);
  const r = Number(form.reps),
    s = Number(form.sets);
  if (!(r > 0) || (!repsOnly && !(w > 0))) {
    toast(
      repsOnly
        ? "Enter the reps you did first."
        : "Enter a weight and reps first.",
    );
    return;
  }
  if (!readyToLog()) return;
  const session = sessionPlan(st, ctx.settings);
  const plan = planForSet(session);
  const bestBefore = st.entries.reduce(
    (m, e) =>
      e.date !== form.date && Number.isFinite(e.adj) && e.adj > m ? e.adj : m,
    -Infinity,
  );
  const created = store.addEntry({
    exerciseId: form.exerciseId,
    date: form.date,
    weight: w,
    reps: r,
    sets: s,
    rir: form.rir,
    notes: form.notes,
    plan,
  });
  const adj = adjE1rm(w, r, s, ctx.settings, st.exercise.kind, form.rir);
  const beatBest = bestBefore > -Infinity && adj > bestBefore + 1e-9;
  // A personal best is the moment the whole app exists for — mark it.
  if (beatBest)
    prBurst({
      lift: st.exercise.name,
      value: fmt(adj, 1),
      sub: `+${fmt(adj - bestBefore, 1)} on your best of ${fmt(bestBefore, 1)}`,
    });
  ui.set(LANDED, true);
  toast(
    beatBest
      ? `🏆 New best for ${st.exercise.name} — ${fmt(adj, 1)}`
      : `Saved · ${fmt(adj, 1)}`,
    {
      action: () => {
        store.undo();
        ctx.refresh();
      },
      actionLabel: "Undo",
    },
  );
  // You are now standing between sets, so the clock starts itself.
  if (form.date === isoToday())
    startRest(ctx.settings.restSeconds, {
      label: `Rest · ${st.exercise.name}`,
    });
  // Keep the lift selected but drop back to plan-based prefill for the next set
  // — or, straight after a top set, to the back-offs that follow it.
  const bo = form.backoff;
  const kept = session;
  setPrefill(bo
    ? { exerciseId: form.exerciseId, date: form.date, mode: form.mode,
      weight: bo.weight, reps: bo.reps, sets: bo.sets, plan: kept }
    : { exerciseId: form.exerciseId, date: form.date, mode: form.mode, plan: kept });
  ctx.refresh();
  if (created)
    requestAnimationFrame(() =>
      document
        .querySelector(".view-log .history")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
}

/* ------------------------------------------------------------- history */

function history(ctx, settings) {
  const entries = store.getEntries();
  const names = new Map(store.getExercises().map((e) => [e.id, e.name]));
  const wrap = el("div", { class: "history" }, [
    el("h2", { class: "section-title", text: "Recent sessions" }),
  ]);
  if (!entries.length) {
    wrap.append(el("p", { class: "card-note", text: "Nothing logged yet." }));
    return wrap;
  }
  // Which of these were a personal best when they were logged — the stats
  // layer has already worked it out, so the badge costs a lookup.
  const prIds = new Set();
  for (const s of ctx.stats)
    for (const e of s.entries) if (e.isPR) prIds.add(e.id);

  const sorted = [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.seq - a.seq,
  );
  const byDate = new Map();
  for (const e of sorted) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  let shown = 0;
  for (const [date, rows] of byDate) {
    if (shown >= 10) break;
    shown++;
    const totalSets = rows.reduce((n, e) => n + e.sets, 0);
    // A day of bodyweight work moved no bar, so "0 kg" is the wrong summary of
    // it. Count what each kind of lift actually did and name only what happened.
    let totalVol = 0;
    let bodyReps = 0;
    for (const e of rows) {
      if (isBodyweight(store.getExercise(e.exerciseId)))
        bodyReps += e.reps * (Number(e.sets) > 0 ? Number(e.sets) : 1);
      else totalVol += volume(e.weight, e.reps, e.sets);
    }
    const meta = [formatDate(date), `${totalSets} sets`];
    if (totalVol > 0) meta.push(`${fmt(totalVol, 0)} kg`);
    if (bodyReps > 0) meta.push(`${bodyReps} reps`);
    const dayRec = store.getDay(date);
    if (dayRec && !dayRec.unknown) meta.push(`${fmt(dayRec.sleepHours, 1)} h sleep · energy ${dayRec.energy}/5`);
    wrap.append(
      el("div", { class: "day" }, [
        el("div", { class: "day-head" }, [
          el("span", { class: "day-when", text: relativeDate(date) }),
          el("span", { class: "day-meta", text: meta.join(" · ") }),
        ]),
        el(
          "ul",
          { class: "day-list" },
          rows.map((e) =>
            historyRow(
              e,
              names.get(e.exerciseId) || "Unknown",
              prIds.has(e.id),
              ctx,
              settings,
            ),
          ),
        ),
      ]),
    );
  }
  if (byDate.size > shown) {
    wrap.append(
      el("p", {
        class: "card-note",
        text: `${byDate.size - shown} earlier session days — see Progress for the full history.`,
      }),
    );
  }
  return wrap;
}

/**
 * One logged entry: tap to edit, swipe left to delete.
 *
 * The swipe is a shortcut, not the route. It is pointer-only by nature, and the
 * delete affordance behind the row is decorative — so the button says out loud
 * what it opens, and the sheet it opens carries Delete. Anyone not swiping gets
 * there in two presses rather than being told about a gesture they cannot make.
 */
function historyRow(entry, name, isPR, ctx, settings) {
  const rir =
    entry.rir !== null && entry.rir !== undefined ? `, RIR ${entry.rir}` : "";
  const lift = store.getExercise(entry.exerciseId) || {};
  const kind = lift.kind;
  const repsOnly = isBodyweight(lift);
  const setText = repsOnly
    ? `${entry.sets} × ${entry.reps} reps`
    : `${entry.sets} × ${entry.reps} @ ${fmtWeight(entry.weight)} kg`;
  // What you were carrying when you did them: the last weigh-in on or before
  // that day. Its own element, apart from the set, because the set itself moves
  // no load and must never read as though it did.
  const bw = repsOnly ? bodyweightOn(store.getMeasurements(), entry.date) : null;
  const spoken = repsOnly
    ? `${entry.sets} sets of ${entry.reps} reps${bw ? `, at ${fmtWeight(bw.value)} kilos bodyweight` : ""}`
    : `${entry.sets} sets of ${entry.reps} at ${fmtWeight(entry.weight)} kilos`;

  const btn = el(
    "button",
    {
      type: "button",
      class: "row-btn",
      "aria-label":
        `${name}, ${spoken}${rir}` +
        `${entry.notes ? `, noted: ${entry.notes}` : ""}. Edit or delete.`,
      onclick: () => editSheet(entry, ctx, settings),
    },
    [
      el("span", { class: "row-name" }, [
        accentDot(entry.exerciseId),
        name,
        isPR ? prBadge({ compact: true }) : null,
      ]),
      el("span", { class: "row-set", text: setText }),
      el("span", {
        class: "row-adj",
        text: fmt(
          adjE1rm(entry.weight, entry.reps, entry.sets, ctx.settings, kind, entry.rir),
          1,
        ),
      }),
      entry.rir !== null && entry.rir !== undefined
        ? el("span", { class: "row-rir", text: `RIR ${entry.rir}` })
        : null,
      bw
        ? el("span", { class: "bw-tag", text: `at ${fmtWeight(bw.value)} kg bodyweight` })
        : null,
      // Notes have been captured, merged and exported since the first version and
      // shown nowhere. If it was worth typing at the rack it is worth reading back.
      entry.notes ? el("span", { class: "row-note", text: entry.notes }) : null,
    ],
  );
  const li = el("li", { class: "swipe-row" }, [
    el("div", { class: "swipe-action", "aria-hidden": "true" }, [
      el("span", { text: "Delete" }),
    ]),
    btn,
  ]);
  swipeToDelete(li, btn, () => {
    store.deleteEntry(entry.id);
    ctx.refresh();
    toast(`${name} entry deleted`, {
      action: () => {
        store.undo();
        ctx.refresh();
      },
      actionLabel: "Undo",
    });
  });
  return li;
}

/**
 * Drag a row leftwards to delete it. The gesture only takes over once it is
 * clearly horizontal, so the list still scrolls normally under a thumb, and it
 * deletes straight away rather than asking — the toast carries the undo.
 */
function swipeToDelete(li, surface, onDelete) {
  const LIMIT = 112,
    ARM = 72;
  let start = null,
    dx = 0,
    engaged = false,
    swallowClick = false;

  const reset = () => {
    surface.style.transition = "transform 0.18s ease";
    surface.style.transform = "";
    li.classList.remove("is-armed", "is-swiping");
    setTimeout(() => {
      surface.style.transition = "";
    }, 200);
    start = null;
    dx = 0;
    engaged = false;
  };

  surface.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    start = { x: e.clientX, y: e.clientY };
    dx = 0;
    engaged = false;
    swallowClick = false;
  });
  surface.addEventListener("pointermove", (e) => {
    if (!start) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!engaged) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) {
        start = null;
        return;
      } // scrolling
      if (Math.abs(mx) < 12) return;
      engaged = true;
      li.classList.add("is-swiping");
      surface.setPointerCapture?.(e.pointerId);
    }
    dx = Math.max(-LIMIT, Math.min(0, mx));
    surface.style.transform = `translateX(${dx}px)`;
    li.classList.toggle("is-armed", dx <= -ARM);
  });
  const end = () => {
    if (!start) return;
    const armed = dx <= -ARM;
    // The click that follows the release is checked against this, not against
    // dx — reset() has already zeroed dx by the time the click arrives.
    swallowClick = engaged && dx < -4;
    reset();
    if (armed) {
      tap(20);
      onDelete();
    }
  };
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", reset);
  // A row that was swiped must not also open the editor.
  surface.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

function editSheet(entry, ctx, settings) {
  const draft = { ...entry };
  const ex = store.getExercise(entry.exerciseId);
  const dateInput = el("input", {
    type: "date",
    class: "date-input",
    value: draft.date,
  });
  dateInput.addEventListener("change", () => {
    draft.date = dateInput.value || draft.date;
  });

  const s = sheet({
    title: `Edit — ${ex?.name || "entry"}`,
    body: [
      el("div", { class: "field-block" }, [
        el("span", { class: "field-label", text: "Date" }),
        dateInput,
      ]),
      el("div", { class: "lever-row" }, [
        // Nothing to load, nothing to edit.
        isBodyweight(ex)
          ? null
          : stepper({
              label: `Weight (${settings.unit})`,
              value: draft.weight,
              step: ex?.step || settings.defaultStep,
              min: 0,
              max: 999,
              dp: 1,
              origin: Number(ex?.base) > 0 ? Number(ex.base) : 0,
              id: "ed-w",
              onChange: (v) => {
                draft.weight = v;
              },
            }),
        stepper({
          label: "Reps",
          value: draft.reps,
          step: 1,
          min: 1,
          max: 50,
          dp: 0,
          id: "ed-r",
          onChange: (v) => {
            draft.reps = v;
          },
        }),
        stepper({
          label: "Sets",
          value: draft.sets,
          step: 1,
          min: 1,
          max: 20,
          dp: 0,
          id: "ed-s",
          onChange: (v) => {
            draft.sets = v;
          },
        }),
      ]),
      el("div", { class: "field-block" }, [
        el("span", { class: "field-label", text: "RIR" }),
        chipGroup({
          label: "RIR",
          value: draft.rir,
          allowNull: true,
          nullLabel: "not noted",
          options: [0, 1, 2, 3, 4],
          onChange: (v) => {
            draft.rir = v;
          },
        }),
      ]),
    ],
    actions: [
      {
        label: "Delete",
        className: "btn-danger",
        onClick: () => {
          confirmSheet({
            title: "Delete this entry?",
            message:
              "It is removed from every calculation. You can undo straight afterwards.",
            onConfirm: () => {
              store.deleteEntry(entry.id);
              ctx.refresh();
              toast("Entry deleted", {
                action: () => {
                  store.undo();
                  ctx.refresh();
                },
                actionLabel: "Undo",
              });
            },
          });
        },
      },
      {
        label: "Save",
        className: "btn-primary",
        onClick: () => {
          store.updateEntry(entry.id, draft);
          ctx.refresh();
          toast("Entry updated", {
            action: () => {
              store.undo();
              ctx.refresh();
            },
            actionLabel: "Undo",
          });
        },
      },
    ],
  });
  return s;
}
