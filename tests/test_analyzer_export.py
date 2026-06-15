"""Analyzer export contract tests."""

import pytest

from circuitscope.analyzer import analyze_circuit_text
from .conftest import EXAMPLE_CIRCUITS


def test_export_includes_detectors_without_error_terms():
    circuit_text = """R 0 1
X_ERROR(0.1) 0
M 0 1
DETECTOR rec[-1]
DETECTOR rec[-2]"""

    result = analyze_circuit_text(circuit_text)

    assert [det["name"] for det in result["detectors"]] == ["D0", "D1"]
    assert result["detectors"][0]["event_fraction"] == 0
    assert result["detectors"][1]["event_fraction"] > 0


def test_error_location_instruction_index_disambiguates_mr_bookends():
    """Two same-rate flips bracketing a composite MR must be told apart.

    A circuit's before-measure and after-reset flips can share the same
    (tick, qubit, name, rate), so the timeline-highlight key needs the exact
    instruction index. Here only the before-measure flip (A) flips D0; the
    after-reset flip (B) flips only D1. Selecting D0 must highlight A and not
    its bookend twin B. Regression for the MR false-positive highlighting bug.
    """
    text = """R 0 1
X_ERROR(0.01) 1
MR 1
X_ERROR(0.01) 1
DETECTOR rec[-1]
TICK
MR 1
DETECTOR rec[-1] rec[-2]"""

    data = analyze_circuit_text(text)

    # The two flips live at the same tick but are distinct instructions.
    flips = [
        {"tick": t["tick"], "instruction_index": op["instruction_index"]}
        for t in data["timeline"]
        for op in t["ops"]
        if op["name"] == "X_ERROR"
    ]
    assert len(flips) == 2
    assert flips[0]["tick"] == flips[1]["tick"]
    assert flips[0]["instruction_index"] != flips[1]["instruction_index"]
    flip_a, flip_b = (f["instruction_index"] for f in flips)

    def relevant_flip_indices(detector):
        idx = set()
        for err in data["detector_errors"]:
            if any(term["target"] == detector for term in err["dem_terms"]):
                for loc in err["locations"]:
                    if loc["instruction_name"] == "X_ERROR":
                        idx.add(loc["instruction_index"])
        return idx

    # D0 is flipped only by the before-measure flip A, never its after-reset twin B.
    assert relevant_flip_indices("D0") == {flip_a}
    # D1 is genuinely flipped by both.
    assert relevant_flip_indices("D1") == {flip_a, flip_b}


@pytest.mark.parametrize("name", list(EXAMPLE_CIRCUITS))
def test_error_location_instruction_index_matches_timeline(name):
    """Every error location's instruction_index points to the matching timeline op.

    The highlight key relies on this index agreeing with the timeline's, so a
    drift here would silently mis-highlight (or fail to highlight) errors.
    """
    data = analyze_circuit_text(EXAMPLE_CIRCUITS[name])

    timeline_name_by_index = {
        op["instruction_index"]: op["name"]
        for tick in data["timeline"]
        for op in tick["ops"]
    }

    for err in data["detector_errors"]:
        for loc in err["locations"]:
            idx = loc["instruction_index"]
            assert idx >= 0, f"{name}: location {loc} has no instruction index"
            assert timeline_name_by_index.get(idx) == loc["instruction_name"], (
                f"{name}: index {idx} -> {timeline_name_by_index.get(idx)} "
                f"!= {loc['instruction_name']}"
            )
