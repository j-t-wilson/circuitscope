"""Server-side Monte Carlo sampling of detector event fractions.

Exposes the same cross-check the test suite performs (analytical event
fractions vs stochastic detector sampling) so the UI can overlay sampled
fractions next to the analytical ones.
"""

from typing import List, Optional

import numpy as np
import stim


# Hard cap on a single request; keeps a local server responsive while still
# allowing precision well past the default (sigma ~ sqrt(p/shots)).
MAX_SHOTS = 100_000_000

DEFAULT_SHOTS = 1_000_000

# Shots sampled per batch. Bounds peak memory (bit-packed, so one batch is
# BATCH_SHOTS * ceil(num_detectors / 8) bytes) regardless of requested shots.
BATCH_SHOTS = 1_000_000


def sample_detector_counts(
    circuit: stim.Circuit,
    shots: int,
    seed: Optional[int] = None,
    batch_shots: int = BATCH_SHOTS,
) -> List[int]:
    """Sample the circuit and return per-detector firing counts.

    Samples in bit-packed batches so large shot counts don't materialize a
    shots x detectors boolean array.
    """
    num_detectors = circuit.num_detectors
    if num_detectors == 0 or shots <= 0:
        return [0] * num_detectors

    sampler = circuit.compile_detector_sampler(seed=seed)
    counts = np.zeros(num_detectors, dtype=np.int64)
    remaining = shots
    while remaining > 0:
        n = min(remaining, batch_shots)
        packed = sampler.sample(n, bit_packed=True)
        bits = np.unpackbits(packed, axis=1, count=num_detectors, bitorder="little")
        counts += bits.sum(axis=0, dtype=np.int64)
        remaining -= n
    return [int(c) for c in counts]


def monte_carlo_payload(circuit_text: str, shots: int, seed: Optional[int] = None) -> dict:
    """Build the /api/montecarlo response: sampled counts and fractions.

    Raises ValueError on an invalid circuit or out-of-range shot count.
    """
    if shots < 1:
        raise ValueError("shots must be at least 1")
    if shots > MAX_SHOTS:
        raise ValueError(f"shots must be at most {MAX_SHOTS:,}".replace(",", "_"))
    circuit = stim.Circuit(circuit_text)
    counts = sample_detector_counts(circuit, shots, seed=seed)
    return {
        "shots": shots,
        "counts": counts,
        "fractions": [c / shots for c in counts],
    }
