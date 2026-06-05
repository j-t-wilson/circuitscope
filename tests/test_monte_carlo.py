"""Monte Carlo validation tests for detector event fraction calculations.

These tests validate analytical calculations against stochastic sampling.
They are marked as slow and can be skipped with: pytest -m "not slow"
"""

import pytest
import stim

from circuitscope.event_fraction_utils import detector_event_fractions_from_dem
from circuitscope.formula_generator import generate_average_formula
from tests.conftest import (
    EXAMPLE_CIRCUITS,
    monte_carlo_tolerance,
)


# Number of samples - 10 million gives good precision while running fast
N_SAMPLES = 10_000_000


@pytest.mark.slow
class TestMonteCarloValidation:
    """Validate analytical calculations against Monte Carlo sampling."""

    @pytest.mark.parametrize(
        "circuit_str,name",
        [(circuit_str, name) for name, circuit_str in EXAMPLE_CIRCUITS.items()],
    )
    def test_dem_fractions_match_monte_carlo(self, circuit_str, name):
        """Analytical event fractions should match Monte Carlo within tolerance."""
        circuit = stim.Circuit(circuit_str)

        # Analytical calculation
        analytical = detector_event_fractions_from_dem(circuit)

        # Monte Carlo sampling
        sampler = circuit.compile_detector_sampler()
        samples = sampler.sample(N_SAMPLES)
        empirical = samples.mean(axis=0)

        for det_id in range(len(analytical)):
            p = analytical[det_id]
            tol = monte_carlo_tolerance(p, N_SAMPLES)

            assert empirical[det_id] == pytest.approx(p, abs=tol), (
                f"{name} D{det_id}: analytical={p:.6f}, "
                f"empirical={empirical[det_id]:.6f}, tolerance={tol:.6f}"
            )

    @pytest.mark.parametrize(
        "circuit_str,name",
        [(circuit_str, name) for name, circuit_str in EXAMPLE_CIRCUITS.items()],
    )
    def test_average_formula_matches_monte_carlo(self, circuit_str, name):
        """Average formula should match Monte Carlo average within tolerance."""
        circuit = stim.Circuit(circuit_str)

        # Monte Carlo average across all samples and detectors
        sampler = circuit.compile_detector_sampler()
        samples = sampler.sample(N_SAMPLES)
        empirical_avg = samples.mean()

        # Analytical average via formula
        result = generate_average_formula(circuit)
        exec_globals = {}
        exec(result["python_code"], exec_globals)
        analytical_avg = exec_globals["average_detector_event_fraction"]()

        # For average, tolerance is reduced by averaging over detectors
        # Total samples effectively = N_SAMPLES * num_detectors
        num_det = circuit.num_detectors
        tol = monte_carlo_tolerance(analytical_avg, N_SAMPLES * num_det)

        assert empirical_avg == pytest.approx(analytical_avg, abs=tol * 2), (
            f"{name}: analytical_avg={analytical_avg:.6f}, "
            f"empirical_avg={empirical_avg:.6f}, tolerance={tol * 2:.6f}"
        )


@pytest.mark.slow
class TestEdgeCases:
    """Test edge cases with Monte Carlo validation."""

    def test_zero_error_circuit(self):
        """Circuit with no errors should have zero event fractions."""
        circuit = stim.Circuit(
            """
            R 0 1
            TICK
            CX 0 1
            TICK
            M 0 1
            DETECTOR rec[-1] rec[-2]
        """
        )

        # Analytical should be zero
        fractions = detector_event_fractions_from_dem(circuit)
        assert all(f == 0.0 for f in fractions)

        # Monte Carlo should also be zero (or very close)
        sampler = circuit.compile_detector_sampler()
        samples = sampler.sample(100_000)
        empirical = samples.mean(axis=0)
        assert all(e == 0.0 for e in empirical)

    def test_single_error_circuit(self):
        """Simple circuit with one X_ERROR should match Monte Carlo."""
        p_error = 0.05
        # X_ERROR after CX flips only one measurement, causing detector to fire
        circuit = stim.Circuit(
            f"""
            R 0 1
            TICK
            CX 0 1
            TICK
            X_ERROR({p_error}) 1
            TICK
            M 0 1
            DETECTOR rec[-1] rec[-2]
        """
        )

        # Analytical
        analytical = detector_event_fractions_from_dem(circuit)
        assert len(analytical) == 1

        # Monte Carlo
        sampler = circuit.compile_detector_sampler()
        samples = sampler.sample(N_SAMPLES)
        empirical = samples.mean(axis=0)

        tol = monte_carlo_tolerance(analytical[0], N_SAMPLES)
        assert empirical[0] == pytest.approx(analytical[0], abs=tol)

        # The analytical result should be exactly p_error
        # since X_ERROR on one qubit flips that measurement, triggering detector
        assert analytical[0] == pytest.approx(p_error, rel=1e-9)
