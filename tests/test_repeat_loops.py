"""Regression tests for Stim REPEAT loop support."""

from copy import deepcopy

import pytest
import stim

from circuitscope.analyzer import analyze_circuit_text
from circuitscope.event_fraction_utils import (
    detector_error_budgets_from_explain,
    detector_event_fractions_from_dem,
)
from circuitscope.formula_generator import (
    generate_average_formula,
    generate_detector_formula,
)
from tests.conftest import EXAMPLE_CIRCUITS


REPEAT_EXAMPLES = list(EXAMPLE_CIRCUITS.items())


def _without_source_text(export):
    result = deepcopy(export)
    result.pop("circuit_text", None)
    return result


@pytest.mark.parametrize("name,circuit_text", REPEAT_EXAMPLES)
def test_repeat_examples_match_manual_unroll_in_analyzer_export(name, circuit_text):
    repeat_circuit = stim.Circuit(circuit_text)
    flat_text = str(repeat_circuit.flattened())

    assert "REPEAT" in circuit_text, f"{name} should exercise Stim REPEAT blocks"
    assert len(circuit_text.splitlines()) < len(flat_text.splitlines()), (
        f"{name} should be more compact than its manual unroll"
    )
    assert _without_source_text(analyze_circuit_text(circuit_text)) == _without_source_text(
        analyze_circuit_text(flat_text)
    )


@pytest.mark.parametrize("name,circuit_text", REPEAT_EXAMPLES)
def test_looped_detector_error_model_matches_flattened_detector_error_model(name, circuit_text):
    circuit = stim.Circuit(circuit_text)
    flattened = circuit.flattened()

    looped_dem_fractions = detector_event_fractions_from_dem(
        circuit,
        dem_kwargs={"flatten_loops": False, "approximate_disjoint_errors": True},
    )
    flattened_dem_fractions = detector_event_fractions_from_dem(
        flattened,
        dem_kwargs={"flatten_loops": True, "approximate_disjoint_errors": True},
    )

    assert looped_dem_fractions == pytest.approx(flattened_dem_fractions, rel=1e-12)

    looped_budget = detector_error_budgets_from_explain(
        circuit,
        dem_kwargs={"flatten_loops": False, "approximate_disjoint_errors": True},
    )
    assert looped_budget.det_p_dem == pytest.approx(looped_budget.det_p_from_explain, rel=1e-10)


@pytest.mark.parametrize("name,circuit_text", REPEAT_EXAMPLES)
def test_formula_generation_matches_manual_unroll_for_repeat_circuit(name, circuit_text):
    repeat_circuit = stim.Circuit(circuit_text)
    flat_circuit = repeat_circuit.flattened()

    for det_id in range(repeat_circuit.num_detectors):
        repeat_result = generate_detector_formula(repeat_circuit, det_id)
        flat_result = generate_detector_formula(flat_circuit, det_id)

        assert repeat_result["parameters"] == flat_result["parameters"]
        assert repeat_result["original_event_fraction"] == pytest.approx(
            flat_result["original_event_fraction"],
            rel=1e-12,
        )

    repeat_average = generate_average_formula(repeat_circuit)
    flat_average = generate_average_formula(flat_circuit)

    assert repeat_average["parameters"] == flat_average["parameters"]
    assert repeat_average["detector_counts"] == flat_average["detector_counts"]
    assert repeat_average["original_event_fraction"] == pytest.approx(
        flat_average["original_event_fraction"],
        rel=1e-12,
    )
