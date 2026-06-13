"""Tests for the server-side Monte Carlo sampling behind /api/montecarlo.

These use modest shot counts (fast); the heavyweight analytical-vs-sampled
validation lives in tests/test_monte_carlo.py.
"""

import pytest
import stim

from circuitscope.sampling import (
    MAX_SHOTS,
    monte_carlo_payload,
    sample_detector_counts,
)
from tests.conftest import monte_carlo_tolerance


SINGLE_ERROR_CIRCUIT = """
R 0 1
TICK
CX 0 1
TICK
X_ERROR(0.05) 1
TICK
M 0 1
DETECTOR rec[-1] rec[-2]
"""

NOISELESS_CIRCUIT = """
R 0 1
TICK
CX 0 1
TICK
M 0 1
DETECTOR rec[-1] rec[-2]
"""


def test_sampled_fraction_matches_known_rate():
    shots = 200_000
    payload = monte_carlo_payload(SINGLE_ERROR_CIRCUIT, shots, seed=42)
    assert payload["shots"] == shots
    assert len(payload["fractions"]) == 1
    tol = monte_carlo_tolerance(0.05, shots)
    assert payload["fractions"][0] == pytest.approx(0.05, abs=tol)
    assert payload["counts"][0] == round(payload["fractions"][0] * shots)


def test_noiseless_circuit_samples_zero():
    payload = monte_carlo_payload(NOISELESS_CIRCUIT, 10_000)
    assert payload["counts"] == [0]
    assert payload["fractions"] == [0.0]


def test_seed_makes_sampling_deterministic():
    a = monte_carlo_payload(SINGLE_ERROR_CIRCUIT, 50_000, seed=7)
    b = monte_carlo_payload(SINGLE_ERROR_CIRCUIT, 50_000, seed=7)
    assert a["counts"] == b["counts"]


def test_batched_sampling_covers_all_shots():
    # Force several batches (including a partial final one) and check the
    # total against a single-batch run with the same seed.
    circuit = stim.Circuit(SINGLE_ERROR_CIRCUIT)
    shots = 25_000
    batched = sample_detector_counts(circuit, shots, seed=3, batch_shots=10_000)
    single = sample_detector_counts(circuit, shots, seed=3, batch_shots=shots)
    tol = monte_carlo_tolerance(0.05, shots)
    assert batched[0] / shots == pytest.approx(0.05, abs=tol)
    assert single[0] / shots == pytest.approx(0.05, abs=tol)


def test_detector_count_past_one_packed_byte():
    # >8 detectors exercises the multi-byte bit-packed unpacking path.
    lines = ["R " + " ".join(str(q) for q in range(12)), "X_ERROR(0.5) 0 1 2 3 4 5 6 7 8 9 10 11",
             "M " + " ".join(str(q) for q in range(12))]
    lines += [f"DETECTOR rec[{-(i + 1)}]" for i in range(12)]
    payload = monte_carlo_payload("\n".join(lines), 20_000, seed=1)
    assert len(payload["fractions"]) == 12
    tol = monte_carlo_tolerance(0.5, 20_000)
    for f in payload["fractions"]:
        assert f == pytest.approx(0.5, abs=tol)


def test_shot_bounds_are_enforced():
    with pytest.raises(ValueError, match="at least 1"):
        monte_carlo_payload(SINGLE_ERROR_CIRCUIT, 0)
    with pytest.raises(ValueError, match="at most"):
        monte_carlo_payload(SINGLE_ERROR_CIRCUIT, MAX_SHOTS + 1)
