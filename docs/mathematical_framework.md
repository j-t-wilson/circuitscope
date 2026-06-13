# Mathematical Framework

This document describes the calculations done by CircuitScope.
Stim provides the circuit parser, detector error model (DEM), explanations, and
sampling machinery. CircuitScope combines those Stim outputs into event
fractions, contribution budgets, sensitivities, and generated Python formulas.

## Table of Contents

1. [Summary](#1-summary)
2. [Event Fractions](#2-event-fractions)
3. [Probability Sources](#3-probability-sources)
4. [Depolarizing Decorrelation](#4-depolarizing-decorrelation)
5. [Contribution Budgets](#5-contribution-budgets)
6. [Analysis Formulas](#6-analysis-formulas)
7. [Stim REPEAT Loops](#7-stim-repeat-loops)
8. [Implementation Reference](#8-implementation-reference)
9. [Core Formula Derivation](#9-core-formula-derivation)
10. [Measured-Data Parameter Fitting](#10-measured-data-parameter-fitting)

---

## 1. Summary

CircuitScope uses one model throughout the UI:

- A detector error model term is an independent event that toggles one or more detectors.
- A detector fires when an odd number of toggles affect it.
- Detector event fractions are odd-parity probabilities.
- Average event fraction is the arithmetic mean over detectors.
- Contributions are log-weight budget shares, not directly additive probabilities.
- Analysis parameters are grouped by `(gate_type, original_value)` from the input circuit.
- `DEPOLARIZE1` and `DEPOLARIZE2` circuit probabilities are decorrelated before
  they are used as independent Pauli toggle probabilities.

The most important distinction is between DEM probabilities and circuit-level
gate probabilities. DEM `error(p)` terms are already independent toggle
probabilities. Circuit-level depolarizing gates are disjoint Pauli channels and
must be converted before they can be used in the same formula.

---

## 2. Event Fractions

For detector $D$, CircuitScope computes:

$$P(D) = \frac{1}{2}\left(1 - \prod_i (1 - 2p_{\text{eff},i})^{c_i}\right)$$

where:
- $P(D)$ is the probability that detector $D$ fires.
- $p_{\text{eff},i}$ is the independent probability that mechanism $i$ toggles detector $D$ once.
- $c_i$ is the number of independent opportunities for mechanism $i$.

In the Detectors panel, this formula is applied directly to the independent
`error(p)` terms from Stim's detector error model. If no DEM error term targets
a detector, that detector still appears in the UI with event fraction `0`.

For the average shown in the detector panel and the Analysis view:

$$\bar{P} = \frac{1}{N}\sum_{d=0}^{N-1} P(D_d)$$

**Code**:
- `circuitscope/event_fraction_utils.py` (`detector_probability_from_independent_toggles`)
- `circuitscope/event_fraction_utils.py` (`detector_event_fractions_from_dem`)
- `circuitscope/formula_generator.py` (`generate_average_formula`)

---

## 3. Probability Sources

CircuitScope uses two related probability sources.

### DEM Terms

For event fractions, the backend asks Stim for a detector error model. In the
export path, it uses a flattened DEM with approximate disjoint errors enabled:

```python
circuit.detector_error_model(
    flatten_loops=True,
    approximate_disjoint_errors=True,
)
```

Each DEM `error(p)` is then treated as one independent toggle opportunity for
each detector target listed by that term.

### Circuit Locations

For detailed budgets and generated formulas, CircuitScope also asks Stim to map
DEM errors back to circuit locations with
`stim.Circuit.explain_detector_error_model_errors()`. CircuitScope extracts a
user-facing parameter from each explained location:

| Circuit location | User-facing parameter |
|------------------|-----------------------|
| `X_ERROR(p)`, `Y_ERROR(p)`, `Z_ERROR(p)` | `p` |
| `CORRELATED_ERROR(p)` | `p` |
| `DEPOLARIZE1(d)` | original depolarizing probability `d` |
| `DEPOLARIZE2(d)` | original depolarizing probability `d` |

`DEPOLARIZE1` and `DEPOLARIZE2` are converted to effective independent Pauli
probabilities before being combined. Other Stim noise channels need explicit
probability extraction in `event_fraction_utils.py` and `formula_generator.py`
before they participate in analytical budgets and formulas.

---

## 4. Depolarizing Decorrelation

Stim's `DEPOLARIZE1` and `DEPOLARIZE2` gates are disjoint Pauli channels: at
most one non-identity Pauli outcome is selected. The event-fraction formula
needs independent toggle probabilities, so CircuitScope uses decorrelated
probabilities following https://algassert.com/post/2001.

### DEPOLARIZE1 (Single-Qubit)

For a single-qubit depolarizing channel with parameter $d$ (probability of any non-identity Pauli):

$$p_{\text{eff}} = \frac{1}{2} - \frac{1}{2}\sqrt{1 - \frac{4d}{3}}$$

This is the independent probability assigned to each of the three Pauli
opportunities `X`, `Y`, and `Z`. It is not simply the disjoint probability
`d/3`, though for small `d`, $p_{\text{eff}} \approx d/3$.

**Code**: `circuitscope/event_fraction_utils.py` (`_decorrelated_depolarize1_independent_pauli_p`)

### DEPOLARIZE2 (Two-Qubit)

For a two-qubit depolarizing channel with parameter $d$ (probability of any non-identity Pauli pair):

$$p_{\text{eff}} = \frac{1}{2} - \frac{1}{2}\left(1 - \frac{16d}{15}\right)^{1/8}$$

This is the independent probability assigned to each of the 15 non-identity
two-qubit Pauli opportunities. For small `d`, $p_{\text{eff}} \approx d/15$.

**Code**: `circuitscope/event_fraction_utils.py` (`_decorrelated_depolarize2_independent_pauli_p`)

### Ranges

These decorrelation formulas are real-valued up to:

- `DEPOLARIZE1`: $d \le 3/4$
- `DEPOLARIZE2`: $d \le 15/16$

CircuitScope clamps formula inputs to those maxima in its decorrelation helpers
and uses the same maxima in the Analysis view parameter controls.

---

## 5. Contribution Budgets

The sidebar's contribution breakdown explains which mechanisms are responsible
for a selected detector's event fraction. These contributions are log-weight
budget shares. They are useful for ranking mechanisms, but they deviate from a linear budget at higher error rates.

### Error Grouping

Errors are grouped by keys such as:

| Example key | Meaning |
|-------------|---------|
| `DEPOLARIZE1:X0` | Single-qubit depolarization causing `X` on qubit 0 |
| `DEPOLARIZE2 q0,q1:X0*Z1` | Two-qubit depolarization on pair `(0, 1)` causing `X0*Z1` |
| `X_ERROR:X2` | Explicit `X_ERROR` on qubit 2 |

For `DEPOLARIZE2`, the qubit pair is included so different pairs are budgeted
separately.

### "If Alone" Calculation

For each group $g$, CircuitScope also computes the event fraction that would
result if only that group could occur:

$$P_{\text{alone}}(g) = \frac{1}{2}\left(1 - \prod_{j \in g}(1 - 2p_j)\right)$$

### Log-Weight Share

To attribute contributions, CircuitScope uses log-weights. For each error group $g$ (say, X_ERRORs on qubit 5):

$$w_g = \sum_{j \in g} -\log(1 - 2p_j)$$

The **contribution** of group $g$ is:

$$s_g = \frac{w_g}{\sum_{g'} w_{g'}}$$

This is useful because the detector's parity bias is multiplicative:

$$1 - 2P(D) = \prod_i (1 - 2p_i)$$

Taking logs makes the terms additive:

$$\log(1 - 2P(D)) = \sum_i \log(1 - 2p_i)$$

If group $g$ has share $s_g$ and the original detector probability is $P$, the
probability after removing that group and leaving all other groups unchanged is:

$$P_{\text{removed}}(g) = \frac{1}{2}\left(1 - (1 - 2P)^{1 - s_g}\right)$$

For small probabilities, this is approximately:

$$P_{\text{removed}}(g) \approx P(1 - s_g)$$

For the "Average" selection in the Analysis view, CircuitScope cannot use one
global parity bias because $\bar{P}$ is a mean of detector probabilities.
Instead, it computes each detector's log-weight shares and reports the
$P(D_d)$-weighted mean:

$$S_j=\frac{\sum_d P(D_d)\,s_{jd}}{\sum_d P(D_d)}$$

where:

$$s_{jd}=\frac{w_{jd}}{\sum_k w_{kd}}, \quad
w_{jd}=c_{jd}\cdot(-\log(1-2p_{\text{eff},j}))$$

In the low-noise regime, this behaves like the usual linear budget of the
average event fraction.

**Code**: `circuitscope/event_fraction_utils.py` (`detector_error_budgets_from_explain`)

---

## 6. Analysis Formulas

The Analysis view generates Python functions for a selected detector or for the
average across all detectors. It also recomputes event fractions, sensitivities,
and contribution shares client-side while the user adjusts parameters.

### Parameter Selection

Errors are grouped by `(gate_type, original_value)` pairs in the input Stim
circuit. Each unique pair becomes a function parameter:

| Circuit Error | Parameter Name |
|--------------|----------------|
| `DEPOLARIZE2(0.001)` | `p_depolarize2_0_001` |
| `X_ERROR(0.002)` | `p_x_error_0_002` |
| `DEPOLARIZE2(0.01)` | `p_depolarize2_0_01` |

To explore different unique parameters, just make their error rates distinguishable in the circuit input.

### Table Fields

| Field | Description |
|-------|-------------|
| **Value** | Current error probability (adjustable via slider or text input) |
| **Count** | Unique gate instances shown in the UI when available; generated formulas use the underlying independent-toggle count |
| **Sensitivity** | Partial derivative $\partial P / \partial p$ |
| **Contribution** | Log-weight share of the current event-fraction budget |

### Sensitivity Formula

The sensitivity tells you how much the event fraction changes per unit change in
the error rate. It is computed like this:

$$\frac{\partial P}{\partial p_j} = c_j \cdot \frac{\partial p_{\text{eff},j}}{\partial p_j} \cdot \frac{\prod_i (1 - 2p_{\text{eff},i})^{c_i}}{1 - 2p_{\text{eff},j}}$$

where:
- $c_j$ is the count for parameter $j$
- $\frac{\partial p_{\text{eff},j}}{\partial p_j}$ is the derivative of the
  effective probability with respect to the original parameter
- The fraction accounts for the product rule in the core formula

### Derivatives by Gate Type

| Gate Type | $\frac{\partial p_{\text{eff}}}{\partial (\text{original parameter})}$ |
|-----------|---------------------------------------------|
| `X_ERROR`, `Y_ERROR`, `Z_ERROR`, `CORRELATED_ERROR`, measurement flips | $1$ |
| `DEPOLARIZE1` | $\displaystyle\frac{1}{3\sqrt{1 - \frac{4d}{3}}}$ |
| `DEPOLARIZE2` | $\displaystyle\frac{1}{15}\left(1 - \frac{16d}{15}\right)^{-7/8}$ |

For explicit error and measurement-flip probabilities, the original parameter is
already the independent toggle probability. For depolarizing channels, the
original parameter is `d`, so the derivative follows from the decorrelation
formula.

**Code**: `circuitscope/formula_generator.py` (`_p_eff_derivative`)

### Average Event Fraction

When "Average" is selected, the formula computes the mean across all detectors:

$$\bar{P} = \frac{1}{N}\sum_{d=0}^{N-1} P(D_d)$$

Each detector may have different counts for each parameter, so the generated function includes a per-detector breakdown.

### Average Sensitivity

Since the average is a linear combination:

$$\frac{\partial \bar{P}}{\partial p} = \frac{1}{N}\sum_{d=0}^{N-1} \frac{\partial P(D_d)}{\partial p}$$

The average sensitivity is the mean of the individual detector sensitivities.

**Code**:
- Backend formula generation: `circuitscope/formula_generator.py` (`generate_average_formula`)
- Frontend real-time computation: `src/utils/eventFraction.js`

---

## 7. Stim REPEAT Loops

Stim `REPEAT` blocks let users write repeated syndrome rounds compactly.
CircuitScope preserves the submitted source text, including `REPEAT` blocks, for
Code view display and copying.

For analysis surfaces that need concrete positions or ordering, the backend uses
a flattened Stim circuit:

- timeline operations
- measurement records
- detector positions
- detecting-region tick maps

For detector event fractions, the DEM utility asks Stim for a flattened DEM by
default. It can also traverse looped DEMs directly when `flatten_loops=False` by
recursively visiting `repeat` blocks and applying `shift_detectors`. Tests check
that compact repeated circuits match their manually flattened equivalents for
exports, DEM traversal, formula generation, and Monte Carlo validation.

---

## 8. Implementation Reference

### Quantities

| Quantity | Meaning | Primary code |
|----------|---------|--------------|
| Detector event fraction | $P(D)$ from independent DEM toggles | `circuitscope/event_fraction_utils.py` |
| Average event fraction | Arithmetic mean over detectors | `circuitscope/formula_generator.py` |
| "If alone" probability | Core formula restricted to one budget group | `circuitscope/event_fraction_utils.py` |
| Budget share | Log-weight share of one detector's parity-bias budget | `circuitscope/event_fraction_utils.py` |
| Sensitivity | Partial derivative of event fraction with respect to one circuit parameter | `circuitscope/formula_generator.py`, `src/utils/eventFraction.js` |
| Average contribution | $P(D)$-weighted mean of per-detector log-weight shares | `src/utils/eventFraction.js` |

### Conversions and Stim APIs

| Item | Purpose | Primary code |
|------|---------|--------------|
| `DEPOLARIZE1` decorrelation | Convert disjoint one-qubit depolarization to independent Pauli probability | `circuitscope/event_fraction_utils.py` |
| `DEPOLARIZE2` decorrelation | Convert disjoint two-qubit depolarization to independent Pauli-pair probability | `circuitscope/event_fraction_utils.py` |
| `stim.Circuit.detector_error_model()` | Extract independent detector error terms | `circuitscope/analyzer.py` |
| `stim.Circuit.explain_detector_error_model_errors()` | Map DEM terms back to circuit locations | `circuitscope/analyzer.py`, `circuitscope/event_fraction_utils.py` |
| `stim.Circuit.detecting_regions()` | Compute detecting-region overlays | `circuitscope/analyzer.py` |
| `stim.Circuit.compile_detector_sampler()` | Monte Carlo validation in tests | `tests/test_monte_carlo.py` |

For documentation on these functions, see the [Stim documentation](https://github.com/quantumlib/Stim).

---

## 9. Core Formula Derivation

Let $X_k$ be independent Bernoulli variables where $X_k=1$ means error
opportunity $k$ toggles detector $D$. The detector fires when the parity is odd:

$$S = X_1 \oplus X_2 \oplus \cdots$$

Define the parity bias:

$$b = P(S=0) - P(S=1) = 1 - 2P(D)$$

Because $(-1)^S$ is `+1` for even parity and `-1` for odd parity:

$$b = \mathbb{E}[(-1)^S]$$

For independent toggles:

$$(-1)^S = \prod_k (-1)^{X_k}$$

and the expectation factors:

$$b = \prod_k \mathbb{E}[(-1)^{X_k}]$$

For a single Bernoulli toggle with probability $p_k$:

$$\mathbb{E}[(-1)^{X_k}] = (1-p_k)(+1) + p_k(-1) = 1 - 2p_k$$

Therefore:

$$b = \prod_k (1 - 2p_k)$$

If a mechanism $i$ appears $c_i$ times, this becomes:

$$b = \prod_i (1 - 2p_{\text{eff},i})^{c_i}$$

Substituting into $P(D)=\frac{1}{2}(1-b)$ gives the core event-fraction
formula.

---

## 10. Measured-Data Parameter Fitting

Implemented in `src/utils/parameterFit.js` (tested by `npm run test:js`).

### Linearization

Every detector's event fraction has the form

$$P_i = \frac{1}{2}\left(1 - \prod_j (1 - 2q_j)^{c_{ij}}\right)$$

where $q_j$ is the effective toggle probability of parameter $j$ and
$c_{ij}$ is the integer count matrix exported by the average formula
(`detector_counts`). In the transformed coordinates

$$y_i = \ln(1 - 2P_i), \qquad x_j = \ln(1 - 2q_j)$$

the model is exactly linear:

$$y = C\,x$$

so fitting measured fractions is closed-form weighted linear least squares —
no iterative optimizer. Fractions at or above $1/2$ saturate the transform
and carry no rate information; they are clamped with a warning.

### Weights

Under the model-is-correct hypothesis (the same convention as the displayed
z-scores), a measured fraction has standard deviation

$$\sigma_{P_i} = \sqrt{\max\!\big(p_i(1-p_i),\, 1/N\big)/N}$$

for $N$ shots, which propagates to the transformed coordinate as

$$\sigma_{y_i} = \frac{2\,\sigma_{P_i}}{1 - 2p_i}$$

evaluated at the nominal model. Weights are $w_i = 1/\sigma_{y_i}^2$
(uniform when no shot count is given). Reported $\chi^2$ values are
recomputed in probability space under each candidate model, so they match
the z-scores shown elsewhere in the app.

### Ridge anchor and constraints

The normal equations are regularized toward the nominal rates:

$$\min_x\; \|W^{1/2}(y - Cx)\|^2 + \sum_j \lambda_j (x_j - x_j^0)^2,
\qquad \lambda_j = 10^{-6}\,(C^\top W C)_{jj}$$

Rank-deficient directions of $C$ (parameters that only appear in fixed
combinations) stay at the model the user wrote down instead of exploding;
well-constrained parameters are essentially unaffected. Rates cannot be
negative, which in transformed coordinates means $x_j \le 0$: positive
solutions are clamped to the zero-rate boundary and the remaining free
parameters refit (a small active-set loop).

Per-parameter uncertainties come from the inverse of the (ridge-stabilized)
normal matrix, converted to raw-rate units through
$\mathrm{d}p/\mathrm{d}x = \tfrac{1}{2}e^{x} \big/ (\mathrm{d}q/\mathrm{d}p)$
and the closed-form inverse decorrelation
($d = \tfrac{3}{4}(1 - e^{2x})$ for `DEPOLARIZE1`,
$d = \tfrac{15}{16}(1 - e^{8x})$ for `DEPOLARIZE2`).

### Scenario ranking

The experimentalist's question is sparse — "which knob is off" — so the
headline output is not the dense fit but a ranked scenario list:

- **Single knob**: for each parameter, a 1-D weighted fit with all others at
  nominal, ranked by resulting $\chi^2/\mathrm{dof}$.
- **Two knobs**: greedy forward selection — the best single knob refit
  jointly with each remaining parameter (shown only when this meaningfully
  beats the best single).
- **Dense fit**: all constrained parameters at once — the best-achievable
  floor. If even this $\chi^2/\mathrm{dof}$ is poor, no rate adjustment
  explains the data and the model is likely missing a mechanism.

### Identifiability

- Parameters with all-zero count columns over the measured detectors have no
  leverage and are reported as unconstrained.
- Exactly proportional count columns are grouped and reported: only the
  combination of those parameters is constrained by the data.
- Identical rows of $C$ (detectors in the bulk of repeated rounds) are
  benign — they act as repeated measurements — and are surfaced as the
  "unique response patterns" count.
