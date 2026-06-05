# CircuitScope

CircuitScope is an educational tool for understanding detector errors in
quantum error correction circuits. It helps answer three practical questions:
how likely is each detector to fire, which circuit error mechanisms can trigger
it, and how that response changes when error rates change.

CircuitScope accepts Stim circuits, uses Stim's detector error model and
explanation APIs for the underlying circuit analysis, and presents the result as
an interactive timeline, error budget, and analytical formula.

## Installation

CircuitScope requires Python 3.8+. Install from the repository:

```bash
git clone https://github.com/j-t-wilson/circuitscope
cd circuitscope
pip install .
```

This installs the `circuitscope` command and dependencies (stim, flask).

## Run

```bash
circuitscope                    # Opens browser automatically
circuitscope --port 8080        # Use a different port
circuitscope --no-browser       # Don't auto-open browser
circuitscope --host 0.0.0.0     # Bind to a different host
```

On launch, choose an example circuit or paste your own Stim circuit, then click
**Analyze Circuit**.

## Basic Workflow

1. Load a stim circuit.
2. Select a detector from the right panel.
3. Inspect the highlighted timeline, related measurements, and detector error model terms.
4. Open the Analysis view to generate a Python event-fraction formula.
5. Adjust parameter sliders to see sensitivities and what-if behavior.

## What You Can Inspect

- **Detector event fractions**: Per-detector firing probabilities and their
  average across the circuit.
- **Timeline context**: Qubits, gates, measurements, detector locations, error
  locations, and detecting-region overlays.
- **Error attribution**: Log-weight contribution shares and "If alone"
  probabilities for mechanisms affecting a selected detector.
- **Stim source and DEM terms**: Syntax-highlighted circuit source and detector
  error model entries linked to detector selection.
- **Analytical response**: Generated Python functions for a detector or for the
  average across all detectors, with sortable parameter sensitivities.

The formula and budget path currently focuses on Stim noise mechanisms with
direct probability extraction in CircuitScope: `X_ERROR`, `Y_ERROR`, `Z_ERROR`,
`CORRELATED_ERROR`, `DEPOLARIZE1`, `DEPOLARIZE2`, and measurement flip
probabilities. Additional Stim channels can be visualized in the timeline when
recognized, but need explicit probability extraction before they participate in
the analytical budget/formula path.

## Mathematical Details

The core calculation treats detector error model terms as independent toggles.
A detector fires when an odd number of toggles affect it:

$$P(D) = \frac{1}{2}\left(1 - \prod_i (1 - 2p_{\text{eff},i})^{c_i}\right)$$

The generated formulas handle `DEPOLARIZE1` and `DEPOLARIZE2` decorrelation
internally, so sliders and Python function parameters stay in terms of the
original circuit probabilities. See
[docs/mathematical_framework.md](docs/mathematical_framework.md) for the full
model, contribution-budget interpretation, sensitivity formulas, and Stim API
references.

## Development

For development, you'll need Node.js in addition to Python:

```bash
# Install Python package plus test dependency
pip install -e ".[dev]"

# Terminal 1: Run Python backend
python -m circuitscope.server --no-browser

# Terminal 2: Run frontend dev server (hot reload)
npm install
npm run dev

# Build for production
npm run build
```

The frontend dev server (port 5173) proxies `/api` requests to the Python backend on port 8050.

Run tests with:

```bash
pytest                  # Full suite
pytest -m "not slow"    # Skip Monte Carlo tests
pytest -v               # Verbose output
```

After changing frontend source under `src/`, run `npm run build` so the packaged
Flask app in `circuitscope/static/` stays in sync.
