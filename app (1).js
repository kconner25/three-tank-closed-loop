/* app.js -- the glue between the page and solver.py.
 *
 * What this file does, in order:
 *   1. Tab switching.
 *   2. Loads Python in the browser (Pyodide), fetches solver.py and runs it.
 *      The browser cannot run a .py file by itself; Pyodide is the translator.
 *   3. On any sidebar input change: reads the inputs by id, hands them to
 *      solver.solve_all() in Python, and writes the returned numbers into
 *      the flowsheet strip, the 4 cards, the transfer-function line, the
 *      unit inspector, the level ledger and the warnings box.
 *   4. Draws the three charts, and runs the time step-through controls,
 *      which only reveal more or less of the already-computed response.
 *
 * This file contains NO engineering equations. All the math stays in
 * solver.py; this file only moves numbers between the page and the solver.
 */
"use strict";

/* ---------- 1. Tabs ---------- */

function showTab(name) {
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  ["app", "theory", "python"].forEach(function (n) {
    document.getElementById("panel-" + n).hidden = (n !== name);
  });
}
document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () { showTab(btn.dataset.tab); });
});
document.querySelectorAll("[data-goto-tab]").forEach(function (link) {
  link.addEventListener("click", function () {
    showTab(link.dataset.gotoTab);
    const target = link.dataset.gotoSection &&
      document.getElementById("code-section-" + link.dataset.gotoSection);
    if (target && target.scrollIntoView) target.scrollIntoView();
  });
});

/* ---------- helpers: reading inputs, formatting numbers ---------- */

// Solver argument names, in the order solve_all() expects them.
// The sidebar input ids are these same names (done on purpose).
const SOLVER_ARGS = ["tank_area_A", "steady_level_hs", "steady_flow_qs",
                     "Kc", "setpoint_step", "disturbance_step", "sim_time_min"];

const DEFAULTS = { tank_area_A: 1.0, steady_level_hs: 1.0,
                   steady_flow_qs: 0.20, Kc: 0.20, setpoint_step: 0.20,
                   disturbance_step: 0.0, sim_time_min: 120.0 };

function readInputs() {
  const values = {};
  for (const name of SOLVER_ARGS) {
    const v = parseFloat(document.getElementById(name).value);
    if (!Number.isFinite(v)) throw new Error("Input '" + name + "' is not a number.");
    values[name] = v;
  }
  return values;
}

function fmt(x, digits) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(digits === undefined ? 3 : digits);
}
function fmtLevel(x) { return fmt(x, 3) + " m"; }
function fmtFlow(x) { return fmt(x, 3) + " m³/min"; }
function setText(id, text) { document.getElementById(id).textContent = text; }
function setRow(rowId, cells) {
  const tds = document.querySelectorAll("#" + rowId + " td");
  cells.forEach(function (c, i) { if (tds[i + 1]) tds[i + 1].textContent = c; });
}
function fmtNum(x) {
  // Short number for the transfer-function line: 10, not 10.00.
  if (!Number.isFinite(x)) return "—";
  return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(2);
}

/* ---------- 3. Rendering one solver result onto the page ---------- */

let lastResult = null;
let lastInputs = null;
let currentTime = 0;     // minutes revealed so far, 0..sim_time
let playTimer = null;
let selectedUnit = "tank3";

function render(result, inputs) {
  const d = result.derived, sim = result.simulation, st = result.stability;
  const hs = inputs.steady_level_hs, qs = inputs.steady_flow_qs;

  // Sidebar derived values
  setText("derived-R", fmt(d.R_min_per_m2, 2));
  setText("derived-tau", fmt(d.tau_min, 2));

  // Flowsheet strip (final values)
  setText("stream-sp", fmtLevel(d.setpoint_level_m));
  setText("stream-u", fmtFlow(qs + d.final_dev_m / d.R_min_per_m2));
  setText("stream-h1", fmtLevel(d.final_level_m));
  setText("stream-h2", fmtLevel(d.final_level_m));
  setText("stream-h3", fmtLevel(d.final_level_m));

  // The 4 cards
  setText("card-dc", fmt(d.dc_gain, 3));
  setText("card-offset", fmt(d.servo_offset_m, 3) + " m");
  setText("card-ku", fmt(d.Ku, 2));
  setText("card-pu", fmt(d.Pu_min, 1) + " min");
  setText("card-peak", fmtLevel(hs + sim.peak_dev_m));
  setText("card-overshoot", sim.overshoot_pct === null
    ? "overshoot: —" : "overshoot: " + fmt(sim.overshoot_pct, 1) + "%");

  // Closed-loop transfer function, with the numbers in.
  const tau = d.tau_min, KcR = d.KcR;
  const denom = [Math.pow(tau, 3), 3 * tau * tau, 3 * tau, 1 + KcR];
  setText("cl-tf", "H₃(s) / Sp(s) = " + fmtNum(KcR) + " / (" +
    fmtNum(denom[0]) + "s³ + " + fmtNum(denom[1]) + "s² + " +
    fmtNum(denom[2]) + "s + " + fmtNum(denom[3]) + ")");
  const poleText = st.poles.map(function (p) {
    return p.imag === 0 ? "s = " + fmt(p.real, 4)
      : "s = " + fmt(p.real, 4) + " ± " + fmt(Math.abs(p.imag), 4) + "i";
  });
  // The pair is listed twice (once per sign); keep one of each.
  setText("cl-poles", "Poles: " + poleText[0] + "  ·  " + poleText[1] +
    "   —   damping ratio ζ = " + fmt(st.damping_ratio, 3) +
    ", Ku = " + fmt(st.Ku, 2) + " (m³/min)/m, Pu = " + fmt(st.Pu_min, 1) +
    " min, " + (st.stable ? "stable." : "UNSTABLE."));

  // Level ledger: all three final levels are the same.
  const outFinal = qs + d.final_dev_m / d.R_min_per_m2;
  ["row-t1", "row-t2", "row-t3"].forEach(function (id) {
    setRow(id, [fmt(hs, 3), fmt(d.final_level_m, 3),
                fmt(d.final_dev_m, 3), fmt(outFinal, 3)]);
  });
  setText("balance-cell", "simulated final − transfer-function final = " +
    (sim.sim_final_dev_m - sim.final_dev_m).toExponential(1) + " m");

  // Gain study summary line.
  const kuRow = result.kc_study.filter(function (r) { return r.stable; }).pop();
  setText("kc-study-text", "At the current Kc = " + fmt(inputs.Kc, 2) +
    ", offset = " + fmt(d.servo_offset_m, 3) + " m and overshoot = " +
    (sim.overshoot_pct === null ? "—" : fmt(sim.overshoot_pct, 1) + "%") +
    ". Ku = " + fmt(st.Ku, 2) + " (m³/min)/m; the highest stable gain in " +
    "the study is Kc = " + (kuRow ? fmt(kuRow.Kc, 2) : "—") + ".");

  // Warnings.
  const box = document.getElementById("warnings");
  box.hidden = result.warnings.length === 0;
  box.textContent = result.warnings.join("  ");

  // Keep this result for the charts and the inspector, show the full
  // response, and (re)draw everything.
  lastResult = result;
  lastInputs = inputs;
  stopPlay();
  currentTime = sim.t_min[sim.t_min.length - 1];
  updateInspector();
  drawCharts();
  updateTransport();
}

function renderError(err) {
  stopPlay();
  const lines = String(err && err.message ? err.message : err)
    .split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
  const box = document.getElementById("warnings");
  box.hidden = false;
  box.textContent = "Solver error: " + (lines[lines.length - 1] || "unknown error");
}

/* ---------- 2. Loading Python and wiring the inputs ---------- */

let pyodide = null;
let solverReady = false;

async function init() {
  const badge = document.getElementById("py-status");
  try {
    badge.textContent = "Python: loading…";
    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    });
    const solverCode = await (await fetch("solver.py")).text();
    pyodide.runPython(solverCode + "\n" + [
      "import json as _json",
      "def solve_json(tank_area_A, steady_level_hs, steady_flow_qs, Kc,",
      "               setpoint_step, disturbance_step, sim_time_min):",
      "    return _json.dumps(solve_all(tank_area_A, steady_level_hs,",
      "        steady_flow_qs, Kc, setpoint_step, disturbance_step,",
      "        sim_time_min))",
    ].join("\n"));
    buildCodeTab(solverCode);
    solverReady = true;
    badge.textContent = "Python: ready";
    badge.classList.add("ready");
    update();
  } catch (err) {
    badge.textContent = "Python: failed to load";
    renderError(err);
  }
}

function update() {
  if (!solverReady) return;
  try {
    const inputs = readInputs();
    SOLVER_ARGS.forEach(function (name, i) {
      pyodide.globals.set("a" + i, inputs[name]);
    });
    const json = pyodide.runPython("solve_json(a0, a1, a2, a3, a4, a5, a6)");
    render(JSON.parse(json), inputs);
  } catch (err) {
    renderError(err);
  }
}

document.querySelectorAll(".sidebar input, .sidebar select").forEach(function (el) {
  el.addEventListener("input", update);
  el.addEventListener("change", update);
});

/* ---------- Scenarios and reset ---------- */

const SCENARIOS = { balanced: 0.20, gentle: 0.10, aggressive: 0.40,
                    "near-ultimate": 0.70, unstable: 1.00 };

document.getElementById("scenario").addEventListener("change", function () {
  const v = document.getElementById("scenario").value;
  if (SCENARIOS[v] !== undefined) {
    document.getElementById("Kc").value = SCENARIOS[v];
    update();
  }
});
document.getElementById("Kc").addEventListener("input", function () {
  // A hand-typed gain is a custom case, unless it matches a scenario.
  const kc = parseFloat(document.getElementById("Kc").value);
  let match = "custom";
  Object.keys(SCENARIOS).forEach(function (k) {
    if (SCENARIOS[k] === kc) match = k;
  });
  document.getElementById("scenario").value = match;
});
document.getElementById("btn-reset").addEventListener("click", function () {
  Object.keys(DEFAULTS).forEach(function (name) {
    document.getElementById(name).value = DEFAULTS[name];
  });
  document.getElementById("scenario").value = "balanced";
  update();
});

/* ---------- Unit inspector ---------- */

function inspectorContent(unit) {
  if (!lastResult || !lastInputs) return null;
  const d = lastResult.derived, st = lastResult.stability;
  const hs = lastInputs.steady_level_hs, qs = lastInputs.steady_flow_qs;
  const R = d.R_min_per_m2, tau = d.tau_min;
  switch (unit) {
    case "controller":
      return { chip: "CONTROLLER · P-ONLY", title: "Controller — gain Kc",
        text: "Output = Kc × (setpoint − measured level). Here Kc = " +
          fmt(lastInputs.Kc, 2) + " (m³/min)/m, which is " +
          fmt(100 * lastInputs.Kc / st.Ku, 0) + "% of the ultimate gain Ku = " +
          fmt(st.Ku, 2) + ". At the final steady state the error is the offset, " +
          fmt(d.servo_offset_m, 3) + " m, and the controller holds the inflow at " +
          fmtFlow(qs + d.final_dev_m / R) + " to sustain it. No integral action, so the error never washes out." };
    case "tank1":
      return { chip: "TANK 1 · FIRST LAG", title: "Tank 1 — first to move",
        text: "Inflow is the controller output; outflow is h₁/R. Its transfer function is R/(τs + 1) with R = " +
          fmt(R, 2) + " min/m² and τ = " + fmt(tau, 2) + " min. It is the only tank that carries the gain R — tanks 2 and 3 only pass a level on. Final level " +
          fmtLevel(d.final_level_m) + "." };
    case "tank2":
      return { chip: "TANK 2 · SECOND LAG", title: "Tank 2 — the middle lag",
        text: "Inflow is tank 1's outflow, h₁/R; outflow is h₂/R. Its transfer function is 1/(τs + 1) — gain 1, lag τ = " +
          fmt(tau, 2) + " min. It adds a second lag, which is what makes the loop oscillatory even well below Ku. Final level " +
          fmtLevel(d.final_level_m) + "." };
    case "tank3":
      return { chip: "TANK 3 · CONTROLLED", title: "Tank 3 — the controlled variable",
        text: "Inflow is tank 2's outflow; outflow is h₃/R. Its level is the measured variable, fed back to the controller with sensor gain 1. Setpoint " +
          fmtLevel(d.setpoint_level_m) + "; final level " + fmtLevel(d.final_level_m) +
          "; offset " + fmt(d.servo_offset_m, 3) + " m. The third lag completes the (τs + 1)³ in the plant." };
    case "sensor":
      return { chip: "SENSOR · GAIN 1", title: "Sensor — the feedback path",
        text: "Reads tank 3's level in metres and returns it in metres: gain 1, no lag, no noise in this model. The controller subtracts it from the setpoint, so the error at the final steady state is exactly the offset, " +
          fmt(d.servo_offset_m, 3) + " m. A real sensor lag would add a fourth lag and lower Ku." };
    default: return null;
  }
}

function updateInspector() {
  const c = inspectorContent(selectedUnit);
  if (!c) return;
  setText("inspector-chip", c.chip);
  setText("inspector-title", c.title);
  setText("inspector-text", c.text);
  document.querySelectorAll(".diagram-unit").forEach(function (b) {
    b.classList.toggle("selected", b.dataset.unit === selectedUnit);
  });
}
document.querySelectorAll(".diagram-unit").forEach(function (btn) {
  btn.addEventListener("click", function () {
    selectedUnit = btn.dataset.unit;
    updateInspector();
  });
});

/* ---------- 4. Charts and time stepping ----------
 *
 * Three Plotly charts, all fed from the last result:
 *   a) Step response: absolute levels h1, h2, h3 vs time, with the
 *      setpoint as a dashed line.
 *   b) Controller output: absolute inflow to tank 1 vs time.
 *   c) Gain study: offset (left axis) and overshoot (right axis) vs Kc,
 *      with a dashed vertical line at Ku.
 * The transport controls only change how much of the already-computed
 * response is revealed (currentTime). They never re-run the solver.
 */

function timeIndex() {
  if (!lastResult) return 0;
  const t = lastResult.simulation.t_min;
  let idx = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] <= currentTime + 1e-9) idx = i; else break;
  }
  return idx;
}

function drawCharts() {
  if (!lastResult || !lastInputs) return;
  const sim = lastResult.simulation, hs = lastInputs.steady_level_hs;
  const qs = lastInputs.steady_flow_qs;
  const idx = timeIndex();
  const t = sim.t_min.slice(0, idx + 1);
  const layoutBase = { margin: { t: 10, r: 16, b: 46, l: 62 },
                       showlegend: true, legend: { orientation: "h", y: -0.22 } };
  const config = { responsive: true, displaylogo: false };

  // (a) Step response
  const respDiv = document.getElementById("chart-response");
  if (typeof Plotly === "undefined") {
    respDiv.textContent = "Charts could not load (Plotly unreachable). " +
                          "The numbers above are unaffected.";
    return;
  }
  const abs = function (arr) { return arr.slice(0, idx + 1).map(function (v) { return hs + v; }); };
  const sp = lastResult.derived.setpoint_level_m;
  Plotly.react(respDiv, [
    { x: t, y: abs(sim.h1_dev_m), mode: "lines", type: "scatter", name: "tank 1",
      line: { color: "#2563eb" } },
    { x: t, y: abs(sim.h2_dev_m), mode: "lines", type: "scatter", name: "tank 2",
      line: { color: "#0891b2" } },
    { x: t, y: abs(sim.h3_dev_m), mode: "lines", type: "scatter", name: "tank 3 (controlled)",
      line: { color: "#dc2626", width: 3 } },
    { x: [0, t[t.length - 1] || 0], y: [sp, sp], mode: "lines", type: "scatter",
      name: "setpoint", line: { color: "#1e293b", dash: "dash" } },
  ], Object.assign({}, layoutBase, {
    xaxis: { title: "time [min]", range: [0, sim.t_min[sim.t_min.length - 1]] },
    yaxis: { title: "level [m]" },
  }), config);

  // (b) Controller output
  const uAbs = sim.u_dev_m3_per_min.slice(0, idx + 1).map(function (v) { return qs + v; });
  Plotly.react(document.getElementById("chart-control"), [
    { x: t, y: uAbs, mode: "lines", type: "scatter", name: "inflow to tank 1",
      line: { color: "#dc2626" } },
    { x: [0, t[t.length - 1] || 0], y: [qs, qs], mode: "lines", type: "scatter",
      name: "steady flow", line: { color: "#1e293b", dash: "dash" } },
  ], Object.assign({}, layoutBase, {
    xaxis: { title: "time [min]", range: [0, sim.t_min[sim.t_min.length - 1]] },
    yaxis: { title: "flow [m³/min]" },
  }), config);

  // (c) Gain study
  const sweep = lastResult.kc_study;
  const Ku = lastResult.derived.Ku;
  Plotly.react(document.getElementById("chart-kc"), [
    { x: sweep.map(function (r) { return r.Kc; }),
      y: sweep.map(function (r) { return r.offset_m; }),
      mode: "lines+markers", type: "scatter", name: "steady-state offset [m]",
      line: { color: "#2563eb" }, marker: { size: 8 } },
    { x: sweep.map(function (r) { return r.Kc; }),
      y: sweep.map(function (r) { return r.overshoot_pct; }),
      mode: "lines+markers", type: "scatter", name: "peak overshoot [%]",
      yaxis: "y2", line: { color: "#dc2626" }, marker: { size: 8 } },
  ], Object.assign({}, layoutBase, {
    xaxis: { title: "proportional gain Kc [(m³/min)/m]" },
    yaxis: { title: "offset [m]" },
    yaxis2: { title: "overshoot [%]", overlaying: "y", side: "right" },
    shapes: [{ type: "line", x0: Ku, x1: Ku, y0: 0, y1: 1, yref: "paper",
               line: { color: "#1e293b", dash: "dash" } }],
    annotations: [{ x: Ku, y: 1.02, yref: "paper", text: "Ku = " + fmt(Ku, 2),
                    showarrow: false, font: { color: "#1e293b" } }],
  }), config);

  // Diagram live values at the revealed time.
  setText("diag-controller", "Kc = " + fmt(lastInputs.Kc, 2));
  setText("diag-tank1", fmtLevel(hs + sim.h1_dev_m[idx]));
  setText("diag-tank2", fmtLevel(hs + sim.h2_dev_m[idx]));
  setText("diag-tank3", fmtLevel(hs + sim.h3_dev_m[idx]));
}

function captionText() {
  if (!lastResult || !lastInputs) return "Waiting for the solver…";
  const sim = lastResult.simulation, hs = lastInputs.steady_level_hs;
  const qs = lastInputs.steady_flow_qs, idx = timeIndex();
  const t = sim.t_min[idx];
  return "t = " + fmt(t, 1) + " min: tank 1 " + fmtLevel(hs + sim.h1_dev_m[idx]) +
    ", tank 2 " + fmtLevel(hs + sim.h2_dev_m[idx]) +
    ", tank 3 " + fmtLevel(hs + sim.h3_dev_m[idx]) +
    ", inflow " + fmtFlow(qs + sim.u_dev_m3_per_min[idx]) + ".";
}

function updateTransport() {
  if (!lastResult) return;
  const tMax = lastResult.simulation.t_min[lastResult.simulation.t_min.length - 1];
  setText("time-now", fmt(currentTime, 1));
  setText("time-max", fmt(tMax, 0));
  const slider = document.getElementById("time-slider");
  slider.max = tMax;
  slider.value = currentTime;
  slider.disabled = false;
  document.getElementById("btn-t-step").disabled = currentTime >= tMax;
  document.getElementById("btn-t-back").disabled = currentTime <= 0;
  document.getElementById("btn-t-reset").disabled = currentTime <= 0;
  document.getElementById("btn-t-play").disabled = false;
  setText("time-caption", captionText());
}

function setTime(t) {
  if (!lastResult) return;
  const tMax = lastResult.simulation.t_min[lastResult.simulation.t_min.length - 1];
  currentTime = Math.max(0, Math.min(tMax, t));
  drawCharts();
  updateTransport();
}

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    document.getElementById("btn-t-play").textContent = "Play";
  }
}

function togglePlay() {
  if (playTimer) { stopPlay(); updateTransport(); return; }
  if (!lastResult) return;
  const tMax = lastResult.simulation.t_min[lastResult.simulation.t_min.length - 1];
  if (currentTime >= tMax) setTime(0);
  document.getElementById("btn-t-play").textContent = "Pause";
  playTimer = setInterval(function () {
    setTime(currentTime + 2);
    if (currentTime >= tMax) { stopPlay(); updateTransport(); }
  }, 250);
  updateTransport();
}

/* ---------- 5. Python tab: the solver's own code, in sections ----------
 *
 * buildCodeTab() receives the exact text of solver.py that init() fetched
 * and ran, splits it at the "# === SECTION n: ... ===" markers, and builds
 * one block per section: heading, short explanation, inputs -> outputs
 * line, then the code. Because the display is generated from the running
 * file, the two can never disagree.
 */

const SECTION_EXPLANATIONS = {
  0: { explain: "The file opens by stating what the model is, what it " +
                "leaves out, and the units used everywhere. Read this " +
                "before trusting any number the site shows.",
       inout: "" },
  1: { explain: "Turns the steady state into two numbers, R and tau, " +
                "that describe one tank. R says how much the level must " +
                "rise to push one extra unit of flow out; tau says how " +
                "slowly the tank answers.",
       inout: "A, h_s, q_s -> R, tau" },
  2: { explain: "A level balance on one tank, in deviation variables, " +
                "becomes a first-order lag. Its gain is R and its lag " +
                "is tau.",
       inout: "R, tau -> G_tank(s) = R / (tau*s + 1)" },
  3: { explain: "Three first-order lags in series multiply. The first " +
                "tank carries the gain R; the second and third only pass " +
                "a level on to the next tank.",
       inout: "R, tau -> G_p(s) = R / (tau*s + 1)^3" },
  4: { explain: "The controller is one block, Kc. The forward path is " +
                "controller times plant; the feedback rule then closes " +
                "the loop.",
       inout: "Kc, R, tau -> closed-loop H3/Sp and H3/D" },
  5: { explain: "The poles are the roots of (tau s + 1)^3 + Kc R = 0. " +
                "They come out in closed form, and their real part " +
                "decides stability.",
       inout: "Kc, R, tau -> poles, Ku, Pu, damping" },
  6: { explain: "Integrates the three tank balances with the controller " +
                "in the loop, step by step (RK4). This is the curve the " +
                "charts draw, and its end point is checked against the " +
                "transfer-function answer.",
       inout: "R, tau, Kc, steps, sim time -> time series + metrics" },
  7: { explain: "Runs sections 1-6 for the sidebar inputs, then repeats " +
                "the closed-loop calculation over a range of Kc values " +
                "so the site can show how gain trades offset against " +
                "oscillation and stability.",
       inout: "all sidebar inputs -> cards, charts, table, warnings" },
  tests: { explain: "Runs the solver on cases with known answers — the " +
                    "default case, no control, a disturbance only, and " +
                    "the ultimate gain — and prints the worked default " +
                    "case. This block runs only when the file is run " +
                    "directly, never on the website.",
           inout: "" },
};

function buildCodeTab(source) {
  const container = document.getElementById("code-sections");
  if (!container) return;

  const blocks = [{ num: 0, title: "Top of the file — what this model is, and is not", lines: [] }];
  let current = blocks[0];
  source.split("\n").forEach(function (line) {
    const m = line.match(/^# === SECTION (\d+): (.+) ===$/);
    if (m) {
      current = { num: parseInt(m[1], 10), title: m[2], lines: [] };
      blocks.push(current);
    } else {
      current.lines.push(line);
    }
  });

  const lastBlock = blocks[blocks.length - 1];
  const cut = lastBlock.lines.findIndex(function (l) { return /^# -{10,}$/.test(l); });
  if (cut >= 0) {
    blocks.push({ num: "tests", title: "End of the file — self-tests",
                  lines: lastBlock.lines.slice(cut) });
    lastBlock.lines = lastBlock.lines.slice(0, cut);
  }

  blocks.forEach(function (block) {
    let ls = block.lines.slice();
    if (typeof block.num === "number" && block.num >= 1) {
      let i = 0;
      while (i < ls.length && ls[i].startsWith("#")) {
        const isSeparator = ls[i].trim() === "#";
        i++;
        if (isSeparator) break;
      }
      if (ls.slice(0, i).join("\n").includes("Explanation:")) ls = ls.slice(i);
    }
    const codeText = ls.join("\n").trim();
    if (!codeText) return;

    const wrap = document.createElement("div");
    wrap.className = "code-section";
    wrap.id = "code-section-" + block.num;

    const h = document.createElement("h3");
    h.textContent = (typeof block.num === "number" && block.num >= 1
                     ? block.num + " · " : "") + block.title;
    wrap.appendChild(h);

    const meta = SECTION_EXPLANATIONS[block.num];
    if (meta) {
      const ex = document.createElement("div");
      ex.className = "code-explain";
      ex.textContent = meta.explain;
      wrap.appendChild(ex);
      if (meta.inout) {
        const io = document.createElement("p");
        io.className = "code-inout";
        io.textContent = "Inputs -> Outputs: " + meta.inout;
        wrap.appendChild(io);
      }
    }

    const pre = document.createElement("pre");
    pre.className = "code-block";
    const code = document.createElement("code");
    code.textContent = codeText;
    pre.appendChild(code);
    wrap.appendChild(pre);

    container.appendChild(wrap);
  });
}

document.getElementById("btn-t-step").addEventListener("click", function () {
  stopPlay(); setTime(currentTime + 2);
});
document.getElementById("btn-t-back").addEventListener("click", function () {
  stopPlay(); setTime(currentTime - 2);
});
document.getElementById("btn-t-reset").addEventListener("click", function () {
  stopPlay(); setTime(0);
});
document.getElementById("btn-t-play").addEventListener("click", togglePlay);
document.getElementById("time-slider").addEventListener("input", function () {
  stopPlay();
  setTime(parseFloat(document.getElementById("time-slider").value));
});

init();
