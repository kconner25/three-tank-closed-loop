"""
Three identical gravity-drained tanks in series, under proportional
control -- solver only.

Teaching model, NOT a predictive design model.
  * Each tank drains by gravity: outflow grows with the square root of
    level (Torricelli). The model linearises that curve about one
    steady state, so every result below is a deviation from that state.
  * The three tanks are identical: same area A, same steady level h_s,
    same steady flow q_s, hence the same resistance R and time constant
    tau. The level of tank 3 is the controlled variable; the inflow to
    tank 1 is the manipulated variable; a proportional controller with
    gain Kc drives it from the error in tank 3's level.
  * The sensor/transmitter gain is taken as 1 (level in metres is read
    in metres). The setpoint and the disturbance are both steps applied
    at t = 0.

Units everywhere in this file:
  levels m, area m^2, flows m^3/min, time min,
  R min/m^2, tau min, Kc (m^3/min)/m.

Run it on its own to see the worked default case and the self-tests:
    python3 solver.py
"""

import math


# === SECTION 1: Inputs and the linearised tank ===
# Explanation: Turns the steady state into two numbers, R and tau, that
# describe one tank. R says how much the level must rise to push one
# extra unit of flow out; tau says how slowly the tank answers.
# Inputs -> Outputs: A, h_s, q_s -> R, tau
#
# Gravity drainage: q_out = k * sqrt(h). At the steady state the slope
# dq/dh = q_s / (2 h_s), so the linearised resistance is its reciprocal,
# R = dh/dq = 2 h_s / q_s, and the tank time constant is tau = A * R.

DEFAULTS = {                   # keys match solve_all() exactly
    "tank_area_A": 1.0,        # m^2, same for all three tanks
    "steady_level_hs": 1.0,    # m
    "steady_flow_qs": 0.20,    # m^3/min
    "Kc": 0.20,                # (m^3/min)/m, proportional gain
    "setpoint_step": 0.20,     # m, step in the tank-3 setpoint at t = 0
    "disturbance_step": 0.0,   # m^3/min, extra inflow to tank 1 at t = 0
    "sim_time_min": 120.0,     # min
}


def tank_constants(tank_area_A, steady_level_hs, steady_flow_qs):
    """Linearised resistance R and time constant tau for one tank."""
    if tank_area_A <= 0:
        raise ValueError("Tank area must be positive.")
    if steady_level_hs <= 0:
        raise ValueError("Steady-state level must be positive.")
    if steady_flow_qs <= 0:
        raise ValueError("Steady-state flow must be positive.")
    R = 2.0 * steady_level_hs / steady_flow_qs   # min/m^2
    tau = tank_area_A * R                          # min
    return R, tau


# === SECTION 2: One tank as a transfer function ===
# Explanation: A level balance on one tank, in deviation variables,
# becomes a first-order lag. Its gain is R and its lag is tau.
# Inputs -> Outputs: R, tau -> G_tank(s) = R / (tau*s + 1)
#
# Balance: A dh/dt = q_in - q_out, q_out = h / R (linearised).
# In deviation variables, A dx/dt = u - x / R. Laplace, zero initial
# deviation: (A s + 1/R) X(s) = U(s), so X/U = R / (A R s + 1).

def single_tank_tf(R, tau):
    """Numerator and denominator coefficients of R / (tau s + 1)."""
    return {"gain": R, "tau": tau,
            "numerator": [R], "denominator": [tau, 1.0]}


# === SECTION 3: Three tanks in series -- the plant ===
# Explanation: Three first-order lags in series multiply. The first
# tank carries the gain R; the second and third only pass a level on
# to the next tank, so each of them has gain 1.
# Inputs -> Outputs: R, tau -> G_p(s) = R / (tau*s + 1)^3
#
# H1/Q0 = R / (tau s + 1), H2/H1 = 1 / (tau s + 1),
# H3/H2 = 1 / (tau s + 1). Multiplying the three blocks (the series
# rule of block diagram algebra) gives the plant transfer function.

def plant_tf(R, tau):
    """G_p(s) = R / (tau s + 1)^3, expanded denominator coefficients."""
    return {"numerator": [R],
            "denominator": [tau ** 3, 3.0 * tau ** 2, 3.0 * tau, 1.0]}


# === SECTION 4: Proportional control and the closed loop ===
# Explanation: The controller is one block, Kc. The forward path is
# controller times plant; the feedback rule then closes the loop.
# Inputs -> Outputs: Kc, R, tau -> closed-loop H3/Sp and H3/D
#
# Forward path: G(s) = Gc * Gp = Kc R / (tau s + 1)^3.
# Feedback rule, sensor gain 1: Y/Sp = G / (1 + G).
#   H3(s)/Sp(s) = Kc R / ((tau s + 1)^3 + Kc R)
# The same denominator governs a disturbance D entering tank 1:
#   H3(s)/D(s) = R / ((tau s + 1)^3 + Kc R)
# At s = 0 the servo gain is Kc R / (1 + Kc R): a P-only loop never
# reaches its setpoint. The shortfall is the steady-state offset,
# offset = setpoint step / (1 + Kc R).

def closed_loop_tf(Kc, R, tau):
    """Closed-loop servo and regulatory transfer functions."""
    if Kc < 0:
        raise ValueError("Proportional gain Kc cannot be negative.")
    KcR = Kc * R
    denom = [tau ** 3, 3.0 * tau ** 2, 3.0 * tau, 1.0 + KcR]
    return {
        "KcR": KcR,
        "dc_gain": KcR / (1.0 + KcR) if KcR > 0 else 0.0,
        "servo_numerator": [KcR],
        "servo_denominator": denom,
        "regulatory_numerator": [R],
        "regulatory_denominator": denom,
    }


# === SECTION 5: Poles, damping and the ultimate gain ===
# Explanation: The poles are the roots of (tau s + 1)^3 + Kc R = 0.
# They come out in closed form, and their real part decides stability.
# Inputs -> Outputs: Kc, R, tau -> poles, Ku, Pu, damping
#
# (tau s + 1)^3 = -Kc R, so tau s + 1 is a cube root of -Kc R.
# With a = (Kc R)^(1/3) the roots are -1 - a, and
# -1 + a/2 +/- i a sqrt(3)/2, all divided by tau. The complex pair
# crosses the imaginary axis when a = 2, i.e. Kc R = 8 -- that is the
# Routh-Hurwitz result too: (3 tau^2)(3 tau) > tau^3 (1 + Kc R).
# Hence Ku = 8 / R, and at Ku the oscillation frequency is
# sqrt(3) / tau, so Pu = 2 pi tau / sqrt(3).

def poles_and_stability(Kc, R, tau):
    """Poles of the closed loop, ultimate gain and ultimate period."""
    KcR = Kc * R
    a = KcR ** (1.0 / 3.0) if KcR > 0 else 0.0
    real_pole = (-1.0 - a) / tau
    re = (-1.0 + 0.5 * a) / tau
    im = (0.5 * math.sqrt(3.0) * a) / tau
    poles = [{"real": real_pole, "imag": 0.0},
             {"real": re, "imag": im},
             {"real": re, "imag": -im}]
    Ku = 8.0 / R
    Pu = 2.0 * math.pi * tau / math.sqrt(3.0)
    wn = math.sqrt(re * re + im * im) if KcR > 0 else 0.0
    zeta = -re / wn if wn > 0 else 1.0
    return {
        "poles": poles,
        "Ku": Ku,
        "Pu": Pu,
        "stable": KcR < 8.0,
        "damping_ratio": zeta,
        "natural_freq_per_min": wn,
        "damped_freq_per_min": im,
    }


# === SECTION 6: Step response by simulation ===
# Explanation: Integrates the three tank balances with the controller
# in the loop, step by step (RK4). This is the curve the charts draw,
# and its end point is checked against the transfer-function answer.
# Inputs -> Outputs: R, tau, Kc, steps, sim time -> time series + metrics
#
# Deviation variables x_i = h_i - h_s. The controller output deviation
# is u = Kc * (setpoint step - x_3) + disturbance step, and
#   A dx1/dt = u - x1/R,  A dx2/dt = x1/R - x2/R,  A dx3/dt = x2/R - x3/R.
# At steady state every x_i is the same, x_final =
#   (Kc R * setpoint step + R * disturbance step) / (1 + Kc R).

def _derivatives(x, Kc, R, tank_area_A, setpoint_step, disturbance_step):
    """Right-hand sides of the three deviation balances."""
    u = Kc * (setpoint_step - x[2]) + disturbance_step
    return [(u - x[0] / R) / tank_area_A,
            (x[0] / R - x[1] / R) / tank_area_A,
            (x[1] / R - x[2] / R) / tank_area_A]


def simulate(R, tau, Kc, tank_area_A, setpoint_step, disturbance_step,
             sim_time_min, dt=0.1, sample_every=5):
    """RK4 step response; returns sampled absolute levels and metrics."""
    if sim_time_min <= 0:
        raise ValueError("Simulation time must be positive.")
    if dt <= 0 or dt > tau / 5.0:
        dt = min(0.1, tau / 20.0)
    steps = int(round(sim_time_min / dt))
    x = [0.0, 0.0, 0.0]
    t = [0.0]
    h1, h2, h3, u_out = [0.0], [0.0], [0.0], [0.0]
    # Final (analytic) deviation, for the metrics below.
    KcR = Kc * R
    final_dev = (KcR * setpoint_step + R * disturbance_step) / (1.0 + KcR)
    peak_dev, peak_time = 0.0, 0.0
    diverged = False
    for n in range(1, steps + 1):
        k1 = _derivatives(x, Kc, R, tank_area_A, setpoint_step,
                          disturbance_step)
        k2 = _derivatives([x[i] + 0.5 * dt * k1[i] for i in range(3)],
                          Kc, R, tank_area_A, setpoint_step,
                          disturbance_step)
        k3 = _derivatives([x[i] + 0.5 * dt * k2[i] for i in range(3)],
                          Kc, R, tank_area_A, setpoint_step,
                          disturbance_step)
        k4 = _derivatives([x[i] + dt * k3[i] for i in range(3)],
                          Kc, R, tank_area_A, setpoint_step,
                          disturbance_step)
        x = [x[i] + dt / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i])
             for i in range(3)]
        if max(abs(v) for v in x) > 1.0e4:
            diverged = True
            break
        if x[2] > peak_dev:
            peak_dev, peak_time = x[2], n * dt
        if n % sample_every == 0 or n == steps:
            tt = n * dt
            u = Kc * (setpoint_step - x[2]) + disturbance_step
            t.append(tt)
            h1.append(x[0]); h2.append(x[1]); h3.append(x[2]); u_out.append(u)
    # Settling time: last sampled time outside a +/-2% band on the final
    # deviation (None when the response never stays inside the band).
    settling_time = None
    if final_dev != 0.0:
        band = 0.02 * abs(final_dev)
        outside = [tt for tt, v in zip(t, h3) if abs(v - final_dev) > band]
        settling_time = (outside[-1] if outside else 0.0)
        if outside and outside[-1] >= sim_time_min - dt * sample_every:
            settling_time = None
    overshoot_pct = None
    if final_dev > 0.0 and peak_dev > final_dev:
        overshoot_pct = 100.0 * (peak_dev - final_dev) / final_dev
    return {
        "t_min": t,
        "h1_dev_m": h1, "h2_dev_m": h2, "h3_dev_m": h3,
        "u_dev_m3_per_min": u_out,
        "final_dev_m": final_dev,
        "sim_final_dev_m": h3[-1],
        "peak_dev_m": peak_dev,
        "peak_time_min": peak_time,
        "overshoot_pct": overshoot_pct,
        "settling_time_2pct_min": settling_time,
        "diverged": diverged,
    }


# === SECTION 7: Putting it together, and the Kc study ===
# Explanation: Runs sections 1-6 for the sidebar inputs, then repeats
# the closed-loop calculation over a range of Kc values so the site can
# show how gain trades offset against oscillation and stability.
# Inputs -> Outputs: all sidebar inputs -> cards, charts, table, warnings
#
# The Kc study holds R and tau fixed and varies only Kc. For each gain
# it records the DC gain, the servo offset for the current setpoint
# step, whether the loop is stable, and -- for stable gains -- the peak
# overshoot from a short simulation. It is a separate study, in the
# same spirit as a stage-count study: it does not change the main run.

KC_STUDY = [0.05, 0.10, 0.20, 0.30, 0.40, 0.60, 0.80, 1.00]


def solve_all(tank_area_A, steady_level_hs, steady_flow_qs, Kc,
              setpoint_step, disturbance_step, sim_time_min):
    """Full calculation: derived constants, transfer functions, poles,
    step response, Kc study, and warnings."""
    R, tau = tank_constants(tank_area_A, steady_level_hs, steady_flow_qs)
    cl = closed_loop_tf(Kc, R, tau)
    stab = poles_and_stability(Kc, R, tau)
    sim = simulate(R, tau, Kc, tank_area_A, setpoint_step,
                   disturbance_step, sim_time_min)

    final_level = steady_level_hs + sim["final_dev_m"]
    servo_offset = (setpoint_step / (1.0 + cl["KcR"])
                    if setpoint_step != 0.0 else 0.0)

    sweep = []
    for kc_try in KC_STUDY:
        kc_r = kc_try * R
        stable_try = kc_r < 8.0
        peak_try = None
        if stable_try:
            s_try = simulate(R, tau, kc_try, tank_area_A, setpoint_step,
                             0.0, min(sim_time_min, 120.0),
                             dt=0.2, sample_every=5)
            peak_try = s_try["overshoot_pct"]
        sweep.append({
            "Kc": kc_try, "KcR": kc_r,
            "dc_gain": kc_r / (1.0 + kc_r),
            "offset_m": setpoint_step / (1.0 + kc_r),
            "stable": stable_try,
            "overshoot_pct": peak_try,
        })

    warnings = []
    if not stab["stable"]:
        warnings.append(
            f"Kc*R = {cl['KcR']:.2f} >= 8: the closed loop is unstable "
            f"(Kc = {Kc} is above Ku = {stab['Ku']:.3f}). The simulated "
            "levels grow instead of settling -- lower Kc.")
    elif cl["KcR"] > 6.4:
        warnings.append(
            f"Kc*R = {cl['KcR']:.2f} is above 80% of the stability limit "
            f"(Ku = {stab['Ku']:.3f}): expect a long, oscillatory response.")
    if sim["diverged"]:
        warnings.append("Simulation diverged: levels left the plotted "
                        "range. The loop is unstable at this gain.")
    if final_level <= 0:
        warnings.append("The final level is at or below zero: the "
                        "linearised model has left its valid range.")
    if setpoint_step == 0.0 and disturbance_step == 0.0:
        warnings.append("Both steps are zero, so nothing changes: the "
                        "levels stay at the steady state.")
    if abs(sim["sim_final_dev_m"] - sim["final_dev_m"]) > 0.01:
        warnings.append("The simulated end point does not match the "
                        "transfer-function final value -- the run may be "
                        "too short for this (slow, oscillatory) case.")

    return {
        "derived": {
            "R_min_per_m2": R, "tau_min": tau, "KcR": cl["KcR"],
            "Ku": stab["Ku"], "Pu_min": stab["Pu"],
            "dc_gain": cl["dc_gain"],
            "servo_offset_m": servo_offset,
            "final_dev_m": sim["final_dev_m"],
            "final_level_m": final_level,
            "setpoint_level_m": steady_level_hs + setpoint_step,
        },
        "plant": plant_tf(R, tau),
        "single_tank": single_tank_tf(R, tau),
        "closed_loop": cl,
        "stability": stab,
        "simulation": sim,
        "kc_study": sweep,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Self-tests and the worked default case. Not a numbered section: this block
# only runs when the file is run directly, never when the website imports it.
# ---------------------------------------------------------------------------

def _run_tests():
    r = solve_all(**{**DEFAULTS})
    d, sim = r["derived"], r["simulation"]

    # Default derived constants.
    assert abs(d["R_min_per_m2"] - 10.0) < 1e-12, d
    assert abs(d["tau_min"] - 10.0) < 1e-12, d
    assert abs(d["KcR"] - 2.0) < 1e-12, d
    assert abs(d["Ku"] - 0.80) < 1e-12, d
    assert abs(d["Pu_min"] - 2.0 * math.pi * 10.0 / math.sqrt(3.0)) < 1e-9

    # Closed loop: DC gain 2/3, final level change 0.1333 m, offset 0.0667 m.
    assert abs(d["dc_gain"] - 2.0 / 3.0) < 1e-12
    assert abs(d["final_dev_m"] - 0.1333333333) < 1e-9
    assert abs(d["servo_offset_m"] - 0.0666666667) < 1e-9
    assert abs(d["final_level_m"] - 1.1333333333) < 1e-9

    # Poles: one real, one complex pair, all with negative real parts.
    poles = r["stability"]["poles"]
    assert all(p["real"] < 0 for p in poles), poles
    assert abs(poles[0]["real"] - (-1.0 - 2.0 ** (1.0 / 3.0)) / 10.0) < 1e-12

    # Simulation must land on the transfer-function final value.
    assert abs(sim["sim_final_dev_m"] - sim["final_dev_m"]) < 0.005, sim
    assert sim["peak_dev_m"] > sim["final_dev_m"]  # it overshoots
    assert abs(sim["overshoot_pct"] - 30.0) < 5.0, sim["overshoot_pct"]

    # No control: a setpoint step moves nothing.
    r0 = solve_all(1.0, 1.0, 0.20, 0.0, 0.20, 0.0, 120.0)
    assert r0["derived"]["dc_gain"] == 0.0
    assert abs(r0["derived"]["final_dev_m"]) < 1e-12

    # Disturbance only: final change is R*d / (1 + Kc R).
    rd = solve_all(1.0, 1.0, 0.20, 0.20, 0.0, 0.01, 120.0)
    assert abs(rd["derived"]["final_dev_m"] - 10.0 * 0.01 / 3.0) < 1e-9

    # At the ultimate gain the complex poles sit on the imaginary axis;
    # above it they cross over and the loop is unstable.
    ru = solve_all(1.0, 1.0, 0.20, 0.80, 0.20, 0.0, 120.0)
    assert abs(ru["stability"]["poles"][1]["real"]) < 1e-9
    assert ru["stability"]["stable"] is False  # Ku is the boundary
    r_unstable = solve_all(1.0, 1.0, 0.20, 1.00, 0.20, 0.0, 120.0)
    assert r_unstable["stability"]["stable"] is False
    assert r_unstable["stability"]["poles"][1]["real"] > 0

    print("Default case (A = 1.0 m^2, h_s = 1.0 m, q_s = 0.20 m^3/min, "
          "Kc = 0.20, setpoint step +0.20 m)")
    print(f"  R = {d['R_min_per_m2']:.2f} min/m^2, tau = {d['tau_min']:.2f} min")
    print(f"  G_p(s) = 10 / (10s + 1)^3")
    print(f"  Closed loop: H3/Sp = {d['KcR']:.1f} / ((10s + 1)^3 + "
          f"{d['KcR']:.1f}), DC gain = {d['dc_gain']:.4f}")
    print(f"  Final h3 change = {d['final_dev_m']:.4f} m "
          f"(level {d['final_level_m']:.4f} m), "
          f"offset = {d['servo_offset_m']:.4f} m")
    print(f"  Ku = {d['Ku']:.2f} (m^3/min)/m, Pu = {d['Pu_min']:.1f} min")
    print(f"  Simulated peak = {sim['peak_dev_m']:.4f} m at "
          f"{sim['peak_time_min']:.1f} min, "
          f"overshoot = {sim['overshoot_pct']:.1f}%")
    print("All self-tests passed.")


if __name__ == "__main__":
    _run_tests()
