// views/plan.js — the NextSession sheet, rebuilt as the app's home screen.
//
// Every lift gets one card carrying a single concrete prescription. Open a card
// and you get the target, the reps/sets levers, and the full trade-off grid the
// spreadsheet drew, colour-banded against your target.

import { el, stepper, segmented, bandChip, toast, details } from "../ui.js";
import {
  planFor,
  BANDS,
  fmt,
  fmtWeight,
  fmtSigned,
  relativeDate,
  snapReps,
  REP_SCHEMES,
  SET_COLUMNS,
} from "../metrics.js";

const overrides = new Map(); // exerciseId -> { target, reps, sets }
const gridMode = new Map(); // exerciseId -> 'weights' | 'scores' | 'table'
let openId = null; // accordion: one card open, so one hero figure

function ov(id) {
  if (!overrides.has(id))
    overrides.set(id, { target: null, reps: null, sets: null });
  return overrides.get(id);
}

export function renderPlan(ctx) {
  const { settings, stats } = ctx;
  const root = el("section", { class: "view view-plan" });

  root.append(
    el("header", { class: "view-head" }, [
      el("h1", { text: "Next session" }),
      el("p", {
        class: "view-sub",
        text: "One prescription per lift, sized to beat your last session by your weekly target.",
      }),
    ]),
  );

  const trained = stats.filter((s) => s.entryCount > 0);
  if (!trained.length) {
    root.append(
      el("div", { class: "empty" }, [
        el("h3", { text: "Nothing logged yet" }),
        el("p", {
          text: "The planner needs one session to work from. Log a set and a plan appears here.",
        }),
        el(
          "button",
          {
            type: "button",
            class: "btn btn-primary",
            onclick: () => ctx.goTo("log"),
          },
          ["Log your first set"],
        ),
      ]),
    );
    return root;
  }

  const list = el("div", { class: "card-list" });
  for (const s of stats) list.append(card(s, ctx, settings));
  root.append(list);

  root.append(
    details("How the planner decides", [
      el("p", {
        text: "Your target is last session’s adjusted e1RM plus this lift’s weekly gain (set per lift in Setup). The planner holds your rep scheme and set count steady and adds weight, because that is usually what you want; the grid is there for when you would rather trade sets against load.",
      }),
      el("p", {
        text: "Weights always round UP to a loadable step, so no suggestion can undershoot the target. The colour band tells you how big the jump is.",
      }),
      el("p", {
        text: "If nearly everything reads amber, your weight step is simply large relative to the lift — one plate on a 40 kg press is a bigger percentage than on a 140 kg deadlift. Widen the ideal band in Setup until green means what you want it to mean.",
      }),
      legend(),
    ]),
  );
  return root;
}

function card(stats, ctx, settings) {
  const id = stats.exercise.id;
  const o = ov(id);
  const isOpen = openId === id;
  const plan = stats.entryCount ? planFor(stats, settings, o) : null;

  const head = el(
    "button",
    {
      type: "button",
      class: "card-head",
      "aria-expanded": isOpen ? "true" : "false",
      onclick: () => {
        openId = isOpen ? null : id;
        ctx.refresh();
      },
    },
    [
      el("div", { class: "card-head-main" }, [
        el("h2", { class: "card-title", text: stats.exercise.name }),
        el("p", {
          class: "card-meta",
          text: stats.lastDate
            ? `${relativeDate(stats.lastDate)} · ${fmtNum(stats.lastSets)}×${fmtNum(stats.lastReps)} @ ${fmtWeight(lastWeight(stats))} kg`
            : "Never logged",
        }),
      ]),
      el("span", {
        class: "card-chevron",
        "aria-hidden": "true",
        text: isOpen ? "⌃" : "⌄",
      }),
    ],
  );

  const body = el("div", { class: "card-body" });

  if (!plan || !plan.ready) {
    body.append(
      el("p", {
        class: "card-note",
        text: "Log a session for this lift and its plan appears here.",
      }),
    );
    body.append(
      el(
        "button",
        {
          type: "button",
          class: "btn btn-primary btn-block",
          onclick: () => ctx.goTo("log", { exerciseId: id }),
        },
        ["Log a set"],
      ),
    );
    return el("article", { class: "card" }, [head, body]);
  }

  // --- the prescription, the one thing to read ---
  const lw = lastWeight(stats);
  const delta = lw != null ? plan.weight - lw : null;
  const changeText = describeChange(plan, stats, delta);
  body.append(
    el("div", { class: "presc" }, [
      el("div", { class: isOpen ? "presc-hero" : "presc-line" }, [
        el("span", {
          class: "presc-scheme",
          text: `${plan.sets} sets × ${plan.reps} reps`,
        }),
        el("span", { class: "presc-at", text: "@" }),
        el("span", { class: "presc-weight" }, [
          fmtWeight(plan.weight),
          el("small", { text: " kg" }),
        ]),
      ]),
      el("div", { class: "presc-side" }, [
        bandChip(plan.band),
        changeText
          ? el("span", { class: "presc-delta", text: changeText })
          : null,
      ]),
    ]),
  );

  body.append(
    el("p", {
      class: "presc-explain",
      text:
        `Scores ${fmt(plan.score, 1)} against a target of ${fmt(plan.target, 1)} (${fmtSigned(plan.overshoot, 1)} kg over). ${plan.band.hint}.` +
        (plan.atBase
          ? ` That is the lightest this lift loads — ${fmtWeight(plan.base)} kg is the bar.`
          : ""),
    }),
  );

  if (plan.band.key === "beaten" && Number.isFinite(stats.bestAdj)) {
    body.append(
      el(
        "button",
        {
          type: "button",
          class: "hint-btn",
          onclick: () => {
            ov(id).target = round1(stats.bestAdj * (1 + stats.gainPerWeek));
            ctx.refresh();
          },
        },
        [
          el("span", {
            class: "hint-label",
            text: "This does not beat your best",
          }),
          el("span", {
            class: "hint-value",
            text: `Your target comes from last session (${fmt(stats.lastAdj, 1)}), which is under your best of ${fmt(stats.bestAdj, 1)}. Aim past the best instead →`,
          }),
        ],
      ),
    );
  }

  const actions = el("div", { class: "card-actions" }, [
    el(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        onclick: () =>
          ctx.goTo("log", {
            exerciseId: id,
            weight: plan.weight,
            reps: plan.reps,
            sets: plan.sets,
          }),
      },
      ["Log this"],
    ),
    el(
      "button",
      {
        type: "button",
        class: "btn btn-ghost",
        onclick: () => {
          openId = isOpen ? null : id;
          ctx.refresh();
        },
      },
      [isOpen ? "Close" : "Adjust"],
    ),
  ]);
  body.append(actions);

  if (isOpen) body.append(detail(stats, plan, ctx, settings));

  return el("article", { class: `card${isOpen ? " is-open" : ""}` }, [
    head,
    body,
  ]);
}

function detail(stats, plan, ctx, settings) {
  const id = stats.exercise.id;
  const o = ov(id);
  const wrap = el("div", { class: "card-detail" });

  // --- levers ---
  const repsStepper = stepper({
    label: "Reps",
    value: plan.reps,
    step: 1,
    min: 1,
    max: 20,
    dp: 0,
    id: `reps-${id}`,
    onChange: (v) => {
      o.reps = v;
      ctx.refresh();
    },
  });
  const setsStepper = stepper({
    label: "Sets",
    value: plan.sets,
    step: 1,
    min: 1,
    max: 10,
    dp: 0,
    id: `sets-${id}`,
    onChange: (v) => {
      o.sets = v;
      ctx.refresh();
    },
  });
  wrap.append(el("div", { class: "lever-row" }, [repsStepper, setsStepper]));

  // --- target ---
  const targetRow = el("div", { class: "target-row" }, [
    el("div", { class: "target-facts" }, [
      factLine(
        "Target adj e1RM",
        `${fmt(plan.target, 1)} kg`,
        plan.usingManualTarget
          ? "your override"
          : `last ${fmt(stats.lastAdj, 1)} + ${(stats.gainPerWeek * 100).toFixed(2)}%/wk`,
      ),
      factLine(
        "Current best",
        `${fmt(stats.bestAdj, 1)} kg`,
        stats.bestAdj > stats.lastAdj + 1e-9
          ? "beat this to set a PR"
          : "set last session",
      ),
    ]),
    stepper({
      label: "Override target (kg)",
      value: o.target ?? "",
      step: 0.5,
      min: 0,
      max: 999,
      dp: 1,
      id: `tgt-${id}`,
      placeholder: fmt(plan.autoTarget, 1) + " auto",
      onChange: (v) => {
        o.target = v > 0 ? v : null;
        ctx.refresh();
      },
    }),
  ]);
  wrap.append(targetRow);

  if (plan.gentlest && plan.gentlest.score < plan.score - 1e-9) {
    wrap.append(
      el(
        "button",
        {
          type: "button",
          class: "hint-btn",
          onclick: () => {
            o.reps = plan.gentlest.reps;
            ctx.refresh();
          },
        },
        [
          el("span", {
            class: "hint-label",
            text: `Smallest jump at ${plan.sets} sets`,
          }),
          el("span", {
            class: "hint-value",
            text: `${plan.sets} × ${plan.gentlest.reps} @ ${fmtWeight(plan.gentlest.weight)} kg — scores ${fmt(plan.gentlest.score, 1)}`,
          }),
        ],
      ),
    );
  }

  // --- the trade-off grid ---
  const mode = gridMode.get(id) || "weights";
  const gridHost = el("div", { class: "grid-host" });
  const seg = segmented({
    label: "Grid view",
    value: mode,
    options: [
      { value: "weights", label: "Weight" },
      { value: "scores", label: "Scores" },
      { value: "table", label: "Table" },
    ],
    onChange: (v) => {
      gridMode.set(id, v);
      gridHost.replaceChildren(gridFor(v, stats, plan, ctx, settings));
    },
  });
  gridHost.append(gridFor(mode, stats, plan, ctx, settings));

  wrap.append(
    el("div", { class: "grid-block" }, [
      el("div", { class: "grid-head" }, [
        el("h3", { text: "Trade sets against weight" }),
        seg,
      ]),
      gridHost,
      legend(),
    ]),
  );

  if (o.reps !== null || o.sets !== null || o.target !== null) {
    wrap.append(
      el(
        "button",
        {
          type: "button",
          class: "btn btn-ghost btn-block",
          onclick: () => {
            overrides.set(id, { target: null, reps: null, sets: null });
            ctx.refresh();
            toast("Back to automatic");
          },
        },
        ["Reset to automatic"],
      ),
    );
  }
  return wrap;
}

function gridFor(mode, stats, plan, ctx, settings) {
  if (mode === "table") return tableView(stats, plan);
  const id = stats.exercise.id;
  const o = ov(id);
  const scores = mode === "scores";
  const table = el("table", {
    class: "grid",
    "aria-label": scores
      ? "Adjusted e1RM each option scores"
      : "Weight to lift for each reps and sets option",
  });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { class: "grid-corner", scope: "col" }, [
        el("span", { text: "reps" }),
        el("small", { text: "sets →" }),
      ]),
      ...SET_COLUMNS.map((s) =>
        el("th", {
          scope: "col",
          class: s === plan.sets ? "is-col" : "",
          text: String(s),
        }),
      ),
    ]),
  ]);
  const tbody = el("tbody");
  for (const [ri, reps] of REP_SCHEMES.entries()) {
    const tr = el("tr");
    tr.append(
      el("th", {
        scope: "row",
        class: reps === snapReps(plan.reps) ? "is-row" : "",
        text: String(reps),
      }),
    );
    for (const [ci, sets] of SET_COLUMNS.entries()) {
      const cell = plan.grid[ri][ci];
      const value = scores ? fmt(cell.score, 1) : fmtWeight(cell.weight);
      const isPick = reps === snapReps(plan.reps) && sets === plan.sets;
      tr.append(
        el(
          "td",
          { class: `cell is-${cell.band.key}${isPick ? " is-pick" : ""}` },
          [
            el(
              "button",
              {
                type: "button",
                class: "cell-btn",
                "aria-label": `${sets} sets of ${reps} reps at ${fmtWeight(cell.weight)} kg, scores ${fmt(cell.score, 1)}, ${cell.band.label}`,
                onclick: () => {
                  o.reps = reps;
                  o.sets = sets;
                  ctx.refresh();
                },
              },
              [
                el("span", { class: "cell-value", text: value }),
                el("span", {
                  class: "cell-glyph",
                  "aria-hidden": "true",
                  text: cell.band.glyph,
                }),
              ],
            ),
          ],
        ),
      );
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const note = scores
    ? "What each option actually scores once the weight is rounded up to a loadable step."
    : "Tap any cell to plan that combination.";
  return el("div", { class: "grid-scroll" }, [
    table,
    el("p", { class: "grid-note", text: note }),
  ]);
}

function tableView(stats, plan) {
  const rows = plan.grid
    .map((row) => row.find((c) => c.sets === plan.sets))
    .filter(Boolean);
  const table = el("table", { class: "data-table" }, [
    el("caption", {
      text: `Every rep scheme at ${plan.sets} sets, against a target of ${fmt(plan.target, 1)} kg.`,
    }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col", text: "Reps" }),
        el("th", { scope: "col", text: "Weight" }),
        el("th", { scope: "col", text: "Scores" }),
        el("th", { scope: "col", text: "Volume" }),
        el("th", { scope: "col", text: "Verdict" }),
      ]),
    ]),
    el(
      "tbody",
      {},
      rows.map((c) =>
        el("tr", { class: c.isPick ? "is-pick" : "" }, [
          el("th", { scope: "row", text: String(c.reps) }),
          el("td", { text: `${fmtWeight(c.weight)} kg` }),
          el("td", { text: fmt(c.score, 1) }),
          el("td", { text: fmt(c.volume, 0) }),
          el("td", {}, [bandChip(c.band)]),
        ]),
      ),
    ),
  ]);
  return el("div", { class: "grid-scroll" }, [table]);
}

function legend() {
  return el(
    "ul",
    { class: "legend" },
    Object.values(BANDS).map((b) =>
      el("li", { class: `legend-item is-${b.key}` }, [
        el("span", {
          class: "legend-glyph",
          "aria-hidden": "true",
          text: b.glyph,
        }),
        el("span", { class: "legend-label", text: b.label }),
        el("span", { class: "legend-hint", text: b.hint }),
      ]),
    ),
  );
}

function factLine(label, value, sub) {
  return el("div", { class: "fact" }, [
    el("span", { class: "fact-label", text: label }),
    el("span", { class: "fact-value", text: value }),
    sub ? el("span", { class: "fact-sub", text: sub }) : null,
  ]);
}

function lastWeight(stats) {
  if (!stats.sessions.length) return null;
  return stats.sessions[stats.sessions.length - 1].best.weight;
}

/** "+2.5 kg on last" / "+1 set at the same weight" / "same as last session". */
function describeChange(plan, stats, delta) {
  const setsDelta = Number.isFinite(Number(stats.lastSets))
    ? plan.sets - Number(stats.lastSets)
    : 0;
  const repsDelta = Number.isFinite(Number(stats.lastReps))
    ? plan.reps - Number(stats.lastReps)
    : 0;
  if (delta === null || !Number.isFinite(delta)) return null;
  const bits = [];
  if (Math.abs(delta) > 1e-9)
    bits.push(`${fmtSigned(delta, 1).replace(".0", "")} kg`);
  if (setsDelta)
    bits.push(
      `${setsDelta > 0 ? "+" : "−"}${Math.abs(setsDelta)} set${Math.abs(setsDelta) === 1 ? "" : "s"}`,
    );
  if (repsDelta)
    bits.push(
      `${repsDelta > 0 ? "+" : "−"}${Math.abs(repsDelta)} rep${Math.abs(repsDelta) === 1 ? "" : "s"}`,
    );
  if (!bits.length) return "same as last session";
  return `${bits.join(", ")} on last`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function fmtNum(n) {
  return n == null || !Number.isFinite(Number(n))
    ? "—"
    : String(Math.round(Number(n)));
}

export function clearOverrides() {
  overrides.clear();
}

export function openCard(id) {
  openId = id;
}
