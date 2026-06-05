"""Cross-method agreement tests for detector event fraction calculations."""

import pytest

from circuitscope.event_fraction_utils import (
    detector_event_fractions_from_dem,
    detector_error_budgets_from_explain,
    _decorrelated_depolarize1_independent_pauli_p,
    _decorrelated_depolarize2_independent_pauli_p,
)
from circuitscope.formula_generator import (
    generate_detector_formula,
    generate_average_formula,
)


class TestDEMvsExplainAgreement:
    """Test that DEM-based and explain-based calculations agree."""

    def test_dem_matches_explain_dem(self, example_circuit):
        """detector_event_fractions_from_dem should match det_p_dem from explain."""
        dem_fractions = detector_event_fractions_from_dem(example_circuit)
        budget_result = detector_error_budgets_from_explain(example_circuit)

        for det_id in range(len(dem_fractions)):
            assert dem_fractions[det_id] == pytest.approx(
                budget_result.det_p_dem[det_id], rel=1e-10
            ), f"DEM fraction mismatch for D{det_id}"

    def test_explain_reconstruction_matches_dem(self, example_circuit):
        """det_p_from_explain should match det_p_dem."""
        budget_result = detector_error_budgets_from_explain(example_circuit)

        for det_id in range(len(budget_result.det_p_dem)):
            assert budget_result.det_p_from_explain[det_id] == pytest.approx(
                budget_result.det_p_dem[det_id], rel=1e-10
            ), f"Explain reconstruction mismatch for D{det_id}"


class TestFormulaMatchesDEM:
    """Test that generated formulas produce correct values."""

    def test_single_detector_formula(self, example_circuit):
        """Generated formula for each detector should match DEM calculation."""
        dem_fractions = detector_event_fractions_from_dem(example_circuit)
        num_detectors = example_circuit.num_detectors

        for det_id in range(num_detectors):
            result = generate_detector_formula(example_circuit, det_id)

            # Execute the generated function
            exec_globals = {}
            exec(result["python_code"], exec_globals)
            func_name = f"detector_D{det_id}_event_fraction"
            func = exec_globals[func_name]

            # Call with default (original) values
            computed = func()

            assert computed == pytest.approx(
                dem_fractions[det_id], rel=1e-9
            ), f"Formula for D{det_id} doesn't match DEM"

            # Also check returned original_event_fraction
            assert result["original_event_fraction"] == pytest.approx(
                dem_fractions[det_id], rel=1e-9
            ), f"original_event_fraction for D{det_id} doesn't match DEM"

    def test_average_formula_matches_mean(self, example_circuit):
        """Average formula should match arithmetic mean of detector fractions."""
        dem_fractions = detector_event_fractions_from_dem(example_circuit)
        expected_avg = sum(dem_fractions) / len(dem_fractions) if dem_fractions else 0.0

        result = generate_average_formula(example_circuit)

        # Execute the generated function
        exec_globals = {}
        exec(result["python_code"], exec_globals)
        func = exec_globals["average_detector_event_fraction"]

        computed_avg = func()

        assert computed_avg == pytest.approx(expected_avg, rel=1e-9)
        assert result["original_event_fraction"] == pytest.approx(expected_avg, rel=1e-9)


class TestDecorrelationFormulas:
    """Test the depolarization decorrelation formulas."""

    @pytest.mark.parametrize("d", [0.001, 0.003, 0.01, 0.03])
    def test_depol1_small_d_approximation(self, d):
        """For small d, DEPOLARIZE1 p_eff should be approximately d/3."""
        p_eff = _decorrelated_depolarize1_independent_pauli_p(d)
        # For small d: p_eff approx d/3
        assert p_eff == pytest.approx(d / 3, rel=0.05)

    @pytest.mark.parametrize("d", [0.001, 0.003, 0.015, 0.03])
    def test_depol2_small_d_approximation(self, d):
        """For small d, DEPOLARIZE2 p_eff should be approximately d/15."""
        p_eff = _decorrelated_depolarize2_independent_pauli_p(d)
        # For small d: p_eff approx d/15
        assert p_eff == pytest.approx(d / 15, rel=0.1)

    def test_depol1_zero(self):
        """Zero depolarization gives zero effective probability."""
        assert _decorrelated_depolarize1_independent_pauli_p(0.0) == 0.0

    def test_depol2_zero(self):
        """Zero depolarization gives zero effective probability."""
        assert _decorrelated_depolarize2_independent_pauli_p(0.0) == 0.0

    def test_depol1_clamping(self):
        """Large depolarization values should be clamped, not raise errors."""
        # d > 0.75 should clamp
        result = _decorrelated_depolarize1_independent_pauli_p(1.0)
        assert 0 <= result <= 0.5

    def test_depol2_clamping(self):
        """Large depolarization values should be clamped, not raise errors."""
        # d > 15/16 should clamp
        result = _decorrelated_depolarize2_independent_pauli_p(1.0)
        assert 0 <= result <= 0.5


class TestFormulaWithModifiedParams:
    """Test that formulas respond correctly to parameter changes."""

    def test_increasing_error_increases_event_fraction(self, bit_flip_d3_circuit):
        """Increasing error probability should increase event fraction."""
        result = generate_detector_formula(bit_flip_d3_circuit, 0)

        exec_globals = {}
        exec(result["python_code"], exec_globals)
        func_name = "detector_D0_event_fraction"
        func = exec_globals[func_name]

        # Get first parameter
        params = result["parameters"]
        assert len(params) > 0, "Expected at least one parameter"

        param_name = params[0]["name"]
        original_val = params[0]["original_value"]

        p_low = func(**{param_name: original_val * 0.5})
        p_original = func()
        p_high = func(**{param_name: original_val * 2.0})

        assert p_low < p_original < p_high, (
            f"Event fraction should increase with error rate: "
            f"p_low={p_low}, p_original={p_original}, p_high={p_high}"
        )

    def test_zero_error_gives_lower_fraction(self, bit_flip_d3_circuit):
        """Setting an error parameter to zero should reduce event fraction."""
        result = generate_detector_formula(bit_flip_d3_circuit, 0)

        exec_globals = {}
        exec(result["python_code"], exec_globals)
        func = exec_globals["detector_D0_event_fraction"]

        params = result["parameters"]
        assert len(params) > 0

        param_name = params[0]["name"]

        p_original = func()
        p_zero = func(**{param_name: 0.0})

        assert p_zero <= p_original, "Zero error should give lower or equal fraction"
