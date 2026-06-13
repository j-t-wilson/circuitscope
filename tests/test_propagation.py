"""Tests for Pauli error propagation (/api/propagate backing logic).

The strongest check is cross-validation against stim's own DEM explanations:
for every error mechanism location in the example circuits, propagating its
flipped Pauli product forward must flip exactly the detectors the DEM says
that mechanism flips.
"""

import pytest
import stim

from circuitscope.analyzer import CircuitScopeAnalyzer
from circuitscope.propagation import parse_pauli_product, propagate_pauli
from circuitscope.server import app


SPREAD_CIRCUIT = """R 0 1
TICK
X_ERROR(0.1) 0
TICK
CX 0 1
TICK
M 0 1
DETECTOR rec[-2]
DETECTOR rec[-1]"""


def frames_as_dict(result):
    """{tick: {qubit: pauli}} from a propagation result (int or str keys)."""
    return {
        int(tick): {term['qubit']: term['pauli'] for term in terms}
        for tick, terms in result['frames'].items()
    }


def test_parse_pauli_product():
    assert parse_pauli_product('X0') == {0: 1}
    assert parse_pauli_product('X0*Z2') == {0: 1, 2: 3}
    assert parse_pauli_product('Y11') == {11: 2}
    with pytest.raises(ValueError):
        parse_pauli_product('NO_PAULI')


def test_cx_spreads_x_to_target():
    result = propagate_pauli(SPREAD_CIRCUIT, 1, 'X_ERROR', [0], 'X0')
    assert frames_as_dict(result) == {
        1: {0: 'X'},
        2: {0: 'X'},          # entering the CX tick, not yet spread
        3: {0: 'X', 1: 'X'},  # after CX, hits both measurements
    }
    assert result['flipped_measurements'] == [0, 1]
    assert result['flipped_detectors'] == [0, 1]


def test_z_commutes_through_cx_control_measurement():
    result = propagate_pauli(SPREAD_CIRCUIT, 1, 'X_ERROR', [0], 'Z0')
    # Z on the control stays put and commutes with Z-basis measurement
    assert frames_as_dict(result) == {1: {0: 'Z'}, 2: {0: 'Z'}, 3: {0: 'Z'}}
    assert result['flipped_measurements'] == []
    assert result['flipped_detectors'] == []


def test_reset_absorbs_frame():
    circuit = """R 0
TICK
X_ERROR(0.1) 0
TICK
R 0
TICK
M 0
DETECTOR rec[-1]"""
    result = propagate_pauli(circuit, 1, 'X_ERROR', [0], 'X0')
    # The frame exists up to the reset, then is fully absorbed
    assert frames_as_dict(result) == {1: {0: 'X'}, 2: {0: 'X'}}
    assert result['flipped_measurements'] == []
    assert result['flipped_detectors'] == []


def test_measure_reset_flips_then_absorbs():
    circuit = """R 0
TICK
X_ERROR(0.1) 0
TICK
MR 0
TICK
M 0
DETECTOR rec[-1]
DETECTOR rec[-2]"""
    result = propagate_pauli(circuit, 1, 'X_ERROR', [0], 'X0')
    assert result['flipped_measurements'] == [0]
    # Only the detector referencing the MR result flips (rec[-2] = m0)
    assert result['flipped_detectors'] == [1]
    assert frames_as_dict(result) == {1: {0: 'X'}, 2: {0: 'X'}}


def test_measurement_basis_awareness():
    circuit = """RX 0
TICK
Z_ERROR(0.1) 0
TICK
MX 0
DETECTOR rec[-1]"""
    result = propagate_pauli(circuit, 1, 'Z_ERROR', [0], 'Z0')
    assert result['flipped_measurements'] == [0]
    assert result['flipped_detectors'] == [0]


def test_hadamard_conjugates_frame():
    circuit = """R 0
TICK
Z_ERROR(0.1) 0
TICK
H 0
TICK
M 0
DETECTOR rec[-1]"""
    result = propagate_pauli(circuit, 1, 'Z_ERROR', [0], 'Z0')
    assert frames_as_dict(result)[3] == {0: 'X'}
    assert result['flipped_detectors'] == [0]


def test_missing_instruction_raises():
    with pytest.raises(ValueError):
        propagate_pauli(SPREAD_CIRCUIT, 0, 'X_ERROR', [0], 'X0')


def test_propagation_matches_dem_explanations(example_circuit):
    """Every explained error location must flip exactly its DEM detectors."""
    analyzer = CircuitScopeAnalyzer(example_circuit)
    circuit_text = str(example_circuit)
    checked = 0
    for err in analyzer.get_detector_errors():
        expected = sorted(
            int(term['target'][1:])
            for term in err['dem_terms']
            if term['target'].startswith('D')
        )
        for loc in err['locations']:
            if 'NO_PAULI' in loc['pauli']:
                continue  # pure measurement-record flips have no Pauli to inject
            result = propagate_pauli(
                circuit_text,
                loc['tick_offset'],
                loc['instruction_name'],
                loc['qubits'],
                loc['pauli'],
            )
            assert result['flipped_detectors'] == expected, (
                f"{loc['instruction_name']} {loc['pauli']} at tick "
                f"{loc['tick_offset']}: propagated {result['flipped_detectors']}, "
                f"DEM says {expected}"
            )
            checked += 1
    assert checked > 0


def test_propagate_endpoint():
    client = app.test_client()
    resp = client.post('/api/propagate', json={
        'circuit_text': SPREAD_CIRCUIT,
        'tick': 1,
        'name': 'X_ERROR',
        'qubits': [0],
        'pauli': 'X0',
    })
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload['start_tick'] == 1
    assert payload['flipped_detectors'] == [0, 1]
    assert frames_as_dict(payload)[3] == {0: 'X', 1: 'X'}


def test_propagate_endpoint_rejects_missing_fields():
    client = app.test_client()
    resp = client.post('/api/propagate', json={
        'circuit_text': SPREAD_CIRCUIT,
        'tick': 1,
    })
    assert resp.status_code == 400
    assert 'error' in resp.get_json()
