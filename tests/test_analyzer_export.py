"""Analyzer export contract tests."""

from circuitscope.analyzer import analyze_circuit_text


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
