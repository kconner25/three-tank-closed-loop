# Three tanks in series: closed-loop transfer function

A single-page teaching site for a process of three identical
gravity-drained tanks in series, under proportional control. It
demonstrates the closed-loop transfer function using block diagram
algebra, with a worked example, a section explaining the theory, and
a section explaining the code.

Live calculation runs in the browser (Python via Pyodide). There is
no backend, no account, and no data upload.

## What the site does

Change any input in the left sidebar and every number updates:

- the plant transfer function $G_p(s) = R / (\tau s + 1)^3$
- the closed-loop transfer function
  $H_3(s)/Sp(s) = K_c R / [(\tau s + 1)^3 + K_c R]$
- the poles, the damping ratio, and the ultimate gain $K_u = 8/R$
  with ultimate period $P_u = 2\pi\tau/\sqrt{3}$
- the step response of all three levels and of the controller output,
  with a time step-through (play / step / slider)
- a level ledger and a separate gain study: offset and overshoot
  versus $K_c$, with $K_u$ marked

## The three tabs

| Tab | Contents |
| --- | --- |
| App | Flowsheet strip, 4 stat cards, closed-loop transfer function, clickable live process view with a unit inspector, time step-through, level ledger, step-response and controller-output charts, gain study |
| Theory | Linearised tank (Torricelli → $R$, $\tau$), the three rules of block diagram algebra, a worked example done step by step with the default numbers, stability / $K_u$ / $P_u$, disturbances, assumptions and limits |
| Python — step by step | `solver.py` itself, loaded live and split at its section markers, each section with a short explanation and an inputs → outputs line |

## Files

| File | Job |
| --- | --- |
| `solver.py` | All the engineering math, in 7 numbered sections, plus self-tests. The site runs this file. |
| `index.html` | Page structure: sidebar inputs, cards, tabs, diagram, tables, Theory text. |
| `style.css` | All styling (slate sidebar, white cards, red accent). |
| `app.js` | Glue only: loads Pyodide, hands sidebar values to `solver.py`, writes results onto the page, draws the charts. No engineering equations live here. |
| `README.md` | This file. |

## The model

Three identical tanks, area $A$, steady level $h_s$, steady flow
$q_s$. Gravity drainage $q_{out} = k\sqrt{h}$ is linearised about
that steady state, giving resistance $R = 2h_s/q_s$ and time
constant $\tau = AR$. One tank is $R/(\tau s+1)$; the second and
third pass a level on, so each is $1/(\tau s+1)$. The controller is
proportional, gain $K_c$, and the sensor gain is 1.

Default case: $A = 1.0\ \text{m}^2$, $h_s = 1.0\ \text{m}$,
$q_s = 0.20\ \text{m}^3/\text{min}$ → $R = 10\ \text{min/m}^2$,
$\tau = 10\ \text{min}$; $K_c = 0.20$, setpoint step $+0.20\ \text{m}$.

- $G_p(s) = 10/(10s+1)^3$
- Closed loop: $H_3/Sp = 2.0/[(10s+1)^3 + 2.0]$, DC gain $0.667$
- Final level change $+0.133\ \text{m}$ (level $1.133\ \text{m}$),
  offset $0.067\ \text{m}$, peak $+0.173\ \text{m}$ (29.9% overshoot)
- $K_u = 0.80\ (\text{m}^3/\text{min})/\text{m}$,
  $P_u = 36.3\ \text{min}$

Limits: the linearisation is valid only for small moves about the
steady state; all tanks are identical; the sensor and valve are
ideal (no lag, noise, saturation, or dead time).

## Run it locally

Double-clicking `index.html` will not work: `file://` blocks the
`solver.py` fetch. Serve the folder instead:

```bash
cd three-tank-closed-loop
python3 -m http.server
```

then open http://localhost:8000 in a browser.

Check the solver on its own (prints the default case and runs the
self-tests):

```bash
python3 solver.py
```

## Publish with GitHub Pages

1. On GitHub, create a new repository, e.g.
   `three-tank-closed-loop`.
2. Upload all five files (`solver.py`, `index.html`, `style.css`,
   `app.js`, `README.md`) to the top level of the repository —
   not inside a folder.
3. Repository → Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.
4. After a minute or two the site is live at
   `https://<your-username>.github.io/three-tank-closed-loop/`.

## Inspiration and build history


Layout inspiration: the propane separation lab at
https://aladdins7.github.io/propane-separation-lab/ — in
particular its left-sidebar operating case with scenario presets,
its four KPI cards, its clickable unit inspector, its stream
ledger, and its separate stage-count study (here: a separate gain
study). The interface structure also follows the author's earlier
propane + water flash-stripper site (sidebar inputs, stat cards,
App / Theory / Python tabs, Pyodide solver, Plotly charts).

Built with AI as the main coder, in verified steps: solver first
(self-tests passing, default case checked by hand), then the page
and styling, then the app wiring, then the Theory and Python tabs,
then a local verification pass. The code is explained as it is
built, and the site itself displays the code in sections.
